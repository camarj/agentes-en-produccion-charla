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
import { EstadoVacio, SugerenciasCompactas } from "./estado-vacio";
import { BannerInstalacion } from "./instalacion";
import { ListaMensajes } from "./lista-mensajes";

export const INTERVALO_REINTENTO_MS = 20_000;
// Tras estos reintentos fallidos con el asistente en pausa (~1 min), el aviso
// pasa a «Estamos presentando fallas…». Se sigue reintentando igual.
export const REINTENTOS_ANTES_DE_AVISO = 3;
// Las sugerencias cambian con la lámina actual: se vuelven a pedir cada 30 s.
export const INTERVALO_SUGERENCIAS_MS = 30_000;
// Pregunta en espera (423) guardada en este navegador: sobrevive a una recarga.
export const CLAVE_PENDIENTE = "charla:pregunta-pendiente";

interface Pendiente {
  texto: string;
  // 423 seguidos recibidos (la primera respuesta + los reintentos).
  fallas: number;
}

function leerPendiente(): Pendiente | null {
  try {
    const crudo = localStorage.getItem(CLAVE_PENDIENTE);
    if (!crudo) return null;
    const datos = JSON.parse(crudo) as Partial<Pendiente>;
    if (typeof datos.texto !== "string" || datos.texto.trim() === "") return null;
    return { texto: datos.texto, fallas: typeof datos.fallas === "number" && datos.fallas >= 0 ? datos.fallas : 0 };
  } catch {
    return null;
  }
}

function guardarPendiente(p: Pendiente) {
  try {
    localStorage.setItem(CLAVE_PENDIENTE, JSON.stringify(p));
  } catch {
    // sin almacenamiento: la espera sigue mientras la página esté abierta
  }
}

function borrarPendiente() {
  try {
    localStorage.removeItem(CLAVE_PENDIENTE);
  } catch {
    // sin almacenamiento
  }
}

const mismasSugerencias = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

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
  // Cada cuánto se vuelven a pedir las sugerencias.
  intervaloSugerenciasMs?: number;
}

export function Chat({
  nombrePila,
  onSesionExpirada,
  intervaloReintentoMs = INTERVALO_REINTENTO_MS,
  intervaloSugerenciasMs = INTERVALO_SUGERENCIAS_MS,
}: PropsChat) {
  const [cargando, setCargando] = useState(true);
  const [sugerencias, setSugerencias] = useState<string[]>([]);
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<Aviso>(null);
  const [interrumpida, setInterrumpida] = useState(false);
  // Una pregunta quedó sin enviar por falta de conexión: se reenvía al volver.
  const [pendienteRed, setPendienteRed] = useState(false);
  // 423 seguidos con la misma pregunta en espera.
  const [fallasPausa, setFallasPausa] = useState(0);
  const fallasPausaRef = useRef(0);
  const enLinea = useEnLinea();
  const viewport = useVisualViewport();

  const { messages, sendMessage, regenerate, stop, status, setMessages } = useChat<MensajeChat>({
    transport: transporte,
    onError: (error) => {
      const e = clasificarError(error, navigator.onLine);
      switch (e.tipo) {
        case "sesion":
          borrarPendiente();
          toast.error(e.mensaje);
          onSesionExpirada();
          return;
        case "mantenimiento": {
          setAviso({ tipo: e.tipo, mensaje: e.mensaje });
          const fallas = fallasPausaRef.current + 1;
          fallasPausaRef.current = fallas;
          setFallasPausa(fallas);
          const ultimo = mensajesRef.current.at(-1);
          if (ultimo?.role === "user") guardarPendiente({ texto: textoVisible(ultimo.parts), fallas });
          return;
        }
        case "tope":
          borrarPendiente();
          setAviso({ tipo: e.tipo, mensaje: e.mensaje });
          return;
        case "frecuencia":
          borrarPendiente();
          toast(TEXTOS.frecuencia);
          devolverAlComposer();
          return;
        case "invalido":
          borrarPendiente();
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
      fallasPausaRef.current = 0;
      setFallasPausa(0);
      borrarPendiente();
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

  const mensajesRef = useRef(messages);
  useEffect(() => {
    mensajesRef.current = messages;
  }, [messages]);

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
      const previos = historial.ok && Array.isArray(historial.datos.messages) ? historial.datos.messages : [];
      if (historial.ok && Array.isArray(historial.datos.messages)) setMessages(previos);
      if (sugeridas.ok && Array.isArray(sugeridas.datos.sugerencias)) setSugerencias(sugeridas.datos.sugerencias);
      setCargando(false);

      // Pregunta que quedó en espera (pausa) antes de recargar: se reenvía sola,
      // salvo que el servidor ya la haya respondido.
      const pendiente = leerPendiente();
      if (!pendiente) return;
      const ultimaPregunta = [...previos].reverse().find((m) => m.role === "user");
      if (ultimaPregunta && textoVisible(ultimaPregunta.parts) === pendiente.texto) {
        borrarPendiente();
        return;
      }
      fallasPausaRef.current = pendiente.fallas;
      setFallasPausa(pendiente.fallas);
      void sendMessage({ text: pendiente.texto });
    });
    return () => {
      vigente = false;
    };
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sugerencias vivas: siguen la lámina actual (cada 30 s y al volver a la pestaña).
  useEffect(() => {
    let vigente = true;
    const refrescar = async () => {
      const r = await obtenerSugerencias();
      if (!vigente || !r.ok || !Array.isArray(r.datos.sugerencias)) return;
      const nuevas = r.datos.sugerencias;
      setSugerencias((previas) => (mismasSugerencias(previas, nuevas) ? previas : nuevas));
    };
    const alVolver = () => {
      if (document.visibilityState !== "hidden") void refrescar();
    };
    const id = window.setInterval(() => void refrescar(), intervaloSugerenciasMs);
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      vigente = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [intervaloSugerenciasMs]);

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
    fallasPausaRef.current = 0;
    setFallasPausa(0);
    borrarPendiente();
    setAviso((a) => (a?.tipo === "tope" ? a : null));
    const sugeridas = await obtenerSugerencias();
    if (sugeridas.ok && Array.isArray(sugeridas.datos.sugerencias)) setSugerencias(sugeridas.datos.sugerencias);
  }

  const deshabilitado = cargando || aviso !== null || pendienteRed;
  const grupos = agruparMensajes(messages);
  // Tras 3 reintentos fallidos (la primera respuesta + 3), el aviso cambia.
  const mensajePausa = fallasPausa > REINTENTOS_ANTES_DE_AVISO ? TEXTOS.pausaProlongada : aviso?.mensaje ?? "";
  const enEspera = pausado && !ocupado && grupos.at(-1)?.role === "user";
  const conFilaSugerencias = !cargando && grupos.length > 0 && !ocupado && !deshabilitado;

  return (
    <div
      className="fixed inset-x-0 top-0 flex h-dvh flex-col bg-background"
      style={viewport ? { height: viewport.alto, transform: `translateY(${viewport.desplazamiento}px)` } : undefined}
    >
      <Cabecera onNuevaConversacion={empezarDeNuevo} />
      <BannerInstalacion />
      {!enLinea && <BannerSinConexion />}
      {aviso?.tipo === "mantenimiento" && status !== "streaming" && <BannerMantenimiento mensaje={mensajePausa} />}
      <ListaMensajes
        grupos={grupos}
        cargando={cargando}
        enCurso={ocupado}
        indicador={indicadorDe(status, messages)}
        interrumpida={interrumpida && !ocupado}
        enEspera={enEspera}
        scroll={scroll}
        onReintentar={reintentar}
        onSesionExpirada={onSesionExpirada}
        vacio={<EstadoVacio nombrePila={nombrePila} sugerencias={sugerencias} deshabilitado={deshabilitado} onElegir={enviar} />}
      />
      <div className="shrink-0 px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-[720px]">
          {aviso?.tipo === "tope" && <AvisoTope mensaje={aviso.mensaje} />}
          {conFilaSugerencias && <SugerenciasCompactas sugerencias={sugerencias} onElegir={enviar} />}
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
