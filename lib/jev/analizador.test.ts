import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearJev } from "@/lib/db/jev";
import { crearDbTemporal } from "@/lib/db/prueba";
import { crearAnalizadorJev, type EvaluarTurno, type StoreJev } from "./analizador";
import type { ResultadoJev } from "./resultado";
import type { RaizListada, SpanTraza } from "./turnos";

const AHORA = Date.parse("2026-09-25T20:00:00Z");

const RESULTADO: ResultadoJev = {
  model: "jev-1.13.0",
  answers: {
    tema: { choice: "evals", confidence: 1, probabilities: { evals: 1 } },
    intencion: { choice: "understand_concept", confidence: 1, probabilities: { understand_concept: 1 } },
    confusion: { score: 1, confidence: 0.9, probabilities: { "1": 1 } },
    valor_para_preguntas: { score: 2, confidence: 0.8, probabilities: { "2": 1 } },
    respaldada: { noul: 0.8 },
  },
  usage: { input_tokens: 2500, output_tokens: 20 },
};

const raiz = (id: string, extra: Partial<RaizListada> = {}): RaizListada => ({
  traceId: id,
  startedAt: new Date(AHORA - 60_000).toISOString(),
  status: "success",
  metadata: {},
  ...extra,
});

function storeCon(raices: RaizListada[]): StoreJev & { getTrace: ReturnType<typeof vi.fn> } {
  return {
    listTracesLight: vi.fn(async () => ({ spans: raices })),
    getTrace: vi.fn(async ({ traceId }: { traceId: string }) => ({
      spans: [
        { spanType: "agent_run", input: `¿Pregunta ${traceId}?`, output: { text: "Respuesta" } },
        {
          spanType: "tool_call",
          name: "tool: 'buscar_laminas'",
          output: { resultados: [{ lamina: 34, titulo: "Evals", fragmento: "¿Lo hizo bien?" }] },
        },
      ] as SpanTraza[],
    })),
  };
}

let db: Awaited<ReturnType<typeof crearDbTemporal>>;
let repo: ReturnType<typeof crearJev>;
beforeEach(async () => {
  db = await crearDbTemporal();
  repo = crearJev(db.fuente);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  db.cerrar();
});

const evaluarOk = (): EvaluarTurno & ReturnType<typeof vi.fn> =>
  vi.fn(async () => ({ resultado: RESULTADO, latenciaMs: 180 }));

describe("crearAnalizadorJev", () => {
  it("analiza las trazas nuevas y nunca vuelve a analizar la misma", async () => {
    const evaluar = evaluarOk();
    const a = crearAnalizadorJev({ obtenerStore: async () => storeCon([raiz("a"), raiz("b")]), evaluar, repo, ahora: () => AHORA });
    expect(await a.analizar()).toMatchObject({ jevDisponible: true, analizadosEnCiclo: 2 });
    expect(await a.analizar()).toMatchObject({ analizadosEnCiclo: 0 });
    expect(evaluar).toHaveBeenCalledTimes(2);
    const guardados = await repo.desde("2026-01-01T00:00:00Z");
    expect(guardados.map((g) => g.traceId).sort()).toEqual(["a", "b"]);
    expect(guardados[0]).toMatchObject({ tema: "evals", confusion: 0.25, valor: 0.5, respaldada: 0.8, latenciaMs: 180 });
  });

  it("excluye las trazas del runner de evals", async () => {
    const evaluar = evaluarOk();
    const store = storeCon([raiz("eval1", { metadata: { origen: "eval" } }), raiz("real")]);
    const a = crearAnalizadorJev({ obtenerStore: async () => store, evaluar, repo, ahora: () => AHORA });
    await a.analizar();
    expect(evaluar).toHaveBeenCalledTimes(1);
    expect(store.getTrace).not.toHaveBeenCalledWith({ traceId: "eval1" });
  });

  it("polls concurrentes comparten el mismo ciclo (sin doble análisis)", async () => {
    const evaluar = evaluarOk();
    const a = crearAnalizadorJev({ obtenerStore: async () => storeCon([raiz("a")]), evaluar, repo, ahora: () => AHORA });
    const [x, y] = await Promise.all([a.analizar(), a.analizar()]);
    expect(x).toBe(y);
    expect(evaluar).toHaveBeenCalledTimes(1);
  });

  it("si TypeSafe falla: degradado, no guarda y deja de llamarlo durante la pausa", async () => {
    let t = AHORA;
    const evaluar = vi.fn(async () => {
      throw new Error("caído");
    });
    const a = crearAnalizadorJev({
      obtenerStore: async () => storeCon([raiz("a")]),
      evaluar,
      repo,
      ahora: () => t,
      pausaTrasFallaMs: 30_000,
    });
    expect(await a.analizar()).toMatchObject({ jevDisponible: false, analizadosEnCiclo: 0 });
    expect(await repo.total()).toBe(0);
    await a.analizar();
    expect(evaluar).toHaveBeenCalledTimes(1);
    // pasada la pausa, vuelve a intentar (la traza sigue sin análisis)
    t += 31_000;
    evaluar.mockResolvedValueOnce({ resultado: RESULTADO, latenciaMs: 200 } as never);
    expect(await a.analizar()).toMatchObject({ jevDisponible: true, analizadosEnCiclo: 1 });
  });

  it("sin TYPESAFE_API_KEY (evaluar = null) no lee trazas y queda no disponible", async () => {
    const store = storeCon([raiz("a")]);
    const a = crearAnalizadorJev({ obtenerStore: async () => store, evaluar: null, repo, ahora: () => AHORA });
    expect(await a.analizar()).toMatchObject({ jevDisponible: false });
    expect(store.listTracesLight).not.toHaveBeenCalled();
  });

  it("si el store de trazas falla, no lanza", async () => {
    const a = crearAnalizadorJev({
      obtenerStore: async () => {
        throw new Error("neon caído");
      },
      evaluar: evaluarOk(),
      repo,
      ahora: () => AHORA,
    });
    expect(await a.analizar()).toMatchObject({ trazasDisponibles: false, analizadosEnCiclo: 0 });
  });

  it("máximo por ciclo: las más recientes primero", async () => {
    const evaluar = evaluarOk();
    const raices = Array.from({ length: 5 }, (_, i) => raiz(`r${i}`, { startedAt: new Date(AHORA - (i + 1) * 1000).toISOString() }));
    const a = crearAnalizadorJev({ obtenerStore: async () => storeCon(raices), evaluar, repo, ahora: () => AHORA, maximoPorCiclo: 2 });
    await a.analizar();
    expect((await repo.desde("2026-01-01T00:00:00Z")).map((g) => g.traceId).sort()).toEqual(["r0", "r1"]);
  });

  it("no envía identidad a TypeSafe: solo pregunta, respuesta y láminas", async () => {
    const evaluar = evaluarOk();
    const store = storeCon([raiz("a", { metadata: { resourceId: "asistente-123", threadId: "charla-asistente-123" } })]);
    const a = crearAnalizadorJev({ obtenerStore: async () => store, evaluar, repo, ahora: () => AHORA });
    await a.analizar();
    const turno = evaluar.mock.calls[0][0];
    expect(JSON.stringify(turno)).not.toContain("asistente-123");
  });
});
