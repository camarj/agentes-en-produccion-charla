// Modelos falsos (LanguageModelV2) para probar el agente sin llamar a un proveedor.
// Solo se usan en tests.

type Parte = Record<string, unknown>;

export interface LlamadaModelo {
  toolChoice?: { type: string };
  tools?: unknown[];
  prompt: unknown[];
  providerOptions?: Record<string, Record<string, unknown> | undefined>;
}

const USO = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

// `texto` puede venir en trozos para simular un stream token a token.
function partesTexto(texto: string | string[]): Parte[] {
  const trozos = Array.isArray(texto) ? texto : [texto];
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    ...trozos.map((delta) => ({ type: "text-delta", id: "t1", delta })),
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: "stop", usage: USO },
  ];
}

function partesHerramienta(nombre: string, entrada: unknown, n: number): Parte[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: `call-${n}`, toolName: nombre, input: JSON.stringify(entrada) },
    { type: "finish", finishReason: "tool-calls", usage: USO },
  ];
}

function comoStream(partes: Parte[]) {
  return new ReadableStream({
    start(c) {
      for (const p of partes) c.enqueue(p);
      c.close();
    },
  });
}

function comoGenerate(partes: Parte[]) {
  const texto = partes.filter((p) => p.type === "text-delta").map((p) => p.delta).join("");
  const content = [
    ...(texto ? [{ type: "text", text: texto }] : []),
    ...partes.filter((p) => p.type === "tool-call").map((p) => ({ ...p })),
  ];
  const fin = partes.find((p) => p.type === "finish") as Parte;
  return { content, finishReason: fin.finishReason, usage: USO, warnings: [] };
}

// Responde según `responder(llamada, n)`: texto o una llamada a herramienta.
export function modeloFalso(
  id: string,
  responder: (
    llamada: LlamadaModelo,
    n: number,
  ) => { texto: string | string[] } | { herramienta: string; entrada: unknown },
) {
  const [provider, modelId] = id.split("/");
  const llamadas: LlamadaModelo[] = [];
  const partes = (opciones: LlamadaModelo) => {
    llamadas.push(opciones);
    const r = responder(opciones, llamadas.length);
    return "texto" in r ? partesTexto(r.texto) : partesHerramienta(r.herramienta, r.entrada, llamadas.length);
  };
  return {
    llamadas,
    modelo: {
      specificationVersion: "v2" as const,
      provider,
      modelId,
      supportedUrls: {},
      doGenerate: async (opciones: LlamadaModelo) => comoGenerate(partes(opciones)),
      doStream: async (opciones: LlamadaModelo) => ({ stream: comoStream(partes(opciones)) }),
    },
  };
}
