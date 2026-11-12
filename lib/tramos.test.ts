import { describe, expect, it } from "vitest";
import { LAMINA_MAX, LAMINA_MIN } from "@/lib/panel/tipos";
import { TRAMOS, TRAMOS_POR_PRESENTACION, etiquetaTramo, presentacionActiva, tramoDeLamina, type Tramo } from "./tramos";

// Reglas de armado que valen para cualquier presentación.
function bienArmados(tramos: readonly Tramo[], total: number) {
  expect(tramos[0].desde).toBe(1);
  expect(tramos.at(-1)!.hasta).toBe(total);
  for (let i = 1; i < tramos.length; i++) expect(tramos[i].desde).toBe(tramos[i - 1].hasta + 1);
  for (const t of tramos) {
    expect(t.preguntas).toHaveLength(3);
    expect(t.desde).toBeLessThanOrEqual(t.hasta);
  }
  expect(new Set(tramos.map((t) => t.id)).size).toBe(tramos.length);
}

describe("TRAMOS_POR_PRESENTACION", () => {
  it("ESPOL (2026-11-25, 26 láminas): conceptos 1–11, decisión y diseño 12–19, producción 20–26", () => {
    const t = TRAMOS_POR_PRESENTACION.espol;
    expect(t.map((x) => [x.desde, x.hasta, x.nombre])).toEqual([
      [1, 11, "Conceptos"],
      [12, 19, "Decisión y diseño"],
      [20, 26, "En producción"],
    ]);
    bienArmados(t, 26);
  });

  it("DevFest (2026-12-05, 25 láminas): conceptos 1–8, decisión y diseño 9–17, producción 18–25", () => {
    const t = TRAMOS_POR_PRESENTACION.devfest;
    expect(t.map((x) => [x.desde, x.hasta, x.nombre])).toEqual([
      [1, 8, "Conceptos"],
      [9, 17, "Decisión y diseño"],
      [18, 25, "En producción"],
    ]);
    bienArmados(t, 25);
  });

  it("ninguna pregunta sugerida es sobre chatbots (las láminas no los comparan)", () => {
    for (const tramos of Object.values(TRAMOS_POR_PRESENTACION)) {
      for (const t of tramos) for (const p of t.preguntas) expect(p).not.toMatch(/chatbot/i);
    }
  });

  it("DevFest no tiene la lámina «Qué es un patrón agéntico»: su pregunta de patrones no pide la definición", () => {
    const preguntas = TRAMOS_POR_PRESENTACION.devfest.flatMap((t) => t.preguntas);
    expect(preguntas).toContain("¿Qué patrones de agentes se mostraron en la charla?");
    expect(preguntas.some((p) => /qué es un patrón/i.test(p))).toBe(false);
  });
});

describe("presentacionActiva", () => {
  it("ESPOL por defecto; «devfest» elige DevFest; cualquier otro valor cae en ESPOL", () => {
    expect(presentacionActiva(undefined)).toBe("espol");
    expect(presentacionActiva("devfest")).toBe("devfest");
    expect(presentacionActiva(" DevFest ")).toBe("devfest");
    expect(presentacionActiva("espol")).toBe("espol");
    expect(presentacionActiva("otra")).toBe("espol");
  });

  it("sin NEXT_PUBLIC_PRESENTACION, TRAMOS son los de ESPOL y el panel llega hasta la 26", () => {
    expect(TRAMOS).toBe(TRAMOS_POR_PRESENTACION.espol);
    expect(LAMINA_MIN).toBe(1);
    expect(LAMINA_MAX).toBe(26);
  });
});

describe("tramoDeLamina", () => {
  it("cada lámina cae en su tramo (bordes incluidos)", () => {
    expect(tramoDeLamina(1)).toBe(TRAMOS[0]);
    expect(tramoDeLamina(11)).toBe(TRAMOS[0]);
    expect(tramoDeLamina(12)).toBe(TRAMOS[1]);
    expect(tramoDeLamina(19)).toBe(TRAMOS[1]);
    expect(tramoDeLamina(20)).toBe(TRAMOS[2]);
    expect(tramoDeLamina(26)).toBe(TRAMOS[2]);
  });

  it("acepta texto (así se guarda) y lleva lo inválido o fuera de rango al tramo más cercano", () => {
    expect(tramoDeLamina("15")).toBe(TRAMOS[1]);
    expect(tramoDeLamina("45")).toBe(TRAMOS[2]);
    expect(tramoDeLamina(0)).toBe(TRAMOS[0]);
    expect(tramoDeLamina("abc")).toBe(TRAMOS[0]);
    expect(tramoDeLamina(null)).toBe(TRAMOS[0]);
  });

  it("con otra lista de tramos (DevFest) usa esa lista", () => {
    const d = TRAMOS_POR_PRESENTACION.devfest;
    expect(tramoDeLamina(8, d)).toBe(d[0]);
    expect(tramoDeLamina(9, d)).toBe(d[1]);
    expect(tramoDeLamina(18, d)).toBe(d[2]);
  });
});

describe("etiquetaTramo", () => {
  it("«Láminas 1–11 · Conceptos»", () => {
    expect(etiquetaTramo(TRAMOS[0])).toBe("Láminas 1–11 · Conceptos");
    expect(etiquetaTramo(TRAMOS[2])).toBe("Láminas 20–26 · En producción");
  });
});
