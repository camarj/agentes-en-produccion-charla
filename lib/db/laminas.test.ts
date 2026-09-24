import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearLaminas } from "./laminas";
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
