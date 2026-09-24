import type { SpanType } from "@mastra/core/observability";
import type { RequestContext } from "@mastra/core/request-context";

// Lo mínimo del span de Mastra que usan las herramientas.
interface SpanHerramienta {
  traceId: string;
  isValid: boolean;
  update(opciones: { metadata?: Record<string, unknown> }): void;
  findParent?(tipo: SpanType): { update(opciones: { metadata?: Record<string, unknown> }): void } | undefined;
}

interface ContextoHerramienta {
  requestContext?: RequestContext<unknown>;
  tracingContext?: { currentSpan?: unknown };
}

export const CLAVE_ASISTENTE = "asistente_id";

// Span TOOL_CALL que Mastra abre para la herramienta. Ausente en tests o si
// no hay observabilidad; un span NO-OP (isValid = false) también se ignora.
export function spanActual(contexto: ContextoHerramienta | undefined): SpanHerramienta | undefined {
  const span = contexto?.tracingContext?.currentSpan as SpanHerramienta | undefined;
  return span?.isValid ? span : undefined;
}

export function traceIdActual(contexto: ContextoHerramienta | undefined): string | null {
  return spanActual(contexto)?.traceId ?? null;
}

// El asistente sale solo del requestContext que arma la ruta de chat.
export function asistenteDelContexto(contexto: ContextoHerramienta | undefined): string | null {
  const valor = contexto?.requestContext?.get(CLAVE_ASISTENTE);
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}
