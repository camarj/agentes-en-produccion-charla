import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { aPlaceholdersPg, type Cliente, type FuenteDb, type Resultado, type Sentencia, type Transaccion } from "./client";
import { migrar } from "./migrate";
import { VARIABLE_DATOS_PGLITE } from "./prueba-global";

// Base temporal para tests: un Postgres embebido (PGlite) en memoria, nunca la
// base real. Usa la API propia de PGlite y no su puente para `pg`: ese puente
// pierde la conexión tras un error de una consulta con parámetros. La
// traducción de `?` y la forma de los resultados son las mismas de `client.ts`. Arrancar PGlite cuesta segundos, así que cada proceso de tests
// abre uno solo y cada base temporal es un esquema nuevo dentro de él
// (`search_path`), migrado desde cero y borrado al cerrar. Las bases de un
// mismo proceso quedan aisladas entre sí.

interface Compartido {
  base: Cliente;
  esquemaActivo: string | null;
  cola: Promise<unknown>;
}

let compartido: Promise<Compartido> | null = null;
let contador = 0;

async function abrirCompartido(): Promise<Compartido> {
  // Con el directorio de datos que dejó el globalSetup arranca en ~1 s; sin él, initdb completo.
  const archivo = process.env[VARIABLE_DATOS_PGLITE];
  const pglite =
    archivo && fs.existsSync(archivo)
      ? await PGlite.create({ loadDataDir: new Blob([fs.readFileSync(archivo)]) })
      : await PGlite.create();
  return { base: clienteDePglite(pglite), esquemaActivo: null, cola: Promise.resolve() };
}

// int8 y numeric como número, igual que `tiposCharla` en producción.
const PARSERS = { 20: (v: string) => Number(v), 1700: (v: string) => Number(v) };

interface ConsultablePglite {
  query: PGlite["query"];
  exec: PGlite["exec"];
}

async function ejecutarEnPglite(db: ConsultablePglite, sentencia: Sentencia): Promise<Resultado> {
  const { sql, args } = typeof sentencia === "string" ? { sql: sentencia, args: undefined } : sentencia;
  // Sin argumentos admite varias sentencias (migraciones), como el protocolo simple de pg.
  const r =
    args && args.length > 0
      ? await db.query<Record<string, unknown>>(aPlaceholdersPg(sql), args.map((a) => (a === undefined ? null : a)), { parsers: PARSERS })
      : (await db.exec(sql, { parsers: PARSERS })).at(-1);
  return { rows: (r?.rows ?? []) as Record<string, unknown>[], rowsAffected: r?.affectedRows ?? 0 };
}

function clienteDePglite(pglite: PGlite): Cliente {
  const transaccion = <T>(fn: (tx: Transaccion) => Promise<T>) =>
    pglite.transaction((tx) => fn({ execute: (s) => ejecutarEnPglite(tx, s) }));
  return {
    execute: (s) => ejecutarEnPglite(pglite, s),
    batch: (sentencias) =>
      transaccion(async (tx) => {
        const salida: Resultado[] = [];
        for (const s of sentencias) salida.push(await tx.execute(s));
        return salida;
      }),
    transaccion,
    close: () => pglite.close(),
  };
}

// PGlite tiene una sola sesión: las operaciones de todas las bases temporales
// van en fila y cada una fija antes su esquema.
function enFila<T>(c: Compartido, esquema: string, fn: () => Promise<T>): Promise<T> {
  const turno = c.cola.then(async () => {
    if (c.esquemaActivo !== esquema) {
      await c.base.execute(`SET search_path TO "${esquema}"`);
      c.esquemaActivo = esquema;
    }
    return fn();
  });
  c.cola = turno.catch(() => undefined);
  return turno;
}

function clienteEnEsquema(c: Compartido, esquema: string): Cliente {
  return {
    execute: (s) => enFila(c, esquema, () => c.base.execute(s)),
    batch: (s, modo) => enFila(c, esquema, () => c.base.batch(s, modo)),
    transaccion: <T>(fn: (tx: Transaccion) => Promise<T>) => enFila(c, esquema, () => c.base.transaccion(fn)),
    close: async () => {},
  };
}

export async function crearDbTemporal({ migrada = true }: { migrada?: boolean } = {}): Promise<{
  cliente: Cliente;
  fuente: FuenteDb;
  cerrar: () => Promise<void>;
}> {
  compartido ??= abrirCompartido().catch((error: unknown) => {
    compartido = null;
    throw error;
  });
  const c = await compartido;
  const esquema = `prueba_${process.pid}_${++contador}`;
  await enFila(c, esquema, () => c.base.execute(`CREATE SCHEMA "${esquema}"`));
  const cliente = clienteEnEsquema(c, esquema);
  if (migrada) await migrar(cliente);
  let cerrada = false;
  return {
    cliente,
    fuente: async () => cliente,
    cerrar: async () => {
      if (cerrada) return;
      cerrada = true;
      await enFila(c, "public", () => c.base.execute(`DROP SCHEMA "${esquema}" CASCADE`));
    },
  };
}
