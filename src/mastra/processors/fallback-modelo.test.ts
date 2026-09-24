import { Agent } from "@mastra/core/agent";
import { APICallError } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("el principal es de OpenAI y su error simulado es un 503 server_error reintentable", () => {
    expect(MODELO_PRINCIPAL.startsWith("openai/")).toBe(true);
    const e = crearErrorSobrecarga(MODELO_PRINCIPAL);
    expect(APICallError.isInstance(e)).toBe(true);
    expect(e.statusCode).toBe(503);
    expect(e.isRetryable).toBe(true);
    expect(JSON.parse(e.responseBody ?? "{}")).toMatchObject({ error: { type: "server_error" } });
    expect(esErrorDeSobrecarga(e)).toBe(true);
  });

  it("para un modelo de Anthropic el error simulado es un 529 overloaded_error reintentable", () => {
    const e = crearErrorSobrecarga(MODELO_RESPALDO);
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
  it("principal OpenAI con 1 reintento y respaldo Anthropic sin reintentos", () => {
    expect(MODELO_PRINCIPAL).toBe("openai/gpt-6-luna");
    expect(MODELO_RESPALDO).toBe("anthropic/claude-sonnet-5");
    expect(modelosConRespaldo()).toEqual([
      {
        id: "principal",
        model: MODELO_PRINCIPAL,
        maxRetries: 1,
        // Razonamiento bajo en OpenAI: ~2x menos tiempo al primer token (medido en vivo).
        providerOptions: { openai: { reasoningEffort: "low" } },
      },
      { id: "respaldo", model: MODELO_RESPALDO, maxRetries: 0 },
    ]);
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

// Nivel HTTP: el model router real de Mastra con fetch simulado (sin red ni clave real).
// OpenAI (principal) usa la Responses API; Anthropic (respaldo) la Messages API.
describe("FallbackModelo con el model router real y HTTP simulado", () => {
  const llamadas: string[] = [];
  const cuerpos: Array<Record<string, unknown>> = [];

  function json(cuerpo: unknown, status = 200) {
    return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
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

  function respuestaAnthropic(modelo: string, texto: string) {
    return json({
      id: "msg_prueba",
      type: "message",
      role: "assistant",
      model: modelo,
      content: [{ type: "text", text: texto }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  }

  // Sobrecarga de OpenAI: 503 con `server_error`.
  function sobrecargaOpenAI() {
    return json({ error: { message: "The server is overloaded", type: "server_error", param: null, code: null } }, 503);
  }

  function agenteRouter(estado: string, principalCaido: boolean) {
    llamadas.length = 0;
    cuerpos.length = 0;
    vi.stubEnv("OPENAI_API_KEY", "sk-prueba");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-prueba");
    vi.stubGlobal("fetch", async (_url: unknown, init: { body: string }) => {
      const cuerpo = JSON.parse(init.body) as { model: string };
      const { model } = cuerpo;
      llamadas.push(model);
      cuerpos.push(cuerpo);
      if (model === "gpt-6-luna") return principalCaido ? sobrecargaOpenAI() : respuestaOpenAI(model, "openai");
      return respuestaAnthropic(model, "anthropic");
    });
    return new Agent({
      id: "prueba-router",
      name: "prueba-router",
      instructions: "x",
      model: modelosConRespaldo(),
      inputProcessors: [new FallbackModelo({ interruptores: interruptores(estado) })],
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("503 de OpenAI: 1 reintento con gpt-6-luna y luego claude-sonnet-5", async () => {
    const r = await agenteRouter("off", true).generate("hola");
    expect(llamadas).toEqual(["gpt-6-luna", "gpt-6-luna", "claude-sonnet-5"]);
    expect(r.text).toBe("anthropic");
  }, 15_000);

  it("modelo_caido=on: OpenAI nunca recibe la petición y responde claude-sonnet-5", async () => {
    const r = await agenteRouter("on", false).generate("hola");
    expect(llamadas).toEqual(["claude-sonnet-5"]);
    expect(r.text).toBe("anthropic");
  }, 15_000);

  it("sin fallas responde gpt-6-luna en un solo intento", async () => {
    const r = await agenteRouter("off", false).generate("hola");
    expect(llamadas).toEqual(["gpt-6-luna"]);
    expect(r.text).toBe("openai");
    // El esfuerzo de razonamiento llega en la petición real a la Responses API.
    expect(cuerpos[0]).toMatchObject({ reasoning: { effort: "low" } });
  });
});
