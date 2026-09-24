import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it } from "vitest";
import { MODELO_PRINCIPAL, MODELO_RESPALDO } from "../modelos";
import { FallbackModelo } from "../processors/fallback-modelo";
import { GuardiaEntrada, ID_GUARDIA_ENTRADA } from "../processors/guardia-entrada";
import { RespuestaFinal } from "../processors/respuesta-final";
import { SinDatosPersonales } from "../processors/sin-datos-personales";
import { mastra } from "../index";
import { charla } from "./charla";
import { VERSION_INSTRUCCIONES } from "./instructions";

describe("agente charla", () => {
  it("identidad y registro en Mastra", () => {
    expect(charla.id).toBe("charla");
    expect(charla.name).toBe("Asistente de la charla");
    expect(mastra.getAgent("charla").id).toBe("charla");
  });

  it("modelo principal con respaldo", async () => {
    const lista = await charla.getModelList();
    expect(lista?.map((m) => ({ id: m.id, maxRetries: m.maxRetries }))).toEqual([
      { id: "principal", maxRetries: 1 },
      { id: "respaldo", maxRetries: 0 },
    ]);
    const modelos = await Promise.all(lista!.map(async (m) => {
      const r = m.model as { provider: string; modelId: string };
      return `${r.provider}/${r.modelId}`;
    }));
    expect(modelos).toEqual([MODELO_PRINCIPAL, MODELO_RESPALDO]);
  });

  it("herramientas buscar_laminas y escalar_pregunta", async () => {
    const tools = await charla.listTools();
    expect(Object.keys(tools).sort()).toEqual(["buscar_laminas", "escalar_pregunta"]);
  });

  it("instrucciones dinámicas desde el requestContext", async () => {
    const sinPerfil = await charla.getInstructions({ requestContext: new RequestContext() });
    expect(String(sinPerfil)).not.toContain("<perfil_asistente");
    const rc = new RequestContext();
    rc.set("rol", "Contadora");
    rc.set("lamina_actual", "11");
    const conPerfil = String(await charla.getInstructions({ requestContext: rc }));
    expect(conPerfil).toContain("A qué se dedica: Contadora");
    expect(conPerfil).toContain("Lámina actual aproximada: 11.");
  });

  it("memoria con los últimos 20 mensajes", async () => {
    const memoria = await charla.getMemory();
    expect(memoria).toBeDefined();
    expect(memoria!.getMergedThreadConfig().lastMessages).toBe(20);
  });

  it("opciones por defecto: 5 pasos y versión de instrucciones en la traza", async () => {
    const opciones = await charla.getDefaultOptions();
    expect(opciones.maxSteps).toBe(5);
    expect(opciones.tracingOptions?.metadata).toMatchObject({ version_instrucciones: VERSION_INSTRUCCIONES });
  });

  it("procesadores de entrada: fallback y respuesta final (5 pasos)", async () => {
    const procesadores = await charla.listConfiguredInputProcessors();
    const ids = procesadores.map((p) => p.id);
    expect(ids).toContain("fallback-modelo");
    expect(ids).toContain("respuesta-final");
    const rf = procesadores.find((p) => p.id === "respuesta-final") as RespuestaFinal;
    expect(rf.maxSteps).toBe(5);
    expect(procesadores.some((p) => p instanceof FallbackModelo)).toBe(true);
  });

  it("guardrails: GuardiaEntrada (inyección ∥ alcance, en paralelo con el agente) primero en entrada y salida; luego sin datos personales", async () => {
    const entrada = await charla.listConfiguredInputProcessors();
    expect(entrada.map((p) => p.id)).toEqual([ID_GUARDIA_ENTRADA, "fallback-modelo", "respuesta-final"]);
    const salida = await charla.listConfiguredOutputProcessors();
    expect(salida.map((p) => p.id)).toEqual([ID_GUARDIA_ENTRADA, "sin-datos-personales"]);
    expect(entrada[0]).toBeInstanceOf(GuardiaEntrada);
    expect(salida[0]).toBe(entrada[0]);
    expect(salida[1]).toBeInstanceOf(SinDatosPersonales);
  });
});
