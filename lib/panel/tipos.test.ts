import { describe, expect, it } from "vitest";
import { acotarLamina, laminaValida } from "./tipos";

describe("laminaValida (1–40)", () => {
  it.each([
    [1, 1],
    [40, 40],
    ["7", 7],
    [" 12 ", 12],
  ])("%j → %j", (entrada, salida) => expect(laminaValida(entrada)).toBe(salida));
  it.each([0, 41, -3, 2.5, "", "1e1", "12a", null, undefined, Number.NaN, true])("%j → null", (entrada) =>
    expect(laminaValida(entrada)).toBeNull(),
  );
});

describe("acotarLamina", () => {
  it("lleva el número al rango", () => {
    expect(acotarLamina(0)).toBe(1);
    expect(acotarLamina(-5)).toBe(1);
    expect(acotarLamina(41)).toBe(40);
    expect(acotarLamina(12.6)).toBe(13);
    expect(acotarLamina(Number.NaN)).toBe(1);
  });
});
