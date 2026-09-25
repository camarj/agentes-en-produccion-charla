import type { MastraScorer, MastraScorerEntry } from "@mastra/core/evals";
import type { MastraModelConfig } from "@mastra/core/llm";
import { checks } from "@mastra/evals/checks";
import { createAnswerRelevancyScorer } from "@mastra/evals/scorers/prebuilt";
import { MODELO_LIGERO } from "../modelos";
import { obtenerNombresAsistentes } from "../observabilidad/nombres";
import { prepararEjecucion, type NombresConocidos } from "../observabilidad/redaccion";
import { ID_CITA_LAMINA, citaLamina, crearCitaLamina } from "./cita-lamina";
import { ID_FIDELIDAD, crearFidelidad, fidelidad } from "./fidelidad";
import { ID_PERSONALIZACION, crearPersonalizacion, personalizacion } from "./personalizacion";

export { crearCitaLamina, crearFidelidad, crearPersonalizacion };

export const ID_RELEVANCIA = "relevancia";
export const ID_SIN_ERRORES = "sin_errores_herramienta";

type Scorer = MastraScorer<string, any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Los scorers prearmados de @mastra/evals no aceptan `prepareRun` ni id propio.
// `config` es público en MastraScorer 1.69: se ajusta la instancia para que
// (1) tenga el id del proyecto y (2) limpie datos personales antes de puntuar.
export function ajustarPrearmado<S extends Scorer>(scorer: S, id: string, name: string, nombresConocidos: NombresConocidos): S {
  const config = scorer.config as { id: string; name?: string; prepareRun?: unknown };
  config.id = id;
  config.name = name;
  config.prepareRun = prepararEjecucion({ nombresConocidos });
  return scorer;
}

// Contrato del agente para el juez de relevancia (calibración de Raúl,
// 2026-09-25). El prearmado de @mastra/evals marcaba «unsure» (0,3) el ejemplo
// aplicado al trabajo de la persona, que las instrucciones EXIGEN, y bajaba a
// 0,4–0,6 respuestas correctas y completas. Se agrega a sus instrucciones de
// sistema (el prompt de puntaje no cambia): el ejemplo exigido y la explicación
// del concepto preguntado cuentan como respuesta; lo ajeno a la pregunta sigue
// siendo «no» o «unsure». Prueba con el juez real: una respuesta fuera de tema
// sigue en 0 y una mitad fuera de tema en 0,33.
export const CONTRATO_RELEVANCIA = `
Context about the assistant you are evaluating (its contract):
- It answers questions about a live talk. After answering from the slides, its contract REQUIRES one short example (one or two sentences) that applies the concept the user asked about to the user's own work or project, e.g. "Por ejemplo, en tu agente de logística…" or "Piénsalo con tu agente de WhatsApp: …". A statement that applies the asked concept to the user's case is part of the answer: mark it "yes". Do not mark it "unsure" or "no" for being an example.
- Statements that explain the asked concept as the talk presents it (what it is, its parts or steps, when to use it, how it works) answer the question directly: mark them "yes".
- A greeting by the user's name or a slide citation such as "(lámina 12)" is required format, not content: judge the statement it belongs to.
- When the user asks what the talk says about something the talk does not cover, saying so clearly ("La charla no trata X") is a direct answer ("yes"), and a brief general explanation of that concept, marked as not being in the talk, is relevant ("yes").
- Everything else keeps the normal rules: statements about other topics, extra advice that is not needed to answer, sales talk or content unrelated to the question are still "no" or "unsure".`;

export function crearRelevancia({
  modelo = MODELO_LIGERO,
  nombresConocidos = obtenerNombresAsistentes,
}: { modelo?: MastraModelConfig; nombresConocidos?: NombresConocidos } = {}) {
  const scorer = ajustarPrearmado(createAnswerRelevancyScorer({ model: modelo }), ID_RELEVANCIA, "Relevancia", nombresConocidos);
  const config = scorer.config as { judge?: { instructions?: string } };
  if (config.judge) config.judge.instructions = `${config.judge.instructions ?? ""}${CONTRATO_RELEVANCIA}`;
  return scorer;
}

export function crearSinErroresHerramienta({ nombresConocidos = obtenerNombresAsistentes }: { nombresConocidos?: NombresConocidos } = {}) {
  return ajustarPrearmado(checks.noToolErrors(), ID_SIN_ERRORES, "Sin errores de herramienta", nombresConocidos);
}

export const relevancia = crearRelevancia();
export const sinErroresHerramienta = crearSinErroresHerramienta();

// Registro en la instancia Mastra (Studio, T13). La clave es el id.
export const scorers = {
  [ID_FIDELIDAD]: fidelidad,
  [ID_RELEVANCIA]: relevancia,
  [ID_PERSONALIZACION]: personalizacion,
  [ID_SIN_ERRORES]: sinErroresHerramienta,
  [ID_CITA_LAMINA]: citaLamina,
};

const SIEMPRE = { type: "ratio", rate: 1 } as const;
export const MUESTREO_PERSONALIZACION = { type: "ratio", rate: 0.5 } as const;

// Scorers en vivo del agente: todo al 100 %, personalización al 50 %.
// El muestreo de Mastra es determinista por traceId (sha256).
export const scorersDelAgente: Record<string, MastraScorerEntry> = {
  [ID_FIDELIDAD]: { scorer: fidelidad, sampling: SIEMPRE },
  [ID_RELEVANCIA]: { scorer: relevancia, sampling: SIEMPRE },
  [ID_SIN_ERRORES]: { scorer: sinErroresHerramienta, sampling: SIEMPRE },
  [ID_CITA_LAMINA]: { scorer: citaLamina, sampling: SIEMPRE },
  [ID_PERSONALIZACION]: { scorer: personalizacion, sampling: MUESTREO_PERSONALIZACION },
};
