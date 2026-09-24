import { describe, expect, it } from "vitest";
import { parsearArgumentos } from "./argumentos";

describe("parsearArgumentos", () => {
  it("valores por defecto: instrucciones actuales, todos los casos, ruta automática", () => {
    expect(parsearArgumentos([], "1.1.0")).toEqual({
      instrucciones: "1.1.0",
      casos: null,
      ruta: "auto",
      concurrencia: 6,
      sinGuardrailSalida: false,
      simularFuga: false,
      laminas: null,
      conservarTemp: false,
    });
  });

  it("acepta el separador de pnpm y las banderas de la prueba de fallo", () => {
    expect(
      parsearArgumentos(["--", "--instrucciones", "1.0.0", "--casos", "L01, s02", "--ruta", "omitir", "--concurrencia=3", "--sin-guardrail-salida", "--simular-fuga", "--conservar-temp"], "1.1.0"),
    ).toMatchObject({
      instrucciones: "1.0.0",
      casos: ["L01", "S02"],
      ruta: "omitir",
      concurrencia: 3,
      sinGuardrailSalida: true,
      simularFuga: true,
      conservarTemp: true,
    });
  });

  it("rechaza versiones de instrucciones o banderas desconocidas", () => {
    expect(() => parsearArgumentos(["--instrucciones", "9.9.9"], "1.1.0")).toThrow(/1\.0\.0/);
    expect(() => parsearArgumentos(["--nada"], "1.1.0")).toThrow(/--nada/);
    expect(() => parsearArgumentos(["--concurrencia", "0"], "1.1.0")).toThrow(/concurrencia/);
  });
});
