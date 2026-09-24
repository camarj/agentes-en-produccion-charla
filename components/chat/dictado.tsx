"use client";

import { LoaderCircleIcon, MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { FOCO } from "@/components/acceso/marco";
import { TEXTOS } from "@/lib/chat-ui";
import { DURACION_MAXIMA_DICTADO_S, elegirTipoAudio } from "@/lib/transcripcion";
import { cn } from "@/lib/utils";

type Estado = "inactivo" | "grabando" | "transcribiendo";

const nada = () => () => {};

// El botón solo existe si el navegador puede grabar (MediaRecorder + getUserMedia).
function useDictadoSoportado(): boolean {
  return useSyncExternalStore(
    nada,
    () => typeof MediaRecorder !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function",
    () => false,
  );
}

const reloj = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

async function mensajeDe(r: Response): Promise<string | undefined> {
  try {
    const cuerpo = (await r.json()) as { mensaje?: unknown };
    return typeof cuerpo.mensaje === "string" ? cuerpo.mensaje : undefined;
  } catch {
    return undefined;
  }
}

export interface PropsDictado {
  deshabilitado: boolean;
  // Texto transcrito para insertar en el composer (nunca se envía solo).
  onTexto: (texto: string) => void;
  // 423: el asistente está en pausa.
  onPausa?: (mensaje: string) => void;
  // true mientras graba o transcribe (el chat no recarga en ese momento).
  onActivo?: (activo: boolean) => void;
}

// Dictado por voz: graba hasta 60 s, sube el audio a /api/transcribir y
// devuelve el texto. El audio no se guarda en ningún lado.
export function BotonDictado({ deshabilitado, onTexto, onPausa, onActivo }: PropsDictado) {
  const soportado = useDictadoSoportado();
  const [estado, setEstado] = useState<Estado>("inactivo");
  const [segundos, setSegundos] = useState(0);
  const grabador = useRef<MediaRecorder | null>(null);
  const flujo = useRef<MediaStream | null>(null);
  const relojes = useRef<number[]>([]);
  const inicio = useRef(0);
  const montado = useRef(true);

  useEffect(() => {
    onActivo?.(estado !== "inactivo");
  }, [estado, onActivo]);

  function limpiarRelojes() {
    for (const id of relojes.current) window.clearTimeout(id);
    relojes.current = [];
  }

  function soltarMicrofono() {
    for (const pista of flujo.current?.getTracks() ?? []) pista.stop();
    flujo.current = null;
  }

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      limpiarRelojes();
      const g = grabador.current;
      grabador.current = null;
      if (g && g.state !== "inactive") {
        g.onstop = null;
        g.stop();
      }
      soltarMicrofono();
    };
  }, []);

  async function subir(audio: Blob, tipo: string, duracionS: number) {
    setEstado("transcribiendo");
    try {
      const r = await fetch(`/api/transcribir?duracion=${duracionS}`, {
        method: "POST",
        headers: { "content-type": tipo },
        body: audio,
      });
      if (r.ok) {
        const cuerpo = (await r.json()) as { texto?: unknown };
        const texto = typeof cuerpo.texto === "string" ? cuerpo.texto.trim() : "";
        if (texto) onTexto(texto);
        else toast(TEXTOS.audioVacio);
      } else if (r.status === 429) {
        toast(TEXTOS.frecuencia);
      } else if (r.status === 423) {
        const mensaje = await mensajeDe(r);
        onPausa?.(mensaje ?? TEXTOS.errorDictado);
      } else {
        toast.error((await mensajeDe(r)) ?? TEXTOS.errorDictado);
      }
    } catch {
      toast.error(TEXTOS.errorDictado);
    } finally {
      if (montado.current) setEstado("inactivo");
    }
  }

  function detener() {
    const g = grabador.current;
    if (g && g.state !== "inactive") g.stop();
  }

  async function empezar() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const nombre = (error as { name?: unknown } | null)?.name;
      toast.error(nombre === "NotAllowedError" || nombre === "SecurityError" ? TEXTOS.permisoMicrofono : TEXTOS.microfonoNoDisponible);
      return;
    }
    if (!montado.current) {
      for (const pista of stream.getTracks()) pista.stop();
      return;
    }
    flujo.current = stream;
    const preferido = elegirTipoAudio((t) => MediaRecorder.isTypeSupported(t));
    let g: MediaRecorder;
    try {
      g = new MediaRecorder(stream, preferido ? { mimeType: preferido } : undefined);
    } catch {
      soltarMicrofono();
      toast.error(TEXTOS.microfonoNoDisponible);
      return;
    }
    const partes: Blob[] = [];
    g.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) partes.push(e.data);
    };
    g.onstop = () => {
      limpiarRelojes();
      soltarMicrofono();
      grabador.current = null;
      const duracion = Math.min(DURACION_MAXIMA_DICTADO_S, Math.max(1, Math.round((Date.now() - inicio.current) / 1000)));
      const tipo = (g.mimeType || preferido || partes[0]?.type || "audio/webm").trim();
      const audio = new Blob(partes, { type: tipo });
      if (audio.size === 0) {
        setEstado("inactivo");
        toast(TEXTOS.audioVacio);
        return;
      }
      void subir(audio, tipo, duracion);
    };
    grabador.current = g;
    inicio.current = Date.now();
    setSegundos(0);
    g.start();
    setEstado("grabando");
    // Reloj visible y corte automático a los 60 s.
    const tic = () => {
      const s = Math.min(DURACION_MAXIMA_DICTADO_S, Math.floor((Date.now() - inicio.current) / 1000));
      setSegundos(s);
      relojes.current.push(window.setTimeout(tic, 1000 - ((Date.now() - inicio.current) % 1000)));
    };
    relojes.current.push(window.setTimeout(tic, 1000));
    relojes.current.push(window.setTimeout(detener, DURACION_MAXIMA_DICTADO_S * 1000));
  }

  if (!soportado) return null;

  const grabando = estado === "grabando";
  const transcribiendo = estado === "transcribiendo";
  const etiqueta = grabando ? TEXTOS.detenerDictado : transcribiendo ? TEXTOS.transcribiendo : TEXTOS.dictar;

  return (
    <>
      {grabando && (
        <span className="flex shrink-0 items-center gap-1.5 self-center font-mono text-xs text-red-400 tabular-nums">
          <span aria-hidden="true" className="size-2 rounded-full bg-red-500 motion-safe:animate-pulse" />
          <span className="sr-only">{TEXTOS.grabando}</span>
          <span>{reloj(segundos)}</span>
        </span>
      )}
      <button
        type="button"
        aria-label={etiqueta}
        aria-pressed={grabando}
        aria-busy={transcribiendo || undefined}
        disabled={transcribiendo || (deshabilitado && !grabando)}
        onClick={() => (grabando ? detener() : void empezar())}
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full",
          grabando ? "bg-red-600 text-white" : "text-muted-foreground hover:text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
          FOCO,
        )}
      >
        {grabando ? (
          <SquareIcon className="size-4 fill-current" aria-hidden="true" />
        ) : transcribiendo ? (
          <LoaderCircleIcon className="size-5 motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          <MicIcon className="size-5" aria-hidden="true" />
        )}
      </button>
    </>
  );
}
