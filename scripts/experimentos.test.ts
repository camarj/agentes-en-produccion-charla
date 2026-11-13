import fs from "node:fs";
import { Mastra } from "@mastra/core/mastra";
import { beforeAll, describe, expect, it } from "vitest";
import { crearAlmacenamientoDePrueba } from "../src/mastra/pruebas/almacenamiento";
import { exportarExperimentos, revisarDatosPersonales, TABLAS, type Paquete } from "./exportar-experimentos";
import { importarExperimentos, planificarImportacion } from "./importar-experimentos";

const NUEVO_ID = "charla-v1-iteracion-2026-09-25";
const NUEVO_NOMBRE = "charla-v1 · iteración 2026-09-25";

// Esquema de Mastra en Postgres (PGlite) con un dataset `charla-v1` creado con
// su propio API (así las columnas JSONB y los puntajes quedan como en producción).
async function crearBase(nombre: string, { experimentos, items }: { experimentos: number; items: number }) {
  const { almacenamiento, esquema, pool } = crearAlmacenamientoDePrueba(nombre);
  const mastra = new Mastra({ storage: almacenamiento });
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
  // Puntaje ajeno a los experimentos: no debe exportarse.
  await pool.query(
    `INSERT INTO "${esquema}".mastra_scorers (id, "scorerId", "runId", scorer, score, input, output, "entityType", entity, "entityId", source, "createdAt", "updatedAt")
     VALUES ('ajeno', 'fidelidad', 'otra-corrida', '{}', 1, '{}', '{}', 'AGENT', '{}', 'charla', 'LIVE', '2026-09-24', '2026-09-24')`,
  );
  return { almacenamiento, esquema, pool, mastra, experimentoIds, itemIds };
}
type Base = Awaited<ReturnType<typeof crearBase>>;

const orden = (t: string) => (t === "mastra_dataset_items" ? `"id", "datasetVersion"` : `"id"`);

async function volcar(b: Base) {
  const salida: Record<string, unknown[]> = {};
  for (const t of TABLAS) salida[t] = (await b.pool.query(`SELECT * FROM "${b.esquema}".${t} ORDER BY ${orden(t)}`)).rows;
  return salida;
}

describe("exportar e importar experimentos (Postgres)", () => {
  let origen: Base;
  let destino: Base;
  let paquete: Paquete;

  beforeAll(async () => {
    origen = await crearBase("origen", { experimentos: 6, items: 4 });
    // Una corrida vieja (antes del 25): queda fuera del filtro por fecha.
    await origen.pool.query(`UPDATE "${origen.esquema}".mastra_experiments SET "createdAt" = '2026-09-20T10:00:00.000Z' WHERE id = $1`, [
      origen.experimentoIds[0],
    ]);
    destino = await crearBase("destino", { experimentos: 1, items: 2 });
    paquete = await exportarExperimentos(origen.pool, { esquema: origen.esquema, desde: "2026-09-25", nuevoId: NUEVO_ID, nuevoNombre: NUEVO_NOMBRE });
  }, 60_000);

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
    // Fechas como ISO en UTC, igual que los paquetes viejos.
    expect(String(t.mastra_experiments[0].createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("filtra por ids explícitos y falla si no hay experimentos", async () => {
    const uno = await exportarExperimentos(origen.pool, { esquema: origen.esquema, ids: [origen.experimentoIds[0]], nuevoId: NUEVO_ID, nuevoNombre: NUEVO_NOMBRE });
    expect(uno.tablas.mastra_experiments).toHaveLength(1);
    await expect(
      exportarExperimentos(origen.pool, { esquema: origen.esquema, desde: "2099-01-01", nuevoId: NUEVO_ID, nuevoNombre: NUEVO_NOMBRE }),
    ).rejects.toThrow(/ningún experimento/);
  });

  it("la simulación no cambia nada", async () => {
    const antes = await volcar(destino);
    const plan = await planificarImportacion(destino.pool, paquete, { esquema: destino.esquema });
    expect(plan.conflictos).toBe(0);
    expect(plan.tablas.mastra_experiments.nuevas).toBe(5);
    expect(plan.tablas.mastra_scorers.nuevas).toBe(40);
    expect(await volcar(destino)).toEqual(antes);
  });

  it("importa sin tocar el charla-v1 existente y es idempotente", async () => {
    const charlaAntes = await volcar(destino);

    const r = await importarExperimentos(destino.pool, paquete, { esquema: destino.esquema });
    expect(r.insertadas).toMatchObject({ mastra_datasets: 1, mastra_experiments: 5, mastra_experiment_results: 20, mastra_scorers: 40, mastra_dataset_items: 4 });

    // Las filas previas siguen idénticas.
    const despues = await volcar(destino);
    for (const t of TABLAS) {
      const previas = new Set(charlaAntes[t].map((f) => JSON.stringify(f)));
      expect(despues[t].filter((f) => previas.has(JSON.stringify(f)))).toHaveLength(charlaAntes[t].length);
    }
    // Las columnas JSONB vuelven a quedar como JSON (no como texto con comillas).
    const tipos = await destino.pool.query(
      `SELECT DISTINCT jsonb_typeof(input) AS t FROM "${destino.esquema}".mastra_dataset_items WHERE "datasetId" = $1`,
      [NUEVO_ID],
    );
    expect(tipos.rows).toEqual([{ t: "string" }]);
    // Releer desde el destino da exactamente el mismo paquete.
    const releido = await exportarExperimentos(destino.pool, {
      esquema: destino.esquema,
      datasetOrigen: NUEVO_ID,
      ids: paquete.meta.experimentos.map((e) => e.id),
      nuevoId: NUEVO_ID,
      nuevoNombre: NUEVO_NOMBRE,
    });
    expect(releido.tablas).toEqual(paquete.tablas);

    // Segunda vez: no duplica nada.
    const otra = await importarExperimentos(destino.pool, paquete, { esquema: destino.esquema });
    expect(Object.values(otra.insertadas).every((n) => n === 0)).toBe(true);
    expect(await volcar(destino)).toEqual(despues);
  }, 30_000);

  it("Mastra (lo que lee Studio) ve ambos datasets y los experimentos con sus puntajes", async () => {
    const mastra = new Mastra({ storage: destino.almacenamiento });
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
    const choque = await crearBase("choque", { experimentos: 0, items: 0 });
    const exp = paquete.tablas.mastra_experiments[0];
    await choque.pool.query(
      `INSERT INTO "${choque.esquema}".mastra_experiments (id, "datasetId", status, "totalItems", "succeededCount", "failedCount", "skippedCount", "createdAt", "updatedAt")
       VALUES ($1, 'charla-v1', 'completed', 0, 0, 0, 0, now(), now())`,
      [String(exp.id)],
    );
    const antes = await volcar(choque);
    const plan = await planificarImportacion(choque.pool, paquete, { esquema: choque.esquema });
    expect(plan.conflictos).toBe(1);
    await expect(importarExperimentos(choque.pool, paquete, { esquema: choque.esquema })).rejects.toThrow(/conflicto/);
    expect(await volcar(choque)).toEqual(antes);
  }, 30_000);

  it("solo usa las columnas que existen en el destino y avisa cuáles descarta", async () => {
    const extra: Paquete = structuredClone(paquete);
    extra.meta.columnas.mastra_datasets = [...extra.meta.columnas.mastra_datasets, "columnaFutura"];
    extra.tablas.mastra_datasets[0] = { ...extra.tablas.mastra_datasets[0], id: "otro-dataset", columnaFutura: "x" };
    const plan = await planificarImportacion(destino.pool, extra, { esquema: destino.esquema });
    expect(plan.tablas.mastra_datasets.columnasDescartadas).toEqual(["columnaFutura"]);
  });

  it("importa el paquete real de la iteración (exportado de LibSQL) y Studio lo lee", async () => {
    const real = JSON.parse(fs.readFileSync("evals/experimentos/iteracion-2026-09-25.json", "utf8")) as Paquete;
    const base = await crearBase("real", { experimentos: 0, items: 0 });
    const r = await importarExperimentos(base.pool, real, { esquema: base.esquema });
    expect(r.insertadas).toMatchObject({
      mastra_experiments: real.meta.conteos.mastra_experiments,
      mastra_experiment_results: real.meta.conteos.mastra_experiment_results,
      mastra_scorers: real.meta.conteos.mastra_scorers,
    });
    const nuevo = await base.mastra.datasets.get({ id: real.meta.destino.datasetId });
    const { experiments } = await nuevo.listExperiments({ perPage: 50 });
    expect(experiments).toHaveLength(real.meta.experimentos.length);
    // Las columnas `…Z` (timestamptz) que LibSQL no tenía salen de su par sin Z.
    const sinZ = await base.pool.query(`SELECT count(*)::int AS n FROM "${base.esquema}".mastra_experiments WHERE "createdAtZ" IS NULL`);
    expect(sinZ.rows[0]).toEqual({ n: 0 });
  }, 60_000);
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
