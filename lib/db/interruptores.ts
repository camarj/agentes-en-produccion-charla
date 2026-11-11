import { baseLenta, db, type FuenteDb } from "./client";
import { isoDeSqlite, texto } from "./tipos";

export const CLAVES_INTERRUPTOR = [
  "herramienta_caida",
  "latencia_alta",
  "modelo_caido",
  "modelos_caidos",
  "kill_switch",
  "lamina_actual",
] as const;

export type ClaveInterruptor = (typeof CLAVES_INTERRUPTOR)[number];
export type Interruptores = Record<ClaveInterruptor, string>;

// Interruptores de caos de PRD §15 G7. Van aparte de `Interruptores` para que
// quien arma esos valores a mano (fixtures de evals y tests) no tenga que
// traerlos; `obtenerTodos` siempre los devuelve.
export const CLAVES_CAOS_G7 = ["limite_gemini", "base_datos_lenta"] as const;
export type ClaveCaosG7 = (typeof CLAVES_CAOS_G7)[number];
export type InterruptoresCompletos = Interruptores & Record<ClaveCaosG7, string>;
type ClaveGuardada = ClaveInterruptor | ClaveCaosG7;
const CLAVES_GUARDADAS: readonly string[] = [...CLAVES_INTERRUPTOR, ...CLAVES_CAOS_G7];

// Interruptores de encendido/apagado (todos menos `lamina_actual`).
export const CLAVES_ON_OFF = [
  "herramienta_caida",
  "latencia_alta",
  "modelo_caido",
  "modelos_caidos",
  "limite_gemini",
  "base_datos_lenta",
  "kill_switch",
] as const;
export type ClaveOnOff = (typeof CLAVES_ON_OFF)[number];

const VALORES_POR_DEFECTO: InterruptoresCompletos = {
  herramienta_caida: "off",
  latencia_alta: "off",
  modelo_caido: "off",
  // Fallan el principal y el respaldo (caos): falla técnica + escalamiento.
  modelos_caidos: "off",
  // El principal falla con un 429 de límite de uso simulado (PRD §15 G7).
  limite_gemini: "off",
  // Cada consulta de la app a charla.db tarda 1,5 s más (PRD §15 G7).
  base_datos_lenta: "off",
  kill_switch: "off",
  lamina_actual: "1",
};

const DURACION_CACHE_MS = 2000;

// `alLeer`: se llama con los valores cada vez que se leen de la base (no en
// la caché); la app lo usa para encender o apagar la base lenta.
export function crearInterruptores(fuente: FuenteDb = db, { alLeer }: { alLeer?: (valores: InterruptoresCompletos) => void } = {}) {
  let cache: { valores: InterruptoresCompletos; vence: number } | null = null;

  function limpiarCache() {
    cache = null;
  }

  async function obtenerTodos(): Promise<InterruptoresCompletos> {
    if (cache && cache.vence > Date.now()) return { ...cache.valores };
    const c = await fuente();
    const r = await c.execute("SELECT clave, valor FROM interruptores");
    const valores: InterruptoresCompletos = { ...VALORES_POR_DEFECTO };
    for (const fila of r.rows) {
      const clave = texto(fila, "clave");
      if (CLAVES_GUARDADAS.includes(clave)) {
        valores[clave as ClaveGuardada] = texto(fila, "valor");
      }
    }
    cache = { valores, vence: Date.now() + DURACION_CACHE_MS };
    alLeer?.({ ...valores });
    return { ...valores };
  }

  async function actualizar(clave: ClaveGuardada, valor: string): Promise<void> {
    const c = await fuente();
    await c.batch(
      [
        {
          sql: `INSERT INTO interruptores (clave, valor) VALUES (?, ?)
            ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = ahora_utc()`,
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

export const interruptores = crearInterruptores(db, { alLeer: (v) => baseLenta.fijar(v.base_datos_lenta === "on") });
