import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { APICallError } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crearSenales } from "@/lib/salud/senales";
import { MODELO_PRINCIPAL, MODELO_RESPALDO } from "../modelos";
import {
  FallbackModelo,
  crearErrorSobrecarga,
  crearModeloCaido,
  esErrorDeSobrecarga,
  modelosConRespaldo,
} from "./fallback-modelo";
import { modeloFalso } from "./pruebas-modelo";

function interruptores(modelo_caido: string, modelos_caidos = "off") {
  return { obtenerTodos: vi.fn().mockResolvedValue({ modelo_caido, modelos_caidos }) };
}

function modelo(id: string) {
  const [provider, modelId] = id.split("/");
  return { provider, modelId };
}

function spanFalso() {
  const agentRun = { update: vi.fn() };
  const generation = { update: vi.fn() };
  const span = {
    update: vi.fn(),
    findParent: vi.fn((tipo: string) =>
      tipo === "agent_run" ? agentRun : tipo === "model_generation" ? generation : undefined,
    ),
  };
  return { span, agentRun, generation };
}

describe("esErrorDeSobrecarga", () => {
  const api = (statusCode: number, responseBody?: string) =>
    new APICallError({ message: "x", url: "u", requestBodyValues: {}, statusCode, responseBody });

  it("reconoce 5xx, 529 y 429 (APICallError de Anthropic u OpenAI)", () => {
    expect(esErrorDeSobrecarga(api(500))).toBe(true);
    expect(esErrorDeSobrecarga(api(503))).toBe(true);
    expect(esErrorDeSobrecarga(api(529))).toBe(true);
    expect(esErrorDeSobrecarga(api(429))).toBe(true);
  });

  it("reconoce la sobrecarga de Anthropic por tipo o mensaje, también en la causa", () => {
    expect(esErrorDeSobrecarga(new Error("Overloaded"))).toBe(true);
    expect(esErrorDeSobrecarga({ type: "overloaded_error" })).toBe(true);
    expect(esErrorDeSobrecarga({ error: { type: "overloaded_error" } })).toBe(true);
    expect(esErrorDeSobrecarga(new Error("envoltura", { cause: api(529) }))).toBe(true);
    expect(esErrorDeSobrecarga(api(200, '{"type":"error","error":{"type":"overloaded_error"}}'))).toBe(true);
  });

  it("reconoce las formas de error de OpenAI: server_error y rate_limit_exceeded", () => {
    expect(esErrorDeSobrecarga({ error: { type: "server_error", code: null } })).toBe(true);
    expect(esErrorDeSobrecarga({ type: "server_error" })).toBe(true);
    expect(esErrorDeSobrecarga({ code: "rate_limit_exceeded" })).toBe(true);
    expect(esErrorDeSobrecarga({ error: { code: "rate_limit_exceeded", type: "requests" } })).toBe(true);
    expect(
      esErrorDeSobrecarga(api(200, '{"error":{"message":"The server had an error","type":"server_error","code":null}}')),
    ).toBe(true);
    expect(esErrorDeSobrecarga(api(200, '{"error":{"type":"tokens","code":"rate_limit_exceeded"}}'))).toBe(true);
    expect(esErrorDeSobrecarga(new Error("envoltura", { cause: api(503) }))).toBe(true);
  });

  it("no confunde errores del cliente ni valores vacíos", () => {
    expect(esErrorDeSobrecarga(api(400))).toBe(false);
    expect(esErrorDeSobrecarga(api(401))).toBe(false);
    expect(esErrorDeSobrecarga(api(404, '{"error":{"type":"invalid_request_error","code":"model_not_found"}}'))).toBe(false);
    expect(esErrorDeSobrecarga({ error: { type: "invalid_request_error" } })).toBe(false);
    expect(esErrorDeSobrecarga(new Error("Invalid request"))).toBe(false);
    expect(esErrorDeSobrecarga(undefined)).toBe(false);
    expect(esErrorDeSobrecarga("texto")).toBe(false);
  });
});

describe("crearErrorSobrecarga / crearModeloCaido", () => {
  it("el principal es Gemini en Vertex y su error simulado es un 503 UNAVAILABLE reintentable", () => {
    expect(MODELO_PRINCIPAL).toBe("google-vertex/gemini-3.8-flash");
    const e = crearErrorSobrecarga(MODELO_PRINCIPAL);
    expect(APICallError.isInstance(e)).toBe(true);
    expect(e.statusCode).toBe(503);
    expect(e.isRetryable).toBe(true);
    expect(JSON.parse(e.responseBody ?? "{}")).toMatchObject({ error: { code: 503, status: "UNAVAILABLE" } });
    expect(esErrorDeSobrecarga(e)).toBe(true);
  });

  it("el respaldo es de OpenAI y su error simulado es un 503 server_error reintentable", () => {
    expect(MODELO_RESPALDO).toBe("openai/gpt-6-luna");
    const e = crearErrorSobrecarga(MODELO_RESPALDO);
    expect(e.statusCode).toBe(503);
    expect(JSON.parse(e.responseBody ?? "{}")).toMatchObject({ error: { type: "server_error" } });
    expect(esErrorDeSobrecarga(e)).toBe(true);
  });

  it("para un modelo de Anthropic el error simulado sigue siendo un 529 overloaded_error reintentable", () => {
    const e = crearErrorSobrecarga("anthropic/claude-sonnet-5");
    expect(e.statusCode).toBe(529);
    expect(e.isRetryable).toBe(true);
    expect(e.responseBody).toContain("overloaded_error");
  });

  it("el modelo caído conserva el id y falla antes de llamar al proveedor", async () => {
    const m = crearModeloCaido(MODELO_PRINCIPAL);
    expect(m.specificationVersion).toBe("v2");
    expect(`${m.provider}/${m.modelId}`).toBe(MODELO_PRINCIPAL);
    await expect(m.doStream()).rejects.toSatisfy(esErrorDeSobrecarga);
    await expect(m.doGenerate()).rejects.toSatisfy(esErrorDeSobrecarga);
  });
});

describe("modelosConRespaldo", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("crear la cadena no exige credenciales de Vertex (la app arranca sin ellas)", () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    vi.stubEnv("GOOGLE_VERTEX_API_KEY", "");
    expect(() => modelosConRespaldo()).not.toThrow();
  });

  it("principal Gemini 3.8 Flash en Vertex (razonamiento bajo, 1 reintento) y respaldo OpenAI sin reintentos", () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "proyecto-prueba");
    const [principal, respaldo] = modelosConRespaldo();
    expect(principal).toMatchObject({
      id: "principal",
      maxRetries: 1,
      providerOptions: { vertex: { thinkingConfig: { thinkingLevel: "low" } } },
    });
    const modelo = (principal.model as unknown as () => { provider: string; modelId: string })();
    expect(modelo.provider).toMatch(/^google\.vertex/);
    expect(modelo.modelId).toBe("gemini-3.8-flash");
    expect(respaldo).toEqual({
      id: "respaldo",
      model: MODELO_RESPALDO,
      maxRetries: 0,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
  });

  it("el modelo real de Vertex se reconoce como el principal (modelo caído aplica)", async () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "proyecto-prueba");
    const p = new FallbackModelo({ interruptores: interruptores("on") });
    const { span } = spanFalso();
    const real = (modelosConRespaldo()[0].model as unknown as () => unknown)();
    const r = await p.processInputStep({ model: real, tracingContext: { currentSpan: span } } as never);
    expect(r).toBeDefined();
    expect(span.update).toHaveBeenCalledWith({ metadata: { modelo_caido_simulado: true } });
  });
});

describe("FallbackModelo.processInputStep (unidad)", () => {
  it("modelo principal con interruptor apagado: no cambia nada", async () => {
    const p = new FallbackModelo({ interruptores: interruptores("off") });
    const { span } = spanFalso();
    const r = await p.processInputStep({ model: modelo(MODELO_PRINCIPAL), tracingContext: { currentSpan: span } } as never);
    expect(r).toBeUndefined();
    expect(span.update).not.toHaveBeenCalled();
  });

  it("modelo principal con modelo_caido=on: lo reemplaza por uno que falla", async () => {
    const p = new FallbackModelo({ interruptores: interruptores("on") });
    const { span } = spanFalso();
    const r = await p.processInputStep({ model: modelo(MODELO_PRINCIPAL), tracingContext: { currentSpan: span } } as never);
    const reemplazo = (r as { model: ReturnType<typeof crearModeloCaido> }).model;
    expect(`${reemplazo.provider}/${reemplazo.modelId}`).toBe(MODELO_PRINCIPAL);
    await expect(reemplazo.doStream()).rejects.toSatisfy(esErrorDeSobrecarga);
    expect(span.update).toHaveBeenCalledWith({ metadata: { modelo_caido_simulado: true } });
  });

  it("modelo de respaldo: marca modelo_respaldo=true en los spans del agente y del modelo", async () => {
    const i = interruptores("on");
    const p = new FallbackModelo({ interruptores: i });
    const { span, agentRun, generation } = spanFalso();
    const r = await p.processInputStep({ model: modelo(MODELO_RESPALDO), tracingContext: { currentSpan: span } } as never);
    expect(r).toBeUndefined();
    const marca = { metadata: { modelo_respaldo: true, modelo_usado: MODELO_RESPALDO } };
    expect(span.update).toHaveBeenCalledWith(marca);
    expect(agentRun.update).toHaveBeenCalledWith(marca);
    expect(generation.update).toHaveBeenCalledWith(marca);
  });

  it("anota en las señales del turno que respondió el respaldo y si la caída fue simulada", async () => {
    const rc = new RequestContext();
    const senales = crearSenales(rc);
    await new FallbackModelo({ interruptores: interruptores("on") }).processInputStep({ model: modelo(MODELO_RESPALDO), requestContext: rc } as never);
    expect(senales.respaldo).toEqual({ modelo: MODELO_RESPALDO, causa: "sobrecarga" });

    const real = new RequestContext();
    const senalesReal = crearSenales(real);
    await new FallbackModelo({ interruptores: interruptores("off") }).processInputStep({ model: modelo(MODELO_RESPALDO), requestContext: real } as never);
    expect(senalesReal.respaldo).toEqual({ modelo: MODELO_RESPALDO, causa: null });
  });

  it("con modelos_caidos=on anota la caída simulada y no anota respaldo", async () => {
    const rc = new RequestContext();
    const senales = crearSenales(rc);
    await new FallbackModelo({ interruptores: interruptores("off", "on") }).processInputStep({ model: modelo(MODELO_RESPALDO), requestContext: rc } as never);
    expect(senales).toEqual({ modelosCaidosSimulado: true });
  });

  it("si no puede leer los interruptores, asume que están apagados", async () => {
    const p = new FallbackModelo({ interruptores: { obtenerTodos: vi.fn().mockRejectedValue(new Error("db")) } });
    expect(await p.processInputStep({ model: modelo(MODELO_PRINCIPAL) } as never)).toBeUndefined();
  });
});

describe("FallbackModelo · modelos_caidos (fallan el principal y el respaldo)", () => {
  it("reemplaza el principal por uno que falla", async () => {
    const p = new FallbackModelo({ interruptores: interruptores("off", "on") });
    const { span } = spanFalso();
    const r = await p.processInputStep({ model: modelo(MODELO_PRINCIPAL), tracingContext: { currentSpan: span } } as never);
    const reemplazo = (r as { model: ReturnType<typeof crearModeloCaido> }).model;
    expect(`${reemplazo.provider}/${reemplazo.modelId}`).toBe(MODELO_PRINCIPAL);
    await expect(reemplazo.doStream()).rejects.toSatisfy(esErrorDeSobrecarga);
  });

  it("reemplaza también el respaldo y no lo marca como respuesta del respaldo", async () => {
    const p = new FallbackModelo({ interruptores: interruptores("off", "on") });
    const { span, agentRun } = spanFalso();
    const r = await p.processInputStep({ model: modelo(MODELO_RESPALDO), tracingContext: { currentSpan: span } } as never);
    const reemplazo = (r as { model: ReturnType<typeof crearModeloCaido> }).model;
    expect(`${reemplazo.provider}/${reemplazo.modelId}`).toBe(MODELO_RESPALDO);
    await expect(reemplazo.doGenerate()).rejects.toSatisfy(esErrorDeSobrecarga);
    expect(span.update).toHaveBeenCalledWith({ metadata: { modelos_caidos_simulado: true } });
    expect(agentRun.update).not.toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ modelo_respaldo: true }) }));
  });

  it("con un agente real: ningún proveedor recibe la petición y el error llega a quien llama", async () => {
    const principal = modeloFalso(MODELO_PRINCIPAL, () => ({ texto: "desde el principal" }));
    const respaldo = modeloFalso(MODELO_RESPALDO, () => ({ texto: "desde el respaldo" }));
    const a = new Agent({
      id: "prueba-modelos-caidos",
      name: "prueba-modelos-caidos",
      instructions: "x",
      model: [
        { id: "principal", model: principal.modelo as never, maxRetries: 1 },
        { id: "respaldo", model: respaldo.modelo as never, maxRetries: 0 },
      ],
      inputProcessors: [new FallbackModelo({ interruptores: interruptores("off", "on") })],
    });
    await expect(a.generate("hola")).rejects.toBeTruthy();
    expect(principal.llamadas.length).toBe(0);
    expect(respaldo.llamadas.length).toBe(0);
  }, 15_000);
});

describe("FallbackModelo con un agente real (fallback nativo de Mastra)", () => {
  function agente(estado: string, principalFalla = false) {
    const principal = modeloFalso(MODELO_PRINCIPAL, () => {
      if (principalFalla) throw crearErrorSobrecarga(MODELO_PRINCIPAL);
      return { texto: "desde el principal" };
    });
    const respaldo = modeloFalso(MODELO_RESPALDO, () => ({ texto: "desde el respaldo" }));
    const a = new Agent({
      id: "prueba-fallback",
      name: "prueba-fallback",
      instructions: "x",
      model: [
        { id: "principal", model: principal.modelo as never, maxRetries: 1 },
        { id: "respaldo", model: respaldo.modelo as never, maxRetries: 0 },
      ],
      inputProcessors: [new FallbackModelo({ interruptores: interruptores(estado) })],
    });
    return { a, principal, respaldo };
  }

  it("con el interruptor apagado responde el principal", async () => {
    const { a, principal, respaldo } = agente("off");
    const r = await a.generate("hola");
    expect(r.text).toBe("desde el principal");
    expect(principal.llamadas.length).toBe(1);
    expect(respaldo.llamadas.length).toBe(0);
  });

  it("con modelo_caido=on nunca llama al principal y responde el respaldo", async () => {
    const { a, principal, respaldo } = agente("on");
    const r = await a.generate("hola");
    expect(r.text).toBe("desde el respaldo");
    expect(principal.llamadas.length).toBe(0);
    expect(respaldo.llamadas.length).toBe(1);
  }, 15_000);

  it("con modelo_caido=on también funciona en stream (el camino de la ruta de chat)", async () => {
    const { a, principal } = agente("on");
    const s = await a.stream("hola");
    expect(await s.text).toBe("desde el respaldo");
    expect(principal.llamadas.length).toBe(0);
  }, 15_000);

  it("un 503 del principal se reintenta 1 vez y luego pasa al respaldo", async () => {
    const { a, principal, respaldo } = agente("off", true);
    const r = await a.generate("hola");
    expect(principal.llamadas.length).toBe(2);
    expect(respaldo.llamadas.length).toBe(1);
    expect(r.text).toBe("desde el respaldo");
  }, 15_000);
});

// Nivel HTTP: proveedores reales (Vertex del AI SDK y model router de Mastra)
// con fetch simulado (sin red ni clave real). Gemini (principal) usa
// generateContent de Vertex en modo express; OpenAI (respaldo) la Responses API.
describe("FallbackModelo con proveedores reales y HTTP simulado", () => {
  const llamadas: string[] = [];
  const cuerpos: Array<Record<string, unknown>> = [];

  function json(cuerpo: unknown, status = 200) {
    return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
  }

  function respuestaGemini(texto: string) {
    return json({
      candidates: [{ content: { role: "model", parts: [{ text: texto }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
  }

  function respuestaOpenAI(modelo: string, texto: string) {
    return json({
      id: "resp_prueba",
      object: "response",
      created_at: 1,
      status: "completed",
      model: modelo,
      output: [
        {
          type: "message",
          id: "msg_prueba",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: texto, annotations: [] }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
  }

  // Sobrecarga de Vertex: 503 UNAVAILABLE.
  function sobrecargaGemini() {
    return json({ error: { code: 503, message: "The model is overloaded.", status: "UNAVAILABLE" } }, 503);
  }

  function agenteHttp(estado: string, principalCaido: boolean) {
    llamadas.length = 0;
    cuerpos.length = 0;
    vi.stubEnv("GOOGLE_VERTEX_API_KEY", "clave-prueba");
    vi.stubEnv("OPENAI_API_KEY", "sk-prueba");
    vi.stubGlobal("fetch", async (url: unknown, init: { body: string }) => {
      const cuerpo = JSON.parse(init.body) as { model?: string };
      cuerpos.push(cuerpo);
      if (String(url).includes("gemini-3.8-flash")) {
        llamadas.push("gemini-3.8-flash");
        return principalCaido ? sobrecargaGemini() : respuestaGemini("gemini");
      }
      llamadas.push(cuerpo.model ?? "?");
      return respuestaOpenAI(cuerpo.model ?? "?", "openai");
    });
    return new Agent({
      id: "prueba-http",
      name: "prueba-http",
      instructions: "x",
      model: modelosConRespaldo(),
      inputProcessors: [new FallbackModelo({ interruptores: interruptores(estado) })],
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("503 de Gemini: 1 reintento con gemini-3.8-flash y luego gpt-6-luna", async () => {
    const r = await agenteHttp("off", true).generate("hola");
    expect(llamadas).toEqual(["gemini-3.8-flash", "gemini-3.8-flash", "gpt-6-luna"]);
    expect(r.text).toBe("openai");
  }, 15_000);

  it("modelo_caido=on: Gemini nunca recibe la petición y responde gpt-6-luna con razonamiento bajo", async () => {
    const r = await agenteHttp("on", false).generate("hola");
    expect(llamadas).toEqual(["gpt-6-luna"]);
    expect(r.text).toBe("openai");
    expect(cuerpos[0]).toMatchObject({ reasoning: { effort: "low" } });
  }, 15_000);

  it("sin fallas responde gemini-3.8-flash en un solo intento, con razonamiento bajo", async () => {
    const r = await agenteHttp("off", false).generate("hola");
    expect(llamadas).toEqual(["gemini-3.8-flash"]);
    expect(r.text).toBe("gemini");
    expect(cuerpos[0]).toMatchObject({ generationConfig: { thinkingConfig: { thinkingLevel: "low" } } });
  });
});
