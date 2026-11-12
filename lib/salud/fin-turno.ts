import type { FilaTurno } from "@/lib/db/turnos";
import type { DesenlaceTurno } from "@/src/mastra/turno";
import type { SenalesTurno } from "./senales";

// Convierte el cierre de un turno de chat en su fila de `turnos` (PRD §15 G7),
// con el mismo significado que tenían las métricas leídas de las trazas:
// - bloqueo: no es una falla y no cuenta en la latencia;
// - buscar_laminas agotó sus intentos: falla «herramienta», aunque el agente respondiera;
// - error del proveedor del modelo (fallaron el principal y el respaldo): «modelo»;
// - turno cortado (tope de 45 s o cliente que se fue): «tiempo»;
// - cualquier otro error: «otro».

export interface DatosFinTurno {
  iniciadoMs: number;
  // null: el turno no terminó dentro del tope de espera.
  finMs: number | null;
  desenlace: DesenlaceTurno | null;
  senales: SenalesTurno;
  // modelId de la respuesta (AI SDK); null si no hubo respuesta.
  modeloRespuesta: string | null;
  // La señal del turno se abortó (tope de tiempo o cancelación del cliente).
  abortado: boolean;
  traceId: string | null;
}

// Qué modelo respondió, según la respuesta final de Mastra. Con la lista de
// modelos del agente (principal por función + respaldo) y Gemini por Vertex,
// Mastra deja `modelId` vacío y lo informa en `modelMetadata.modelId`.
export function modeloDeRespuesta(
  respuesta: { modelId?: string; modelMetadata?: { modelId?: string } } | null | undefined,
): string | null {
  return respuesta?.modelId || respuesta?.modelMetadata?.modelId || null;
}

export function filaDeTurno(d: DatosFinTurno): FilaTurno {
  const base = { iniciadoMs: d.iniciadoMs, traceId: d.traceId, motivoBloqueo: null, tipoFalla: null };
  const duracion = d.finMs === null ? null : Math.max(0, d.finMs - d.iniciadoMs);
  const sinRespuesta = { duracionMs: null, modelo: null, respaldo: false };

  if (!d.desenlace) return { ...base, ...sinRespuesta, resultado: "falla", tipoFalla: "tiempo" };
  if (d.desenlace.motivoBloqueo) {
    return { ...base, ...sinRespuesta, duracionMs: duracion, resultado: "bloqueo", motivoBloqueo: d.desenlace.motivoBloqueo };
  }
  if (d.desenlace.error) {
    const tipoFalla = d.abortado
      ? "tiempo"
      : d.senales.busqueda?.agotada
        ? "herramienta"
        : d.desenlace.error === "proveedor"
          ? "modelo"
          : "otro";
    return { ...base, ...sinRespuesta, resultado: "falla", tipoFalla };
  }

  const respondio = {
    duracionMs: duracion,
    modelo: d.senales.respaldo?.modelo ?? d.modeloRespuesta,
    respaldo: d.senales.respaldo !== undefined,
  };
  if (d.senales.busqueda?.agotada) return { ...base, ...respondio, resultado: "falla", tipoFalla: "herramienta" };
  return { ...base, ...respondio, resultado: "ok" };
}
