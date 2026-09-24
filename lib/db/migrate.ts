import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "@libsql/client";
import { abrirCliente, urlPorDefecto } from "./client";

export function carpetaMigraciones(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
}

// Aplica en orden las migraciones .sql pendientes, cada una en su transacción.
// Devuelve los nombres aplicados en esta corrida.
export async function migrar(cliente: Client, carpeta = carpetaMigraciones()): Promise<string[]> {
  await cliente.execute(
    "CREATE TABLE IF NOT EXISTS _migraciones (nombre TEXT PRIMARY KEY, aplicada_en TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const hechas = await cliente.execute("SELECT nombre FROM _migraciones");
  const aplicadas = new Set(hechas.rows.map((r) => String(r.nombre)));
  const pendientes = fs
    .readdirSync(carpeta)
    .filter((f) => f.endsWith(".sql") && !aplicadas.has(f))
    .sort();

  for (const nombre of pendientes) {
    const sql = fs.readFileSync(path.join(carpeta, nombre), "utf8");
    const literal = nombre.replaceAll("'", "''");
    // executeMultiple usa una sola conexión; si algo falla, el cliente hace ROLLBACK.
    await cliente.executeMultiple(
      `BEGIN;\n${sql}\n;INSERT INTO _migraciones (nombre) VALUES ('${literal}');\nCOMMIT;`,
    );
  }
  return pendientes;
}

async function principal() {
  const url = urlPorDefecto();
  fs.mkdirSync(path.dirname(url.slice("file:".length)), { recursive: true });
  const cliente = await abrirCliente(url);
  try {
    const aplicadas = await migrar(cliente);
    console.log(
      aplicadas.length
        ? `Migraciones aplicadas: ${aplicadas.join(", ")}`
        : "La base ya está al día; no hay migraciones pendientes.",
    );
  } finally {
    cliente.close();
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
