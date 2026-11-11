import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { VARIABLE_DATOS_PGLITE } from "@/lib/db/prueba-global";
import { crearAlmacenamiento } from "../storage";
import { crearPoolPglite } from "./pool-pglite";

// Almacenamiento de Mastra para tests: el mismo `crearAlmacenamiento` de
// producción (PostgresStore + observabilidad tolerante), sobre un Postgres
// embebido (PGlite) en memoria. Un PGlite por proceso de tests; cada
// almacenamiento usa un esquema propio, así las pruebas no se cruzan.
// Es síncrono: PGlite arranca al primer uso del pool.

let pglite: Promise<PGlite> | null = null;
let contador = 0;

function abrirPglite(): Promise<PGlite> {
  pglite ??= (async () => {
    // Con el directorio de datos que dejó el globalSetup arranca en ~1 s.
    const archivo = process.env[VARIABLE_DATOS_PGLITE];
    return archivo && fs.existsSync(archivo)
      ? PGlite.create({ loadDataDir: new Blob([fs.readFileSync(archivo)]) })
      : PGlite.create();
  })();
  return pglite;
}

// PGlite perezoso detrás de la forma de un pool de `pg`.
let pool: Pool | null = null;
export function poolDePrueba(): Pool {
  if (pool) return pool;
  const real = abrirPglite().then(crearPoolPglite);
  const perezoso = {
    query: (...args: unknown[]) => real.then((p) => (p.query as (...a: unknown[]) => unknown)(...args)),
    connect: () => real.then((p) => p.connect()),
    on: () => perezoso,
    end: async () => {},
    options: { max: 1 },
  };
  pool = perezoso as unknown as Pool;
  return pool;
}

export function crearAlmacenamientoDePrueba(nombre = "prueba") {
  const esquema = `${nombre.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}_${process.pid}_${++contador}`;
  const p = poolDePrueba();
  return { almacenamiento: crearAlmacenamiento({ pool: p, esquema }), esquema, pool: p };
}
