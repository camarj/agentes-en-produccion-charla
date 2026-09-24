"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import {
  TEXTOS,
  agruparMensajes,
  clasificarError,
  indicadorDe,
  nuevaConversacion,
  obtenerHistorial,
  obtenerSugerencias,
  textoVisible,
  type MensajeChat,
} from "@/lib/chat-ui";
import { AvisoTope, BannerMantenimiento, BannerSinConexion } from "./banners";
import { Cabecera } from "./cabecera";
import { Composer } from "./composer";
import { EstadoVacio } from "./estado-vacio";
import { BannerInstalacion } from "./instalacion";
import { ListaMensajes } from "./lista-mensajes";

export const INTERVALO_REINTENTO_MS = 20_000;

// Solo viaja el último mensaje: el historial lo aporta la memoria del servidor.
const transporte = new DefaultChatTransport<MensajeChat>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
    body: { id, trigger, messageId, messages: messages.slice(-1) },
  }),
});

function suscribirConexion(aviso: () => void) {
  window.addEventListener("online", aviso);
  window.addEventListener("offline", aviso);
  return () => {
    window.removeEventListener("online", aviso);
    window.removeEventListener("offline", aviso);
  };
}

function useEnLinea(): boolean {
  return useSyncExternalStore(
    suscribirConexion,
    () => navigator.onLine,
    () => true,
  );
}

type Aviso = { tipo: "mantenimiento" | "tope"; mensaje: string } | null;

export interface PropsChat {
  nombrePila?: string;
  onSesionExpirada: () => void;
  // Cada cuánto se reintenta con el asistente en pausa (423).
  intervaloReintentoMs?: number;
}

export function Chat({ nombrePila, onSesionExpirada, intervaloReintentoMs = INTERVALO_REINTENTO_MS }: PropsChat) {
  const [cargando, setCargando] = useState(true);
  const [sugerencias, setSugerencias] = useState<string[]>([]);
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<Aviso>(null);
  const [interrumpida, setInterrumpida] = useState(false);
  // Una pregunta quedó sin enviar por falta de conexión: se reenvía al volver.
  const [pendienteRed, setPendienteRed] = useState(false);
  const enLinea = useEnLinea();
  const viewport = useVisualViewport();

  const { messages, sendMessage, regenerate, stop, status, setMessages } = useChat<MensajeChat>({
    transport: transporte,
    onError: (error) => {
      const e = clasificarError(error, navigator.onLine);
      switch (e.tipo) {
        case "sesion":
          toast.error(e.mensaje);
          onSesionExpirada();
          return;
        case "mantenimiento":
        case "tope":
          setAviso({ tipo: e.tipo, mensaje: e.mensaje });
          return;
        case "frecuencia":
          toast(TEXTOS.frecuencia);
          devolverAlComposer();
          return;
        case "invalido":
          toast.error(e.mensaje);
          devolverAlComposer();
          return;
        case "red":
          setPendienteRed(true);
          return;
        case "interrumpido":
          setInterrumpida(true);
      }
    },
    onFinish: ({ isError }) => {
      if (isError) return;
      setAviso((a) => (a?.tipo === "mantenimiento" ? null : a));
      setPendienteRed(false);
    },
  });

  // La pregunta rechazada (429 frecuencia, 400) vuelve al composer.
  function devolverAlComposer() {
    setMessages((actuales) => {
      const ultimo = actuales.at(-1);
      if (ultimo?.role !== "user") return actuales;
      setTexto(textoVisible(ultimo.parts));
      return actuales.slice(0, -1);
    });
  }

  const ocupado = status === "submitted" || status === "streaming";
  // Se sigue también el cambio de estado: al terminar aparecen las acciones o el aviso.
  const contenido = useMemo(() => [messages, status, interrumpida], [messages, status, interrumpida]);
  const scroll = useAutoScroll<HTMLDivElement>(contenido);
  const { irAlFinal } = scroll;

  // Hidratación: conversación guardada y sugerencias.
  useEffect(() => {
    let vigente = true;
    Promise.all([obtenerHistorial(), obtenerSugerencias()]).then(([historial, sugeridas]) => {
      if (!vigente) return;
      if (!historial.ok && historial.tipo === "http" && historial.status === 401) {
        toast.error(historial.mensaje);
        onSesionExpirada();
        return;
      }
      if (historial.ok && Array.isArray(historial.datos.messages)) setMessages(historial.datos.messages);
      if (sugeridas.ok && Array.isArray(sugeridas.datos.sugerencias)) setSugerencias(sugeridas.datos.sugerencias);
      setCargando(false);
    });
    return () => {
      vigente = false;
    };
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 423: reintento automático cada 20 s. El servidor revisa la pausa antes que
  // el rate limit y el contador: reintentar no llama al modelo ni gasta preguntas.
  const ocupadoRef = useRef(ocupado);
  const pendienteRedRef = useRef(pendienteRed);
  useEffect(() => {
    ocupadoRef.current = ocupado;
    pendienteRedRef.current = pendienteRed;
  }, [ocupado, pendienteRed]);
  const pausado = aviso?.tipo === "mantenimiento";
  useEffect(() => {
    if (!pausado) return;
    const id = window.setInterval(() => {
      if (!ocupadoRef.current) void regenerate();
    }, intervaloReintentoMs);
    return () => window.clearInterval(id);
  }, [pausado, intervaloReintentoMs, regenerate]);

  // Sin conexión: al volver, se reenvía la pregunta pendiente.
  useEffect(() => {
    const alVolver = () => {
      if (!pendienteRedRef.current || ocupadoRef.current) return;
      setPendienteRed(false);
      void regenerate();
    };
    window.addEventListener("online", alVolver);
    return () => window.removeEventListener("online", alVolver);
  }, [regenerate]);

  const enviar = useCallback(
    (pregunta: string) => {
      setInterrumpida(false);
      setTexto("");
      irAlFinal();
      void sendMessage({ text: pregunta });
    },
    [sendMessage, irAlFinal],
  );

  function reintentar() {
    setInterrumpida(false);
    irAlFinal();
    void regenerate();
  }

  async function empezarDeNuevo() {
    if (ocupado) await stop();
    const r = await nuevaConversacion();
    if (!r.ok) {
      if (r.tipo === "http" && r.status === 401) {
        toast.error(r.mensaje);
        onSesionExpirada();
      } else {
        toast.error(TEXTOS.errorNuevaConversacion);
      }
      return;
    }
    setMessages([]);
    setInterrumpida(false);
    setPendienteRed(false);
    setAviso((a) => (a?.tipo === "tope" ? a : null));
    const sugeridas = await obtenerSugerencias();
    if (sugeridas.ok && Array.isArray(sugeridas.datos.sugerencias)) setSugerencias(sugeridas.datos.sugerencias);
  }

  const deshabilitado = cargando || aviso !== null || pendienteRed;
  const grupos = agruparMensajes(messages);

  return (
    <div
      className="fixed inset-x-0 top-0 flex h-dvh flex-col bg-background"
      style={viewport ? { height: viewport.alto, transform: `translateY(${viewport.desplazamiento}px)` } : undefined}
    >
      <Cabecera onNuevaConversacion={empezarDeNuevo} />
      <BannerInstalacion />
      {!enLinea && <BannerSinConexion />}
      {aviso?.tipo === "mantenimiento" && status !== "streaming" && <BannerMantenimiento mensaje={aviso.mensaje} />}
      <ListaMensajes
        grupos={grupos}
        cargando={cargando}
        enCurso={ocupado}
        indicador={indicadorDe(status, messages)}
        interrumpida={interrumpida && !ocupado}
        scroll={scroll}
        onReintentar={reintentar}
        onSesionExpirada={onSesionExpirada}
        vacio={<EstadoVacio nombrePila={nombrePila} sugerencias={sugerencias} deshabilitado={deshabilitado} onElegir={enviar} />}
      />
      <div className="shrink-0 px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-[720px]">
          {aviso?.tipo === "tope" && <AvisoTope mensaje={aviso.mensaje} />}
          <Composer
            valor={texto}
            onCambiar={setTexto}
            onEnviar={enviar}
            onDetener={() => void stop()}
            ocupado={ocupado}
            deshabilitado={deshabilitado}
          />
        </div>
      </div>
    </div>
  );
}
