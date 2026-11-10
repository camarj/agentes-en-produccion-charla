import { createClient, type Client } from "@libsql/client";
import { crearBaseLenta } from "../salud/db-lenta";
import { urlArchivo } from "../rutas";

export type FuenteDb = () => Promise<Client>;

// Una sola conexión: los PRAGMA por conexión (foreign_keys) quedan activos
// para todas las consultas. `timeout` aplica busy_timeout en cada conexión.
export function crearCliente(url: string): Client {
  return createClient({ url, concurrency: 1, timeout: 5000 });
}

export async function abrirCliente(url: string): Promise<Client> {
  const cliente = crearCliente(url);
  await cliente.executeMultiple(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
  );
  return cliente;
}

export function urlPorDefecto(): string {
  return urlArchivo(process.env.DATABASE_PATH ?? "./data/charla.db");
}

let singleton: Promise<Client> | null = null;

// Conexión compartida, creada al primer uso; las consultas esperan a los PRAGMA.
const conexion: FuenteDb = () => {
  if (!singleton) {
    singleton = abrirCliente(urlPorDefecto()).catch((error) => {
      singleton = null;
      throw error;
    });
  }
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

let instrumentado: Promise<Client> | null = null;

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
