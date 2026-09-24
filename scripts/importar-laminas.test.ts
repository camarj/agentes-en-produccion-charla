import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearLaminas } from "../lib/db/laminas";
import { crearDbTemporal } from "../lib/db/prueba";
import { extraerLaminas, importarLaminas } from "./importar-laminas";

const html = fs.readFileSync(path.join(__dirname, "fixtures/presentacion.html"), "utf8");

describe("extraerLaminas", () => {
  const laminas = extraerLaminas(html);

  it("lee número y título del aria-label de cada section.slide", () => {
    expect(laminas.map((l) => [l.numero, l.titulo])).toEqual([
      [1, "Portada de prueba"],
      [2, "Router de intención"],
      [3, "Cierre"],
    ]);
  });

  it("el contenido excluye notas, paginación, imágenes, svg title/desc, style y script", () => {
    const [portada, router] = laminas;
    expect(portada.contenido).toBe("Agentes de prueba Subtítulo importante");
    expect(router.contenido).toContain("El router decide qué agente responde.");
    expect(router.contenido).toContain("Nodo");
    expect(router.contenido).toContain("Entrada Datos");
    for (const fuera of ["zumbacalabaza", "02 / 03", "duplicad", "var y", ".x{}", "Logo"]) {
      expect(router.contenido + portada.contenido).not.toContain(fuera);
    }
    expect(router.contenido).not.toMatch(/\s{2,}/);
  });

  it("una sección con etiquetas sin cerrar no se traga a la siguiente", () => {
    expect(laminas[1].contenido).not.toContain("Gracias");
    expect(laminas[2].contenido).toBe("Gracias");
  });

  it("las notas conservan los párrafos y las vacías quedan en null", () => {
    expect(laminas[0].notas).toBeNull();
    expect(laminas[1].notas).toBe(
      "Primer párrafo de notas con la palabra zumbacalabaza.\n\nSegundo párrafo de notas.",
    );
    expect(laminas[2].notas).toBe("Nota sin etiquetas.\n\nOtro bloque.");
  });
});

describe("importarLaminas", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  beforeEach(async () => {
    db = await crearDbTemporal();
  });
  afterEach(() => db.cerrar());

  it("guarda las láminas, reconstruye el índice y encuentra palabras que solo están en las notas", async () => {
    await importarLaminas(db.fuente, extraerLaminas(html));
    const repo = crearLaminas(db.fuente);
    const [primero] = await repo.buscar("zumbacalabaza");
    expect(primero.lamina).toBe(2);
    expect((await repo.buscar("router"))[0].lamina).toBe(2);
  });

  it("re-importar actualiza sin duplicar ni perder notas", async () => {
    await importarLaminas(db.fuente, extraerLaminas(html));
    await importarLaminas(db.fuente, extraerLaminas(html));
    const r = await db.cliente.execute("SELECT count(*) AS n, count(notas) AS conNotas FROM laminas");
    expect(Number(r.rows[0].n)).toBe(3);
    expect(Number(r.rows[0].conNotas)).toBe(2);
    expect(await crearLaminas(db.fuente).buscar("zumbacalabaza")).toHaveLength(1);
  });
});
