import { EventEmitter } from "node:events";
import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";

// Pool de `pg` mínimo sobre la API propia de PGlite, solo para tests: lo que
// usa `@mastra/pg` (query, connect/release, end, eventos). No se usa el puente
// `@electric-sql/pglite/node-postgres` porque pierde la conexión tras un error
// en una consulta con parámetros. PGlite tiene una sola sesión: un candado deja
// pasar una consulta suelta o un cliente prestado (transacción) a la vez.

// Como `pg`: int8 y numeric como texto.
const PARSERS = { 20: (v: string) => v, 1700: (v: string) => v };

type Consulta = string | { text: string; values?: unknown[] };

interface Resultado {
  rows: Record<string, unknown>[];
  rowCount: number;
  command: string;
  fields: { name: string; dataTypeID: number }[];
}

async function ejecutar(pglite: PGlite, consulta: Consulta, valores?: unknown[]): Promise<Resultado> {
  const { text, values } = typeof consulta === "string" ? { text: consulta, values: valores } : consulta;
  const r =
    values && values.length > 0
      ? await pglite.query<Record<string, unknown>>(text, values, { parsers: PARSERS })
      : // Sin parámetros admite varias sentencias, como el protocolo simple de pg.
        (await pglite.exec(text, { parsers: PARSERS })).at(-1);
  const rows = (r?.rows ?? []) as Record<string, unknown>[];
  return {
    rows,
    rowCount: r?.affectedRows ?? rows.length,
    command: text.trim().split(/\s+/)[0]?.toUpperCase() ?? "",
    fields: (r?.fields ?? []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
  };
}

export function crearPoolPglite(pglite: PGlite): Pool {
  let cola: Promise<unknown> = Promise.resolve();
  // Toma el candado; devuelve la función que lo suelta.
  const tomar = (): Promise<() => void> => {
    let soltar!: () => void;
    const libre = new Promise<void>((r) => (soltar = r));
    const turno = cola.then(() => soltar);
    cola = turno.then(() => libre);
    return turno;
  };

  const pool = new EventEmitter() as EventEmitter & Record<string, unknown>;
  Object.assign(pool, {
    options: { max: 1 },
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    async query(consulta: Consulta, valores?: unknown[]) {
      const soltar = await tomar();
      try {
        return await ejecutar(pglite, consulta, valores);
      } finally {
        soltar();
      }
    },
    async connect() {
      const soltar = await tomar();
      const cliente = new EventEmitter() as EventEmitter & Record<string, unknown>;
      let suelto = false;
      Object.assign(cliente, {
        query: (consulta: Consulta, valores?: unknown[]) => ejecutar(pglite, consulta, valores),
        release: () => {
          if (suelto) return;
          suelto = true;
          pool.emit("release", undefined, cliente);
          soltar();
        },
      });
      pool.emit("connect", cliente);
      pool.emit("acquire", cliente);
      return cliente;
    },
    async end() {},
  });
  return pool as unknown as Pool;
}
