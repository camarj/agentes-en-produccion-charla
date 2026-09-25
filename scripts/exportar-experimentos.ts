import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createClient, type Client } from "@libsql/client";
import { urlArchivo } from "../lib/rutas";
import { ejecutarCli } from "./comun";

// Exporta experimentos de Mastra (Studio → Datasets → Experiments) de una base
// LibSQL a un paquete JSON, para importarlos en otra base con
// `pnpm importar:experimentos`. El dataset se renombra (nuevo id y nombre) para
// no mezclarse con el `charla-v1` del destino; los demás ids se conservan, así
// los enlaces item → resultado → puntaje y los traceId siguen valiendo.

export const TABLAS = [
  "mastra_datasets",
  "mastra_dataset_versions",
  "mastra_dataset_items",
  "mastra_experiments",
  "mastra_experiment_results",
  "mastra_scorers",
] as const;
export type Tabla = (typeof TABLAS)[number];

export type Valor = string | number | null;
export type Fila = Record<string, Valor>;

export interface Paquete {
  meta: {
    formato: "mastra-experimentos/1";
    origen: { archivo: string; datasetId: string };
    exportadoEn: string;
    filtro: { desde?: string; ids?: string[] };
    destino: { datasetId: string; datasetNombre: string };
    experimentos: { id: string; nombre: string | null; creado: string }[];
    conteos: Record<Tabla, number>;
    columnas: Record<Tabla, string[]>;
    // Columnas guardadas como JSONB en LibSQL: se exportan como texto con
    // json() y se vuelven a guardar con jsonb().
    columnasJsonb: Record<Tabla, string[]>;
  };
  tablas: Record<Tabla, Fila[]>;
}

export interface OpcionesExportacion {
  datasetOrigen?: string;
  desde?: string;
  ids?: string[];
  nuevoId: string;
  nuevoNombre: string;
  archivo?: string;
}

export const ID_ITERACION = "charla-v1-iteracion-2026-09-25";
export const NOMBRE_ITERACION = "charla-v1 · iteración 2026-09-25";

export async function columnasDe(cliente: Client, tabla: string): Promise<string[]> {
  const r = await cliente.execute(`PRAGMA table_info("${tabla}")`);
  return r.rows.map((f) => String(f.name));
}

const comillas = (c: string) => `"${c.replaceAll('"', '""')}"`;

// Lee filas con los JSONB ya convertidos a texto y detecta qué columnas lo son.
async function leer(cliente: Client, tabla: Tabla, donde: string, args: Valor[]) {
  const columnas = await columnasDe(cliente, tabla);
  if (columnas.length === 0) throw new Error(`La tabla ${tabla} no existe en la base de origen`);
  const select = columnas
    .map((c, i) => `CASE WHEN typeof(${comillas(c)}) = 'blob' THEN json(${comillas(c)}) ELSE ${comillas(c)} END AS ${comillas(c)}, typeof(${comillas(c)}) AS "__t${i}"`)
    .join(", ");
  const r = await cliente.execute({ sql: `SELECT ${select} FROM ${tabla} WHERE ${donde} ORDER BY rowid`, args });
  const tipos = columnas.map(() => new Set<string>());
  const filas: Fila[] = r.rows.map((f) => {
    const fila: Fila = {};
    columnas.forEach((c, i) => {
      tipos[i].add(String(f[`__t${i}`]));
      const v = f[c];
      if (v !== null && typeof v !== "string" && typeof v !== "number") throw new Error(`${tabla}.${c}: tipo no soportado (${typeof v})`);
      fila[c] = v;
    });
    return fila;
  });
  const jsonb = columnas.filter((_c, i) => tipos[i].has("blob"));
  for (const c of jsonb) {
    const t = tipos[columnas.indexOf(c)];
    if ([...t].some((x) => x !== "blob" && x !== "null")) throw new Error(`${tabla}.${c} mezcla JSONB con otros tipos`);
  }
  return { columnas, jsonb, filas };
}

const marcadores = (n: number) => Array.from({ length: n }, () => "?").join(", ");

export async function exportarExperimentos(cliente: Client, opciones: OpcionesExportacion): Promise<Paquete> {
  const origen = opciones.datasetOrigen ?? "charla-v1";
  const filtroExp = opciones.ids?.length
    ? { donde: `datasetId = ? AND id IN (${marcadores(opciones.ids.length)})`, args: [origen, ...opciones.ids] }
    : { donde: "datasetId = ? AND createdAt >= ?", args: [origen, opciones.desde ?? "2026-09-25"] };

  const experimentos = await leer(cliente, "mastra_experiments", filtroExp.donde, filtroExp.args);
  if (experimentos.filas.length === 0) throw new Error(`No hay ningún experimento del dataset ${origen} con ese filtro`);
  if (opciones.ids?.length && experimentos.filas.length !== opciones.ids.length) {
    throw new Error(`Se pidieron ${opciones.ids.length} experimentos y solo existen ${experimentos.filas.length}`);
  }
  const idsExp = experimentos.filas.map((e) => String(e.id));
  const enExp = marcadores(idsExp.length);

  const leidas: Record<Tabla, Awaited<ReturnType<typeof leer>>> = {
    mastra_datasets: await leer(cliente, "mastra_datasets", "id = ?", [origen]),
    mastra_dataset_versions: await leer(cliente, "mastra_dataset_versions", "datasetId = ?", [origen]),
    mastra_dataset_items: await leer(cliente, "mastra_dataset_items", "datasetId = ?", [origen]),
    mastra_experiments: experimentos,
    mastra_experiment_results: await leer(cliente, "mastra_experiment_results", `experimentId IN (${enExp})`, idsExp),
    mastra_scorers: await leer(cliente, "mastra_scorers", `source = 'TEST' AND runId IN (${enExp})`, idsExp),
  };
  if (leidas.mastra_datasets.filas.length !== 1) throw new Error(`No existe el dataset ${origen}`);

  const tablas = {} as Record<Tabla, Fila[]>;
  for (const t of TABLAS) {
    tablas[t] = leidas[t].filas.map((f) => {
      const copia = { ...f };
      if (copia.datasetId === origen) copia.datasetId = opciones.nuevoId;
      if (t === "mastra_datasets") Object.assign(copia, { id: opciones.nuevoId, name: opciones.nuevoNombre });
      return copia;
    });
  }

  const porTabla = <T>(f: (t: Tabla) => T) => Object.fromEntries(TABLAS.map((t) => [t, f(t)])) as Record<Tabla, T>;
  return {
    meta: {
      formato: "mastra-experimentos/1",
      origen: { archivo: opciones.archivo ?? "data/mastra.db", datasetId: origen },
      exportadoEn: new Date().toISOString(),
      filtro: opciones.ids?.length ? { ids: opciones.ids } : { desde: opciones.desde ?? "2026-09-25" },
      destino: { datasetId: opciones.nuevoId, datasetNombre: opciones.nuevoNombre },
      experimentos: experimentos.filas.map((e) => ({ id: String(e.id), nombre: e.name === null ? null : String(e.name), creado: String(e.createdAt) })),
      conteos: porTabla((t) => tablas[t].length),
      columnas: porTabla((t) => leidas[t].columnas),
      columnasJsonb: porTabla((t) => leidas[t].jsonb),
    },
    tablas,
  };
}

// Cuenta emails y coincidencias con asistentes reales. Nunca devuelve los datos.
export function revisarDatosPersonales(texto: string, asistentes: { email: string; nombre: string }[]) {
  const emails = texto.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  // Palabra completa y sin distinguir mayúsculas: «Ana» no coincide con «analizar».
  const contiene = (valor: string) => {
    const v = valor.trim();
    if (!v) return false;
    const escapado = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapado}(?![\\p{L}\\p{N}])`, "iu").test(texto);
  };
  return {
    emails: emails.length,
    emailsDeAsistentes: asistentes.filter((a) => contiene(a.email)).length,
    nombresDeAsistentes: asistentes.filter((a) => contiene(a.nombre)).length,
  };
}

async function asistentesReales(): Promise<{ email: string; nombre: string }[] | null> {
  const url = urlArchivo(process.env.DATABASE_PATH ?? "./data/charla.db");
  if (!fs.existsSync(url.slice("file:".length))) return null;
  const c = createClient({ url });
  try {
    const r = await c.execute("SELECT email, nombre FROM asistentes");
    return r.rows.map((f) => ({ email: String(f.email), nombre: String(f.nombre) }));
  } finally {
    c.close();
  }
}

async function principal() {
  const { values } = parseArgs({
    options: {
      db: { type: "string", default: "file:./data/mastra.db" },
      desde: { type: "string", default: "2026-09-25" },
      ids: { type: "string" },
      salida: { type: "string", default: "evals/experimentos/iteracion-2026-09-25.json" },
      "nuevo-id": { type: "string", default: ID_ITERACION },
      "nuevo-nombre": { type: "string", default: NOMBRE_ITERACION },
    },
  });
  const url = urlArchivo(values.db);
  const cliente = createClient({ url, concurrency: 1 });
  let paquete: Paquete;
  try {
    paquete = await exportarExperimentos(cliente, {
      desde: values.desde,
      ids: values.ids ? values.ids.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      nuevoId: values["nuevo-id"],
      nuevoNombre: values["nuevo-nombre"],
      archivo: path.basename(url.slice("file:".length)),
    });
  } finally {
    cliente.close();
  }
  const texto = JSON.stringify(paquete, null, 2);

  const asistentes = await asistentesReales();
  const revision = revisarDatosPersonales(texto, asistentes ?? []);
  console.log(
    `Revisión de datos personales: ${revision.emails} emails en el paquete; ` +
      (asistentes
        ? `${revision.emailsDeAsistentes} emails y ${revision.nombresDeAsistentes} nombres de ${asistentes.length} asistentes reales.`
        : "no se encontró charla.db para comparar con los asistentes."),
  );
  if (revision.emailsDeAsistentes + revision.nombresDeAsistentes > 0) {
    throw new Error("El paquete contiene datos de asistentes reales: no se escribió el archivo");
  }

  const salida = path.resolve(values.salida);
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, `${texto}\n`);
  console.log(`Paquete escrito en ${path.relative(process.cwd(), salida)} (${Math.round(Buffer.byteLength(texto) / 1024)} KB)`);
  for (const e of paquete.meta.experimentos) console.log(`  · ${e.nombre}`);
  console.log("Filas:", paquete.meta.conteos);
}

ejecutarCli(import.meta.url, principal, "No se pudieron exportar los experimentos");
