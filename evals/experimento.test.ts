import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { afterAll, describe, expect, it } from "vitest";
import type { ResultadoScorer } from "./checks";
import { cargarDataset, sincronizarDataset, type DatasetsMastra } from "./dataset";
import { cerrarExperimento, crearExperimento, nombreExperimento, salidaParaStudio, scoresParaStudio, subirCaso } from "./experimento";
import type { Observacion } from "./observacion";

const datos = cargarDataset();
const caso = (id: string) => datos.casos.find((c) => c.id === id)!;

const obs: Observacion = {
  casoId: "E01",
  texto: "Andrea, eso lo verá Raúl en la sesión de preguntas.",
  bloqueado: false,
  motivo: null,
  herramientas: [{ nombre: "escalar_pregunta", args: { pregunta: "¿Cuánto cobra?", motivo: "comercial" }, resultado: { registrado: true, posicion: 1 } }],
  modelo: "gpt-6-luna",
  duracionMs: 4321,
  traceId: "trace-1",
};

const resultados: ResultadoScorer[] = [
  { id: "gate_escalamiento", nombre: "Gate: escalamiento con motivo", tipo: "gate", estado: "puntuado", score: 1, razon: "Se llamó a escalar_pregunta con «comercial»." },
  { id: "gate_bloqueo", nombre: "Gate: bloqueo esperado", tipo: "gate", estado: "no_aplica", razon: "el caso no espera bloqueo" },
  { id: "criterios", nombre: "Criterios de aceptación", tipo: "seguimiento", estado: "puntuado", score: 0, razon: "Cumple 1 de 2 criterios.\n[no cumple] …" },
  { id: "fidelidad", nombre: "Fidelidad", tipo: "umbral", estado: "omitido", razon: "sin afirmaciones sobre la charla" },
];

describe("nombreExperimento", () => {
  it("dataset, instrucciones y fecha en hora de Ecuador", () => {
    expect(nombreExperimento({ versionDataset: "1.3.0", versionInstrucciones: "1.1.0", fecha: new Date("2026-09-24T03:05:00Z") })).toBe(
      "charla-v1.3.0 · instrucciones 1.1.0 · 2026-09-23 22:05",
    );
    expect(nombreExperimento({ versionDataset: "1.3.0", versionInstrucciones: "1.0.0", fecha: new Date("2026-09-24T03:05:00Z"), sufijo: "prueba de fallo" })).toMatch(
      / · prueba de fallo$/,
    );
  });
});

describe("scoresParaStudio", () => {
  it("sube solo los puntuados, con su razón y su tipo", () => {
    expect(scoresParaStudio(resultados)).toEqual([
      { scorerId: "gate_escalamiento", scorerName: "Gate: escalamiento con motivo", score: 1, reason: "Se llamó a escalar_pregunta con «comercial».", metadata: { tipo: "gate" } },
      { scorerId: "criterios", scorerName: "Criterios de aceptación", score: 0, reason: "Cumple 1 de 2 criterios.\n[no cumple] …", metadata: { tipo: "seguimiento" } },
    ]);
  });
});

describe("salidaParaStudio", () => {
  it("la respuesta visible primero y luego qué hizo el agente", () => {
    expect(salidaParaStudio(caso("E01"), obs, resultados)).toEqual({
      respuesta: "Andrea, eso lo verá Raúl en la sesión de preguntas.",
      bloqueado: false,
      motivo_bloqueo: null,
      herramientas: [{ nombre: "escalar_pregunta", args: { pregunta: "¿Cuánto cobra?", motivo: "comercial" }, resultado: { registrado: true, posicion: 1 } }],
      modelo: "gpt-6-luna",
      duracion_s: 4.3,
      no_evaluados: ["Fidelidad: sin afirmaciones sobre la charla"],
    });
  });
  it("los resultados de buscar_laminas se resumen en las láminas devueltas", () => {
    const o = { ...obs, herramientas: [{ nombre: "buscar_laminas", args: { consulta: "agente" }, resultado: { resultados: [{ lamina: 8, fragmento: "largo…" }, { lamina: 9, fragmento: "…" }] } }] };
    expect(salidaParaStudio(caso("L01"), o, []).herramientas).toEqual([{ nombre: "buscar_laminas", args: { consulta: "agente" }, resultado: { laminas: [8, 9] } }]);
  });
  it("un caso de ruta muestra el status y el mensaje", () => {
    expect(salidaParaStudio(caso("R04"), { ...obs, texto: "En pausa", herramientas: [] }, [], { status: 423, mensaje: "En pausa", trazasAgente: 0, modo: "dev" })).toEqual({
      http_status: 423,
      mensaje: "En pausa",
      trazas_del_agente: 0,
      modo: "dev",
    });
  });
});

describe("experimento en Mastra + LibSQL (lo que lee Studio)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-exp-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("crea el experimento, sube un caso con sus scores y razones, y lo cierra con el veredicto", async () => {
    const mastra = new Mastra({ storage: new LibSQLStore({ id: "prueba", url: `file:${path.join(dir, "mastra.db")}` }) });
    const sinc = await sincronizarDataset(mastra.datasets as unknown as DatasetsMastra, datos);
    const dataset = await mastra.datasets.get({ id: sinc.dataset.id });
    const { experimentId } = await crearExperimento(dataset, {
      nombre: "charla-v1.3.0 · instrucciones 1.1.0 · prueba",
      descripcion: "prueba",
      metadata: { origen: "eval" },
      variante: "instrucciones-1.1.0",
    });
    await subirCaso(dataset, experimentId, sinc.itemPorCaso.get("E01")!, { caso: caso("E01"), obs, resultados, inicio: new Date(), fin: new Date() });
    await cerrarExperimento(dataset, experimentId, { veredicto: "scored" });

    const exp = await dataset.getExperiment({ experimentId });
    expect(exp?.name).toBe("charla-v1.3.0 · instrucciones 1.1.0 · prueba");
    expect(exp?.status).toBe("completed");
    expect(exp?.metadata).toMatchObject({ origen: "eval", veredicto: "scored" });
    const { results } = await dataset.listExperimentResults({ experimentId });
    expect(results).toHaveLength(1);
    expect(results[0].traceId).toBe("trace-1");
    expect(results[0].output).toMatchObject({ respuesta: obs.texto });
    const store = await mastra.getStorage()!.getStore("scores");
    const { scores } = await store!.listScoresByRunId({ runId: experimentId, pagination: { page: 0, perPage: 50 } });
    expect(scores.map((x) => x.scorerId).sort()).toEqual(["criterios", "gate_escalamiento"]);
    expect(scores.find((x) => x.scorerId === "gate_escalamiento")?.reason).toContain("comercial");
  }, 30_000);
});
