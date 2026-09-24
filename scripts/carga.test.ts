import { describe, expect, it } from "vitest";
import { analizarTrozo, emailPrueba, percentil } from "./carga";

describe("carga", () => {
  it("calcula percentiles por rango más cercano", () => {
    expect(percentil([], 95)).toBeNull();
    expect(percentil([3, 1, 2, 4], 50)).toBe(2);
    expect(percentil(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
    expect(percentil([7], 95)).toBe(7);
  });

  it("detecta texto y errores en el stream de AI SDK UI", () => {
    expect(analizarTrozo('data: {"type":"start"}\n\ndata: {"type":"text-delta","id":"1","delta":"Hola"}')).toEqual({
      texto: true,
      error: false,
    });
    expect(analizarTrozo('data: {"type":"error","errorText":"x"}')).toEqual({ texto: false, error: true });
  });

  it("usa emails de prueba reconocibles", () => {
    expect(emailPrueba(7)).toBe("carga+7@carga.example.com");
  });
});
