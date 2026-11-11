import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

// globalSetup de vitest: inicializa PGlite una sola vez (initdb tarda ~10 s) y
// deja su directorio de datos en un archivo temporal. Cada proceso de tests lo
// carga con `loadDataDir` (~1 s) en `lib/db/prueba.ts`.
export const VARIABLE_DATOS_PGLITE = "CHARLA_PRUEBA_PGLITE_DATOS";

export default async function preparar(): Promise<() => void> {
  const pglite = await PGlite.create();
  const datos = await pglite.dumpDataDir("none");
  await pglite.close();
  const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "charla-pglite-")), "datos.tar");
  fs.writeFileSync(archivo, Buffer.from(await datos.arrayBuffer()));
  process.env[VARIABLE_DATOS_PGLITE] = archivo;
  return () => fs.rmSync(path.dirname(archivo), { recursive: true, force: true });
}
