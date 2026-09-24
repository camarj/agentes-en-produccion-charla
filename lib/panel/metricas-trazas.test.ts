import { afterEach, describe, expect, it, vi } from "vitest";
import { esTrazaDeEval } from "@/lib/origen-eval";
import {
  calcularMetricasTrazas,
  crearLectorMetricasTrazas,
  leerMetricasTrazas,
  motivoDeBloqueo,
  percentil,
  tipoDeFalla,
  VENTANA_LATENCIA_MS,
  VENTANA_TOTALES_MS,
  type RaizTraza,
  type RamaProcesador,
  type SpanDetalle,
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
      erroresPorTipo: {},
      bloqueos: { total: 0, porMotivo: {} },
      turnos: 0,
      respaldo: { ultimaHora: 0, ultimaEn: null },
      modeloEnUso: null,
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

// ---------- Modelo de respaldo y fallas técnicas (arreglos post-T14) ----------

const span = (spanType: string, error: unknown = null, extra: Partial<SpanDetalle> = {}): SpanDetalle => ({
  spanType,
  status: error ? "error" : "success",
  error,
  ...extra,
});

describe("calcularMetricasTrazas · modelo de respaldo", () => {
  it("cuenta las respuestas del respaldo de la última hora y da la hora de la última (sin evals)", () => {
    const vieja = traza({ haceMin: 90, metadata: { modelo_respaldo: true, modelo_usado: "anthropic/claude-sonnet-5" } });
    const reciente = traza({ haceMin: 3, metadata: { modelo_respaldo: true } });
    const otra = traza({ haceMin: 30, metadata: { modelo_respaldo: true } });
    const m = calcularMetricasTrazas(
      [vieja, otra, reciente, traza(), traza({ haceMin: 1, metadata: { modelo_respaldo: true, origen: "eval" } })],
      { ahora: AHORA },
    );
    expect(m.respaldo).toEqual({ ultimaHora: 2, ultimaEn: hace(3).toISOString() });
  });

  it("sin respaldo en la última hora, igual informa la última de la ventana", () => {
    const m = calcularMetricasTrazas([traza({ haceMin: 200, metadata: { modelo_respaldo: true } })], { ahora: AHORA });
    expect(m.respaldo).toEqual({ ultimaHora: 0, ultimaEn: hace(200).toISOString() });
  });

  it("una respuesta salvada por el respaldo no es una falla aunque el intento del principal dejó un span con error", () => {
    const salvada = traza({ metadata: { modelo_respaldo: true } });
    const m = calcularMetricasTrazas([salvada], {
      ahora: AHORA,
      trazasConErrorHijo: new Set([salvada.traceId]),
      detalle: new Map([[salvada.traceId, [span("agent_run"), span("model_generation", { name: "APICallError", message: "Overloaded" })]]]),
    });
    expect(m.errores).toBe(0);
    expect(m.latencia.muestras).toBe(1);
  });
});

describe("tipoDeFalla", () => {
  const raiz = (p: Partial<RaizTraza> = {}) => traza(p);

  it("null si no hay error en la raíz ni en los hijos", () => {
    expect(tipoDeFalla(raiz(), undefined, false)).toBeNull();
  });

  it("tiempo agotado: corte por los 45 s o abort", () => {
    expect(tipoDeFalla(raiz({ status: "error", error: { name: "TimeoutError", message: "The operation was aborted due to timeout" } }), undefined, false)).toBe("tiempo");
    expect(tipoDeFalla(raiz(), [span("model_generation", { name: "AbortError", message: "This operation was aborted" })], true)).toBe("tiempo");
  });

  it("herramienta: un span de herramienta con error", () => {
    expect(tipoDeFalla(raiz(), [span("agent_run"), span("tool_call", { message: "no_disponible" })], true)).toBe("herramienta");
    expect(tipoDeFalla(raiz(), [span("mcp_tool_call", { message: "x" })], true)).toBe("herramienta");
  });

  it("modelo: un span del modelo con error o un error de proveedor en la raíz", () => {
    expect(tipoDeFalla(raiz(), [span("model_step", { message: "Overloaded" })], true)).toBe("modelo");
    expect(tipoDeFalla(raiz({ status: "error", error: { name: "AI_APICallError", message: "Service Unavailable" } }), [], false)).toBe("modelo");
  });

  it("otro: error sin pistas", () => {
    expect(tipoDeFalla(raiz({ status: "error", error: { message: "boom" } }), [span("agent_run", { message: "boom" })], false)).toBe("otro");
    expect(tipoDeFalla(raiz(), undefined, true)).toBe("otro");
  });

  it("salvada por el respaldo: los errores del modelo no cuentan; otros sí", () => {
    const salvada = raiz({ metadata: { modelo_respaldo: true } });
    expect(tipoDeFalla(salvada, [span("model_generation", { message: "Overloaded" })], true)).toBeNull();
    // Sin detalle, se asume que el error hijo fue el intento fallido del principal.
    expect(tipoDeFalla(salvada, undefined, true)).toBeNull();
    expect(tipoDeFalla(salvada, [span("model_step", { message: "Overloaded" }), span("tool_call", { message: "x" })], true)).toBe("herramienta");
  });

  it("los bloqueos de guardrail (span de procesador con guardrail) no son fallas", () => {
    expect(
      tipoDeFalla(raiz(), [span("processor_run", { message: "Solo puedo ayudarte…" }, { metadata: { guardrail: "alcance_charla" } })], true),
    ).toBeNull();
  });
});

describe("fallas de herramienta marcadas en la raíz (buscar_laminas agotó sus reintentos)", () => {
  it("cuenta como «herramienta» aunque el turno terminó bien y no pide detalle", async () => {
    const t = traza({ metadata: { falla_herramienta: true } });
    expect(tipoDeFalla(t, undefined, false)).toBe("herramienta");
    const store = { ...storeFalso([t, traza()]), getTraceLight: vi.fn(async () => ({ spans: [] })) };
    const m = await leerMetricasTrazas(async () => store, { ahora: () => AHORA });
    expect(m).toMatchObject({ errores: 1, erroresPorTipo: { herramienta: 1 } });
    expect(store.getTraceLight).not.toHaveBeenCalled();
    // Sigue midiendo latencia: el asistente sí recibió una respuesta.
    expect(m?.latencia.muestras).toBe(2);
  });

  it("también con el respaldo: la herramienta falló aunque el respaldo respondió", () => {
    expect(tipoDeFalla(traza({ metadata: { falla_herramienta: true, modelo_respaldo: true } }), undefined, false)).toBe("herramienta");
  });

  it("ningún modelo pudo responder (fallan los dos): «modelo»", () => {
    const raiz = traza({ status: "error", error: { name: "AI_APICallError", message: "Overloaded (simulado por el interruptor modelo_caido)" } });
    expect(tipoDeFalla(raiz, [span("model_generation", { message: "Overloaded" })], false)).toBe("modelo");
  });
});

describe("calcularMetricasTrazas · fallas por tipo", () => {
  it("desglosa las fallas por tipo y no cuenta bloqueos", () => {
    const a = traza({ status: "error", error: { name: "TimeoutError", message: "aborted due to timeout" } });
    const b = traza();
    const c = traza();
    const d = traza({ status: "error", error: { message: "boom" } });
    const bloqueo = traza({ metadata: { guardrail: "g", motivo: "inyeccion" } });
    const m = calcularMetricasTrazas([a, b, c, d, bloqueo, traza()], {
      ahora: AHORA,
      trazasConErrorHijo: new Set([b.traceId, c.traceId, bloqueo.traceId]),
      detalle: new Map([
        [b.traceId, [span("tool_call", { message: "x" })]],
        [c.traceId, [span("model_generation", { message: "Overloaded" })]],
      ]),
    });
    expect(m.errores).toBe(4);
    expect(m.erroresPorTipo).toEqual({ tiempo: 1, herramienta: 1, modelo: 1, otro: 1 });
    expect(m.bloqueos.total).toBe(1);
  });
});

describe("leerMetricasTrazas · detalle de fallas", () => {
  it("pide el detalle (getTraceLight) solo de las trazas con error y clasifica", async () => {
    const ok = traza();
    const herramienta = traza();
    const store = {
      ...storeFalso([ok, herramienta], [herramienta.traceId]),
      getTraceLight: vi.fn(async ({ traceId }: { traceId: string }) => ({
        traceId,
        spans: [span("agent_run"), span("tool_call", { message: "no_disponible" })],
      })),
    };
    const m = await leerMetricasTrazas(async () => store, { ahora: () => AHORA });
    expect(m).toMatchObject({ errores: 1, erroresPorTipo: { herramienta: 1 } });
    expect(store.getTraceLight.mock.calls.map((c) => c[0].traceId)).toEqual([herramienta.traceId]);
  });

  it("si getTraceLight falla o no existe, cuenta la falla como «otro» (nunca lanza)", async () => {
    const t = traza({ status: "error", error: { message: "boom" } });
    const sinDetalle = storeFalso([t]);
    expect(await leerMetricasTrazas(async () => sinDetalle, { ahora: () => AHORA })).toMatchObject({ errores: 1, erroresPorTipo: { otro: 1 } });
    const conFalla = { ...storeFalso([t]), getTraceLight: vi.fn(async () => Promise.reject(new Error("x"))) };
    expect(await leerMetricasTrazas(async () => conFalla, { ahora: () => AHORA })).toMatchObject({ errores: 1, erroresPorTipo: { otro: 1 } });
  });

  it("no pide detalle de bloqueos, evals ni respuestas del respaldo sin error hijo", async () => {
    const bloqueo = traza({ metadata: { guardrail: "g", motivo: "inyeccion" } });
    const evalT = traza({ status: "error", error: {}, metadata: { origen: "eval" } });
    const respaldo = traza({ metadata: { modelo_respaldo: true } });
    const store = {
      ...storeFalso([bloqueo, evalT, respaldo], [bloqueo.traceId, evalT.traceId]),
      getTraceLight: vi.fn(async ({ traceId }: { traceId: string }) => ({ traceId, spans: [] })),
    };
    const m = await leerMetricasTrazas(async () => store, { ahora: () => AHORA });
    expect(store.getTraceLight).not.toHaveBeenCalled();
    expect(m).toMatchObject({ errores: 0, respaldo: { ultimaHora: 1 } });
  });
});

describe("modelo en uso (el del turno más reciente con respuesta)", () => {
  it("respaldo: el turno más reciente lo respondió el respaldo (modelo_usado en la raíz)", () => {
    const m = calcularMetricasTrazas(
      [traza({ haceMin: 10 }), traza({ haceMin: 2, metadata: { modelo_respaldo: true, modelo_usado: "anthropic/claude-sonnet-5" } })],
      { ahora: AHORA },
    );
    expect(m.modeloEnUso).toMatchObject({ estado: "respaldo", modelo: "anthropic/claude-sonnet-5", en: hace(2).toISOString() });
  });

  it("principal: sin marca de respaldo (el modelo se completa después con el span model_generation)", () => {
    const reciente = traza({ haceMin: 1 });
    const m = calcularMetricasTrazas([traza({ haceMin: 5, metadata: { modelo_respaldo: true } }), reciente], { ahora: AHORA });
    expect(m.modeloEnUso).toEqual({ estado: "principal", modelo: null, en: hace(1).toISOString(), traceId: reciente.traceId });
  });

  it("sin modelo: el turno más reciente falló porque ningún modelo respondió", () => {
    const caida = traza({ haceMin: 1, status: "error", error: { name: "AI_APICallError", message: "Overloaded" } });
    const m = calcularMetricasTrazas([traza({ haceMin: 5 }), caida], {
      ahora: AHORA,
      detalle: new Map([[caida.traceId, [span("model_generation", { message: "Overloaded" })]]]),
    });
    expect(m.modeloEnUso).toMatchObject({ estado: "sin_modelo", modelo: null, en: hace(1).toISOString() });
  });

  it("ignora evals, bloqueos, turnos en curso y otras fallas sin respuesta", () => {
    const buena = traza({ haceMin: 30, metadata: { modelo_respaldo: true, modelo_usado: "anthropic/claude-sonnet-5" } });
    const hijoBloqueado = traza({ haceMin: 3, status: "running", endedAt: null });
    const m = calcularMetricasTrazas(
      [
        buena,
        traza({ haceMin: 1, metadata: { origen: "eval" } }),
        traza({ haceMin: 2, metadata: { guardrail: "g", motivo: "inyeccion" } }),
        hijoBloqueado,
        traza({ haceMin: 4, status: "running", endedAt: null }),
        traza({ haceMin: 5, status: "error", error: { message: "boom" } }),
      ],
      { ahora: AHORA, bloqueosEnHijos: new Map([[hijoBloqueado.traceId, "fuera_de_alcance"]]) },
    );
    expect(m.modeloEnUso).toMatchObject({ estado: "respaldo", en: hace(30).toISOString() });
  });

  it("una falla de herramienta con respuesta sí cuenta (el modelo respondió)", () => {
    const m = calcularMetricasTrazas([traza({ haceMin: 1, metadata: { falla_herramienta: true } })], { ahora: AHORA });
    expect(m.modeloEnUso).toMatchObject({ estado: "principal" });
  });

  it("null si no hubo turnos con respuesta", () => {
    expect(calcularMetricasTrazas([traza({ metadata: { origen: "eval" } })], { ahora: AHORA }).modeloEnUso).toBeNull();
  });
});

describe("leerMetricasTrazas · modelo en uso", () => {
  const conTraza = (raices: RaizTraza[], spans: Array<{ spanType: string; attributes?: Record<string, unknown> | null }>) => ({
    ...storeFalso(raices),
    getTrace: vi.fn(async ({ traceId }: { traceId: string }) => ({ traceId, spans })),
  });

  it("principal: lee el modelo del span model_generation (una sola traza)", async () => {
    const vieja = traza({ haceMin: 9 });
    const reciente = traza({ haceMin: 1 });
    const store = conTraza([vieja, reciente], [
      { spanType: "agent_run", attributes: {} },
      { spanType: "model_generation", attributes: { model: "gpt-6-luna", provider: "openai.responses" } },
    ]);
    const m = await leerMetricasTrazas(async () => store, { ahora: () => AHORA });
    expect(m?.modeloEnUso).toMatchObject({ estado: "principal", modelo: "gpt-6-luna" });
    expect(store.getTrace.mock.calls.map((c) => c[0].traceId)).toEqual([reciente.traceId]);
  });

  it("respaldo o sin modelo: no pide la traza completa", async () => {
    const store = conTraza([traza({ metadata: { modelo_respaldo: true, modelo_usado: "anthropic/claude-sonnet-5" } })], []);
    const m = await leerMetricasTrazas(async () => store, { ahora: () => AHORA });
    expect(m?.modeloEnUso).toMatchObject({ estado: "respaldo", modelo: "anthropic/claude-sonnet-5" });
    expect(store.getTrace).not.toHaveBeenCalled();
  });

  it("si la traza no se puede leer o no trae el modelo: principal con modelo null (el panel muestra «—»)", async () => {
    const t = traza();
    const falla = { ...storeFalso([t]), getTrace: vi.fn(async () => Promise.reject(new Error("x"))) };
    expect((await leerMetricasTrazas(async () => falla, { ahora: () => AHORA }))?.modeloEnUso).toMatchObject({ estado: "principal", modelo: null });
    const sinModelo = conTraza([t], [{ spanType: "model_generation", attributes: null }]);
    expect((await leerMetricasTrazas(async () => sinModelo, { ahora: () => AHORA }))?.modeloEnUso).toMatchObject({ modelo: null });
    expect((await leerMetricasTrazas(async () => storeFalso([t]), { ahora: () => AHORA }))?.modeloEnUso).toMatchObject({ modelo: null });
  });
});
