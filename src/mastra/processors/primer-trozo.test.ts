import { Agent } from "@mastra/core/agent";
import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { MODELO_PRINCIPAL, MODELO_RESPALDO } from "../modelos";
import { conLimitePrimerTrozo, ESPERA_PRIMER_TROZO_MS, esModeloConLimite, esperaPrimerTrozoMs } from "./primer-trozo";
import { modeloFalso } from "./pruebas-modelo";

type Parte = Record<string, unknown>;

// Modelo falso (LanguageModelV2) que emite `partes` con las pausas indicadas
// y registra la señal de cancelación que recibió.
function modeloLento(pasos: { esperaMs: number; parte: Parte }[]) {
  const senales: AbortSignal[] = [];
  let llamadas = 0;
  const modelo = {
    specificationVersion: "v2" as const,
    provider: "google.vertex.chat",
    modelId: "gemini-3.8-flash",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("no se usa");
    },
    doStream: async (opciones: { abortSignal?: AbortSignal }) => {
      llamadas++;
      if (opciones.abortSignal) senales.push(opciones.abortSignal);
      const stream = new ReadableStream<Parte>({
        async start(c) {
          for (const p of pasos) {
            await new Promise((r) => setTimeout(r, p.esperaMs));
            if (opciones.abortSignal?.aborted) return;
            c.enqueue(p.parte);
          }
          c.close();
        },
      });
      return { stream };
    },
  };
  return { modelo, senales, llamadas: () => llamadas };
}

const USO = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const inicio = { type: "stream-start", warnings: [] };
const texto = (delta: string) => ({ type: "text-delta", id: "t1", delta });
const fin = { type: "finish", finishReason: "stop", usage: USO };

async function leerTodo(stream: ReadableStream<Parte>): Promise<Parte[]> {
  const partes: Parte[] = [];
  const lector = stream.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) return partes;
    partes.push(value);
  }
}

describe("conLimitePrimerTrozo", () => {
  it("si el primer contenido llega a tiempo, entrega todos los trozos sin cambios", async () => {
    const lento = modeloLento([
      { esperaMs: 0, parte: inicio },
      { esperaMs: 10, parte: texto("Hola") },
      { esperaMs: 10, parte: texto(" mundo") },
      { esperaMs: 0, parte: fin },
    ]);
    const limitado = conLimitePrimerTrozo(lento.modelo, 200);
    const r = await limitado.doStream({});
    expect(await leerTodo(r.stream as ReadableStream<Parte>)).toEqual([inicio, texto("Hola"), texto(" mundo"), fin]);
    expect(lento.senales[0].aborted).toBe(false);
  });

  it("si no llega contenido en el plazo, cancela la petición y falla con un 408 reintentable", async () => {
    // Solo `stream-start` (no es contenido) y luego silencio.
    const lento = modeloLento([
      { esperaMs: 0, parte: inicio },
      { esperaMs: 500, parte: texto("tarde") },
    ]);
    const limitado = conLimitePrimerTrozo(lento.modelo, 50);
    const error = await limitado.doStream({}).catch((e: unknown) => e);
    expect(APICallError.isInstance(error)).toBe(true);
    expect(error).toMatchObject({ statusCode: 408, isRetryable: true });
    expect(lento.senales[0].aborted).toBe(true);
  });

  it("una pausa larga después del primer contenido no corta la respuesta", async () => {
    const lento = modeloLento([
      { esperaMs: 0, parte: texto("Hola") },
      { esperaMs: 120, parte: texto(" despacio") },
      { esperaMs: 0, parte: fin },
    ]);
    const limitado = conLimitePrimerTrozo(lento.modelo, 50);
    const r = await limitado.doStream({});
    expect(await leerTodo(r.stream as ReadableStream<Parte>)).toEqual([texto("Hola"), texto(" despacio"), fin]);
  });

  it("respeta la cancelación de quien llama (el cliente se fue)", async () => {
    const lento = modeloLento([{ esperaMs: 0, parte: texto("Hola") }, { esperaMs: 0, parte: fin }]);
    const limitado = conLimitePrimerTrozo(lento.modelo, 200);
    const externa = new AbortController();
    await limitado.doStream({ abortSignal: externa.signal });
    externa.abort();
    expect(lento.senales[0].aborted).toBe(true);
  });

  it("conserva el proveedor y el id del modelo, y se puede reconocer como limitado", () => {
    const lento = modeloLento([]);
    const limitado = conLimitePrimerTrozo(lento.modelo, 50);
    expect(limitado.provider).toBe("google.vertex.chat");
    expect(limitado.modelId).toBe("gemini-3.8-flash");
    expect(esModeloConLimite(limitado)).toBe(true);
    expect(esModeloConLimite(lento.modelo)).toBe(false);
  });
});

describe("esperaPrimerTrozoMs", () => {
  it("usa 15 s por defecto y acepta un valor válido de ESPERA_PRIMER_TROZO_MS", () => {
    expect(ESPERA_PRIMER_TROZO_MS).toBe(15_000);
    expect(esperaPrimerTrozoMs({})).toBe(15_000);
    expect(esperaPrimerTrozoMs({ ESPERA_PRIMER_TROZO_MS: "12000" })).toBe(12_000);
  });

  it("ignora valores inválidos o menores a 1 s", () => {
    for (const v of ["", "abc", "500", "-3", "1.5"]) expect(esperaPrimerTrozoMs({ ESPERA_PRIMER_TROZO_MS: v })).toBe(15_000);
  });
});

describe("conLimitePrimerTrozo con un agente real (cadena de modelos de Mastra)", () => {
  it("si el principal se queda callado, lo reintenta 1 vez y luego responde el respaldo", async () => {
    const callado = modeloLento([
      { esperaMs: 0, parte: inicio },
      { esperaMs: 2_000, parte: texto("demasiado tarde") },
    ]);
    const respaldo = modeloFalso(MODELO_RESPALDO, () => ({ texto: "desde el respaldo" }));
    const a = new Agent({
      id: "prueba-primer-trozo",
      name: "prueba-primer-trozo",
      instructions: "x",
      model: [
        { id: "principal", model: conLimitePrimerTrozo(callado.modelo, 50) as never, maxRetries: 1 },
        { id: "respaldo", model: respaldo.modelo as never, maxRetries: 0 },
      ],
    });
    const s = await a.stream("hola");
    expect(await s.text).toBe("desde el respaldo");
    expect(callado.llamadas()).toBe(2);
    expect(respaldo.llamadas.length).toBe(1);
  }, 15_000);

  it("si el principal responde a tiempo, el respaldo no se usa", async () => {
    const rapido = modeloFalso(MODELO_PRINCIPAL, () => ({ texto: "desde el principal" }));
    const respaldo = modeloFalso(MODELO_RESPALDO, () => ({ texto: "desde el respaldo" }));
    const a = new Agent({
      id: "prueba-primer-trozo-ok",
      name: "prueba-primer-trozo-ok",
      instructions: "x",
      model: [
        { id: "principal", model: conLimitePrimerTrozo(rapido.modelo, 200) as never, maxRetries: 1 },
        { id: "respaldo", model: respaldo.modelo as never, maxRetries: 0 },
      ],
    });
    const s = await a.stream("hola");
    expect(await s.text).toBe("desde el principal");
    expect(respaldo.llamadas.length).toBe(0);
  });
});
