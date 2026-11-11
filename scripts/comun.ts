import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirCliente, type Cliente } from "../lib/db/client";
import { migrar } from "../lib/db/migrate";

// true cuando el módulo se ejecuta directamente (tsx scripts/x.ts), no al importarlo en tests.
export function esScript(urlModulo: string): boolean {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(urlModulo);
}

// Abre la base de la app (DATABASE_URL, Postgres) y la migra.
export async function abrirBaseMigrada(): Promise<Cliente> {
  const cliente = abrirCliente();
  try {
    await migrar(cliente);
  } catch (error) {
    await cliente.close();
    throw error;
  }
  return cliente;
}

export function ejecutarCli(urlModulo: string, principal: () => Promise<void>, error: string): void {
  if (!esScript(urlModulo)) return;
  principal().catch((e: unknown) => {
    console.error(`${error}:`, e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
