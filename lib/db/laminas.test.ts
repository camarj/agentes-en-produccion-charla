import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { extraerLaminas, importarLaminas } from "@/scripts/importar-laminas";
import { consultasBusqueda, crearLaminas } from "./laminas";
import { crearDbTemporal } from "./prueba";

describe("laminas", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  let repo: ReturnType<typeof crearLaminas>;
  beforeEach(async () => {
    db = await crearDbTemporal();
    repo = crearLaminas(db.fuente);
    await repo.upsert({ numero: 1, titulo: "Portada", contenido: "Cómo lograr que tus agentes sobrevivan a producción", notas: null });
    await repo.upsert({ numero: 7, titulo: "Resiliencia", contenido: "Reintentos, modelo de respaldo y degradación elegante", notas: "Contar la caída del proveedor" });
    await repo.upsert({ numero: 9, titulo: "Guardrails", contenido: "Filtros de entrada y salida para el agente", notas: null });
    await repo.reconstruirIndice();
  });
  afterEach(() => db.cerrar());

  it("busca ignorando tildes (remove_diacritics)", async () => {
    const a = await repo.buscar("resiliencia");
    const b = await repo.buscar("resiliéncia");
    expect(a[0]?.lamina).toBe(7);
    expect(b[0]?.lamina).toBe(7);
    expect(a[0].titulo).toBe("Resiliencia");
    expect(a[0].puntaje).toBeGreaterThan(0);
    expect(a[0].notas).toContain("caída");
    expect(a[0].fragmento).toContain("respaldo");
  });

  it("notas es null cuando la lámina no tiene notas", async () => {
    const r = await repo.buscar("guardrails");
    expect(r[0]).toMatchObject({ lamina: 9, notas: null });
  });

  it("usa AND y reintenta con OR si no hay resultados", async () => {
    const and = await repo.buscar("agentes producción");
    expect(and.map((r) => r.lamina)).toEqual([1]);
    const or = await repo.buscar("guardrails reintentos");
    expect(or.map((r) => r.lamina).sort()).toEqual([7, 9]);
  });

  it("tolera comillas y operadores y respeta el límite", async () => {
    expect(await repo.buscar('"agente" OR NEAR( * ^')).toBeInstanceOf(Array);
    expect(await repo.buscar("   ")).toEqual([]);
    expect(await repo.buscar("?!¿")).toEqual([]);
    expect(await repo.buscar("agentes agente reintentos filtros", 1)).toHaveLength(1);
  });

  it("upsert actualiza una lámina existente", async () => {
    await repo.upsert({ numero: 9, titulo: "Guardrails v2", contenido: "Filtros", notas: "nuevo" });
    await repo.reconstruirIndice();
    const r = await repo.buscar("guardrails");
    expect(r[0]).toMatchObject({ lamina: 9, titulo: "Guardrails v2" });
  });
});

// Búsqueda con la presentación real (2026-09-25): las conjugaciones no
// coincidían con el texto de las láminas («patrocinó» ↔ «patrocinada»). Orden:
// AND exacto → AND con prefijos (palabras de contenido) → OR exacto (el de
// siempre). Un OR con prefijos empeoraba el orden en consultas reales del agente.
describe("laminas · presentación real", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  let repo: ReturnType<typeof crearLaminas>;
  beforeAll(async () => {
    db = await crearDbTemporal();
    const html = fs.readFileSync(path.join(__dirname, "..", "..", "agentes-produccion-taller-v43-before-slide14-v2.html"), "utf8");
    await importarLaminas(db.fuente, extraerLaminas(html));
    repo = crearLaminas(db.fuente);
  });
  afterAll(() => db.cerrar());
  const numeros = async (q: string) => (await repo.buscar(q, 5)).map((r) => r.lamina);

  it("«¿Quién patrocinó la charla?» encuentra la lámina 1 primero (patrocinó ↔ patrocinada)", async () => {
    expect((await numeros("¿Quién patrocinó la charla?"))[0]).toBe(1);
  });
  it("«¿Quién organizó la charla?» encuentra la lámina 1 primero (organizó ↔ organizada)", async () => {
    expect((await numeros("¿Quién organizó la charla?"))[0]).toBe(1);
  });
  // Evals del 2026-09-25 (L07, L12): el fragmento era un snippet de 32 palabras
  // y cortaba la lista de la lámina («Memoria», «Condiciones de operación»…).
  it("devuelve el contenido y las notas completos de la lámina, no un recorte", async () => {
    const [r] = await repo.buscar("factores arquitectura", 1);
    expect(r.lamina).toBe(18);
    expect(r.fragmento).toContain("Memoria");
    expect(r.fragmento).toContain("Privacidad y gobernanza");
    expect(r.fragmento).not.toContain("…");
    expect(r.notas).toContain("condiciones de operación");
  });
  it("mantiene las búsquedas exactas: router → 25, loop agéntico → 10, harness incluye 11 en el top 3", async () => {
    expect((await numeros("router"))[0]).toBe(25);
    expect((await numeros("loop agéntico"))[0]).toBe(10);
    expect((await numeros("harness")).slice(0, 3)).toContain(11);
  });
});

describe("consultasBusqueda", () => {
  it("AND exacto, luego AND con prefijos sin palabras vacías, luego el OR exacto de siempre", () => {
    expect(consultasBusqueda("¿Quién patrocinó la charla?")).toEqual([
      '"quién" "patrocinó" "la" "charla"',
      '"patroc"* "charla"',
      '"quién" OR "patrocinó" OR "la" OR "charla"',
    ]);
  });
  it("sin variantes repetidas: una palabra corta da una sola consulta", () => {
    expect(consultasBusqueda("router")).toEqual(['"router"']);
    expect(consultasBusqueda("harness")).toEqual(['"harness"', '"harne"*']);
    expect(consultasBusqueda("patrocinada")).toEqual(['"patrocinada"', '"patrocin"*']);
  });
  it("si todo son palabras vacías, usa todas", () => {
    expect(consultasBusqueda("¿qué es?")).toEqual(['"qué" "es"', '"qué" OR "es"']);
  });
});
