import { SpanType } from "@mastra/core/observability";

interface SpanMinimo {
  update(opciones: { metadata?: Record<string, unknown> }): void;
  findParent?(tipo: SpanType): SpanMinimo | undefined;
}

// Deja la metadata del guardrail en el span del procesador y en el span raíz
// (agent_run), para verla en la traza sin abrir cada procesador. Nunca debe
// recibir texto del usuario. Si no hay observabilidad no hace nada.
export function registrarEnTraza(
  tracingContext: { currentSpan?: unknown } | undefined,
  metadata: Record<string, unknown>,
): void {
  try {
    const span = tracingContext?.currentSpan as SpanMinimo | undefined;
    if (!span) return;
    span.update({ metadata });
    const raiz = span.findParent?.(SpanType.AGENT_RUN);
    if (raiz && raiz !== span) raiz.update({ metadata });
  } catch {
    // la traza nunca debe romper la respuesta
  }
}
