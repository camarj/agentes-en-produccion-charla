import type { ChatStatus, UIMessage } from "ai";
import { ERRORES_CHAT, LARGO_MAXIMO_PREGUNTA, type MetadataMensaje } from "./chat";
import { MENSAJE_GENERICO, pedir } from "./acceso";
import { MENSAJES_BLOQUEO, mensajeDeTripwire } from "@/src/mastra/processors/mensajes";

// Lógica de la UI de chat (T11): textos, clasificación de errores de /api/chat,
// agrupación de mensajes, indicadores y el cliente de las APIs auxiliares.
// Nunca se muestra el texto técnico de un error.

export type MensajeChat = UIMessage<MetadataMensaje>;

export const TEXTOS = {
  titulo: "Agentes en producción",
  menu: "Menú",
  nuevaConversacion: "Nueva conversación",
  comoFunciona: "Cómo funciona",
  entendido: "Entendido",
  placeholder: "Pregunta sobre la charla…",
  enviar: "Enviar",
  detener: "Detener",
  irAlFinal: "Ir al final",
  pensando: "Pensando…",
  buscando: "Buscando en las láminas…",
  escalando: "Enviando tu pregunta a Raúl…",
  interrumpida: "Se interrumpió la respuesta",
  reintentar: "Reintentar",
  copiar: "Copiar",
  copiado: "Copiado",
  meSirvio: "Me sirvió",
  noMeSirvio: "No me sirvió",
  sinConexion: "Sin conexión",
  pausaProlongada:
    "Estamos presentando fallas en este momento. Tu pregunta quedó en espera y se responderá apenas el asistente vuelva.",
  enEspera: "En espera",
  sugeridas: "Preguntas sugeridas",
  frecuencia: "Vas muy rápido, espera unos segundos",
  errorFeedback: "No pudimos registrar tu valoración. Intenta de nuevo.",
  errorNuevaConversacion: "No pudimos empezar una conversación nueva. Intenta de nuevo.",
  dictar: "Dictar pregunta",
  detenerDictado: "Detener dictado",
  transcribiendo: "Transcribiendo…",
  grabando: "Grabando",
  permisoMicrofono: "Activa el permiso del micrófono para dictar. También puedes escribir tu pregunta.",
  microfonoNoDisponible: "No pudimos usar el micrófono. Puedes escribir tu pregunta.",
  audioVacio: "No se entendió el audio. Intenta de nuevo.",
  errorDictado: "No pudimos transcribir el audio. Intenta de nuevo o escribe tu pregunta.",
} as const;

export const COMO_FUNCIONA = [
  "Respondo preguntas sobre la charla «Cómo lograr que tus agentes sobrevivan a producción», con base en sus láminas. Si no sé algo, le paso tu pregunta a Raúl para la sesión de preguntas.",
  "Puedo equivocarme. Si una respuesta no te convence, revisa la lámina que cito o pregúntale a Raúl.",
  "Usamos tu email solo para personalizar las respuestas.",
] as const;

export function saludo(nombrePila?: string): string {
  return nombrePila ? `Hola, ${nombrePila}.` : "Hola.";
}

// ---------- Errores de /api/chat ----------

export type ErrorChat =
  | { tipo: "sesion"; mensaje: string }
  | { tipo: "mantenimiento"; mensaje: string }
  | { tipo: "tope"; mensaje: string }
  | { tipo: "frecuencia" }
  | { tipo: "invalido"; mensaje: string }
  | { tipo: "red" }
  | { tipo: "interrumpido" };

function cuerpoDe(error: unknown): { error?: string; mensaje?: string } {
  const texto = (error as { responseBody?: unknown }).responseBody;
  if (typeof texto !== "string") return {};
  try {
    const datos = JSON.parse(texto) as { error?: unknown; mensaje?: unknown };
    return {
      error: typeof datos.error === "string" ? datos.error : undefined,
      mensaje: typeof datos.mensaje === "string" ? datos.mensaje : undefined,
    };
  } catch {
    return {};
  }
}

// useChat entrega los errores previos al stream como APICallError (con
// `statusCode` y `responseBody`); un corte de red como TypeError; un error a
// mitad del stream como Error con el texto genérico del servidor.
export function clasificarError(error: unknown, enLinea: boolean): ErrorChat {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status !== "number") return enLinea ? { tipo: "interrumpido" } : { tipo: "red" };
  const cuerpo = cuerpoDe(error);
  switch (status) {
    case 401:
    case 403:
      return { tipo: "sesion", mensaje: cuerpo.mensaje ?? MENSAJE_GENERICO };
    case 423:
      return { tipo: "mantenimiento", mensaje: cuerpo.mensaje ?? ERRORES_CHAT.mantenimiento };
    case 429:
      return cuerpo.error === "tope" ? { tipo: "tope", mensaje: cuerpo.mensaje ?? ERRORES_CHAT.tope } : { tipo: "frecuencia" };
    case 400:
      return { tipo: "invalido", mensaje: cuerpo.mensaje ?? ERRORES_CHAT.mensaje_invalido };
    default:
      return { tipo: "interrumpido" };
  }
}

// ---------- Mensajes ----------

export interface Grupo {
  id: string;
  // ids de los mensajes originales (una respuesta puede venir en dos).
  ids: string[];
  role: "user" | "assistant";
  parts: MensajeChat["parts"];
  traceId?: string;
}

// El historial puede traer una respuesta partida en dos mensajes seguidos del
// asistente (uno con la herramienta y otro con el texto): se muestran como uno.
export function agruparMensajes(mensajes: MensajeChat[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const m of mensajes) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const anterior = grupos.at(-1);
    const traceId = m.metadata?.trace_id;
    if (m.role === "assistant" && anterior?.role === "assistant") {
      anterior.ids.push(m.id);
      anterior.parts = [...anterior.parts, ...m.parts];
      if (traceId) anterior.traceId = traceId;
      continue;
    }
    grupos.push({ id: m.id, ids: [m.id], role: m.role, parts: [...m.parts], ...(traceId ? { traceId } : {}) });
  }
  return grupos;
}

// Texto que ve el asistente: bloqueos con su mensaje fijo; si no, el texto.
export function textoVisible(partes: MensajeChat["parts"]): string {
  if (partes.some((p) => p.type === "data-guardrail")) return MENSAJES_BLOQUEO.datos_personales;
  const tripwire = partes.find((p) => p.type === "data-tripwire") as { data?: unknown } | undefined;
  if (tripwire) return mensajeDeTripwire(tripwire.data as { metadata?: unknown });
  return partes
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .filter((t) => t.length > 0)
    .join("\n\n");
}

// ---------- Indicadores ----------

export type Indicador = "pensando" | "buscando" | "escalando";

function herramientaDe(parte: { type: string; toolName?: unknown }): string | null {
  if (parte.type === "dynamic-tool") return typeof parte.toolName === "string" ? parte.toolName : null;
  return parte.type.startsWith("tool-") ? parte.type.slice("tool-".length) : null;
}

export function indicadorDe(status: ChatStatus, mensajes: MensajeChat[]): Indicador | null {
  if (status === "submitted") {
    const ultimo = mensajes.at(-1);
    if (!ultimo || ultimo.role === "user") return "pensando";
  } else if (status !== "streaming") {
    return null;
  }
  const ultimo = mensajes.at(-1);
  if (!ultimo || ultimo.role !== "assistant") return "pensando";
  for (const parte of ultimo.parts as { type: string; toolName?: unknown; state?: unknown }[]) {
    const nombre = herramientaDe(parte);
    if (nombre && (parte.state === "input-streaming" || parte.state === "input-available")) {
      return nombre === "escalar_pregunta" ? "escalando" : "buscando";
    }
  }
  return textoVisible(ultimo.parts) ? null : "pensando";
}

// ---------- Composer ----------

export const CONTADOR_DESDE = 800;
export const ALTO_LINEA_PX = 24;
export const PADDING_COMPOSER_PX = 16;
export const LINEAS_MAXIMAS = 6;

function miles(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function contador(largo: number): string | null {
  return largo >= CONTADOR_DESDE ? `${miles(largo)}/${miles(LARGO_MAXIMO_PREGUNTA)}` : null;
}

// Alto del textarea (1 a 6 líneas) según su scrollHeight.
export function alturaComposer(scrollHeight: number): { alto: number; conScroll: boolean } {
  const minimo = ALTO_LINEA_PX + PADDING_COMPOSER_PX;
  const maximo = ALTO_LINEA_PX * LINEAS_MAXIMAS + PADDING_COMPOSER_PX;
  return { alto: Math.min(Math.max(scrollHeight, minimo), maximo), conScroll: scrollHeight > maximo };
}

export function largoPregunta(texto: string): number {
  return Array.from(texto.trim()).length;
}

// ---------- «lámina N» ----------

// «lámina 11», «láminas 19 y 23», «láminas 3, 4 y 5».
const LAMINA = /\b[Ll][áa]minas?\s+\d+(?:(?:\s*,\s*|\s+y\s+)\d+)*\b/g;

export function partirLaminas(texto: string): (string | { lamina: string })[] {
  const salida: (string | { lamina: string })[] = [];
  let desde = 0;
  for (const m of texto.matchAll(LAMINA)) {
    if (m.index > desde) salida.push(texto.slice(desde, m.index));
    salida.push({ lamina: m[0] });
    desde = m.index + m[0].length;
  }
  if (desde < texto.length || salida.length === 0) salida.push(texto.slice(desde));
  return salida;
}

// ---------- APIs auxiliares ----------

export function obtenerHistorial() {
  return pedir<{ messages: MensajeChat[] }>("/api/chat/historial");
}

export function obtenerSugerencias() {
  return pedir<{ sugerencias: string[]; version?: string }>("/api/sugerencias");
}

export function enviarFeedback(traceId: string, valor: 1 | -1) {
  return pedir<{ ok: true }>("/api/feedback", { trace_id: traceId, valor });
}

export function nuevaConversacion() {
  return pedir<{ ok: true }>("/api/chat/nuevo", {});
}
