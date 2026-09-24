import type { ObservacionRuta, ResultadoScorer } from "./checks";
import type { Caso } from "./dataset";
import type { Observacion } from "./observacion";

// Registro de la corrida en Studio (Datasets → charla-v1 → Experiments).
// Patrón «caller-driven» de la documentación de Mastra: el experimento se crea
// sin target, cada caso se sube con `submitExperimentResult` (entrada,
// salida, traza y el score + la razón de cada gate y scorer) y al final se
// cierra con `finalizeExperiment`. Así Studio muestra cada caso y «Compare»
// funciona entre corridas (por ejemplo, instrucciones 1.0.0 frente a 1.1.0).
// El veredicto lo calcula `runEvals` sobre esas mismas salidas.

export interface DatasetExperimentos {
  createExperiment(args: {
    name?: string;
    description?: string;
    metadata?: Record<string, unknown>;
    grouping?: { comparisonId?: string; variantId?: string };
  }): Promise<{ experimentId: string }>;
  submitExperimentResult(args: {
    experimentId: string;
    itemId: string;
    output?: unknown;
    error?: { message: string } | null;
    startedAt?: Date;
    completedAt?: Date;
    traceId?: string;
    scores?: { scorerId: string; scorerName?: string; score: number; reason?: string; metadata?: Record<string, unknown> }[];
  }): Promise<unknown>;
  updateExperiment(args: { experimentId: string; metadata?: Record<string, unknown>; description?: string }): Promise<unknown>;
  finalizeExperiment(args: { experimentId: string }): Promise<unknown>;
  getExperiment(args: { experimentId: string }): Promise<{ metadata?: Record<string, unknown> | null } | null>;
}

const FORMATO_FECHA = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Guayaquil",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function nombreExperimento({
  versionDataset,
  versionInstrucciones,
  fecha,
  sufijo,
}: {
  versionDataset: string;
  versionInstrucciones: string;
  fecha: Date;
  sufijo?: string;
}): string {
  const partes = [`charla-v${versionDataset}`, `instrucciones ${versionInstrucciones}`, FORMATO_FECHA.format(fecha)];
  if (sufijo) partes.push(sufijo);
  return partes.join(" · ");
}

export function scoresParaStudio(resultados: ResultadoScorer[]) {
  return resultados
    .filter((r) => r.estado === "puntuado" && typeof r.score === "number")
    .map((r) => ({ scorerId: r.id, scorerName: r.nombre, score: r.score as number, reason: r.razon, metadata: { tipo: r.tipo } }));
}

function resumirResultado(nombre: string, resultado: unknown): unknown {
  const r = resultado as { resultados?: { lamina?: unknown }[] } | undefined;
  if (nombre === "buscar_laminas" && Array.isArray(r?.resultados)) return { laminas: r.resultados.map((x) => x.lamina) };
  return resultado;
}

// Salida que se ve en Studio: lo que vio el asistente y qué hizo el agente.
export function salidaParaStudio(caso: Caso, obs: Observacion, resultados: ResultadoScorer[] = [], ruta?: ObservacionRuta): Record<string, unknown> {
  if (caso.nivel === "ruta") {
    return { http_status: ruta?.status ?? null, mensaje: ruta?.mensaje ?? null, trazas_del_agente: ruta?.trazasAgente ?? null, modo: ruta?.modo ?? null, ...(ruta?.omitida ? { omitida: ruta.omitida } : {}), ...(ruta?.error ? { error: ruta.error } : {}) };
  }
  const noEvaluados = resultados.filter((r) => r.estado === "omitido" || r.estado === "error").map((r) => `${r.nombre}: ${r.razon}`);
  return {
    respuesta: obs.texto,
    bloqueado: obs.bloqueado,
    motivo_bloqueo: obs.motivo,
    herramientas: obs.herramientas.map((h) => ({ nombre: h.nombre, args: h.args, resultado: resumirResultado(h.nombre, h.resultado) })),
    modelo: obs.modelo ?? null,
    duracion_s: Math.round(obs.duracionMs / 100) / 10,
    ...(noEvaluados.length > 0 ? { no_evaluados: noEvaluados } : {}),
  };
}

export async function crearExperimento(
  dataset: Pick<DatasetExperimentos, "createExperiment">,
  { nombre, descripcion, metadata, variante }: { nombre: string; descripcion: string; metadata: Record<string, unknown>; variante: string },
) {
  return dataset.createExperiment({
    name: nombre,
    description: descripcion,
    metadata,
    grouping: { comparisonId: "charla-v1", variantId: variante },
  });
}

export async function subirCaso(
  dataset: Pick<DatasetExperimentos, "submitExperimentResult">,
  experimentId: string,
  itemId: string,
  d: { caso: Caso; obs: Observacion; resultados: ResultadoScorer[]; ruta?: ObservacionRuta; inicio: Date; fin: Date },
) {
  await dataset.submitExperimentResult({
    experimentId,
    itemId,
    output: salidaParaStudio(d.caso, d.obs, d.resultados, d.ruta),
    error: d.obs.error ? { message: `El turno del agente falló (${d.obs.error})` } : null,
    startedAt: d.inicio,
    completedAt: d.fin,
    ...(d.obs.traceId ? { traceId: d.obs.traceId } : {}),
    scores: scoresParaStudio(d.resultados),
  });
}

// Guarda el veredicto y el resumen en la metadata del experimento y lo cierra.
export async function cerrarExperimento(
  dataset: Pick<DatasetExperimentos, "updateExperiment" | "finalizeExperiment" | "getExperiment">,
  experimentId: string,
  resumen: Record<string, unknown>,
) {
  const actual = (await dataset.getExperiment({ experimentId }))?.metadata ?? {};
  await dataset.updateExperiment({ experimentId, metadata: { ...actual, ...resumen } });
  await dataset.finalizeExperiment({ experimentId });
}
