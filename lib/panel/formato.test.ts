import { describe, expect, it } from "vitest";
import {
  desgloseFallas,
  etiquetaMotivoBloqueo,
  etiquetaMotivoEscalamiento,
  etiquetaRol,
  horaCorta,
  latencia,
  modeloActual,
  respaldoUltimaHora,
  ultimaRespuesta,
  usd,
} from "./formato";

describe("formato del panel", () => {
  it("latencia en segundos con coma decimal; null → —", () => {
    expect(latencia(2900)).toBe("2,9 s");
    expect(latencia(12345)).toBe("12,3 s");
    expect(latencia(40)).toBe("0,0 s");
    expect(latencia(null)).toBe("—");
  });
  it("usd: 2 decimales desde 1 USD, 3 por debajo", () => {
    expect(usd(0)).toBe("$0,000");
    expect(usd(0.0345)).toBe("$0,035");
    expect(usd(10)).toBe("$10,00");
    expect(usd(1.5)).toBe("$1,50");
  });
  it("hora corta en 24 h (zona fija para el test)", () => {
    expect(horaCorta("2026-09-26T18:10:00Z", "UTC")).toBe("18:10");
    expect(horaCorta("2026-09-26T23:05:00Z", "America/Guayaquil")).toBe("18:05");
    expect(horaCorta(null)).toBe("—");
    expect(horaCorta("no es fecha")).toBe("—");
  });
  it("etiquetas en español; desconocidas se muestran legibles", () => {
    expect(etiquetaMotivoEscalamiento("falla_tecnica")).toBe("Falla técnica");
    expect(etiquetaMotivoEscalamiento("fuera_de_charla")).toBe("Fuera de la charla");
    expect(etiquetaMotivoBloqueo("fuera_de_alcance")).toBe("Fuera de alcance");
    expect(etiquetaMotivoBloqueo("inyeccion")).toBe("Inyección");
    expect(etiquetaMotivoBloqueo("datos_personales")).toBe("Datos personales");
    expect(etiquetaMotivoBloqueo("algo_nuevo")).toBe("algo nuevo");
    expect(etiquetaRol("educacion")).toBe("Educación");
    expect(etiquetaRol("tecnico")).toBe("Técnico");
  });
});

describe("desgloseFallas", () => {
  it("orden fijo: herramienta, modelo, tiempo agotado, otro; omite ceros", () => {
    expect(desgloseFallas({ modelo: 1, tiempo: 2, herramienta: 1 })).toBe("1 herramienta · 1 modelo · 2 tiempo agotado");
    expect(desgloseFallas({ otro: 3, herramienta: 0 })).toBe("3 otro");
  });
  it("sin fallas → null", () => {
    expect(desgloseFallas({})).toBeNull();
  });
});

describe("modelo en uso (tarjeta del panel)", () => {
  const apagados = { modelo_caido: "off", modelos_caidos: "off" } as const;

  it("el valor grande sale de los interruptores: el modelo que va a responder ahora", () => {
    expect(modeloActual(apagados)).toEqual({ texto: "gpt-6-luna", estado: "principal" });
    expect(modeloActual({ ...apagados, modelo_caido: "on" })).toEqual({ texto: "claude-sonnet-5 · respaldo", estado: "respaldo" });
    // «Modelos caídos» manda aunque «Modelo caído» también esté encendido.
    expect(modeloActual({ modelo_caido: "on", modelos_caidos: "on" })).toEqual({ texto: "Sin modelo · falla técnica", estado: "sin_modelo" });
    expect(modeloActual({ ...apagados, modelos_caidos: "on" }).estado).toBe("sin_modelo");
  });

  it("sin interruptores cargados: «—»", () => {
    expect(modeloActual(null)).toEqual({ texto: "—", estado: null });
  });

  it("«última respuesta: <modelo> a las HH:MM», o «—» si no hay dato", () => {
    const en = "2026-09-26T23:05:00Z";
    expect(ultimaRespuesta({ estado: "principal", modelo: "openai/gpt-6-luna", en }, "America/Guayaquil")).toBe("última respuesta: gpt-6-luna a las 18:05");
    expect(ultimaRespuesta({ estado: "respaldo", modelo: "anthropic/claude-sonnet-5", en }, "UTC")).toBe("última respuesta: claude-sonnet-5 a las 23:05");
    expect(ultimaRespuesta({ estado: "sin_modelo", modelo: null, en }, "UTC")).toBe("última respuesta: sin modelo a las 23:05");
    expect(ultimaRespuesta({ estado: "principal", modelo: null, en }, "UTC")).toBe("última respuesta: —");
    expect(ultimaRespuesta(null)).toBe("última respuesta: —");
  });

  it("«respaldo: N en la última hora»", () => {
    expect(respaldoUltimaHora(0)).toBe("respaldo: 0 en la última hora");
    expect(respaldoUltimaHora(3)).toBe("respaldo: 3 en la última hora");
  });
});
