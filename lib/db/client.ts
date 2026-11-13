import pg from "pg";
import { crearBaseLenta } from "../salud/db-lenta";

// Cliente de charla en PostgreSQL (Cloud SQL en producción, PGlite en tests).
// Conserva la forma que usan los repositorios desde SQLite: `execute`, `batch`
// en una transacción, filas como objetos por columna y `rowsAffected`. Los
// repositorios escriben `?` y aquí se traducen a `$1..$n`.

export type ValorSql = string | number | boolean | null | undefined | Date | Uint8Array;
export type Sentencia = string | { sql: string; args?: readonly ValorSql[] };
export type Fila = Record<string, unknown>;

export interface Resultado {
  rows: Fila[];
  rowsAffected: number;
}

export interface Transaccion {
  execute(sentencia: Sentencia): Promise<Resultado>;
}

export interface Cliente extends Transaccion {
  // Todas las sentencias en una transacción: o se aplican todas o ninguna.
  // `read` usa una instantánea de solo lectura.
  batch(sentencias: readonly Sentencia[], modo?: "read" | "write"): Promise<Resultado[]>;
  // Transacción interactiva sobre una sola conexión (migraciones con cerrojo).
  transaccion<T>(fn: (tx: Transaccion) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type FuenteDb = () => Promise<Cliente>;

// `?` → `$n`, sin tocar los `?` dentro de literales, identificadores entre
// comillas, comentarios ni bloques `$tag$…$tag$`.
export function aPlaceholdersPg(sql: string): string {
  let salida = "";
  let n = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const sig = sql[i + 1];
    if (c === "'" || c === '"') {
      const fin = buscarCierre(sql, i + 1, c);
      salida += sql.slice(i, fin);
      i = fin;
    } else if (c === "-" && sig === "-") {
      const fin = sql.indexOf("\n", i);
      const hasta = fin === -1 ? sql.length : fin;
      salida += sql.slice(i, hasta);
      i = hasta;
    } else if (c === "/" && sig === "*") {
      const fin = sql.indexOf("*/", i + 2);
      const hasta = fin === -1 ? sql.length : fin + 2;
      salida += sql.slice(i, hasta);
      i = hasta;
    } else if (c === "$" && /^\$[A-Za-z_]*\$/.test(sql.slice(i))) {
      const etiqueta = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))![0];
      const fin = sql.indexOf(etiqueta, i + etiqueta.length);
      const hasta = fin === -1 ? sql.length : fin + etiqueta.length;
      salida += sql.slice(i, hasta);
      i = hasta;
    } else if (c === "?") {
      salida += `$${++n}`;
      i++;
    } else {
      salida += c;
      i++;
    }
  }
  return salida;
}

// Índice justo después de la comilla de cierre (una comilla doble la escapa).
function buscarCierre(sql: string, desde: number, comilla: string): number {
  let i = desde;
  while (i < sql.length) {
    if (sql[i] === comilla) {
      if (sql[i + 1] === comilla) i += 2;
      else return i + 1;
    } else i++;
  }
  return sql.length;
}

// int8 (COUNT, SUM, BIGINT) y numeric llegan como texto en pg: aquí se leen
// como número, igual que en SQLite. Los valores de la app caben en 2^53.
const TIPO_INT8 = 20;
const TIPO_NUMERIC = 1700;
export const tiposCharla: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, formato?: "text" | "binary") => {
    if (oid === TIPO_INT8 || oid === TIPO_NUMERIC) return (v: string) => Number(v);
    return pg.types.getTypeParser(oid, formato);
  }) as pg.CustomTypesConfig["getTypeParser"],
};

interface Consultable {
  query(texto: string, valores?: unknown[]): Promise<pg.QueryResult | pg.QueryResult[]>;
}

async function ejecutarEn(conexion: Consultable, sentencia: Sentencia): Promise<Resultado> {
  const { sql, args } = typeof sentencia === "string" ? { sql: sentencia, args: undefined } : sentencia;
  // Sin argumentos va por el protocolo simple: admite varias sentencias.
  const r =
    args && args.length > 0
      ? await conexion.query(aPlaceholdersPg(sql), args.map((a) => (a === undefined ? null : a)))
      : await conexion.query(sql);
  const ultimo = Array.isArray(r) ? r[r.length - 1] : r;
  return { rows: (ultimo?.rows ?? []) as Fila[], rowsAffected: ultimo?.rowCount ?? 0 };
}

// Adaptador sobre un Pool de pg (Cloud SQL o PGlite vía su conexión pg).
export function clienteDePool(pool: pg.Pool): Cliente {
  async function transaccion<T>(fn: (tx: Transaccion) => Promise<T>, inicio = "BEGIN"): Promise<T> {
    const conexion = await pool.connect();
    try {
      await conexion.query(inicio);
      const valor = await fn({ execute: (s) => ejecutarEn(conexion, s) });
      await conexion.query("COMMIT");
      return valor;
    } catch (error) {
      await conexion.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      conexion.release();
    }
  }

  return {
    execute: (s) => ejecutarEn(pool, s),
    batch: (sentencias, modo = "write") =>
      transaccion(
        async (tx) => {
          const salida: Resultado[] = [];
          for (const s of sentencias) salida.push(await tx.execute(s));
          return salida;
        },
        modo === "read" ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN",
      ),
    transaccion: (fn) => transaccion(fn),
    close: () => pool.end(),
  };
}

export function urlPorDefecto(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("Falta DATABASE_URL: la URL postgres:// de la base de la app");
  return url;
}

// En Cloud Run la URL puede usar el socket de Cloud SQL:
// postgres://usuario:clave@/charla?host=/cloudsql/proyecto:region:instancia
export function abrirCliente(url: string = urlPorDefecto(), { max = 10 }: { max?: number } = {}): Cliente {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    types: tiposCharla,
  });
  // Un error de una conexión ociosa (p. ej. reinicio de Cloud SQL) no debe tumbar el proceso.
  pool.on("error", () => undefined);
  return clienteDePool(pool);
}

let singleton: Cliente | null = null;

// Pool compartido, creado al primer uso.
const conexion: FuenteDb = async () => {
  singleton ??= abrirCliente();
  return singleton;
};

// Interruptor «Base de datos lenta» y aviso de consultas lentas (PRD §15 G7).
// El aviso se anota como evento de salud como mucho una vez cada 5 s (esa
// escritura también puede ser lenta: el tope evita un bucle de avisos).
let ultimoAviso = Number.NEGATIVE_INFINITY;
export const baseLenta = crearBaseLenta({
  alLenta: () => {
    if (Date.now() - ultimoAviso < 5000) return;
    ultimoAviso = Date.now();
    void import("../salud/registro").then((m) => m.anotarEvento("db_lenta")).catch(() => undefined);
  },
});

let instrumentado: Promise<Cliente> | null = null;

// Cliente de la app: el mismo, con la base lenta y el aviso de consultas lentas.
export const db: FuenteDb = () => {
  instrumentado ??= conexion().then(
    (c) => baseLenta.envolver(c),
    (error: unknown) => {
      instrumentado = null;
      throw error;
    },
  );
  return instrumentado;
};
