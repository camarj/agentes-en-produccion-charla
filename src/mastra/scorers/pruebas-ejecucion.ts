// Ejecuciones falsas con la forma que Mastra 1.69 entrega a los scorers en
// vivo (`type: 'agent'`). Solo se usan en tests.
import type { ScorerRun, ScorerRunInputForAgent, ScorerRunOutputForAgent } from "@mastra/core/evals";
import type { Invocacion } from "./ejecucion";

export type EjecucionAgente = ScorerRun<ScorerRunInputForAgent, ScorerRunOutputForAgent>;

let n = 0;

export function mensajeUsuario(texto: string) {
  return {
    id: `u-${++n}`,
    role: "user" as const,
    createdAt: new Date(),
    content: { format: 2 as const, parts: [{ type: "text", text: texto }], content: texto },
  };
}

export function mensajeAgente(texto: string, invocaciones: Invocacion[] = []) {
  const parts = [
    ...invocaciones.map((toolInvocation) => ({ type: "tool-invocation", toolInvocation })),
    ...(texto ? [{ type: "text", text: texto }] : []),
  ];
  return {
    id: `a-${++n}`,
    role: "assistant" as const,
    createdAt: new Date(),
    content: { format: 2 as const, parts, content: texto, toolInvocations: invocaciones },
  };
}

export function busqueda(resultados: Array<{ lamina: number; fragmento: string; titulo?: string; notas?: string | null }>, id = `call-${++n}`): Invocacion {
  return {
    state: "result",
    toolCallId: id,
    toolName: "buscar_laminas",
    args: { consulta: "x" },
    result: {
      resultados: resultados.map((r) => ({ titulo: `Lámina ${r.lamina}`, notas: null, puntaje: 1, ...r })),
      sin_resultados: resultados.length === 0,
    },
  };
}

export function busquedaCaida(id = `call-${++n}`): Invocacion {
  return { state: "result", toolCallId: id, toolName: "buscar_laminas", args: { consulta: "x" }, result: { error: "no_disponible" } };
}

export interface OpcionesEjecucion {
  pregunta: string;
  respuesta: string;
  invocaciones?: Invocacion[];
  recordados?: unknown[];
  requestContext?: Record<string, unknown>;
  sistema?: string;
}

export function ejecucion({ pregunta, respuesta, invocaciones = [], recordados = [], requestContext, sistema = "" }: OpcionesEjecucion): EjecucionAgente {
  const run = {
    input: {
      inputMessages: [mensajeUsuario(pregunta)],
      rememberedMessages: recordados,
      systemMessages: sistema ? [{ role: "system", content: sistema }] : [],
      taggedSystemMessages: {},
    },
    output: [mensajeAgente(respuesta, invocaciones)],
    requestContext,
  };
  return run as unknown as EjecucionAgente;
}
