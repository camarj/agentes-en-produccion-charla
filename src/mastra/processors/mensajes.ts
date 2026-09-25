// Textos fijos que ve el asistente cuando un guardrail bloquea. Los usan los
// procesadores, la ruta de chat (T09), la UI (T11) y el runner de evals (T13).

export type MotivoBloqueo = "inyeccion" | "fuera_de_alcance" | "datos_personales";

export const MENSAJES_BLOQUEO: Record<MotivoBloqueo, string> = {
  inyeccion: "Solo puedo ayudarte con temas de la charla. ¿Qué te gustaría entender mejor?",
  fuera_de_alcance:
    "Eso queda fuera de lo que puedo responder aquí. Puedo ayudarte con cualquier tema de la charla: agentes, patrones, evals u observabilidad.",
  datos_personales: "No puedo compartir información sobre otros asistentes ni sobre tus datos de registro.",
};

// Temas de salud (decisión de Raúl, 2026-09-25, caso F04): el bloqueo sigue
// siendo `fuera_de_alcance` (gates, panel y métricas no cambian), pero el
// asistente ve un mensaje que le sugiere acudir a un profesional. El
// clasificador de alcance lo marca con `subtema: "salud"` en la metadata.
export const SUBTEMA_SALUD = "salud";
export const MENSAJE_SALUD =
  "No puedo dar consejos médicos. Si tienes un síntoma o una urgencia, acude a un profesional de la salud. Puedo ayudarte con cualquier tema de la charla: agentes, patrones, evals u observabilidad.";

// Todos los textos fijos que puede ver el asistente con un motivo dado.
export function mensajesDelMotivo(motivo: MotivoBloqueo): string[] {
  return motivo === "fuera_de_alcance" ? [MENSAJES_BLOQUEO.fuera_de_alcance, MENSAJE_SALUD] : [MENSAJES_BLOQUEO[motivo]];
}

// Todos los textos fijos de bloqueo.
export const TODOS_LOS_MENSAJES_BLOQUEO: readonly string[] = [...Object.values(MENSAJES_BLOQUEO), MENSAJE_SALUD];

// Parte `data-*` que emite SinDatosPersonales en el stream cuando reemplaza la
// respuesta: la UI debe mostrar solo el mensaje fijo en esa burbuja.
export const TIPO_PARTE_GUARDRAIL = "data-guardrail";

// Metadata que llevan los tripwires (`abort`) de los guardrails de entrada y la
// parte `data-guardrail` de la salida. Nunca incluye el texto del usuario.
export interface MetadataBloqueo {
  guardrail: string;
  motivo: MotivoBloqueo;
  confianza?: number;
  [clave: string]: unknown;
}

export function esMotivoBloqueo(valor: unknown): valor is MotivoBloqueo {
  return typeof valor === "string" && Object.hasOwn(MENSAJES_BLOQUEO, valor);
}

// Texto para el asistente. Un motivo desconocido (por ejemplo, un tripwire de
// otro procesador de Mastra) recibe el mensaje genérico de inyección, que no
// revela nada técnico. Con la metadata del bloqueo, salud tiene su mensaje.
export function mensajeDeBloqueo(motivo: unknown, metadata?: unknown): string {
  if (!esMotivoBloqueo(motivo)) return MENSAJES_BLOQUEO.inyeccion;
  const subtema = (metadata as { subtema?: unknown } | null | undefined)?.subtema;
  if (motivo === "fuera_de_alcance" && subtema === SUBTEMA_SALUD) return MENSAJE_SALUD;
  return MENSAJES_BLOQUEO[motivo];
}

// Motivo de un tripwire de Mastra (`result.tripwire`, chunk `tripwire`) o de la
// parte `data-tripwire` que genera `toAISdkStream` (`part.data`). Devuelve
// null si no hubo tripwire.
export function motivoDeTripwire(tripwire: { reason?: string; metadata?: unknown } | null | undefined): MotivoBloqueo | null {
  if (!tripwire) return null;
  const motivo = (tripwire.metadata as { motivo?: unknown } | undefined)?.motivo;
  return esMotivoBloqueo(motivo) ? motivo : "inyeccion";
}

// Texto que ve el asistente para un tripwire (motivo y subtema de su metadata).
export function mensajeDeTripwire(tripwire: { reason?: string; metadata?: unknown } | null | undefined): string {
  return mensajeDeBloqueo(motivoDeTripwire(tripwire), tripwire?.metadata);
}
