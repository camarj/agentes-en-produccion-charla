import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { modeloFalso } from "./pruebas-modelo";
import { AVISO_RESPUESTA_FINAL, RespuestaFinal } from "./respuesta-final";

function args(stepNumber: number, extra: Record<string, unknown> = {}) {
  return { stepNumber, toolChoice: "auto", ...extra } as never;
}

describe("RespuestaFinal (unidad)", () => {
  it("por defecto el límite es 5 pasos", () => {
    expect(new RespuestaFinal().maxSteps).toBe(5);
  });

  it("no cambia nada antes del último paso", async () => {
    const p = new RespuestaFinal(5);
    const sendSignal = vi.fn();
    for (const paso of [0, 1, 2, 3]) {
      expect(await p.processInputStep(args(paso, { sendSignal }))).toBeUndefined();
    }
    expect(sendSignal).not.toHaveBeenCalled();
  });

  it("en el último paso prohíbe herramientas y envía la señal de respuesta final", async () => {
    const p = new RespuestaFinal(5);
    const sendSignal = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn();
    const r = await p.processInputStep(args(4, { sendSignal, tracingContext: { currentSpan: { update } } }));
    expect(r).toEqual({ toolChoice: "none" });
    expect(sendSignal).toHaveBeenCalledWith({
      type: "system-reminder",
      contents: AVISO_RESPUESTA_FINAL,
      transient: true,
    });
    expect(update).toHaveBeenCalledWith({ metadata: { respuesta_final_forzada: true } });
  });

  it("también fuerza la respuesta si se pasó del límite y funciona sin sendSignal", async () => {
    const p = new RespuestaFinal(3);
    expect(await p.processInputStep(args(2))).toEqual({ toolChoice: "none" });
    expect(await p.processInputStep(args(7))).toEqual({ toolChoice: "none" });
  });

  it("rechaza límites inválidos", () => {
    expect(() => new RespuestaFinal(0)).toThrow();
    expect(() => new RespuestaFinal(2.5)).toThrow();
  });
});

describe("RespuestaFinal (con un agente real y un modelo falso)", () => {
  const eco = createTool({
    id: "eco",
    description: "Devuelve lo mismo",
    inputSchema: z.object({ q: z.string() }),
    execute: async ({ q }) => ({ q }),
  });

  it("un modelo que siempre pide herramientas termina en ≤ 5 pasos y con texto", async () => {
    const falso = modeloFalso("openai/gpt-6-luna", (llamada, n) =>
      llamada.toolChoice?.type === "none" ? { texto: "Respuesta final" } : { herramienta: "eco", entrada: { q: `q${n}` } },
    );
    const agente = new Agent({
      id: "prueba",
      name: "prueba",
      instructions: "x",
      model: falso.modelo as never,
      tools: { eco },
      inputProcessors: [new RespuestaFinal(5)],
      defaultOptions: { maxSteps: 5 },
    });
    const r = await agente.generate("hola");
    expect(falso.llamadas.length).toBe(5);
    expect(falso.llamadas.slice(0, 4).map((l) => l.toolChoice?.type)).toEqual(["auto", "auto", "auto", "auto"]);
    expect(falso.llamadas[4].toolChoice?.type).toBe("none");
    expect(JSON.stringify(falso.llamadas[4].prompt)).toContain(AVISO_RESPUESTA_FINAL);
    expect(JSON.stringify(falso.llamadas[3].prompt)).not.toContain(AVISO_RESPUESTA_FINAL);
    expect(r.steps.length).toBe(5);
    expect(r.text).toContain("Respuesta final");
  });
});
