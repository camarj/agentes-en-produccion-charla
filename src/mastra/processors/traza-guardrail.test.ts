import { SpanType } from "@mastra/core/observability";
import { describe, expect, it, vi } from "vitest";
import { registrarEnTraza } from "./traza-guardrail";

describe("registrarEnTraza", () => {
  it("marca el span actual y el span raíz agent_run", () => {
    const raiz = { update: vi.fn() };
    const span = { update: vi.fn(), findParent: vi.fn((t: SpanType) => (t === SpanType.AGENT_RUN ? raiz : undefined)) };
    registrarEnTraza({ currentSpan: span }, { guardrail: "alcance_charla", motivo: "fuera_de_alcance", confianza: 0.9 });
    const esperado = { metadata: { guardrail: "alcance_charla", motivo: "fuera_de_alcance", confianza: 0.9 } };
    expect(span.update).toHaveBeenCalledWith(esperado);
    expect(raiz.update).toHaveBeenCalledWith(esperado);
  });

  it("no falla sin span, con span sin findParent o si update lanza", () => {
    expect(() => registrarEnTraza(undefined, { a: 1 })).not.toThrow();
    expect(() => registrarEnTraza({ currentSpan: { update: vi.fn() } }, { a: 1 })).not.toThrow();
    const roto = { update: () => { throw new Error("x"); } };
    expect(() => registrarEnTraza({ currentSpan: roto }, { a: 1 })).not.toThrow();
  });
});
