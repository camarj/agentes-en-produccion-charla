import fs from "node:fs";
import path from "node:path";

// `mastra dev` ejecuta su bundle desde carpetas internas (`.mastra/output`,
// `src/mastra/public`), así que las rutas relativas se resuelven contra la
// raíz del proyecto: la primera carpeta hacia arriba con `package.json` y `data/`.
export function raizProyecto(): string {
  if (process.env.PROYECTO_RAIZ) return process.env.PROYECTO_RAIZ;
  let dir = process.cwd();
  while (true) {
    const tienePaquete = fs.existsSync(path.join(dir, "package.json"));
    const tieneDatos = fs.existsSync(path.join(dir, "data"));
    if (tienePaquete && tieneDatos) return dir;
    const padre = path.dirname(dir);
    if (padre === dir) return process.cwd();
    dir = padre;
  }
}

// Convierte `file:./x.db` o `./x.db` en `file:<ruta absoluta>` desde la raíz.
export function urlArchivo(valor: string): string {
  const ruta = valor.startsWith("file:") ? valor.slice("file:".length) : valor;
  if (ruta === ":memory:" || path.isAbsolute(ruta)) return `file:${ruta}`;
  return `file:${path.resolve(raizProyecto(), ruta)}`;
}
