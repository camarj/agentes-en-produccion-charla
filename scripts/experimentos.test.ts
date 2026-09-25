import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportarExperimentos, revisarDatosPersonales, TABLAS, type Paquete } from "./exportar-experimentos";
import { importarExperimentos, planificarImportacion, rutaRespaldo } from "./importar-experimentos";

const NUEVO_ID = "charla-v1-iteracion-2026-09-25";
const NUEVO_NOMBRE = "charla-v1 · iteración 2026-09-25";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-import-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// Base con las tablas de Mastra y un dataset `charla-v1` creado con su propio API
// (así las columnas JSONB y los puntajes quedan como en data/mastra.db).
async function crearBase(nombre: string, { experimentos, items }: { experimentos: number; items: number }) {
  const url = `file:${path.join(dir, nombre)}`;
  const mastra = new Mastra({ storage: new LibSQLStore({ id: nombre, url }) });
  const dataset = await mastra.datasets.create({ id: "charla-v1", name: "charla-v1", description: "casos" });
  const itemIds: string[] = [];
  for (let i = 0; i < items; i++) {
    const item = await dataset.addItem({
      input: `Pregunta ${i}`,
      groundTruth: { criterios: [`criterio ${i}`] },
      requestContext: { nombre_pila: "Andrea", rol: "PM" },
      metadata: { caso_id: `L0${i}` },
    });
    itemIds.push(item.id);
  }
  const experimentoIds: string[] = [];
  for (let e = 0; e < experimentos; e++) {
    const { experimentId } = await dataset.createExperiment({ name: `${nombre} · corrida ${e}`, metadata: { corrida: e } });
    for (const itemId of itemIds) {
      await dataset.submitExperimentResult({
        experimentId,
        itemId,
        output: { respuesta: `Respuesta ${e}`, herramientas: [{ nombre: "buscar_laminas" }] },
        traceId: `traza-${e}-${itemId}`,
        scores: [
          { scorerId: "gate_privacidad", score: 1, reason: "sin datos" },
          { scorerId: "fidelidad", score: 0.8, reason: "cita la lámina" },
        ],
      });
    }
    await dataset.finalizeExperiment({ experimentId });
    experimentoIds.push(experimentId);
  }
  const cliente = createClient({ url, concurrency: 1 });
  // Puntaje ajeno a los experimentos: no debe exportarse.
  await cliente.execute(
    "INSERT INTO mastra_scorers (id, scorerId, runId, score, source, entityType, createdAt, updatedAt) VALUES ('ajeno', 'fidelidad', 'otra-corrida', 1, 'LIVE', 'AGENT', '2026-09-24', '2026-09-24')",
  );
  return { url, mastra, cliente, experimentoIds, itemIds };
}

async function volcar(cliente: Client) {
  const salida: Record<string, unknown[]> = {};
  for (const t of TABLAS) salida[t] = (await cliente.execute(`SELECT * FROM ${t} ORDER BY rowid`)).rows.map((r) => ({ ...r }));
  return salida;
}

async function filasDe(cliente: Client, sql: string, args: string[] = []) {
  return (await cliente.execute({ sql, args })).rows.map((r) => ({ ...r }));
}

describe("exportar e importar experimentos", () => {
  let origen: Awaited<ReturnType<typeof crearBase>>;
  let destino: Awaited<ReturnType<typeof crearBase>>;
  let paquete: Paquete;

  beforeAll(async () => {
    origen = await crearBase("origen.db", { experimentos: 6, items: 4 });
    // Una corrida vieja (antes del 25): queda fuera del filtro por fecha.
    await origen.cliente.execute({
      sql: "UPDATE mastra_experiments SET createdAt = '2026-09-20T10:00:00.000Z' WHERE id = ?",
      args: [origen.experimentoIds[0]],
    });
    destino = await crearBase("destino.db", { experimentos: 1, items: 2 });
    paquete = await exportarExperimentos(origen.cliente, { desde: "2026-09-25", nuevoId: NUEVO_ID, nuevoNombre: NUEVO_NOMBRE });
  }, 60_000);

  afterAll(() => {
    origen.cliente.close();
    destino.cliente.close();
  });

  it("exporta el dataset renombrado con sus versiones, items, experimentos, resultados y puntajes TEST", () => {
    const t = paquete.tablas;
    expect(t.mastra_datasets).toHaveLength(1);
    expect(t.mastra_datasets[0]).toMatchObject({ id: NUEVO_ID, name: NUEVO_NOMBRE });
    expect(t.mastra_experiments.map((e) => e.id).sort()).toEqual(origen.experimentoIds.slice(1).sort());
    expect(t.mastra_experiment_results).toHaveLength(5 * 4);
    expect(t.mastra_scorers).toHaveLength(5 * 4 * 2);
    expect(t.mastra_scorers.every((s) => s.source === "TEST")).toBe(true);
    expect(t.mastra_dataset_items).toHaveLength(4);
    expect(t.mastra_dataset_versions.length).toBeGreaterThan(0);
    for (const tabla of TABLAS) {
      for (const fila of t[tabla]) if ("datasetId" in fila && fila.datasetId !== null) expect(fila.datasetId).toBe(NUEVO_ID);
    }
    // Los ids de items y experimentos no cambian: los enlaces siguen valiendo.
    expect(new Set(t.mastra_experiment_results.map((r) => r.itemId))).toEqual(new Set(origen.itemIds));
    expect(paquete.meta.conteos).toMatchObject({ mastra_experiments: 5, mastra_experiment_results: 20, mastra_scorers: 40 });
    expect(paquete.meta.columnasJsonb.mastra_dataset_items).toContain("input");
    expect(JSON.parse(String(t.mastra_dataset_items[0].input))).toMatch(/^Pregunta/);
  });

  it("filtra por ids explícitos y falla si no hay experimentos", async () => {
    const uno = await exportarExperimentos(origen.cliente, { ids: [origen.experimentoIds[0]], nuevoId: NUEVO_ID, nuevoNombre: NUEVO_NOMBRE });
    expect(uno.tablas.mastra_experiments).toHaveLength(1);
    await expect(exportarExperimentos(origen.cliente, { desde: "2099-01-01", nuevoId: NUEVO_ID, nuevoNombre: NUEVO_NOMBRE })).rejects.toThrow(/ningún experimento/);
  });

  it("la simulación no cambia nada y no deja respaldo", async () => {
    const antes = await volcar(destino.cliente);
    const plan = await planificarImportacion(destino.cliente, paquete);
    expect(plan.conflictos).toBe(0);
    expect(plan.tablas.mastra_experiments.nuevas).toBe(5);
    expect(plan.tablas.mastra_scorers.nuevas).toBe(40);
    expect(await volcar(destino.cliente)).toEqual(antes);
    expect(fs.readdirSync(dir).filter((f) => f.includes("respaldo"))).toEqual([]);
  });

  it("importa sin tocar el charla-v1 existente, respalda antes y es idempotente", async () => {
    const charlaAntes = await volcar(destino.cliente);
    const destinoRuta = destino.url.slice("file:".length);
    const respaldo = rutaRespaldo(destinoRuta, new Date("2026-09-25T20:00:00Z"));

    const r = await importarExperimentos(destino.cliente, paquete, { respaldo });
    expect(r.insertadas).toMatchObject({ mastra_datasets: 1, mastra_experiments: 5, mastra_experiment_results: 20, mastra_scorers: 40, mastra_dataset_items: 4 });
    expect(fs.existsSync(respaldo)).toBe(true);
    const copia = createClient({ url: `file:${respaldo}` });
    expect((await copia.execute("SELECT count(*) AS n FROM mastra_experiments")).rows[0].n).toBe(1);
    copia.close();

    // Las filas previas siguen idénticas.
    const despues = await volcar(destino.cliente);
    for (const t of TABLAS) {
      const previas = new Set(charlaAntes[t].map((f) => JSON.stringify(f)));
      expect(despues[t].filter((f) => previas.has(JSON.stringify(f)))).toHaveLength(charlaAntes[t].length);
    }
    // Las columnas JSONB vuelven a quedar como JSONB.
    const tipos = await filasDe(destino.cliente, "SELECT DISTINCT typeof(input) AS t FROM mastra_dataset_items WHERE datasetId = ?", [NUEVO_ID]);
    expect(tipos).toEqual([{ t: "blob" }]);
    // Releer desde el destino da exactamente el mismo paquete.
    const releido = await exportarExperimentos(destino.cliente, { datasetOrigen: NUEVO_ID, ids: paquete.meta.experimentos.map((e) => e.id), nuevoId: NUEVO_ID, nuevoNombre: NUEVO_NOMBRE });
    expect(releido.tablas).toEqual(paquete.tablas);

    // Segunda vez: no duplica nada.
    const otra = await importarExperimentos(destino.cliente, paquete, { respaldo: null });
    expect(Object.values(otra.insertadas).every((n) => n === 0)).toBe(true);
    expect(await volcar(destino.cliente)).toEqual(despues);
  }, 30_000);

  it("Mastra (lo que lee Studio) ve ambos datasets y los experimentos con sus puntajes", async () => {
    const mastra = new Mastra({ storage: new LibSQLStore({ id: "lectura", url: destino.url }) });
    const { datasets } = await mastra.datasets.list();
    expect(datasets.map((d) => d.id).sort()).toEqual(["charla-v1", NUEVO_ID]);
    const nuevo = await mastra.datasets.get({ id: NUEVO_ID });
    expect((await nuevo.getDetails()).name).toBe(NUEVO_NOMBRE);
    const { experiments } = await nuevo.listExperiments({ perPage: 50 });
    expect(experiments).toHaveLength(5);
    const { results } = await nuevo.listExperimentResults({ experimentId: experiments[0].id, perPage: 50 });
    expect(results).toHaveLength(4);
    expect(results[0].output).toMatchObject({ respuesta: expect.stringMatching(/^Respuesta/) });
    const comparacion = await mastra.datasets.compareExperiments({ experimentIds: [experiments[0].id, experiments[1].id] });
    expect(comparacion.items).toHaveLength(4);
    expect(Object.values(comparacion.items[0].results)[0]?.scores).toMatchObject({ gate_privacidad: 1, fidelidad: 0.8 });
    const viejo = await mastra.datasets.get({ id: "charla-v1" });
    expect((await viejo.listExperiments()).experiments).toHaveLength(1);
  }, 30_000);

  it("se niega a aplicar si un id del paquete ya pertenece a otro dataset", async () => {
    const choque = await crearBase("choque.db", { experimentos: 0, items: 0 });
    const exp = paquete.tablas.mastra_experiments[0];
    await choque.cliente.execute({
      sql: "INSERT INTO mastra_experiments (id, datasetId, status, totalItems, succeededCount, failedCount, skippedCount, createdAt, updatedAt) VALUES (?, 'charla-v1', 'completed', 0, 0, 0, 0, 'x', 'x')",
      args: [String(exp.id)],
    });
    const antes = await volcar(choque.cliente);
    const plan = await planificarImportacion(choque.cliente, paquete);
    expect(plan.conflictos).toBe(1);
    await expect(importarExperimentos(choque.cliente, paquete, { respaldo: null })).rejects.toThrow(/conflicto/);
    expect(await volcar(choque.cliente)).toEqual(antes);
    choque.cliente.close();
  }, 30_000);

  it("solo usa las columnas que existen en el destino y avisa cuáles descarta", async () => {
    const extra: Paquete = structuredClone(paquete);
    extra.meta.columnas.mastra_datasets = [...extra.meta.columnas.mastra_datasets, "columnaFutura"];
    extra.tablas.mastra_datasets[0] = { ...extra.tablas.mastra_datasets[0], id: "otro-dataset", columnaFutura: "x" };
    const plan = await planificarImportacion(destino.cliente, extra);
    expect(plan.tablas.mastra_datasets.columnasDescartadas).toEqual(["columnaFutura"]);
  });
});

describe("revisarDatosPersonales", () => {
  it("cuenta emails y coincidencias con asistentes reales sin devolverlos", () => {
    const texto = JSON.stringify({ a: "escríbeme a ana.perez@empresa.com", b: "Hola Andrea, soy invitado", c: "Carlos Mendoza pregunta" });
    const r = revisarDatosPersonales(texto, [
      { email: "ana.perez@empresa.com", nombre: "Ana Pérez" },
      { email: "carlos@x.com", nombre: "Carlos Mendoza" },
    ]);
    expect(r).toEqual({ emails: 1, emailsDeAsistentes: 1, nombresDeAsistentes: 1 });
    expect(revisarDatosPersonales("sin nada", [{ email: "a@b.co", nombre: "Ana" }])).toEqual({ emails: 0, emailsDeAsistentes: 0, nombresDeAsistentes: 0 });
  });
});
