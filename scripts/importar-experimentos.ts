import fs from "node:fs";
import path from "node:path";
import type { Client } from "@libsql/client";
import { crearCliente } from "../lib/db/client";
import { urlArchivo } from "../lib/rutas";
import { ejecutarCli } from "./comun";
import { columnasDe, TABLAS, type Fila, type Paquete, type Tabla } from "./exportar-experimentos";

// Importa un paquete de `pnpm exportar:experimentos` en la base de Mastra
// (MASTRA_DB_URL o data/mastra.db). Solo toca las seis tablas del paquete,
// solo inserta filas que faltan (idempotente) y todo va en un único batch de
// escritura. Si algún id del paquete ya pertenece a otro dataset o experimento,
// no escribe nada.

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

interface Preparacion {
  plan: Plan;
  nuevas: Record<Tabla, Fila[]>;
  columnas: Record<Tabla, string[]>;
}

async function preparar(cliente: Client, paquete: Paquete): Promise<Preparacion> {
  if (paquete.meta?.formato !== "mastra-experimentos/1") throw new Error("El archivo no es un paquete de experimentos");
  const tablas = {} as Record<Tabla, PlanTabla>;
  const nuevas = {} as Record<Tabla, Fila[]>;
  const columnas = {} as Record<Tabla, string[]>;

  for (const t of TABLAS) {
    const destino = await columnasDe(cliente, t);
    if (destino.length === 0) throw new Error(`La tabla ${t} no existe en el destino (¿Studio arrancó alguna vez con esta base?)`);
    const info = await cliente.execute(`PRAGMA table_info("${t}")`);
    const enPaquete = paquete.meta.columnas[t];
    columnas[t] = enPaquete.filter((c) => destino.includes(c));
    const faltantes = info.rows.filter((c) => Number(c.notnull) === 1 && c.dflt_value === null && !columnas[t].includes(String(c.name)));
    if (faltantes.length > 0) throw new Error(`${t}: el paquete no trae columnas obligatorias del destino (${faltantes.map((c) => c.name).join(", ")})`);

    const dueno = DUENO[t];
    const existentes = new Map<string, Fila[]>();
    const ids = [...new Set(paquete.tablas[t].map((f) => String(f.id)))];
    for (let i = 0; i < ids.length; i += 200) {
      const lote = ids.slice(i, i + 200);
      const campos = ["id", ...(dueno ? [dueno] : []), ...(t === "mastra_dataset_items" ? ["datasetVersion"] : [])];
      const r = await cliente.execute({
        sql: `SELECT ${campos.map((c) => `"${c}"`).join(", ")} FROM ${t} WHERE id IN (${lote.map(() => "?").join(", ")})`,
        args: lote,
      });
      for (const f of r.rows) {
        const lista = existentes.get(String(f.id)) ?? [];
        lista.push({ ...f } as Fila);
        existentes.set(String(f.id), lista);
      }
    }

    const plan: PlanTabla = { enPaquete: paquete.tablas[t].length, nuevas: 0, existentes: 0, conflictos: 0, columnasDescartadas: enPaquete.filter((c) => !destino.includes(c)) };
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

export async function planificarImportacion(cliente: Client, paquete: Paquete): Promise<Plan> {
  return (await preparar(cliente, paquete)).plan;
}

export function rutaRespaldo(rutaDb: string, fecha = new Date()): string {
  const sello = fecha.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return path.join(path.dirname(rutaDb), `mastra.respaldo-${sello}.db`);
}

export interface ResultadoImportacion {
  plan: Plan;
  insertadas: Record<Tabla, number>;
  respaldo: string | null;
}

// Aplica la importación. `respaldo`: ruta donde copiar la base antes de
// escribir (VACUUM INTO: copia coherente aunque haya WAL), o null para no copiar.
export async function importarExperimentos(cliente: Client, paquete: Paquete, { respaldo }: { respaldo: string | null }): Promise<ResultadoImportacion> {
  const { plan, nuevas, columnas } = await preparar(cliente, paquete);
  if (plan.conflictos > 0) {
    throw new Error(`Hay ${plan.conflictos} filas en conflicto (ids que ya pertenecen a otro dataset o experimento): no se importó nada`);
  }
  const insertadas = Object.fromEntries(TABLAS.map((t) => [t, 0])) as Record<Tabla, number>;
  const sentencias: { sql: string; args: (string | number | null)[] }[] = [];
  const tablaDe: Tabla[] = [];
  for (const t of TABLAS) {
    const cols = columnas[t];
    const jsonb = new Set(paquete.meta.columnasJsonb[t]);
    const valores = cols.map((c) => (jsonb.has(c) ? "jsonb(?)" : "?")).join(", ");
    const donde = clave(t).map((c) => `"${c}" = ?`).join(" AND ");
    const sql = `INSERT OR IGNORE INTO ${t} (${cols.map((c) => `"${c}"`).join(", ")}) SELECT ${valores} WHERE NOT EXISTS (SELECT 1 FROM ${t} WHERE ${donde})`;
    for (const fila of nuevas[t]) {
      sentencias.push({ sql, args: [...cols.map((c) => fila[c] ?? null), ...clave(t).map((c) => fila[c] ?? null)] });
      tablaDe.push(t);
    }
  }
  if (sentencias.length === 0) return { plan, insertadas, respaldo: null };

  if (respaldo) {
    fs.mkdirSync(path.dirname(respaldo), { recursive: true });
    await cliente.execute({ sql: "VACUUM INTO ?", args: [respaldo] });
  }
  const resultados = await cliente.batch(sentencias, "write");
  resultados.forEach((r, i) => (insertadas[tablaDe[i]] += r.rowsAffected));
  return { plan, insertadas, respaldo };
}

async function conteosDelDataset(cliente: Client, paquete: Paquete) {
  const id = paquete.meta.destino.datasetId;
  const r = await cliente.execute({
    sql: `SELECT
      (SELECT count(*) FROM mastra_datasets WHERE id = ?1) AS datasets,
      (SELECT count(*) FROM mastra_dataset_versions WHERE datasetId = ?1) AS versiones,
      (SELECT count(*) FROM mastra_dataset_items WHERE datasetId = ?1) AS items,
      (SELECT count(*) FROM mastra_experiments WHERE datasetId = ?1) AS experimentos,
      (SELECT count(*) FROM mastra_experiment_results WHERE experimentId IN (SELECT id FROM mastra_experiments WHERE datasetId = ?1)) AS resultados,
      (SELECT count(*) FROM mastra_scorers WHERE source = 'TEST' AND runId IN (SELECT id FROM mastra_experiments WHERE datasetId = ?1)) AS puntajes,
      (SELECT count(*) FROM mastra_datasets) AS datasetsTotales`,
    args: [id],
  });
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
  const url = urlArchivo(process.env.MASTRA_DB_URL ?? "file:./data/mastra.db");
  const rutaDb = url.slice("file:".length);
  if (!fs.existsSync(rutaDb)) throw new Error("No existe la base de Mastra en el destino");

  console.log(`Base de destino: ${rutaDb}`);
  console.log(`Dataset a importar: «${paquete.meta.destino.datasetNombre}» (${paquete.meta.destino.datasetId}), ${paquete.meta.experimentos.length} experimentos`);
  const cliente = crearCliente(url);
  try {
    const plan = await planificarImportacion(cliente, paquete);
    imprimirPlan(plan);
    if (plan.conflictos > 0) throw new Error(`Hay ${plan.conflictos} filas en conflicto (ids que ya pertenecen a otro dataset o experimento): no se importó nada`);
    if (!args.includes("--si")) {
      console.log("\nSimulación: no se escribió nada. Para aplicar, repite el comando con --si.");
      return;
    }
    const r = await importarExperimentos(cliente, paquete, { respaldo: rutaRespaldo(rutaDb) });
    console.log(r.respaldo ? `\nRespaldo previo: ${r.respaldo}` : "\nNo faltaba nada: no se escribió nada (ni respaldo).");
    console.log("Filas insertadas:", r.insertadas);
    console.log("En el destino ahora:", await conteosDelDataset(cliente, paquete));
  } finally {
    cliente.close();
  }
}

ejecutarCli(import.meta.url, principal, "No se pudieron importar los experimentos");
