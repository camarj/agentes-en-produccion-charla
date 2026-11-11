import fs from "node:fs";
import { crearPoolMastra, esquemaMastra } from "../src/mastra/storage";
import { ejecutarCli } from "./comun";
import { columnasDe, comillas, tablaPg, TABLAS, type ColumnaPg, type Fila, type Paquete, type PoolPg, type Tabla } from "./exportar-experimentos";

// Importa un paquete de `pnpm exportar:experimentos` en el esquema de Mastra
// en Postgres (DATABASE_URL, esquema `mastra` o MASTRA_ESQUEMA). Solo toca las
// seis tablas del paquete, solo inserta filas que faltan (idempotente) y todo
// va en una única transacción. Si algún id del paquete ya pertenece a otro
// dataset o experimento, no escribe nada. Sin respaldo propio: antes de
// aplicar en producción, `gcloud sql backups create`.

// Columna que dice a quién pertenece cada fila; un id repetido con otro dueño es un conflicto.
const DUENO: Record<Tabla, string | null> = {
  mastra_datasets: null,
  mastra_dataset_versions: "datasetId",
  mastra_dataset_items: "datasetId",
  mastra_experiments: "datasetId",
  mastra_experiment_results: "experimentId",
  mastra_scorers: "runId",
};

// Los items no tienen clave primaria: una fila es (id, datasetVersion).
const clave = (t: Tabla) => (t === "mastra_dataset_items" ? ["id", "datasetVersion"] : ["id"]);

export interface PlanTabla {
  enPaquete: number;
  nuevas: number;
  existentes: number;
  conflictos: number;
  columnasDescartadas: string[];
}
export interface Plan {
  tablas: Record<Tabla, PlanTabla>;
  conflictos: number;
  datasetExiste: boolean;
}

// Columna del destino y de dónde sale su valor: del paquete, o (columnas
// `…Z` de Postgres que los paquetes de LibSQL no traen) de su par sin Z.
interface ColumnaDestino extends ColumnaPg {
  origen: string;
}

interface Preparacion {
  plan: Plan;
  nuevas: Record<Tabla, Fila[]>;
  columnas: Record<Tabla, ColumnaDestino[]>;
}

async function preparar(pool: PoolPg, esquema: string, paquete: Paquete): Promise<Preparacion> {
  if (paquete.meta?.formato !== "mastra-experimentos/1") throw new Error("El archivo no es un paquete de experimentos");
  const tablas = {} as Record<Tabla, PlanTabla>;
  const nuevas = {} as Record<Tabla, Fila[]>;
  const columnas = {} as Record<Tabla, ColumnaDestino[]>;

  for (const t of TABLAS) {
    const destino = await columnasDe(pool, esquema, t);
    if (destino.length === 0) throw new Error(`La tabla ${t} no existe en el destino (¿Studio o la app arrancaron alguna vez con esta base?)`);
    const enPaquete = paquete.meta.columnas[t];
    const nombres = destino.map((c) => c.nombre);
    columnas[t] = destino.flatMap((c) => {
      if (enPaquete.includes(c.nombre)) return [{ ...c, origen: c.nombre }];
      const par = c.nombre.endsWith("Z") ? c.nombre.slice(0, -1) : null;
      return c.tipo === "timestamp with time zone" && par && enPaquete.includes(par) ? [{ ...c, origen: par }] : [];
    });
    const faltantes = destino.filter((c) => c.obligatoria && !columnas[t].some((x) => x.nombre === c.nombre));
    if (faltantes.length > 0) throw new Error(`${t}: el paquete no trae columnas obligatorias del destino (${faltantes.map((c) => c.nombre).join(", ")})`);

    const dueno = DUENO[t];
    const existentes = new Map<string, Fila[]>();
    const ids = [...new Set(paquete.tablas[t].map((f) => String(f.id)))];
    const campos = ["id", ...(dueno ? [dueno] : []), ...(t === "mastra_dataset_items" ? ["datasetVersion"] : [])];
    for (let i = 0; i < ids.length; i += 200) {
      const r = await pool.query(`SELECT ${campos.map(comillas).join(", ")} FROM ${tablaPg(esquema, t)} WHERE id = ANY($1::text[])`, [ids.slice(i, i + 200)]);
      for (const f of r.rows) {
        const lista = existentes.get(String(f.id)) ?? [];
        lista.push({ ...f } as Fila);
        existentes.set(String(f.id), lista);
      }
    }

    const plan: PlanTabla = { enPaquete: paquete.tablas[t].length, nuevas: 0, existentes: 0, conflictos: 0, columnasDescartadas: enPaquete.filter((c) => !nombres.includes(c)) };
    nuevas[t] = [];
    for (const fila of paquete.tablas[t]) {
      const previas = existentes.get(String(fila.id)) ?? [];
      if (dueno && previas.some((p) => String(p[dueno]) !== String(fila[dueno]))) {
        plan.conflictos++;
      } else if (previas.some((p) => clave(t).every((c) => String(p[c]) === String(fila[c])))) {
        plan.existentes++;
      } else {
        plan.nuevas++;
        nuevas[t].push(fila);
      }
    }
    tablas[t] = plan;
  }
  const conflictos = TABLAS.reduce((s, t) => s + tablas[t].conflictos, 0);
  return { plan: { tablas, conflictos, datasetExiste: tablas.mastra_datasets.existentes > 0 }, nuevas, columnas };
}

export async function planificarImportacion(pool: PoolPg, paquete: Paquete, { esquema = esquemaMastra() }: { esquema?: string } = {}): Promise<Plan> {
  return (await preparar(pool, esquema, paquete)).plan;
}

export interface ResultadoImportacion {
  plan: Plan;
  insertadas: Record<Tabla, number>;
}

// Aplica la importación en una sola transacción: o entra todo o nada.
export async function importarExperimentos(pool: PoolPg, paquete: Paquete, { esquema = esquemaMastra() }: { esquema?: string } = {}): Promise<ResultadoImportacion> {
  const { plan, nuevas, columnas } = await preparar(pool, esquema, paquete);
  if (plan.conflictos > 0) {
    throw new Error(`Hay ${plan.conflictos} filas en conflicto (ids que ya pertenecen a otro dataset o experimento): no se importó nada`);
  }
  const insertadas = Object.fromEntries(TABLAS.map((t) => [t, 0])) as Record<Tabla, number>;
  if (TABLAS.every((t) => nuevas[t].length === 0)) return { plan, insertadas };

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const t of TABLAS) {
      const cols = columnas[t];
      // Cada valor llega como texto o número y se convierte al tipo exacto de la columna.
      const valores = cols.map((col, i) => `$${i + 1}::${col.tipo}`).join(", ");
      const donde = clave(t).map((k, i) => `${comillas(k)} = $${cols.length + i + 1}::${cols.find((x) => x.nombre === k)?.tipo ?? "text"}`).join(" AND ");
      const tabla = tablaPg(esquema, t);
      const sql = `INSERT INTO ${tabla} (${cols.map((x) => comillas(x.nombre)).join(", ")}) SELECT ${valores} WHERE NOT EXISTS (SELECT 1 FROM ${tabla} WHERE ${donde})`;
      for (const fila of nuevas[t]) {
        const r = await c.query(sql, [...cols.map((x) => fila[x.origen] ?? null), ...clave(t).map((k) => fila[k] ?? null)]);
        insertadas[t] += r.rowCount ?? 0;
      }
    }
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    c.release();
  }
  return { plan, insertadas };
}

async function conteosDelDataset(pool: PoolPg, esquema: string, paquete: Paquete) {
  const t = (tabla: Tabla) => tablaPg(esquema, tabla);
  const r = await pool.query(
    `SELECT
      (SELECT count(*) FROM ${t("mastra_datasets")} WHERE id = $1) AS datasets,
      (SELECT count(*) FROM ${t("mastra_dataset_versions")} WHERE "datasetId" = $1) AS versiones,
      (SELECT count(*) FROM ${t("mastra_dataset_items")} WHERE "datasetId" = $1) AS items,
      (SELECT count(*) FROM ${t("mastra_experiments")} WHERE "datasetId" = $1) AS experimentos,
      (SELECT count(*) FROM ${t("mastra_experiment_results")} WHERE "experimentId" IN (SELECT id FROM ${t("mastra_experiments")} WHERE "datasetId" = $1)) AS resultados,
      (SELECT count(*) FROM ${t("mastra_scorers")} WHERE source = 'TEST' AND "runId" IN (SELECT id FROM ${t("mastra_experiments")} WHERE "datasetId" = $1)) AS puntajes,
      (SELECT count(*) FROM ${t("mastra_datasets")}) AS "datasetsTotales"`,
    [paquete.meta.destino.datasetId],
  );
  return Object.fromEntries(Object.entries(r.rows[0]).map(([k, v]) => [k, Number(v)]));
}

function imprimirPlan(plan: Plan) {
  console.log(plan.datasetExiste ? "El dataset ya existe en el destino: solo se agregan las filas que falten." : "El dataset no existe en el destino: se crea.");
  for (const t of TABLAS) {
    const p = plan.tablas[t];
    const descartadas = p.columnasDescartadas.length ? ` · columnas que el destino no tiene (se omiten): ${p.columnasDescartadas.join(", ")}` : "";
    console.log(`  ${t.padEnd(26)} paquete ${String(p.enPaquete).padStart(5)} · nuevas ${String(p.nuevas).padStart(5)} · ya estaban ${String(p.existentes).padStart(5)} · conflictos ${p.conflictos}${descartadas}`);
  }
}

async function principal() {
  const args = process.argv.slice(2);
  const archivo = args.find((a) => !a.startsWith("--"));
  if (!archivo) throw new Error("Uso: pnpm importar:experimentos <paquete.json> [--si]");
  const paquete = JSON.parse(fs.readFileSync(archivo, "utf8")) as Paquete;
  const esquema = esquemaMastra();

  console.log(`Destino: esquema «${esquema}» de DATABASE_URL`);
  console.log(`Dataset a importar: «${paquete.meta.destino.datasetNombre}» (${paquete.meta.destino.datasetId}), ${paquete.meta.experimentos.length} experimentos`);
  const pool = crearPoolMastra();
  try {
    const plan = await planificarImportacion(pool, paquete, { esquema });
    imprimirPlan(plan);
    if (plan.conflictos > 0) throw new Error(`Hay ${plan.conflictos} filas en conflicto (ids que ya pertenecen a otro dataset o experimento): no se importó nada`);
    if (!args.includes("--si")) {
      console.log("\nSimulación: no se escribió nada. Para aplicar, repite el comando con --si (antes, un backup: gcloud sql backups create).");
      return;
    }
    const r = await importarExperimentos(pool, paquete, { esquema });
    console.log("Filas insertadas:", r.insertadas);
    console.log("En el destino ahora:", await conteosDelDataset(pool, esquema, paquete));
  } finally {
    await pool.end();
  }
}

ejecutarCli(import.meta.url, principal, "No se pudieron importar los experimentos");
