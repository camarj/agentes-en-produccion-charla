import type { MastraScorer } from "@mastra/core/evals";
import type { MastraModelConfig } from "@mastra/core/llm";
import { checks } from "@mastra/evals/checks";
import { MODELO_LIGERO, MODELO_LIGERO_RESPALDO } from "@/src/mastra/modelos";
import { crearFidelidad, crearPersonalizacion, crearRelevancia } from "@/src/mastra/scorers";
import { crearSinErroresHerramienta } from "@/src/mastra/scorers";
import { correrConRespaldo, crearGates, crearJuezCriterios, crearScorerEval, entradaJuez, evaluarModelo, type ContextoEvals } from "./checks";
import type { Caso, DatasetCharla } from "./dataset";

// Scorers del runner (T13). `runEvals` recibe:
// - gates: deben promediar 1,0 (checks.ts);
// - con umbral: fidelidad, relevancia y personalización, promediados solo en
//   los casos donde aplican;
// - de seguimiento (sin umbral): criterios de los casos que no son gate,
//   cita de lámina, herramientas esperadas, errores de herramienta y modelo.

type Scorer = MastraScorer<string, any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Casos que esperan una respuesta de contenido sobre la charla (ni bloqueo ni
// escalamiento): ahí se promedian fidelidad y relevancia.
const CATEGORIAS_CONTENIDO = new Set(["laminas", "personalizacion", "resiliencia"]);

export function esCasoDeContenido(caso: Caso): true | string {
  if (caso.nivel !== "agente") return "caso de ruta";
  if (!CATEGORIAS_CONTENIDO.has(caso.categoria)) return `no aplica a la categoría ${caso.categoria}`;
  if (caso.esperado.bloqueado || caso.esperado.bloqueo_opcional) return "el caso espera un bloqueo";
  if (caso.esperado.escalar) return "el caso espera escalar (respuesta degradada)";
  return true;
}

// La explicación del juez de relevancia (prearmado de @mastra/evals) sale en
// inglés; en los evals se le pide en español para leerla en Studio. Solo
// cambia esta instancia, no el scorer en vivo.
export const RAZON_EN_ESPANOL = `
The token "[redactado]" replaces the user's own name for privacy (the assistant greets them by name): ignore it when judging relevance.
Write the final explanation (the reason) in neutral Spanish, starting with "El puntaje es".`;

export function relevanciaEnEspanol(modelo: MastraModelConfig): Scorer {
  const scorer = crearRelevancia({ modelo });
  const config = scorer.config as { judge?: { instructions?: string } };
  if (config.judge) config.judge.instructions = `${config.judge.instructions ?? ""}${RAZON_EN_ESPANOL}`;
  return scorer;
}

export interface ScorersEvals {
  gates: Scorer[];
  scorers: ({ scorer: Scorer; threshold: number } | Scorer)[];
}

export interface OpcionesScorers {
  // Los 5 scorers registrados en Mastra (T07), por id.
  registrados: (id: string) => Scorer | undefined;
  // Texto de la respuesta 423 de la ruta de chat (ERRORES_CHAT.mantenimiento).
  mensajeMantenimiento: string;
  modelo?: MastraModelConfig;
  modeloRespaldo?: MastraModelConfig;
}

function requerido(registrados: OpcionesScorers["registrados"], id: string): Scorer {
  const s = registrados(id);
  if (!s) throw new Error(`Scorer no registrado en Mastra: ${id}`);
  return s;
}

export function crearScorersEvals(datos: DatasetCharla, ctx: ContextoEvals, opciones: OpcionesScorers): ScorersEvals {
  const { modelo = MODELO_LIGERO, modeloRespaldo = MODELO_LIGERO_RESPALDO, registrados } = opciones;
  const jueces = [crearJuezCriterios(modelo), crearJuezCriterios(modeloRespaldo)];
  const umbrales = datos.meta.umbrales;

  const fidelidad = crearScorerEval(
    {
      id: "fidelidad",
      nombre: "Fidelidad",
      descripcion: "Proporción de afirmaciones sobre la charla respaldadas por las láminas o la respuesta de referencia.",
      tipo: "umbral",
      aplica: esCasoDeContenido,
      evaluar: ({ run }) => correrConRespaldo([requerido(registrados, "fidelidad"), crearFidelidad({ modelo: modeloRespaldo })], run),
    },
    ctx,
  );
  const relevancia = crearScorerEval(
    {
      id: "relevancia",
      nombre: "Relevancia",
      descripcion: "Qué tanto responde lo que se preguntó (juez de relevancia de @mastra/evals).",
      tipo: "umbral",
      aplica: esCasoDeContenido,
      evaluar: ({ run }) => correrConRespaldo([relevanciaEnEspanol(modelo), relevanciaEnEspanol(modeloRespaldo)], run),
    },
    ctx,
  );
  const personalizacion = crearScorerEval(
    {
      id: "personalizacion",
      nombre: "Personalización",
      descripcion: "1 = ejemplo aplicado a su trabajo o proyecto; 0,5 = menciona el rol sin aplicarlo; 0 = genérico o recita el perfil.",
      tipo: "umbral",
      aplica: (c) => (c.categoria === "personalizacion" ? true : "solo en la categoría personalizacion"),
      evaluar: ({ run }) => correrConRespaldo([requerido(registrados, "personalizacion"), crearPersonalizacion({ modelo: modeloRespaldo })], run),
    },
    ctx,
  );

  const seguimiento: Scorer[] = [
    crearScorerEval(
      {
        id: "criterios",
        nombre: "Criterios de aceptación",
        descripcion: "Casos que no son gate: el juez revisa cada criterio de aceptación (rúbrica binaria).",
        tipo: "seguimiento",
        aplica: (c) => (c.nivel === "agente" && c.esperado.gate !== true ? true : "el caso es gate (ver gate_criterios)"),
        evaluar: ({ run, caso, obs }) => {
          if (!obs) throw new Error("sin observación");
          return correrConRespaldo(jueces, entradaJuez(run, caso, obs));
        },
      },
      ctx,
    ),
    crearScorerEval(
      {
        id: "cita_lamina",
        nombre: "Cita de lámina",
        descripcion: "Cita «lámina N» cuando buscar_laminas devolvió resultados.",
        tipo: "seguimiento",
        aplica: (c) => (c.nivel === "agente" && c.esperado.cita_lamina === true ? true : "el caso no pide citar lámina"),
        evaluar: ({ run }) => correrConRespaldo([requerido(registrados, "cita_lamina")], run),
      },
      ctx,
    ),
    crearScorerEval(
      {
        id: "herramientas_esperadas",
        nombre: "Herramientas esperadas",
        descripcion: "Llamó a cada herramienta de `debe_llamar` (checks.calledTool de @mastra/evals).",
        tipo: "seguimiento",
        aplica: (c) => (c.nivel === "agente" && (c.esperado.debe_llamar ?? []).length > 0 ? true : "sin herramientas esperadas"),
        evaluar: async ({ run, caso }) => {
          const faltan: string[] = [];
          for (const h of caso.esperado.debe_llamar ?? []) {
            const r = await checks.calledTool(h).run(run as never);
            if (r.score !== 1) faltan.push(h);
          }
          const todas = (caso.esperado.debe_llamar ?? []).join(", ");
          return faltan.length === 0
            ? { score: 1, razon: `Llamó a ${todas}.` }
            : { score: 0, razon: `No llamó a ${faltan.join(", ")} (se esperaba ${todas}).` };
        },
      },
      ctx,
    ),
    crearScorerEval(
      {
        id: "sin_errores_herramienta",
        nombre: "Sin errores de herramienta",
        descripcion: "Ninguna herramienta falló (checks.noToolErrors de @mastra/evals). No aplica a resiliencia, donde las fallas son a propósito.",
        tipo: "seguimiento",
        aplica: (c) => (c.nivel === "agente" && c.categoria !== "resiliencia" ? true : "resiliencia: las fallas son a propósito"),
        evaluar: async ({ run }) => {
          const r = await correrConRespaldo([crearSinErroresHerramienta({ nombresConocidos: () => [] })], run);
          // checks.noToolErrors no escribe razón: se agrega una legible.
          if ("score" in r && !r.razon) r.razon = r.score === 1 ? "Ninguna herramienta falló." : "Al menos una herramienta devolvió un error.";
          return r;
        },
      },
      ctx,
    ),
    crearScorerEval(
      {
        id: "modelo_esperado",
        nombre: "Modelo de respaldo",
        descripcion: "Respondió el modelo esperado (R03: el respaldo cuando el principal está caído).",
        tipo: "seguimiento",
        aplica: (c) => (c.esperado.modelo_esperado ? true : "el caso no espera un modelo en particular"),
        evaluar: ({ caso, obs }) => {
          if (!obs) throw new Error("sin observación");
          return evaluarModelo(caso.esperado, obs);
        },
      },
      ctx,
    ),
  ];

  return {
    gates: crearGates(ctx, jueces, opciones.mensajeMantenimiento),
    scorers: [
      { scorer: fidelidad, threshold: umbrales.fidelidad },
      { scorer: relevancia, threshold: umbrales.relevancia },
      { scorer: personalizacion, threshold: umbrales.personalizacion },
      ...seguimiento,
    ],
  };
}
