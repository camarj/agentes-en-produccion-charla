import { describe, expect, it } from "vitest";
import type { ResultadoScorer } from "./checks";
import { cargarDataset } from "./dataset";
import type { Observacion } from "./observacion";
import {
  codigoSalida,
  costeCorrida,
  explicarVeredicto,
  formatearReporte,
  llamadasDeJuez,
  resumirCaso,
  tablaPorCategoria,
  type ResumenCaso,
} from "./reporte";

const datos = cargarDataset();
const caso = (id: string) => datos.casos.find((c) => c.id === id)!;

const r = (p: Partial<ResultadoScorer> & Pick<ResultadoScorer, "id">): ResultadoScorer => ({
  nombre: p.id,
  tipo: "gate",
  estado: "puntuado",
  razon: "ok",
  ...p,
});

const obs = (p: Partial<Observacion> = {}): Observacion => ({ casoId: "X", texto: "t", bloqueado: false, motivo: null, herramientas: [], duracionMs: 1000, ...p });

describe("resumirCaso", () => {
  it("pasa si todos los gates y los criterios del caso se cumplen", () => {
    const s = resumirCaso(caso("L01"), [r({ id: "gate_privacidad", score: 1 }), r({ id: "criterios", tipo: "seguimiento", score: 1 })], obs());
    expect(s).toMatchObject({ id: "L01", categoria: "laminas", estado: "pasa", fallos: [] });
  });

  it("falla con la razón del gate que no se cumplió", () => {
    const s = resumirCaso(caso("S02"), [r({ id: "gate_bloqueo", nombre: "Gate: bloqueo esperado", score: 0, razon: "No se bloqueó." })], obs());
    expect(s.estado).toBe("falla");
    expect(s.fallos).toEqual(["Gate: bloqueo esperado: No se bloqueó."]);
  });

  it("los criterios no cumplidos de un caso que no es gate también lo hacen fallar", () => {
    const s = resumirCaso(caso("L04"), [r({ id: "criterios", nombre: "Criterios", tipo: "seguimiento", score: 0, razon: "Cumple 1 de 3." })], obs());
    expect(s.estado).toBe("falla");
  });

  it("otros scorers de seguimiento en 0 son alertas, no fallos; un gate omitido también es alerta", () => {
    const s = resumirCaso(
      caso("R04"),
      [r({ id: "gate_ruta", nombre: "Gate: ruta", estado: "omitido", razon: "prueba de ruta omitida" }), r({ id: "cita_lamina", nombre: "Cita", tipo: "seguimiento", score: 0, razon: "no citó" })],
      obs(),
    );
    expect(s.estado).toBe("pasa");
    expect(s.alertas).toEqual(["Gate: ruta (omitido): prueba de ruta omitida", "Cita: no citó"]);
  });

  it("un turno que falló es un fallo", () => {
    expect(resumirCaso(caso("L02"), [], obs({ error: "TypeError" })).fallos[0]).toMatch(/TypeError/);
  });
});

describe("tablaPorCategoria", () => {
  it("cuenta pasados sobre total en el orden de las categorías", () => {
    const res: ResumenCaso[] = [
      { id: "L01", categoria: "laminas", estado: "pasa", fallos: [], alertas: [] },
      { id: "L02", categoria: "laminas", estado: "falla", fallos: ["x"], alertas: [] },
      { id: "S01", categoria: "seguridad", estado: "pasa", fallos: [], alertas: [] },
    ];
    expect(tablaPorCategoria(res)).toEqual([
      { categoria: "laminas", pasados: 1, total: 2 },
      { categoria: "seguridad", pasados: 1, total: 1 },
    ]);
  });
});

describe("veredicto", () => {
  const base = { scores: {}, summary: { totalItems: 3 } };
  it("explica failed con los gates que fallaron y scored con los umbrales", () => {
    const failed = explicarVeredicto({ ...base, verdict: "failed", gateResults: [{ id: "gate_bloqueo", passed: false, score: 0.8 }, { id: "gate_privacidad", passed: true, score: 1 }] });
    expect(failed).toContain("failed");
    expect(failed).toContain("gate_bloqueo");
    expect(failed).not.toContain("gate_privacidad");
    const scored = explicarVeredicto({ ...base, verdict: "scored", thresholdResults: [{ id: "relevancia", passed: false, averageScore: 0.6, threshold: 0.9 }] });
    expect(scored).toContain("scored");
    expect(scored).toContain("relevancia 0,60 < 0,90");
  });
  it("sale con 1 si el veredicto no es passed", () => {
    expect(codigoSalida("passed")).toBe(0);
    expect(codigoSalida("scored")).toBe(1);
    expect(codigoSalida("failed")).toBe(1);
    expect(codigoSalida(undefined)).toBe(1);
  });
});

describe("coste", () => {
  it("suma el coste estimado de cada turno y una estimación de los jueces", () => {
    const observaciones = [obs({ modelo: "gpt-6-luna", uso: { inputTokens: 1_000_000, outputTokens: 0 } }), obs({ modelo: "claude-sonnet-5", uso: { inputTokens: 0, outputTokens: 100_000 } })];
    const c = costeCorrida(observaciones, 10);
    // 0,10 + 1,00 USD de tokens + 2 × 0,002 fijos por turno (guardrails).
    expect(c.agenteUsd).toBeCloseTo(1.104, 3);
    expect(c.juecesUsd).toBeGreaterThan(0);
    expect(c.totalUsd).toBeCloseTo(c.agenteUsd + c.juecesUsd, 6);
    expect(c.llamadasJuez).toBe(10);
  });

  it("cuenta llamadas de juez solo cuando el juez corrió", () => {
    const resultados = [
      r({ id: "fidelidad", tipo: "umbral", score: 1 }),
      r({ id: "relevancia", tipo: "umbral", score: 1 }),
      r({ id: "personalizacion", tipo: "umbral", estado: "no_aplica" }),
      r({ id: "criterios", tipo: "seguimiento", score: 1 }),
      r({ id: "gate_privacidad", score: 1 }),
    ];
    // fidelidad 1 + relevancia 3 + criterios 1
    expect(llamadasDeJuez(resultados)).toBe(5);
  });
});

describe("formatearReporte", () => {
  it("incluye la tabla, los fallidos con motivo, los promedios con su umbral y el veredicto", () => {
    const texto = formatearReporte({
      titulo: "charla-v1.3.0 · instrucciones 1.1.0",
      resumenes: [
        { id: "L01", categoria: "laminas", estado: "pasa", fallos: [], alertas: [] },
        { id: "S02", categoria: "seguridad", estado: "falla", fallos: ["Gate: bloqueo esperado: No se bloqueó."], alertas: [] },
      ],
      resultado: {
        scores: { fidelidad: 0.8, criterios: 0.5 },
        summary: { totalItems: 2 },
        verdict: "failed",
        gateResults: [{ id: "gate_bloqueo", passed: false, score: 0 }],
        thresholdResults: [{ id: "fidelidad", passed: false, averageScore: 0.8, threshold: 0.95 }],
      },
      coste: { agenteUsd: 0.01, juecesUsd: 0.02, totalUsd: 0.03, turnos: 2, llamadasJuez: 8 },
      duracionS: 90,
      urlStudio: "http://localhost:4111/datasets/charla-v1",
    });
    expect(texto).toContain("laminas");
    expect(texto).toMatch(/laminas\s+1\/1/);
    expect(texto).toMatch(/seguridad\s+0\/1/);
    expect(texto).toContain("S02 · Gate: bloqueo esperado: No se bloqueó.");
    expect(texto).toMatch(/fidelidad\s+0,80\s+≥ 0,95\s+no cumple/);
    expect(texto).toContain("Veredicto: failed");
    expect(texto).toContain("0,03 USD");
    expect(texto).toContain("1 min 30 s");
  });
});
