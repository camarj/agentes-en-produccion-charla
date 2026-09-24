import { afterEach, describe, expect, it, vi } from "vitest";
import { esTrazaDeEval } from "@/lib/origen-eval";
import {
  calcularMetricasTrazas,
  crearLectorMetricasTrazas,
  leerMetricasTrazas,
  motivoDeBloqueo,
  percentil,
  VENTANA_LATENCIA_MS,
  VENTANA_TOTALES_MS,
  type RaizTraza,
  type RamaProcesador,
} from "./metricas-trazas";

const AHORA = Date.parse("2026-09-26T19:00:00Z");
const hace = (min: number) => new Date(AHORA - min * 60_000);

let n = 0;
function traza(p: Partial<RaizTraza> & { duracionMs?: number; haceMin?: number } = {}): RaizTraza {
  const { duracionMs = 1000, haceMin = 5, ...resto } = p;
  const inicio = hace(haceMin);
  return {
    traceId: `t${++n}`,
    startedAt: inicio,
    endedAt: new Date(inicio.getTime() + duracionMs),
    status: "success",
    error: null,
    metadata: {},
    ...resto,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("percentil (rango más cercano)", () => {
  it("null sin datos", () => {
    expect(percentil([], 50)).toBeNull();
  });
  it("un solo valor", () => {
    expect(percentil([7], 50)).toBe(7);
    expect(percentil([7], 95)).toBe(7);
  });
  it("1..100 → p50 = 50 y p95 = 95, sin importar el orden", () => {
    const valores = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(percentil(valores, 50)).toBe(50);
    expect(percentil(valores, 95)).toBe(95);
  });
  it("10 valores → p95 es el máximo", () => {
    const v = [2550, 2600, 2740, 2750, 2810, 2970, 3610, 3670, 3990, 6720];
    expect(percentil(v, 50)).toBe(2810);
    expect(percentil(v, 95)).toBe(6720);
  });
});

describe("motivoDeBloqueo", () => {
  it("motivo cuando hay guardrail y motivo en la metadata", () => {
    expect(motivoDeBloqueo({ guardrail: "alcance_charla", motivo: "fuera_de_alcance", confianza: 0.9 })).toBe("fuera_de_alcance");
    expect(motivoDeBloqueo({ guardrail: "sin_datos_personales", motivo: "datos_personales", tipo_dato: "email" })).toBe(
      "datos_personales",
    );
  });
  it("bloqueo de entrada sin motivo explícito → «otro»", () => {
    expect(motivoDeBloqueo({ guardrails_entrada: "bloqueado" })).toBe("otro");
  });
  it("null si no hubo bloqueo", () => {
    expect(motivoDeBloqueo({})).toBeNull();
    expect(motivoDeBloqueo(null)).toBeNull();
    expect(motivoDeBloqueo({ guardrails_entrada: "paso", alcance_falla_abierta: true })).toBeNull();
    expect(motivoDeBloqueo({ motivo: "algo" })).toBeNull();
  });
});

describe("calcularMetricasTrazas", () => {
  it("sin trazas: latencias null y conteos en cero", () => {
    expect(calcularMetricasTrazas([], { ahora: AHORA })).toEqual({
      latencia: { p50Ms: null, p95Ms: null, muestras: 0 },
      errores: 0,
      bloqueos: { total: 0, porMotivo: {} },
      turnos: 0,
    });
  });

  it("latencia = endedAt − startedAt de turnos terminados de la última hora", () => {
    const m = calcularMetricasTrazas(
      [
        traza({ duracionMs: 1000 }),
        traza({ duracionMs: 3000 }),
        traza({ duracionMs: 2000 }),
        traza({ duracionMs: 9000, haceMin: 61 }), // fuera de la hora
        traza({ duracionMs: 4000, endedAt: null, status: "running" }), // en curso
      ],
      { ahora: AHORA },
    );
    expect(m.latencia).toEqual({ p50Ms: 2000, p95Ms: 3000, muestras: 3 });
    expect(m.turnos).toBe(5);
  });

  it("acepta fechas como texto ISO", () => {
    const m = calcularMetricasTrazas(
      [{ traceId: "x", startedAt: hace(2).toISOString(), endedAt: new Date(hace(2).getTime() + 1500).toISOString(), status: "success" }],
      { ahora: AHORA },
    );
    expect(m.latencia.p50Ms).toBe(1500);
  });

  it("los bloqueos no cuentan en la latencia ni como error; se agrupan por motivo", () => {
    const m = calcularMetricasTrazas(
      [
        traza({ duracionMs: 5000 }),
        traza({ duracionMs: 50, metadata: { guardrail: "deteccion_inyeccion", motivo: "inyeccion" } }),
        traza({ duracionMs: 60, metadata: { guardrail: "alcance_charla", motivo: "fuera_de_alcance" } }),
        traza({ duracionMs: 70, metadata: { guardrail: "alcance_charla", motivo: "fuera_de_alcance" } }),
        traza({ duracionMs: 4000, metadata: { guardrail: "sin_datos_personales", motivo: "datos_personales" } }),
        // Bloqueo a mitad de una llamada a herramienta: la traza quedó abierta (T09).
        traza({ endedAt: null, status: "running", metadata: { guardrails_entrada: "bloqueado", guardrail: "alcance_charla", motivo: "fuera_de_alcance" } }),
        // Bloqueo abierto que además quedó con error: sigue siendo un bloqueo.
        traza({ endedAt: null, status: "error", error: { message: "abort" }, metadata: { guardrails_entrada: "bloqueado" } }),
      ],
      { ahora: AHORA, trazasConErrorHijo: new Set() },
    );
    expect(m.latencia).toEqual({ p50Ms: 5000, p95Ms: 5000, muestras: 1 });
    expect(m.errores).toBe(0);
    expect(m.bloqueos).toEqual({
      total: 6,
      porMotivo: { inyeccion: 1, fuera_de_alcance: 3, datos_personales: 1, otro: 1 },
    });
  });

  it("bloqueo registrado solo en un span hijo (raíz abierta y sin metadata, visto en Neon): bloqueo, no error", () => {
    const abierta = traza({ endedAt: null, status: "running", metadata: { rol_anonimo: "negocio" } });
    const m = calcularMetricasTrazas([abierta, traza({ duracionMs: 2000 })], {
      ahora: AHORA,
      trazasConErrorHijo: new Set([abierta.traceId]),
      bloqueosEnHijos: new Map([[abierta.traceId, "fuera_de_alcance"]]),
    });
    expect(m.errores).toBe(0);
    expect(m.bloqueos).toEqual({ total: 1, porMotivo: { fuera_de_alcance: 1 } });
    expect(m.latencia.muestras).toBe(1);
  });

  it("errores = estado error en la raíz o algún span hijo con error, sin duplicar", () => {
    const conError = traza({ status: "error", error: { message: "boom" }, duracionMs: 800 });
    const hijo = traza({ duracionMs: 1200 });
    const ambos = traza({ status: "error", error: {} });
    const m = calcularMetricasTrazas([conError, hijo, ambos, traza()], {
      ahora: AHORA,
      trazasConErrorHijo: new Set([hijo.traceId, ambos.traceId, "otra-traza-fuera-de-la-lista"]),
    });
    expect(m.errores).toBe(3);
    // Un turno con error no entra en la latencia.
    expect(m.latencia.muestras).toBe(1);
  });

  it("errores y bloqueos cuentan toda la ventana (12 h), no solo la última hora", () => {
    const m = calcularMetricasTrazas(
      [
        traza({ haceMin: 300, status: "error", error: {} }),
        traza({ haceMin: 300, metadata: { guardrail: "x", motivo: "inyeccion" } }),
        traza({ haceMin: 13 * 60, status: "error", error: {} }), // fuera de la ventana
      ],
      { ahora: AHORA },
    );
    expect(m.errores).toBe(1);
    expect(m.bloqueos.total).toBe(1);
    expect(VENTANA_LATENCIA_MS).toBe(3_600_000);
    expect(VENTANA_TOTALES_MS).toBe(12 * 3_600_000);
  });
});

function storeFalso(raices: RaizTraza[], conErrorHijo: string[] = [], ramas: RamaProcesador[] = []) {
  return {
    listTracesLight: vi.fn(async (args: { filters?: { hasChildError?: boolean }; pagination?: { page: number; perPage: number } }) => {
      const lista = args.filters?.hasChildError ? raices.filter((r) => conErrorHijo.includes(r.traceId)) : raices;
      const { page = 0, perPage = 100 } = args.pagination ?? {};
      return {
        pagination: { total: lista.length, page, perPage, hasMore: (page + 1) * perPage < lista.length },
        spans: lista.slice(page * perPage, (page + 1) * perPage),
      };
    }),
    listBranches: vi.fn(async (args: { pagination?: { page: number; perPage: number } }) => {
      const { page = 0, perPage = 100 } = args.pagination ?? {};
      return {
        pagination: { total: ramas.length, page, perPage, hasMore: (page + 1) * perPage < ramas.length },
        branches: ramas.slice(page * perPage, (page + 1) * perPage),
      };
    }),
  };
}

describe("calcularMetricasTrazas · trazas de evals (T13)", () => {
  it("no cuenta los turnos que generó el runner de evals (metadata.origen = eval)", () => {
    const raices = [
      traza({ duracionMs: 2000 }),
      traza({ duracionMs: 9000, metadata: { origen: "eval" } }),
      traza({ status: "error", metadata: { origen: "eval" } }),
      traza({ metadata: { origen: "eval", guardrail: "alcance_charla", motivo: "fuera_de_alcance" } }),
    ];
    const m = calcularMetricasTrazas(raices, { ahora: AHORA, trazasConErrorHijo: new Set([raices[1].traceId]) });
    expect(m.turnos).toBe(1);
    expect(m.errores).toBe(0);
    expect(m.bloqueos.total).toBe(0);
    expect(m.latencia).toEqual({ p50Ms: 2000, p95Ms: 2000, muestras: 1 });
  });

  it("un bloqueo de eval registrado solo en un span hijo tampoco cuenta", () => {
    const raiz = traza({ status: "running", endedAt: null, metadata: { origen: "eval" } });
    const m = calcularMetricasTrazas([raiz], { ahora: AHORA, bloqueosEnHijos: new Map([[raiz.traceId, "inyeccion"]]) });
    expect(m.turnos).toBe(0);
    expect(m.bloqueos.total).toBe(0);
  });

  it("esTrazaDeEval reconoce solo la marca exacta", () => {
    expect(esTrazaDeEval({ origen: "eval" })).toBe(true);
    expect(esTrazaDeEval({ origen: "chat" })).toBe(false);
    expect(esTrazaDeEval({})).toBe(false);
    expect(esTrazaDeEval(null)).toBe(false);
    expect(esTrazaDeEval(undefined)).toBe(false);
  });
});

describe("leerMetricasTrazas", () => {
  it("consulta solo las trazas del agente charla en la ventana y calcula", async () => {
    const t1 = traza({ duracionMs: 1000 });
    const t2 = traza({ duracionMs: 3000 });
    const store = storeFalso([t1, t2], [t2.traceId]);
    const m = await leerMetricasTrazas(async () => store, { ahora: () => AHORA });
    expect(m).toMatchObject({ errores: 1, latencia: { muestras: 1, p50Ms: 1000 } });
    const filtros = store.listTracesLight.mock.calls.map((c) => c[0].filters);
    expect(filtros).toContainEqual({ entityId: "charla", startedAt: { start: new Date(AHORA - VENTANA_TOTALES_MS) } });
    expect(filtros).toContainEqual({
      entityId: "charla",
      startedAt: { start: new Date(AHORA - VENTANA_TOTALES_MS) },
      hasChildError: true,
    });
  });

  it("busca bloqueos en los spans de procesador con error (listBranches) y los descuenta de errores", async () => {
    const bloqueada = traza({ endedAt: null, status: "running", metadata: {} });
    const store = storeFalso([bloqueada, traza()], [bloqueada.traceId], [
      { traceId: bloqueada.traceId, metadata: { guardrail: "alcance_charla", motivo: "fuera_de_alcance" } },
      { traceId: "otra-traza-de-otro-agente", metadata: { guardrail: "x", motivo: "inyeccion" } },
      { traceId: "t-sin-motivo", metadata: { runId: "r" } },
    ]);
    const m = await leerMetricasTrazas(async () => store, { ahora: () => AHORA });
    expect(m).toMatchObject({ errores: 0, bloqueos: { total: 1, porMotivo: { fuera_de_alcance: 1 } } });
    expect(store.listBranches.mock.calls[0][0]).toEqual({
      filters: { spanType: "processor_run", status: "error", startedAt: { start: new Date(AHORA - VENTANA_TOTALES_MS) } },
      pagination: { page: 0, perPage: 100 },
    });
  });

  it("si listBranches no existe o falla (LibSQL), igual calcula con las raíces", async () => {
    const t = traza({ metadata: { guardrail: "g", motivo: "inyeccion" } });
    const sinRamas = { listTracesLight: storeFalso([t]).listTracesLight };
    expect(await leerMetricasTrazas(async () => sinRamas, { ahora: () => AHORA })).toMatchObject({ bloqueos: { total: 1 } });
    const conFalla = { ...storeFalso([t]), listBranches: vi.fn(async () => Promise.reject(new Error("LibSQL no soporta"))) };
    expect(await leerMetricasTrazas(async () => conFalla, { ahora: () => AHORA })).toMatchObject({ bloqueos: { total: 1 } });
  });

  it("recorre varias páginas de a 100 como máximo (límite de Mastra) y las pide en paralelo", async () => {
    const muchas = Array.from({ length: 780 }, () => traza());
    const store = storeFalso(muchas);
    let simultaneas = 0;
    let maximo = 0;
    const original = store.listTracesLight.getMockImplementation()!;
    store.listTracesLight.mockImplementation(async (args) => {
      simultaneas++;
      maximo = Math.max(maximo, simultaneas);
      await new Promise((r) => setTimeout(r, 5));
      simultaneas--;
      return original(args);
    });
    const m = await leerMetricasTrazas(async () => store, { ahora: () => AHORA });
    expect(m?.turnos).toBe(780);
    const tamanos = store.listTracesLight.mock.calls.map((c) => c[0].pagination!.perPage);
    expect(Math.max(...tamanos)).toBeLessThanOrEqual(100);
    expect(maximo).toBeGreaterThan(2);
  });

  it("modo degradado: null si el store no existe, lanza o tarda demasiado (nunca lanza)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await leerMetricasTrazas(async () => undefined, { ahora: () => AHORA })).toBeNull();
    expect(
      await leerMetricasTrazas(async () => ({ listTracesLight: async () => Promise.reject(new Error("ECONNREFUSED host-secreto")) }), {
        ahora: () => AHORA,
      }),
    ).toBeNull();
    expect(
      await leerMetricasTrazas(async () => ({ listTracesLight: () => new Promise<never>(() => {}) }), {
        ahora: () => AHORA,
        timeoutMs: 20,
      }),
    ).toBeNull();
    expect(await leerMetricasTrazas(async () => Promise.reject(new Error("init")), { ahora: () => AHORA })).toBeNull();
    // El log lleva solo el tipo del error, nunca el mensaje.
    expect(JSON.stringify(error.mock.calls)).not.toContain("host-secreto");
  });
});

describe("crearLectorMetricasTrazas", () => {
  it("reutiliza el resultado durante el TTL y comparte la consulta en curso", async () => {
    let t = AHORA;
    const store = storeFalso([traza()]);
    const leer = crearLectorMetricasTrazas({ obtenerStore: async () => store, ttlMs: 4000, ahora: () => t });
    await Promise.all([leer(), leer()]);
    const llamadas = store.listTracesLight.mock.calls.length;
    await leer();
    expect(store.listTracesLight.mock.calls.length).toBe(llamadas);
    t += 4001;
    await leer();
    expect(store.listTracesLight.mock.calls.length).toBe(llamadas * 2);
  });
});
