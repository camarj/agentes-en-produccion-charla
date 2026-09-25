import { describe, expect, it } from "vitest";
import { charla } from "../agents/charla";
import { mastra } from "../index";
import { MODELO_LIGERO } from "../modelos";
import { CONTRATO_RELEVANCIA, crearRelevancia, crearSinErroresHerramienta, relevancia, scorers } from "./index";
import { busqueda, busquedaCaida, ejecucion } from "./pruebas-ejecucion";

const IDS = ["fidelidad", "relevancia", "personalizacion", "sin_errores_herramienta", "cita_lamina"];

describe("registro de scorers", () => {
  it("los 5 scorers están en la instancia Mastra con su id", () => {
    expect(Object.keys(scorers).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(mastra.getScorerById(id)?.id).toBe(id);
  });

  it("en el agente: todo al 100 % y personalización al 50 %", async () => {
    const lista = await charla.listScorers();
    const muestreo = Object.fromEntries(Object.values(lista).map((e) => [e.scorer.id, e.sampling]));
    expect(muestreo).toEqual({
      fidelidad: { type: "ratio", rate: 1 },
      relevancia: { type: "ratio", rate: 1 },
      sin_errores_herramienta: { type: "ratio", rate: 1 },
      cita_lamina: { type: "ratio", rate: 1 },
      personalizacion: { type: "ratio", rate: 0.5 },
    });
  });

  it("los jueces usan el modelo ligero (openai/gpt-6-luna)", () => {
    expect(MODELO_LIGERO).toBe("openai/gpt-6-luna");
    for (const id of ["fidelidad", "relevancia", "personalizacion"]) {
      expect(mastra.getScorerById(id)?.judge?.model).toBe(MODELO_LIGERO);
    }
  });
});

describe("prearmados ajustados", () => {
  it("relevancia: id propio y prepareRun que limpia datos personales", async () => {
    const r = crearRelevancia({ nombresConocidos: () => [] });
    expect(r.id).toBe("relevancia");
    const preparado = await r.config.prepareRun!({ ...ejecucion({ pregunta: "Soy Zoraida, z@x.com", respuesta: "ok" }), requestContext: { nombre_pila: "Zoraida" } });
    expect(JSON.stringify(preparado)).not.toMatch(/Zoraida|z@x\.com/);
  });

  // Calibración del 2026-09-25: el juez prearmado penalizaba el ejemplo aplicado
  // al trabajo de la persona, que el contrato del agente EXIGE (L09 0,44, P03 0,40).
  it("relevancia: el juez conoce el contrato (ejemplo exigido) sin perder sus instrucciones ni volverse laxo con lo ajeno", () => {
    for (const r of [crearRelevancia({ nombresConocidos: () => [] }), relevancia]) {
      const instrucciones = (r.config as { judge?: { instructions?: string } }).judge?.instructions ?? "";
      expect(instrucciones).toContain("balanced and nuanced answer relevancy evaluator");
      expect(instrucciones.endsWith(CONTRATO_RELEVANCIA)).toBe(true);
    }
    expect(CONTRATO_RELEVANCIA).toMatch(/contract REQUIRES one short example/);
    expect(CONTRATO_RELEVANCIA).toMatch(/Do not mark it "unsure" or "no" for being an example/);
    expect(CONTRATO_RELEVANCIA).toMatch(/La charla no trata X/);
    expect(CONTRATO_RELEVANCIA).toMatch(/still "no" or "unsure"/);
  });

  it("sin_errores_herramienta: 1 si todo salió bien, 0 si la búsqueda falló", async () => {
    const s = crearSinErroresHerramienta({ nombresConocidos: () => [] });
    expect(s.id).toBe("sin_errores_herramienta");
    const ok = await s.run(ejecucion({ pregunta: "p", respuesta: "r", invocaciones: [busqueda([{ lamina: 1, fragmento: "f" }])] }));
    expect(ok.score).toBe(1);
    const caida = await s.run({ ...ejecucion({ pregunta: "p", respuesta: "r", invocaciones: [busquedaCaida()] }), requestContext: { nombre_pila: "Zoraida", rol_anonimo: "otro" } });
    expect(caida.score).toBe(0);
    expect(caida.requestContext).toEqual({ rol_anonimo: "otro" });
  });
});
