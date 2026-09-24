import { describe, expect, it } from "vitest";
import { evidenciaDeSpans, leerEvidenciaTraza } from "./evidencia";

const t0 = new Date("2026-09-23T20:00:00Z").getTime();
const at = (ms: number) => new Date(t0 + ms);

const spans = [
  { spanType: "agent_run", name: "agent run: 'charla'", parentSpanId: null, startedAt: at(0), endedAt: at(20_000), metadata: { modelo_respaldo: true, modelo_usado: "anthropic/claude-sonnet-5" } },
  { spanType: "model_generation", name: "llm: 'gpt-6-luna'", startedAt: at(100), endedAt: at(900), attributes: { model: "gpt-6-luna" } },
  { spanType: "tool_call", name: "tool: 'buscar_laminas'", startedAt: at(1000), endedAt: at(16_200), metadata: { intentos: 3 }, attributes: { toolId: "buscar_laminas" } },
  { spanType: "model_generation", name: "llm: 'claude-sonnet-5'", startedAt: at(16_300), endedAt: at(19_000), attributes: { model: "claude-sonnet-5" } },
  { spanType: "tool_call", name: "tool: 'escalar_pregunta'", startedAt: at(17_000), endedAt: at(17_100), errorInfo: { message: "x" } },
];

describe("evidenciaDeSpans", () => {
  it("resume intentos y duración de cada herramienta, los modelos en orden y el respaldo", () => {
    expect(evidenciaDeSpans(spans)).toEqual({
      herramientas: [
        { nombre: "buscar_laminas", intentos: 3, duracionMs: 15_200 },
        { nombre: "escalar_pregunta", duracionMs: 100, error: true },
      ],
      modelos: ["gpt-6-luna", "claude-sonnet-5"],
      modeloRespaldo: true,
      modeloUsado: "anthropic/claude-sonnet-5",
    });
  });
  it("sin spans devuelve una evidencia vacía", () => {
    expect(evidenciaDeSpans([])).toEqual({ herramientas: [], modelos: [] });
  });
});

describe("leerEvidenciaTraza", () => {
  it("reintenta hasta que la traza está guardada y terminada", async () => {
    let n = 0;
    const store = {
      getTrace: async () => {
        n++;
        if (n < 3) return n === 1 ? null : { spans: [{ ...spans[0], endedAt: null }] };
        return { spans };
      },
    };
    const e = await leerEvidenciaTraza(store, "t-1", { intentos: 5, esperaMs: 1 });
    expect(n).toBe(3);
    expect(e?.herramientas[0]).toMatchObject({ nombre: "buscar_laminas", intentos: 3 });
  });
  it("si el span raíz no termina a tiempo, devuelve lo que haya (evidencia parcial)", async () => {
    const store = { getTrace: async () => ({ spans: [{ ...spans[0], endedAt: null }, spans[2]] }) };
    const e = await leerEvidenciaTraza(store, "t", { intentos: 2, esperaMs: 1 });
    expect(e?.herramientas[0]).toMatchObject({ nombre: "buscar_laminas", intentos: 3 });
  });
  it("si nunca aparece, devuelve undefined", async () => {
    expect(await leerEvidenciaTraza({ getTrace: async () => null }, "t", { intentos: 2, esperaMs: 1 })).toBeUndefined();
  });
});
