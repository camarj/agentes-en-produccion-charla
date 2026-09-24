// Textos fijos que ve el asistente cuando un guardrail bloquea. Los usan los
// procesadores, la ruta de chat (T09), la UI (T11) y el runner de evals (T13).

export type MotivoBloqueo = "inyeccion" | "fuera_de_alcance" | "datos_personales";

export const MENSAJES_BLOQUEO: Record<MotivoBloqueo, string> = {
  inyeccion: "Solo puedo ayudarte con temas de la charla. ¿Qué te gustaría entender mejor?",
  fuera_de_alcance:
    "Eso queda fuera de lo que puedo responder aquí. Puedo ayudarte con cualquier tema de la charla: agentes, patrones, evals u observabilidad.",
  datos_personales: "No puedo compartir información sobre otros asistentes ni sobre tus datos de registro.",
};

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
// revela nada técnico.
export function mensajeDeBloqueo(motivo: unknown): string {
  return esMotivoBloqueo(motivo) ? MENSAJES_BLOQUEO[motivo] : MENSAJES_BLOQUEO.inyeccion;
}

// Motivo de un tripwire de Mastra (`result.tripwire`, chunk `tripwire`) o de la
// parte `data-tripwire` que genera `toAISdkStream` (`part.data`). Devuelve
// null si no hubo tripwire.
export function motivoDeTripwire(tripwire: { reason?: string; metadata?: unknown } | null | undefined): MotivoBloqueo | null {
  if (!tripwire) return null;
  const motivo = (tripwire.metadata as { motivo?: unknown } | undefined)?.motivo;
  return esMotivoBloqueo(motivo) ? motivo : "inyeccion";
}
