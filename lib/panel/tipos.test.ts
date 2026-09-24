import { describe, expect, it } from "vitest";
import { acotarLamina, laminaValida } from "./tipos";

describe("laminaValida (1–39)", () => {
  it.each([
    [1, 1],
    [39, 39],
    ["7", 7],
    [" 12 ", 12],
  ])("%j → %j", (entrada, salida) => expect(laminaValida(entrada)).toBe(salida));
  it.each([0, 40, -3, 2.5, "", "1e1", "12a", null, undefined, Number.NaN, true])("%j → null", (entrada) =>
    expect(laminaValida(entrada)).toBeNull(),
  );
});

describe("acotarLamina", () => {
  it("lleva el número al rango", () => {
    expect(acotarLamina(0)).toBe(1);
    expect(acotarLamina(-5)).toBe(1);
    expect(acotarLamina(40)).toBe(39);
    expect(acotarLamina(12.6)).toBe(13);
    expect(acotarLamina(Number.NaN)).toBe(1);
  });
});
