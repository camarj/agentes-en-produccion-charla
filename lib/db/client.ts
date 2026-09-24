import { createClient, type Client } from "@libsql/client";
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

// Cliente compartido, creado al primer uso; las consultas esperan a los PRAGMA.
export const db: FuenteDb = () => {
  if (!singleton) {
    singleton = abrirCliente(urlPorDefecto()).catch((error) => {
      singleton = null;
      throw error;
    });
  }
  return singleton;
};
