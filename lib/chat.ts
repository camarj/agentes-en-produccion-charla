import type { UIMessageChunk } from "ai";
import type { Interruptores } from "./db/interruptores";

// Piezas de la ruta de chat (T09). Viven aquí porque Next no permite exportar
// nada más que los handlers desde un route.ts.

// Tope de un turno completo (decisión de Raúl, 2026-09-23: 45 s, no 20 s). Con
// `latencia_alta` una sola búsqueda en láminas puede tardar ~16 s.
export const TIEMPO_MAXIMO_TURNO_MS = 45_000;
export const LARGO_MAXIMO_PREGUNTA = 1000;
export const MAX_MENSAJES_POR_DEFECTO = 30;
// Igual que MAX_PASOS del agente `charla` (T05).
export const MAX_PASOS_TURNO = 5;

export const MENSAJE_FALLA_TECNICA =
  "Tuve un problema técnico para responder. Tu pregunta quedó registrada para la sesión de preguntas.";
// Error después de que ya salió texto: no se puede reemplazar lo mostrado.
export const MENSAJE_ERROR_STREAM = "La respuesta se interrumpió. Intenta preguntar de nuevo.";

export const ERRORES_CHAT = {
  falta_perfil: "Antes de chatear, completa tu perfil.",
  mantenimiento: "El asistente está en pausa unos minutos. Vuelve a intentarlo pronto.",
  mensaje_invalido: "Escribe una pregunta de entre 1 y 1.000 caracteres.",
  demasiados_mensajes: "Vas muy rápido. Espera un momento antes de enviar otra pregunta.",
  tope: "Llegaste al límite de preguntas de esta charla. Guarda tus dudas para la sesión de preguntas con Raúl.",
} as const;

// Metadata del mensaje del asistente que ve el cliente (useChat → message.metadata).
export interface MetadataMensaje {
  trace_id?: string;
}

export function maxMensajesAsistente(): number {
  const valor = Number(process.env.MAX_MENSAJES_ASISTENTE?.trim() || Number.NaN);
  return Number.isInteger(valor) && valor > 0 ? valor : MAX_MENSAJES_POR_DEFECTO;
}

// Texto del último mensaje del cuerpo de useChat (`{ messages: UIMessage[] }`),
// recortado. null si no hay, si el último no es del usuario o si el largo no
// está entre 1 y 1.000 caracteres.
export function extraerPregunta(cuerpo: unknown): string | null {
  const mensajes = (cuerpo as { messages?: unknown } | null | undefined)?.messages;
  if (!Array.isArray(mensajes) || mensajes.length === 0) return null;
  const ultimo = mensajes.at(-1) as { role?: unknown; parts?: unknown } | null;
  if (!ultimo || ultimo.role !== "user" || !Array.isArray(ultimo.parts)) return null;
  const texto = ultimo.parts
    .filter((p): p is { type: "text"; text: string } => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  const largo = Array.from(texto).length;
  return largo >= 1 && largo <= LARGO_MAXIMO_PREGUNTA ? texto : null;
}

// Interruptores encendidos (sin `lamina_actual`, que no es un interruptor).
export function interruptoresActivos(valores: Interruptores): string[] {
  return Object.entries(valores)
    .filter(([clave, valor]) => clave !== "lamina_actual" && valor === "on")
    .map(([clave]) => clave);
}

function partesMensajeFijo(texto: string, metadata: MetadataMensaje, conInicio: boolean): UIMessageChunk[] {
  const id = "falla-tecnica";
  return [
    ...(conInicio ? [{ type: "start", messageMetadata: metadata } as UIMessageChunk] : []),
    { type: "text-start", id },
    { type: "text-delta", id, delta: texto },
    { type: "text-end", id },
    { type: "finish", finishReason: "error", messageMetadata: metadata } as UIMessageChunk,
  ];
}

// Stream con solo el mensaje fijo de falla técnica (el turno ni arrancó).
export function streamFallaTecnica(metadata: MetadataMensaje = {}): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(c) {
      for (const p of partesMensajeFijo(MENSAJE_FALLA_TECNICA, metadata, true)) c.enqueue(p);
      c.close();
    },
  });
}

export interface OpcionesProteccion {
  metadata: MetadataMensaje;
  // true si el cliente se fue (cancelación real, no el timeout).
  clienteSeFue: () => boolean;
  // Se llama una vez si el turno falla antes del primer texto.
  alFallar: () => void;
}

// Envuelve el stream UI del turno:
// - Si el turno falla (error, corte por tiempo, stream roto o final sin texto)
//   antes del primer texto, y no fue un bloqueo de guardrail ni el cliente que
//   se fue, reemplaza el resto por el mensaje fijo de falla técnica y avisa
//   con `alFallar` (la ruta registra el escalamiento).
// - Un error después del primer texto se muestra con un texto genérico.
// Nunca deja pasar el texto técnico de un error. Cancelar este stream cancela
// el de origen (y con él, el agente).
export function protegerStreamUI(
  fuente: ReadableStream<UIMessageChunk>,
  opciones: OpcionesProteccion,
): ReadableStream<UIMessageChunk> {
  const lector = fuente.getReader();
  let hayTexto = false;
  let bloqueo = false;
  let inicioEnviado = false;
  let terminado = false;

  const puedeFallar = () => !hayTexto && !bloqueo && !opciones.clienteSeFue();

  function fallar(c: ReadableStreamDefaultController<UIMessageChunk>) {
    for (const p of partesMensajeFijo(MENSAJE_FALLA_TECNICA, opciones.metadata, !inicioEnviado)) c.enqueue(p);
    terminar(c);
    void lector.cancel().catch(() => {});
    try {
      opciones.alFallar();
    } catch {
      // alFallar registra por su cuenta; nunca rompe el stream.
    }
  }

  function terminar(c: ReadableStreamDefaultController<UIMessageChunk>) {
    terminado = true;
    c.close();
  }

  return new ReadableStream<UIMessageChunk>({
    async pull(c) {
      let leido: ReadableStreamReadResult<UIMessageChunk>;
      try {
        leido = await lector.read();
      } catch {
        if (puedeFallar()) fallar(c);
        else terminar(c);
        return;
      }
      if (leido.done) {
        if (puedeFallar()) fallar(c);
        else terminar(c);
        return;
      }
      const parte = leido.value;
      switch (parte.type) {
        case "start":
          inicioEnviado = true;
          break;
        case "text-delta":
          hayTexto = true;
          break;
        case "data-tripwire":
        case "data-guardrail":
          bloqueo = true;
          break;
        case "error":
          if (puedeFallar()) return fallar(c);
          c.enqueue({ type: "error", errorText: MENSAJE_ERROR_STREAM });
          return;
        case "abort":
          if (puedeFallar()) return fallar(c);
          break;
        case "finish":
          if (puedeFallar()) return fallar(c);
          // El `finish` que agrega toAISdkStream tras un tripwire no pasa por
          // `messageMetadata`: se completa aquí para que el trace_id llegue siempre.
          c.enqueue({ ...parte, messageMetadata: parte.messageMetadata ?? opciones.metadata });
          // No se cancela el origen: el agente aún guarda la memoria.
          return terminar(c);
      }
      c.enqueue(parte);
    },
    cancel(motivo) {
      if (terminado) return;
      terminado = true;
      return lector.cancel(motivo);
    },
  });
}
