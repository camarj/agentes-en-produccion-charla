import { db, type FuenteDb } from "./client";
import { isoDeSqlite, texto } from "./tipos";

export const CLAVES_INTERRUPTOR = [
  "herramienta_caida",
  "latencia_alta",
  "modelo_caido",
  "kill_switch",
  "lamina_actual",
] as const;

export type ClaveInterruptor = (typeof CLAVES_INTERRUPTOR)[number];
export type Interruptores = Record<ClaveInterruptor, string>;

// Interruptores de encendido/apagado (todos menos `lamina_actual`).
export const CLAVES_ON_OFF = ["herramienta_caida", "latencia_alta", "modelo_caido", "kill_switch"] as const;
export type ClaveOnOff = (typeof CLAVES_ON_OFF)[number];

const VALORES_POR_DEFECTO: Interruptores = {
  herramienta_caida: "off",
  latencia_alta: "off",
  modelo_caido: "off",
  kill_switch: "off",
  lamina_actual: "1",
};

const DURACION_CACHE_MS = 2000;

export function crearInterruptores(fuente: FuenteDb = db) {
  let cache: { valores: Interruptores; vence: number } | null = null;

  function limpiarCache() {
    cache = null;
  }

  async function obtenerTodos(): Promise<Interruptores> {
    if (cache && cache.vence > Date.now()) return { ...cache.valores };
    const c = await fuente();
    const r = await c.execute("SELECT clave, valor FROM interruptores");
    const valores: Interruptores = { ...VALORES_POR_DEFECTO };
    for (const fila of r.rows) {
      const clave = texto(fila, "clave");
      if ((CLAVES_INTERRUPTOR as readonly string[]).includes(clave)) {
        valores[clave as ClaveInterruptor] = texto(fila, "valor");
      }
    }
    cache = { valores, vence: Date.now() + DURACION_CACHE_MS };
    return { ...valores };
  }

  async function actualizar(clave: ClaveInterruptor, valor: string): Promise<void> {
    const c = await fuente();
    await c.batch(
      [
        {
          sql: `INSERT INTO interruptores (clave, valor) VALUES (?, ?)
            ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = datetime('now')`,
          args: [clave, valor],
        },
        { sql: "INSERT INTO eventos_interruptor (clave, valor) VALUES (?, ?)", args: [clave, valor] },
      ],
      "write",
    );
    limpiarCache();
  }

  // Hora (ISO, UTC) de la última vez que cada interruptor pasó a `on`, según
  // `eventos_interruptor`; null si nunca se encendió.
  async function ultimasActivaciones(): Promise<Record<ClaveOnOff, string | null>> {
    const c = await fuente();
    const r = await c.execute(
      "SELECT clave, MAX(creado_en) AS ultima FROM eventos_interruptor WHERE valor = 'on' GROUP BY clave",
    );
    const salida = Object.fromEntries(CLAVES_ON_OFF.map((k) => [k, null])) as Record<ClaveOnOff, string | null>;
    for (const fila of r.rows) {
      const clave = texto(fila, "clave");
      if ((CLAVES_ON_OFF as readonly string[]).includes(clave)) salida[clave as ClaveOnOff] = isoDeSqlite(texto(fila, "ultima"));
    }
    return salida;
  }

  return { obtenerTodos, actualizar, limpiarCache, ultimasActivaciones };
}

export const interruptores = crearInterruptores();
