import { describe, expect, it } from "vitest";
import { LAMINA_MAX, LAMINA_MIN } from "@/lib/panel/tipos";
import { TRAMOS, etiquetaTramo, tramoDeLamina } from "./tramos";

describe("TRAMOS", () => {
  it("son 3 tramos contiguos que cubren todas las láminas, con 3 preguntas cada uno", () => {
    expect(TRAMOS.map((t) => [t.desde, t.hasta, t.nombre])).toEqual([
      [1, 13, "Conceptos"],
      [14, 31, "Decisión y diseño"],
      [32, 39, "En producción"],
    ]);
    expect(TRAMOS[0].desde).toBe(LAMINA_MIN);
    expect(TRAMOS.at(-1)!.hasta).toBe(LAMINA_MAX);
    for (let i = 1; i < TRAMOS.length; i++) expect(TRAMOS[i].desde).toBe(TRAMOS[i - 1].hasta + 1);
    for (const t of TRAMOS) {
      expect(t.preguntas).toHaveLength(3);
      expect(t.desde).toBeLessThanOrEqual(t.hasta);
    }
    expect(new Set(TRAMOS.map((t) => t.id)).size).toBe(TRAMOS.length);
  });
});

describe("tramoDeLamina", () => {
  it("cada lámina cae en su tramo (bordes incluidos)", () => {
    expect(tramoDeLamina(1)).toBe(TRAMOS[0]);
    expect(tramoDeLamina(13)).toBe(TRAMOS[0]);
    expect(tramoDeLamina(14)).toBe(TRAMOS[1]);
    expect(tramoDeLamina(31)).toBe(TRAMOS[1]);
    expect(tramoDeLamina(32)).toBe(TRAMOS[2]);
    expect(tramoDeLamina(39)).toBe(TRAMOS[2]);
  });

  it("acepta texto (así se guarda) y lleva lo inválido o fuera de rango al tramo más cercano", () => {
    expect(tramoDeLamina("20")).toBe(TRAMOS[1]);
    expect(tramoDeLamina("45")).toBe(TRAMOS[2]);
    expect(tramoDeLamina(0)).toBe(TRAMOS[0]);
    expect(tramoDeLamina("abc")).toBe(TRAMOS[0]);
    expect(tramoDeLamina(null)).toBe(TRAMOS[0]);
  });
});

describe("etiquetaTramo", () => {
  it("«Láminas 1–13 · Conceptos»", () => {
    expect(etiquetaTramo(TRAMOS[0])).toBe("Láminas 1–13 · Conceptos");
    expect(etiquetaTramo(TRAMOS[2])).toBe("Láminas 32–39 · En producción");
  });
});
