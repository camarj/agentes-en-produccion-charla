import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirCliente, type Cliente } from "./client";

export function carpetaMigraciones(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
}

// Clave del cerrojo consultivo de las migraciones de charla (constante, arbitraria).
export const CERROJO_MIGRACIONES = 72_617_301;

// Aplica en orden las migraciones .sql pendientes. Todo va en una transacción
// con un cerrojo consultivo: si varios contenedores arrancan a la vez, uno
// migra y los demás esperan y luego no encuentran nada pendiente. Si una
// migración falla, no queda ninguna aplicada a medias.
// Devuelve los nombres aplicados en esta corrida.
export async function migrar(cliente: Cliente, carpeta = carpetaMigraciones()): Promise<string[]> {
  const archivos = fs
    .readdirSync(carpeta)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return cliente.transaccion(async (tx) => {
    await tx.execute({ sql: "SELECT pg_advisory_xact_lock(?)", args: [CERROJO_MIGRACIONES] });
    await tx.execute(
      "CREATE TABLE IF NOT EXISTS _migraciones (nombre TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const hechas = await tx.execute("SELECT nombre FROM _migraciones");
    const aplicadas = new Set(hechas.rows.map((r) => String(r.nombre)));
    const pendientes = archivos.filter((f) => !aplicadas.has(f));
    for (const nombre of pendientes) {
      await tx.execute(fs.readFileSync(path.join(carpeta, nombre), "utf8"));
      await tx.execute({ sql: "INSERT INTO _migraciones (nombre) VALUES (?)", args: [nombre] });
    }
    return pendientes;
  });
}

async function principal() {
  const cliente = abrirCliente();
  try {
    const aplicadas = await migrar(cliente);
    console.log(
      aplicadas.length
        ? `Migraciones aplicadas: ${aplicadas.join(", ")}`
        : "La base ya está al día; no hay migraciones pendientes.",
    );
  } finally {
    await cliente.close();
  }
}

const esScript =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (esScript) {
  principal().catch((error: unknown) => {
    console.error("No se pudo migrar la base:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
