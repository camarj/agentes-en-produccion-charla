import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "@libsql/client";
import { abrirCliente, urlPorDefecto } from "../lib/db/client";
import { migrar } from "../lib/db/migrate";

// true cuando el módulo se ejecuta directamente (tsx scripts/x.ts), no al importarlo en tests.
export function esScript(urlModulo: string): boolean {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(urlModulo);
}

// Abre la base de la app (DATABASE_PATH o data/charla.db), crea la carpeta si falta y la migra.
export async function abrirBaseMigrada(): Promise<Client> {
  const url = urlPorDefecto();
  fs.mkdirSync(path.dirname(url.slice("file:".length)), { recursive: true });
  const cliente = await abrirCliente(url);
  await migrar(cliente);
  return cliente;
}

export function ejecutarCli(urlModulo: string, principal: () => Promise<void>, error: string): void {
  if (!esScript(urlModulo)) return;
  principal().catch((e: unknown) => {
    console.error(`${error}:`, e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
