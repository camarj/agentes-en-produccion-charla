import type { EvidenciaTraza } from "./observacion";

// Evidencia de la traza guardada de un turno (solo resiliencia): intentos y
// duración de cada herramienta, modelos llamados en orden y si hubo respaldo.
// El juez de criterios la recibe para criterios como «la traza muestra 3
// intentos de buscar_laminas» o «el cambio al modelo de respaldo».

interface SpanLeido {
  spanType?: string;
  name?: string;
  parentSpanId?: string | null;
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
  attributes?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  errorInfo?: unknown;
  error?: unknown;
}

const ms = (f: Date | string | null | undefined) => (f == null ? Number.NaN : new Date(f).getTime());

function nombreHerramienta(s: SpanLeido): string {
  const m = /tool: '([^']+)'/.exec(s.name ?? "");
  return m?.[1] ?? String(s.attributes?.toolId ?? s.name ?? "herramienta");
}

export function evidenciaDeSpans(spans: SpanLeido[]): EvidenciaTraza {
  const ordenados = [...spans].sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
  const herramientas = ordenados
    .filter((s) => s.spanType === "tool_call")
    .map((s) => {
      const duracion = ms(s.endedAt) - ms(s.startedAt);
      const intentos = s.metadata?.intentos;
      return {
        nombre: nombreHerramienta(s),
        ...(typeof intentos === "number" ? { intentos } : {}),
        ...(Number.isFinite(duracion) ? { duracionMs: duracion } : {}),
        ...(s.errorInfo || s.error ? { error: true } : {}),
      };
    });
  const modelos = ordenados
    .filter((s) => s.spanType === "model_generation")
    .map((s) => String(s.attributes?.model ?? s.name ?? "?"));
  const raiz = ordenados.find((s) => s.spanType === "agent_run" && !s.parentSpanId);
  const evidencia: EvidenciaTraza = { herramientas, modelos };
  if (typeof raiz?.metadata?.modelo_respaldo === "boolean") evidencia.modeloRespaldo = raiz.metadata.modelo_respaldo;
  if (typeof raiz?.metadata?.modelo_usado === "string") evidencia.modeloUsado = raiz.metadata.modelo_usado;
  return evidencia;
}

export interface LectorTrazas {
  getTrace(args: { traceId: string }): Promise<{ spans: SpanLeido[] } | null | undefined>;
}

// El exportador guarda los spans por lotes (hasta ~5 s): se reintenta hasta
// que el span raíz aparece terminado. Si no termina a tiempo, se devuelve lo
// que haya (evidencia parcial) en vez de nada.
export async function leerEvidenciaTraza(
  store: LectorTrazas,
  traceId: string,
  { intentos = 30, esperaMs = 1000 }: { intentos?: number; esperaMs?: number } = {},
): Promise<EvidenciaTraza | undefined> {
  let ultima: { spans: SpanLeido[] } | null = null;
  for (let i = 0; i < intentos; i++) {
    const traza = await store.getTrace({ traceId }).catch(() => null);
    if (traza && traza.spans.length > 0) ultima = traza;
    const raiz = traza?.spans.find((s) => s.spanType === "agent_run" && !s.parentSpanId);
    if (traza && raiz?.endedAt) return evidenciaDeSpans(traza.spans);
    if (i < intentos - 1) await new Promise((r) => setTimeout(r, esperaMs));
  }
  return ultima ? evidenciaDeSpans(ultima.spans) : undefined;
}
