import { describe, expect, it } from "vitest";
import type { AnalisisJev } from "./resultado";
import { construirVista, lineasDe, TARJETAS_MAXIMAS } from "./vista";

const AHORA = Date.parse("2026-09-25T20:00:00Z");
let n = 0;
const analisis = (extra: Partial<AnalisisJev> = {}): AnalisisJev => {
  n++;
  return {
    traceId: `t${n}`,
    turnoEn: new Date(AHORA - n * 1000).toISOString(),
    pregunta: `pregunta ${n}`,
    tema: "evals",
    temaConfianza: 1,
    intencion: "understand_concept",
    intencionConfianza: 1,
    confusion: 0.25,
    confusionConfianza: 0.9,
    valor: 0.3,
    valorConfianza: 0.8,
    respaldada: 0.8,
    motivoBloqueo: null,
    herramientaCaida: false,
    respaldo: false,
    sinModelo: false,
    falla: false,
    latenciaMs: 200,
    tokensEntrada: 2000,
    modelo: "jev-1.13.0",
    ...extra,
  };
};
const vista = (xs: AnalisisJev[], jevDisponible = true) => construirVista(xs, { ahora: AHORA, total: xs.length, jevDisponible });

describe("construirVista", () => {
  it("sin análisis: todo vacío y sin promedios", () => {
    const v = vista([]);
    expect(v).toMatchObject({ tarjetas: [], temas: [], destacadas: [], latencia_media_ms: null, total_analisis: 0 });
    expect(v.termometro).toEqual({ porcentaje: null, turnos: 0, mas_confunde: null });
  });

  it("tarjetas: las más recientes primero, máximo 6, con etiquetas en español", () => {
    const xs = Array.from({ length: 9 }, () => analisis());
    const v = vista([...xs].reverse());
    expect(v.tarjetas).toHaveLength(TARJETAS_MAXIMAS);
    expect(v.tarjetas[0].traceId).toBe(xs[0].traceId);
    expect(v.tarjetas[0]).toMatchObject({ tema: "Evals", intencion: "Entender un concepto", confusion: 0.25 });
  });

  it("temas: cuenta los últimos 30 min, sin bloqueos, de mayor a menor", () => {
    const v = vista([
      analisis({ tema: "guardrails" }),
      analisis({ tema: "guardrails" }),
      analisis({ tema: "evals" }),
      analisis({ tema: "evals", motivoBloqueo: "inyeccion" }),
      analisis({ tema: "harness", turnoEn: new Date(AHORA - 31 * 60 * 1000).toISOString() }),
    ]);
    expect(v.temas).toEqual([
      { tema: "Guardrails", turnos: 2 },
      { tema: "Evals", turnos: 1 },
    ]);
  });

  it("termómetro: promedio de confusión sin bloqueos ni fuera de tema, y el tema que más confunde", () => {
    const v = vista([
      analisis({ tema: "harness", confusion: 0.8 }),
      analisis({ tema: "evals", confusion: 0.2 }),
      analisis({ intencion: "off_topic", tema: "other", confusion: 1 }),
      analisis({ motivoBloqueo: "inyeccion", confusion: 1 }),
    ]);
    expect(v.termometro).toEqual({ porcentaje: 50, turnos: 2, mas_confunde: "Harness" });
  });

  it("destacadas: top 3 por valor, una por tema + intención, con cuántas parecidas hay", () => {
    const v = vista([
      analisis({ tema: "resilience", intencion: "apply_to_own_case", valor: 0.9, pregunta: "A" }),
      analisis({ tema: "resilience", intencion: "apply_to_own_case", valor: 0.5 }),
      analisis({ tema: "resilience", intencion: "apply_to_own_case", valor: 0.4 }),
      analisis({ tema: "evals", valor: 0.7, pregunta: "B" }),
      analisis({ tema: "harness", valor: 0.6, pregunta: "C" }),
      analisis({ tema: "guardrails", valor: 0.1 }),
      analisis({ intencion: "off_topic", tema: "other", valor: 1 }),
    ]);
    expect(v.destacadas.map((d) => [d.pregunta, d.parecidas])).toEqual([
      ["A", 2],
      ["B", 0],
      ["C", 0],
    ]);
  });

  it("latencia media y disponibilidad", () => {
    const v = vista([analisis({ latenciaMs: 100 }), analisis({ latenciaMs: 300 })], false);
    expect(v.latencia_media_ms).toBe(200);
    expect(v.jev_disponible).toBe(false);
  });

  it("no expone campos de identidad", () => {
    const v = vista([analisis()]);
    const json = JSON.stringify(v);
    for (const clave of ["email", "nombre", "asistente", "resourceId", "threadId"]) expect(json).not.toContain(clave);
  });
});

describe("lineasDe", () => {
  it("respaldada / no respaldada según el umbral 0,5", () => {
    expect(lineasDe(analisis({ respaldada: 0.5 }))).toEqual([{ tipo: "respaldada" }]);
    expect(lineasDe(analisis({ respaldada: 0.3 }))).toEqual([{ tipo: "no_respaldada", probabilidad: 0.3 }]);
  });
  it("bloqueada tapa todo lo demás", () => {
    expect(lineasDe(analisis({ motivoBloqueo: "inyeccion", respaldada: null }))).toEqual([
      { tipo: "bloqueada", motivo: "intento de inyección" },
    ]);
  });
  it("herramienta caída, respaldo y sin modelo", () => {
    expect(lineasDe(analisis({ respaldada: null, herramientaCaida: true, respaldo: true }))).toEqual([
      { tipo: "herramienta_caida" },
      { tipo: "respaldo" },
    ]);
    expect(lineasDe(analisis({ respaldada: null, sinModelo: true }))).toEqual([{ tipo: "sin_modelo" }]);
    expect(lineasDe(analisis({ respaldada: null }))).toEqual([{ tipo: "sin_laminas" }]);
  });
});
