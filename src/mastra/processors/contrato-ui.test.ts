import { toAISdkStream } from "@mastra/ai-sdk";
import { Agent } from "@mastra/core/agent";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { describe, expect, it } from "vitest";
import { AlcanceCharla } from "./alcance-charla";
import { MENSAJES_BLOQUEO, TIPO_PARTE_GUARDRAIL, mensajeDeBloqueo, motivoDeTripwire } from "./mensajes";
import { modeloFalso } from "./pruebas-modelo";
import { SinDatosPersonales } from "./sin-datos-personales";

// Contrato para T09/T11: cómo llegan los bloqueos al stream de AI SDK UI.
async function partesUI(agente: Agent) {
  const stream = await agente.stream("pregunta");
  const partes: { type: string; data?: unknown; delta?: string }[] = [];
  const reader = toAISdkStream(stream, { from: "agent", version: "v7" }).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    partes.push(value as never);
  }
  return partes;
}

describe("contrato del stream UI (toAISdkStream)", () => {
  it("un bloqueo de entrada llega como data-tripwire con metadata.motivo y sin texto", async () => {
    const agente = new Agent({
      id: "contrato-entrada",
      name: "x",
      instructions: "x",
      model: modeloFalso("openai/gpt-6-luna", () => ({ texto: "no" })).modelo as never,
      inputProcessors: [new AlcanceCharla({ clasificar: async () => ({ categoria: "fuera_de_alcance", confianza: 0.9 }) })],
    });
    const partes = await partesUI(agente);
    const tripwire = partes.find((p) => p.type === "data-tripwire") as { data: { reason: string; metadata: unknown } };
    expect(tripwire.data.reason).toBe(MENSAJES_BLOQUEO.fuera_de_alcance);
    expect(mensajeDeBloqueo(motivoDeTripwire(tripwire.data))).toBe(MENSAJES_BLOQUEO.fuera_de_alcance);
    expect(partes.some((p) => p.type === "text-delta")).toBe(false);
    expect(partes.at(-1)).toMatchObject({ type: "finish" });
  });

  it("un reemplazo de salida llega como data-guardrail más el texto seguro", async () => {
    const agente = new Agent({
      id: "contrato-salida",
      name: "x",
      instructions: "x",
      model: modeloFalso("openai/gpt-6-luna", () => ({ texto: ["Escribe a ", "juan@x.com"] })).modelo as never,
      outputProcessors: [new SinDatosPersonales({ cargarAsistentes: async () => [] })],
    });
    const partes = await partesUI(agente);
    expect(partes).toContainEqual(
      expect.objectContaining({ type: TIPO_PARTE_GUARDRAIL, data: { guardrail: "sin_datos_personales", motivo: "datos_personales" } }),
    );
    const texto = partes.filter((p) => p.type === "text-delta").map((p) => p.delta).join("");
    expect(texto).toBe(MENSAJES_BLOQUEO.datos_personales);
    expect(JSON.stringify(partes)).not.toContain("juan@x.com");
  });

  it("un turno bloqueado en la entrada no queda en la memoria (ni la pregunta ni la respuesta)", async () => {
    const memoria = new Memory({ storage: new LibSQLStore({ id: "contrato-memoria", url: "file::memory:" }) });
    let bloquear = true;
    const agente = new Agent({
      id: "contrato-memoria",
      name: "x",
      instructions: "x",
      model: modeloFalso("openai/gpt-6-luna", () => ({ texto: "Un LLM es..." })).modelo as never,
      memory: memoria,
      inputProcessors: [
        new AlcanceCharla({
          clasificar: async () => (bloquear ? { categoria: "fuera_de_alcance", confianza: 0.9 } : { categoria: "concepto_ia", confianza: 0.9 }),
        }),
      ],
    });
    const opciones = { memory: { thread: "t1", resource: "r1" } };
    const s1 = await agente.stream("Dame una receta", opciones);
    await s1.consumeStream();
    bloquear = false;
    const s2 = await agente.stream("¿Qué es un LLM?", opciones);
    await s2.consumeStream();
    const { messages } = await memoria.recall({ threadId: "t1", resourceId: "r1" });
    const guardado = JSON.stringify(messages);
    expect(guardado).not.toContain("receta");
    expect(guardado).toContain("¿Qué es un LLM?");
    expect(guardado).toContain("Un LLM es...");
  });
});
