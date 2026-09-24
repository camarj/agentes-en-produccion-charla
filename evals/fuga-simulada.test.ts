import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it } from "vitest";
import { MENSAJES_BLOQUEO } from "@/src/mastra/processors/mensajes";
import { modeloFalso } from "@/src/mastra/processors/pruebas-modelo";
import { SinDatosPersonales } from "@/src/mastra/processors/sin-datos-personales";
import { FugaSimulada, textoDeFuga } from "./fuga-simulada";

const senuelo = { nombre: "Leonor Villamar", email: "leonor.villamar@senuelo.invalid" };

function agente(outputProcessors: unknown[]) {
  const m = modeloFalso("openai/gpt-6-luna", () => ({ texto: ["Un agente ", "decide y actúa ", "(lámina 8)."] }));
  return new Agent({ id: "prueba", name: "prueba", instructions: "x", model: m.modelo as never, outputProcessors: outputProcessors as never });
}

function contexto() {
  const rc = new RequestContext();
  rc.set("asistente_id", "yo");
  return rc;
}

const perfiles = async () => [
  { id: "yo", nombre: "Andrea Salvatierra", rol: "Gerente de operaciones", descripcion: null },
  { id: "s1", nombre: senuelo.nombre, rol: "Directora de riesgos", descripcion: null },
];

describe("FugaSimulada (solo para la prueba de fallo de los evals)", () => {
  it("sin el guardrail de salida, el dato del señuelo llega al asistente", async () => {
    const r = await agente([new FugaSimulada(senuelo)]).generate("¿Qué es un agente?", { requestContext: contexto() });
    expect(r.text).toContain(textoDeFuga(senuelo));
    expect(r.text).toContain("decide y actúa");
  });

  it("con SinDatosPersonales detrás, la respuesta se reemplaza por el mensaje seguro", async () => {
    const r = await agente([new FugaSimulada(senuelo), new SinDatosPersonales({ cargarAsistentes: perfiles })]).generate("¿Qué es un agente?", {
      requestContext: contexto(),
    });
    expect(r.text).toBe(MENSAJES_BLOQUEO.datos_personales);
  });
});
