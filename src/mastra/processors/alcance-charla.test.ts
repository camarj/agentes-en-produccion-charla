import { Agent } from "@mastra/core/agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AlcanceCharla,
  PROMPT_CLASIFICADOR,
  TIEMPO_MAXIMO_CLASIFICADOR_MS,
  UMBRAL_FUERA_DE_ALCANCE,
  crearClasificador,
  modelosGuardrail,
  ultimoTextoDeUsuario,
  type Clasificacion,
  type Clasificador,
} from "./alcance-charla";
import { MODELO_LIGERO, MODELO_LIGERO_RESPALDO } from "../modelos";
import { MENSAJES_BLOQUEO } from "./mensajes";
import { modeloFalso } from "./pruebas-modelo";

function mensaje(role: "user" | "assistant", texto: string, id = Math.random().toString(36)) {
  return { id, role, createdAt: new Date(), content: { format: 2, parts: [{ type: "text", text: texto }] } };
}

class Abortado extends Error {
  constructor(
    readonly reason: string | undefined,
    readonly options: unknown,
  ) {
    super(reason);
  }
}

function contexto(messages: unknown[]) {
  const span = { update: vi.fn() };
  const abort = vi.fn((reason?: string, options?: unknown) => {
    throw new Abortado(reason, options);
  });
  return { span, abort, args: { messages, abort, tracingContext: { currentSpan: span } } as never };
}

function fijo(resultado: Clasificacion): Clasificador {
  return vi.fn(async () => resultado);
}

describe("AlcanceCharla (unidad)", () => {
  afterEach(() => vi.useRealTimers());

  // Prompt ampliado con los temas de la charla (Raúl, 2026-09-23): bloqueaba «¿Qué es un PRD?».
  it("constantes: umbral 0,7, tope 3 s y prompt con los temas de la charla", () => {
    expect(UMBRAL_FUERA_DE_ALCANCE).toBe(0.7);
    expect(TIEMPO_MAXIMO_CLASIFICADOR_MS).toBe(3000);
    expect(PROMPT_CLASIFICADOR).toBe(
      "Clasifica si el mensaje trata sobre la charla de agentes de IA en producción, sobre conceptos de IA, o sobre Raúl, Inteliside o críticas a la charla (escalable). La charla cubre: qué es un agente, la IA, los modelos y los LLM; el loop agéntico y el harness; contexto, control, ejecución y seguimiento; decidir si un proyecto necesita un agente; el PRD (documento de requerimientos de producto), las especificaciones y el contrato del agente; la arquitectura con uno o varios agentes; plataformas, código y marcos para implementar; resiliencia, salvaguardas (guardrails), evaluaciones (evals), observabilidad y el lanzamiento. Las preguntas sobre cualquiera de esos temas, aunque sean cortas o generales, son charla. Las preguntas sobre este asistente, cómo funciona o los datos y el perfil del propio usuario son charla. Consejos financieros, médicos, legales, política, recetas, tareas escolares y temas ajenos son fuera_de_alcance.",
    );
  });

  it("bloquea fuera_de_alcance con confianza ≥ 0,7 con el mensaje fijo y la metadata", async () => {
    const p = new AlcanceCharla({ clasificar: fijo({ categoria: "fuera_de_alcance", confianza: 0.7 }) });
    const { args, abort, span } = contexto([mensaje("user", "Dame una receta de encebollado")]);
    await expect(p.processInput(args)).rejects.toBeInstanceOf(Abortado);
    expect(abort).toHaveBeenCalledWith(MENSAJES_BLOQUEO.fuera_de_alcance, {
      metadata: { guardrail: "alcance_charla", motivo: "fuera_de_alcance", confianza: 0.7, categoria: "fuera_de_alcance" },
    });
    expect(span.update).toHaveBeenCalledWith({
      metadata: { guardrail: "alcance_charla", motivo: "fuera_de_alcance", confianza: 0.7, categoria: "fuera_de_alcance" },
    });
  });

  it("deja pasar fuera_de_alcance con confianza < 0,7", async () => {
    const p = new AlcanceCharla({ clasificar: fijo({ categoria: "fuera_de_alcance", confianza: 0.69 }) });
    const msgs = [mensaje("user", "¿Y eso?")];
    const { args, abort, span } = contexto(msgs);
    expect(await p.processInput(args)).toBe(msgs);
    expect(abort).not.toHaveBeenCalled();
    expect(span.update).toHaveBeenCalledWith({ metadata: { alcance_categoria: "fuera_de_alcance", alcance_confianza: 0.69 } });
  });

  it.each(["charla", "concepto_ia", "escalable"] as const)("deja pasar la categoría %s aunque la confianza sea alta", async (categoria) => {
    const p = new AlcanceCharla({ clasificar: fijo({ categoria, confianza: 0.99 }) });
    const msgs = [mensaje("user", "¿Qué es un LLM?")];
    const { args, abort } = contexto(msgs);
    expect(await p.processInput(args)).toBe(msgs);
    expect(abort).not.toHaveBeenCalled();
  });

  it("clasifica solo el último mensaje del usuario (no el historial) y le pasa una señal", async () => {
    const clasificar = fijo({ categoria: "charla", confianza: 0.9 });
    const p = new AlcanceCharla({ clasificar });
    const { args } = contexto([
      mensaje("user", "Dame una receta"),
      mensaje("assistant", "No puedo"),
      mensaje("user", "¿Qué es el harness?"),
    ]);
    await p.processInput(args);
    expect(clasificar).toHaveBeenCalledTimes(1);
    const [texto, signal] = (clasificar as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(texto).toBe("¿Qué es el harness?");
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("sin texto de usuario no llama al clasificador", async () => {
    const clasificar = fijo({ categoria: "fuera_de_alcance", confianza: 1 });
    const p = new AlcanceCharla({ clasificar });
    const msgs = [mensaje("user", "   ")];
    const { args } = contexto(msgs);
    expect(await p.processInput(args)).toBe(msgs);
    expect(clasificar).not.toHaveBeenCalled();
  });

  it("falla abierta si el clasificador lanza, y lo anota en el span", async () => {
    const p = new AlcanceCharla({ clasificar: vi.fn(async () => Promise.reject(new Error("529 Overloaded"))) });
    const msgs = [mensaje("user", "Mi correo es ana@ejemplo.com, ¿qué acciones compro?")];
    const { args, abort, span } = contexto(msgs);
    expect(await p.processInput(args)).toBe(msgs);
    expect(abort).not.toHaveBeenCalled();
    expect(span.update).toHaveBeenCalledWith({ metadata: { alcance_falla_abierta: true, alcance_error: "error" } });
    expect(JSON.stringify(span.update.mock.calls)).not.toContain("ana@ejemplo.com");
  });

  it("falla abierta si la salida no cumple el esquema", async () => {
    const p = new AlcanceCharla({ clasificar: fijo({ categoria: "fuera_de_alcance", confianza: 7 } as Clasificacion) });
    const msgs = [mensaje("user", "x")];
    const { args, abort, span } = contexto(msgs);
    expect(await p.processInput(args)).toBe(msgs);
    expect(abort).not.toHaveBeenCalled();
    expect(span.update).toHaveBeenCalledWith({ metadata: { alcance_falla_abierta: true, alcance_error: "salida_invalida" } });
  });

  it("falla abierta si el clasificador tarda más de 3 s y cancela su señal", async () => {
    vi.useFakeTimers();
    let senal: AbortSignal | undefined;
    const clasificar: Clasificador = (_texto, signal) => {
      senal = signal;
      return new Promise(() => {}); // nunca responde
    };
    const p = new AlcanceCharla({ clasificar });
    const msgs = [mensaje("user", "¿Qué acciones compro?")];
    const { args, abort, span } = contexto(msgs);
    const promesa = p.processInput(args);
    await vi.advanceTimersByTimeAsync(2999);
    expect(senal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await promesa).toBe(msgs);
    expect(senal?.aborted).toBe(true);
    expect(abort).not.toHaveBeenCalled();
    expect(span.update).toHaveBeenCalledWith({ metadata: { alcance_falla_abierta: true, alcance_error: "timeout" } });
  });

  it("si responde justo antes de 3 s, decide con su resultado", async () => {
    vi.useFakeTimers();
    const clasificar: Clasificador = () =>
      new Promise((r) => setTimeout(() => r({ categoria: "fuera_de_alcance", confianza: 0.95 }), 2900));
    const p = new AlcanceCharla({ clasificar });
    const { args, abort } = contexto([mensaje("user", "¿Por quién voto?")]);
    const promesa = p.processInput(args).catch((e) => e);
    await vi.advanceTimersByTimeAsync(2900);
    expect(await promesa).toBeInstanceOf(Abortado);
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("nunca escribe el texto del usuario en el span al bloquear", async () => {
    const p = new AlcanceCharla({ clasificar: fijo({ categoria: "fuera_de_alcance", confianza: 0.9 }) });
    const { args, span, abort } = contexto([mensaje("user", "Escríbeme a ana@ejemplo.com una receta")]);
    await p.processInput(args).catch(() => undefined);
    expect(JSON.stringify(span.update.mock.calls)).not.toContain("ana@ejemplo.com");
    expect(JSON.stringify(abort.mock.calls)).not.toContain("ana@ejemplo.com");
  });
});

describe("ultimoTextoDeUsuario", () => {
  it("usa las partes de texto y, si no hay, content.content", () => {
    expect(ultimoTextoDeUsuario([mensaje("user", "a"), mensaje("assistant", "b")] as never)).toBe("a");
    expect(
      ultimoTextoDeUsuario([{ id: "1", role: "user", content: { format: 2, parts: [], content: "legado" } }] as never),
    ).toBe("legado");
    expect(ultimoTextoDeUsuario([] as never)).toBe("");
  });
});

describe("crearClasificador (Agent de Mastra con salida estructurada)", () => {
  it("por defecto usa el modelo ligero (OpenAI) con respaldo en Anthropic, sin reintentos", () => {
    expect(modelosGuardrail()).toEqual([
      { id: "ligero", model: MODELO_LIGERO, maxRetries: 0 },
      { id: "ligero-respaldo", model: MODELO_LIGERO_RESPALDO, maxRetries: 0 },
    ]);
  });

  it("si el modelo principal falla, clasifica con el de respaldo", async () => {
    const caido = modeloFalso("openai/gpt-6-luna", () => {
      throw new Error("503 server_error");
    });
    const respaldo = modeloFalso("anthropic/claude-haiku-4-5", () => ({
      texto: JSON.stringify({ categoria: "concepto_ia", confianza: 0.9 }),
    }));
    const clasificar = crearClasificador([
      { model: caido.modelo as never, maxRetries: 0 },
      { model: respaldo.modelo as never, maxRetries: 0 },
    ]);
    const r = await clasificar("¿Qué es un LLM?", new AbortController().signal);
    expect(r).toEqual({ categoria: "concepto_ia", confianza: 0.9 });
    expect(caido.llamadas.length).toBe(1);
    expect(respaldo.llamadas.length).toBe(1);
  });

  it("devuelve la clasificación del modelo y usa el prompt del clasificador", async () => {
    const falso = modeloFalso("openai/gpt-6-luna", () => ({
      texto: JSON.stringify({ categoria: "fuera_de_alcance", confianza: 0.93 }),
    }));
    const clasificar = crearClasificador(falso.modelo as never);
    const r = await clasificar("Dame una receta de encebollado", new AbortController().signal);
    expect(r).toEqual({ categoria: "fuera_de_alcance", confianza: 0.93 });
    const prompt = JSON.stringify(falso.llamadas[0].prompt);
    expect(prompt).toContain("Clasifica si el mensaje trata sobre la charla");
    expect(prompt).toContain("Dame una receta de encebollado");
    // Razonamiento 'none' en OpenAI para no pasar el tope de 3 s.
    expect(falso.llamadas[0].providerOptions?.openai).toMatchObject({ reasoningEffort: "none" });
  });
});

describe("AlcanceCharla con un agente real y modelos falsos", () => {
  it("un mensaje fuera de alcance termina en tripwire sin llamar al modelo principal", async () => {
    const principal = modeloFalso("openai/gpt-6-luna", () => ({ texto: "receta..." }));
    const agente = new Agent({
      id: "prueba-alcance",
      name: "prueba",
      instructions: "x",
      model: principal.modelo as never,
      inputProcessors: [new AlcanceCharla({ clasificar: fijo({ categoria: "fuera_de_alcance", confianza: 0.9 }) })],
    });
    const r = await agente.generate("Dame una receta de encebollado");
    expect(principal.llamadas.length).toBe(0);
    expect(r.tripwire).toMatchObject({
      reason: MENSAJES_BLOQUEO.fuera_de_alcance,
      processorId: "alcance-charla",
      metadata: { guardrail: "alcance_charla", motivo: "fuera_de_alcance", confianza: 0.9 },
    });
  });

  it("un mensaje de la charla llega al modelo", async () => {
    const principal = modeloFalso("openai/gpt-6-luna", () => ({ texto: "Un LLM es..." }));
    const agente = new Agent({
      id: "prueba-alcance-2",
      name: "prueba",
      instructions: "x",
      model: principal.modelo as never,
      inputProcessors: [new AlcanceCharla({ clasificar: fijo({ categoria: "concepto_ia", confianza: 0.95 }) })],
    });
    const r = await agente.generate("¿Qué es un LLM?");
    expect(r.tripwire).toBeUndefined();
    expect(r.text).toBe("Un LLM es...");
  });
});
