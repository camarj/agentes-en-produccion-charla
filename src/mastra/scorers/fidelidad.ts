import { createScorer, notScorable } from "@mastra/core/evals";
import type { MastraModelConfig } from "@mastra/core/llm";
import { z } from "zod";
import { MODELO_LIGERO } from "../modelos";
import { obtenerNombresAsistentes } from "../observabilidad/nombres";
import { prepararEjecucion, redactarTexto, type NombresConocidos } from "../observabilidad/redaccion";
import {
  busquedasDeLaminas,
  esMensajeBloqueo,
  formatearFragmentos,
  mensajesRecordados,
  preguntaUsuario,
  recortarRazon,
  textoRespuesta,
  type Fragmento,
} from "./ejecucion";

export const ID_FIDELIDAD = "fidelidad";

export const INSTRUCCIONES_JUEZ_FIDELIDAD = `You are a strict fact-checker for a chat assistant that answers questions about a live talk
("Cómo lograr que tus agentes sobrevivan a producción"). You compare the assistant's answer with
the slide excerpts it retrieved and decide which statements about the talk are supported.
You never invent evidence. Write the reason in neutral Spanish.`;

export const esquemaFidelidad = z.object({
  afirmaciones: z
    .array(
      z.object({
        afirmacion: z.string(),
        // La respuesta la presenta como contenido de la charla (no como
        // conocimiento general marcado como "esto no está en la charla").
        sobre_la_charla: z.boolean(),
        // Ejemplo ilustrativo o aplicación hipotética al proyecto del usuario
        // («Por ejemplo, en tu agente de ecommerce…»). Solo informa: lo que se
        // puntúa es `sobre_la_charla`, así que un dato de la charla dentro de un
        // ejemplo («como mostró Raúl, esto reduce 87 % las fallas») sigue contando.
        ejemplo_ilustrativo: z.boolean(),
        respaldada: z.boolean(),
      }),
    )
    .max(20),
  razon: z.string(),
});

export type AnalisisFidelidad = z.infer<typeof esquemaFidelidad>;

// Proporción de afirmaciones sobre la charla respaldadas por la evidencia.
// null si no hay afirmaciones sobre la charla (no hay nada que puntuar).
// Los ejemplos ilustrativos no cuentan salvo que atribuyan algo a la charla
// (decisión de Raúl, 2026-09-23): el juez los marca sobre_la_charla = false.
export function puntajeFidelidad(analisis: AnalisisFidelidad): number | null {
  const relevantes = analisis.afirmaciones.filter((a) => a.sobre_la_charla);
  if (relevantes.length === 0) return null;
  const respaldadas = relevantes.filter((a) => a.respaldada).length;
  return Math.round((respaldadas / relevantes.length) * 100) / 100;
}

export interface Evidencia {
  pregunta: string;
  respuesta: string;
  // Hubo búsqueda con resultados en esta ejecución.
  huboBusqueda: boolean;
  fragmentos: Fragmento[];
  // Respuesta de referencia del dataset de evals (groundTruth, T13). En vivo no hay.
  referencia?: string | null;
}

// Respuesta de referencia de un caso de evals: el groundTruth es un texto o un
// objeto con `respuesta_referencia` (ver evals/dataset.ts). null si no hay.
export function referenciaDeGroundTruth(groundTruth: unknown): string | null {
  const valor =
    typeof groundTruth === "string"
      ? groundTruth
      : (groundTruth as { respuesta_referencia?: unknown } | null | undefined)?.respuesta_referencia;
  if (typeof valor !== "string") return null;
  const t = valor.trim();
  return t === "" ? null : t;
}

export function promptFidelidad(e: Evidencia): string {
  const evidencia = e.fragmentos.length > 0 ? formatearFragmentos(e.fragmentos) : "(no slide excerpts)";
  const alcance = e.huboBusqueda
    ? `The assistant searched the slides in this turn. A statement is "about the talk" (sobre_la_charla = true)
when the answer presents it as what the talk says or as the answer to the user's question about the
talk. Statements the answer explicitly marks as general knowledge outside the talk ("esto no está en
la charla, pero…") are sobre_la_charla = false.`
    : `The assistant did NOT search the slides in this turn. Only statements the answer explicitly
attributes to the talk (e.g. "en la charla…", "la lámina 12 dice…", "Raúl explica…") are
sobre_la_charla = true; everything else is false. The excerpts below (if any) come from earlier turns
of the same conversation.`;
  return `${alcance}

Illustrative examples are NOT statements about the talk. The assistant is told to apply each concept
to the user's own work or project, so answers often contain clearly illustrative examples or
hypothetical applications, e.g. "Por ejemplo, en tu agente de ecommerce, antes de ejecutar un
reembolso…", "Piénsalo con tu bot de WhatsApp: …", "podrías medir cuántas respuestas…". List them with
ejemplo_ilustrativo = true and sobre_la_charla = false: they are not checked against the excerpts and
must not lower the score. Only the example itself is exempt. Any fact, figure, percentage, result,
tool or quote that the answer attributes to the talk, the slides or the speaker
is still sobre_la_charla = true, even when it is embedded inside an example (e.g. "Por ejemplo, en tu tienda…
como mostró Raúl, esto reduce 87 % las fallas" contains the statement "como mostró Raúl, esto reduce
87 % las fallas", which is sobre_la_charla = true and ejemplo_ilustrativo = true). The explanation of
the concept itself (what it is, what it is for) is never an example. Non-example statements have
ejemplo_ilustrativo = false.

A statement is supported (respaldada = true) only if the excerpts (or the reference answer, when
given) state it or directly imply it.
Any number, percentage, date, name, tool or claim that does not appear in that evidence is NOT
supported, even if it sounds plausible. Slide citations like "(lámina 11)" are not statements by
themselves. List at most 20 atomic statements.

Slide excerpts:
"""
${evidencia}
"""
${
  e.referencia
    ? `
Reference answer written by the speaker for this question (also valid evidence of what the talk says):
"""
${e.referencia}
"""
`
    : ""
}
User question:
"""
${e.pregunta}
"""

Assistant answer:
"""
${e.respuesta}
"""

Return JSON: { "afirmaciones": [{ "afirmacion": string, "sobre_la_charla": boolean,
"ejemplo_ilustrativo": boolean, "respaldada": boolean }],
"razon": string } where "razon" is one or two short sentences in Spanish explaining the result. Do
not include personal data in "razon".`;
}

export interface OpcionesFidelidad {
  modelo?: MastraModelConfig;
  nombresConocidos?: NombresConocidos;
}

export function crearFidelidad({ modelo = MODELO_LIGERO, nombresConocidos = obtenerNombresAsistentes }: OpcionesFidelidad = {}) {
  return createScorer({
    id: ID_FIDELIDAD,
    name: "Fidelidad",
    description: "Proporción de afirmaciones sobre la charla respaldadas por los fragmentos de buscar_laminas.",
    type: "agent",
    judge: { model: modelo, instructions: INSTRUCCIONES_JUEZ_FIDELIDAD },
    prepareRun: prepararEjecucion({ nombresConocidos }),
  })
    .preprocess(({ run }): Evidencia | ReturnType<typeof notScorable> => {
      const respuesta = textoRespuesta(run.output);
      if (!respuesta) return notScorable("sin respuesta de texto");
      if (esMensajeBloqueo(respuesta)) return notScorable("respuesta de guardrail");
      const actual = busquedasDeLaminas(run.output);
      // Sin búsqueda en este turno, la única evidencia válida es la que el
      // agente ya obtuvo en turnos anteriores del mismo hilo.
      const fragmentos = actual.llamada ? actual.fragmentos : busquedasDeLaminas(mensajesRecordados(run.input)).fragmentos;
      return {
        pregunta: preguntaUsuario(run.input),
        respuesta,
        huboBusqueda: actual.llamada,
        fragmentos,
        referencia: referenciaDeGroundTruth(run.groundTruth),
      };
    })
    .analyze({
      description: "Extrae las afirmaciones sobre la charla y verifica cada una contra los fragmentos.",
      outputSchema: esquemaFidelidad,
      createPrompt: ({ results }) => promptFidelidad(results.preprocessStepResult),
    })
    .generateScore(({ results }) => {
      const puntaje = puntajeFidelidad(results.analyzeStepResult);
      return puntaje === null ? notScorable("sin afirmaciones sobre la charla") : puntaje;
    })
    .generateReason(({ results }) => recortarRazon(redactarTexto(results.analyzeStepResult.razon)));
}

export const fidelidad = crearFidelidad();
