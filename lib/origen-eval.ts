// Marca de las trazas que genera el runner de evals (T13). Va en la metadata
// del span raíz (`tracingOptions.metadata.origen`) y como etiqueta (`tags`).
// El panel del speaker (T12) excluye estas trazas de sus métricas, para que
// una corrida de evals en producción no se vea como tráfico de asistentes.
export const CLAVE_ORIGEN = "origen";
export const ORIGEN_EVAL = "eval";
export const ETIQUETA_EVAL = "eval";

export function esTrazaDeEval(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.[CLAVE_ORIGEN] === ORIGEN_EVAL;
}
