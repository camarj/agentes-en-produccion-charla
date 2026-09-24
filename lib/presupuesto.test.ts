import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearDbTemporal } from "./db/prueba";
import {
  PRECIOS_USD_POR_MILLON,
  PRECIO_DESCONOCIDO,
  TOKENS_AUXILIARES_POR_TURNO,
  costeEstimadoTurno,
  crearPresupuesto,
  precioDe,
  presupuestoMaximoUsd,
} from "./presupuesto";

const MILLON = 1_000_000;

describe("precioDe", () => {
  it("cubre los modelos del agente, del respaldo y de guardrails/jueces", () => {
    for (const id of ["gpt-6-luna", "claude-sonnet-5", "claude-haiku-4-5"]) {
      expect(PRECIOS_USD_POR_MILLON[id]).toBeDefined();
    }
  });

  it("gpt-6-luna: $0,10 entrada y $0,50 salida por millón (con o sin prefijo de proveedor)", () => {
    const uso = { inputTokens: MILLON, outputTokens: MILLON };
    expect(precioDe("openai/gpt-6-luna", uso)).toBeCloseTo(0.6, 10);
    expect(precioDe("gpt-6-luna", uso)).toBeCloseTo(0.6, 10);
  });

  it("claude-sonnet-5: $2 / $10; claude-haiku-4-5: $1 / $5", () => {
    expect(precioDe("anthropic/claude-sonnet-5", { inputTokens: MILLON, outputTokens: MILLON })).toBeCloseTo(12, 10);
    expect(precioDe("claude-haiku-4-5", { inputTokens: MILLON, outputTokens: MILLON })).toBeCloseTo(6, 10);
  });

  it("los tokens de entrada en caché se cobran a la tarifa de caché", () => {
    const uso = { inputTokens: MILLON, cachedInputTokens: MILLON, outputTokens: 0 };
    expect(precioDe("gpt-6-luna", uso)).toBeCloseTo(PRECIOS_USD_POR_MILLON["gpt-6-luna"].entradaCache, 10);
  });

  it("un id con sufijo de versión usa el precio de su familia", () => {
    expect(precioDe("gpt-6-luna-2026-09-01", { inputTokens: MILLON })).toBeCloseTo(0.1, 10);
  });

  it("un modelo desconocido o ausente usa el precio conservador", () => {
    const uso = { inputTokens: MILLON, outputTokens: MILLON };
    const conservador = PRECIO_DESCONOCIDO.entrada + PRECIO_DESCONOCIDO.salida;
    expect(precioDe("otro/modelo-raro", uso)).toBeCloseTo(conservador, 10);
    expect(precioDe(undefined, uso)).toBeCloseTo(conservador, 10);
    // Nunca más barato que cualquier modelo conocido.
    for (const p of Object.values(PRECIOS_USD_POR_MILLON)) {
      expect(PRECIO_DESCONOCIDO.entrada).toBeGreaterThanOrEqual(p.entrada);
      expect(PRECIO_DESCONOCIDO.salida).toBeGreaterThanOrEqual(p.salida);
    }
  });

  it("uso vacío o con valores no numéricos cuesta 0", () => {
    expect(precioDe("gpt-6-luna", {})).toBe(0);
    expect(precioDe("gpt-6-luna", { inputTokens: undefined, outputTokens: Number.NaN })).toBe(0);
  });
});

describe("costeEstimadoTurno", () => {
  it("suma el uso del agente más el costo fijo estimado de guardrails y jueces", () => {
    const auxiliar = precioDe("openai/gpt-6-luna", TOKENS_AUXILIARES_POR_TURNO);
    expect(auxiliar).toBeGreaterThan(0);
    expect(costeEstimadoTurno("anthropic/claude-sonnet-5", { inputTokens: MILLON })).toBeCloseTo(2 + auxiliar, 10);
    expect(costeEstimadoTurno("openai/gpt-6-luna", undefined)).toBeCloseTo(auxiliar, 10);
  });
});

describe("presupuestoMaximoUsd", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lee PRESUPUESTO_MAX_USD", () => {
    vi.stubEnv("PRESUPUESTO_MAX_USD", "5.5");
    expect(presupuestoMaximoUsd()).toBe(5.5);
  });

  it("vacío, inválido o ≤ 0 → sin tope (null)", () => {
    for (const v of ["", "abc", "0", "-1"]) {
      vi.stubEnv("PRESUPUESTO_MAX_USD", v);
      expect(presupuestoMaximoUsd()).toBeNull();
    }
  });
});

describe("crearPresupuesto (charla.db)", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  beforeEach(async () => {
    db = await crearDbTemporal();
  });
  afterEach(() => db.cerrar());

  it("empieza en 0 y acumula de forma atómica", async () => {
    const p = crearPresupuesto(db.fuente);
    expect(await p.acumulado()).toBe(0);
    await Promise.all([p.sumar(0.25), p.sumar(0.5), p.sumar(0.25)]);
    expect(await p.acumulado()).toBeCloseTo(1, 10);
  });

  it("ignora sumas negativas o no numéricas", async () => {
    const p = crearPresupuesto(db.fuente);
    await p.sumar(-3);
    await p.sumar(Number.NaN);
    expect(await p.acumulado()).toBe(0);
  });
});
