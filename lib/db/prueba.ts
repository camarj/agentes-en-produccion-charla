import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Client } from "@libsql/client";
import { abrirCliente, type FuenteDb } from "./client";
import { migrar } from "./migrate";

// Base temporal para tests: nunca toca data/charla.db.
export async function crearDbTemporal(): Promise<{
  cliente: Client;
  fuente: FuenteDb;
  cerrar: () => void;
}> {
  const ruta = path.join(os.tmpdir(), `charla-test-${crypto.randomUUID()}.db`);
  const cliente = await abrirCliente(`file:${ruta}`);
  await migrar(cliente);
  return {
    cliente,
    fuente: async () => cliente,
    cerrar: () => {
      cliente.close();
      for (const sufijo of ["", "-wal", "-shm"]) fs.rmSync(ruta + sufijo, { force: true });
    },
  };
}
