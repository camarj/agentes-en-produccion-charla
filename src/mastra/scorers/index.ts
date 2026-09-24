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

export function crearRelevancia({
  modelo = MODELO_LIGERO,
  nombresConocidos = obtenerNombresAsistentes,
}: { modelo?: MastraModelConfig; nombresConocidos?: NombresConocidos } = {}) {
  return ajustarPrearmado(createAnswerRelevancyScorer({ model: modelo }), ID_RELEVANCIA, "Relevancia", nombresConocidos);
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
