import { createScorer, notScorable } from "@mastra/core/evals";
import type { MastraModelConfig } from "@mastra/core/llm";
import { z } from "zod";
import { MODELO_LIGERO } from "../modelos";
import { obtenerNombresAsistentes } from "../observabilidad/nombres";
import { normalizar, prepararEjecucion, redactarTexto, type NombresConocidos } from "../observabilidad/redaccion";
import { esMensajeBloqueo, invocaciones, preguntaUsuario, recortarRazon, textoRespuesta, valorContexto } from "./ejecucion";

export const ID_PERSONALIZACION = "personalizacion";

export const INSTRUCCIONES_JUEZ_PERSONALIZACION = `You evaluate whether a chat assistant applied its explanation to the
work of the person asking. A good answer gives a concrete example applied to what that person does or
builds; it may refer to their work or project naturally, but it must never recite or confirm the stored
profile data. You never quote the occupation or the project description in your reason. Write the
reason in neutral Spanish.`;

export const esquemaPersonalizacion = z.object({
  // La respuesta explica algún concepto. Si es false (gracias, saludo,
  // despedida, charla trivial), el turno no se puntúa.
  explica_concepto: z.boolean(),
  // El ejemplo se aplica al trabajo o proyecto de la persona.
  ejemplo_aplicado: z.boolean(),
  // La respuesta nombra el rol (o una variante evidente).
  menciona_rol: z.boolean(),
  // Recita o confirma los datos guardados ("tu rol registrado es…").
  recita_datos: z.boolean(),
  razon: z.string(),
});

export type AnalisisPersonalizacion = z.infer<typeof esquemaPersonalizacion>;

// Rúbrica 1.1.0 (Raúl, 2026-09-23): 1 si el ejemplo se aplica a su trabajo o
// proyecto (aludirlo con naturalidad está bien); 0,5 si menciona el rol sin
// aplicarlo; 0 si es genérico o si recita los datos guardados.
export function puntajePersonalizacion(a: AnalisisPersonalizacion): number {
  if (a.recita_datos) return 0;
  if (a.ejemplo_aplicado) return 1;
  return a.menciona_rol ? 0.5 : 0;
}

// Omisión determinista (sin gastar juez): un turno sin herramientas y con
// una respuesta corta es un agradecimiento, un saludo o una despedida. Una
// explicación con ejemplo aplicado ocupa 3–7 frases (instrucciones 1.1.0).
export const LARGO_MINIMO_EXPLICACION = 160;

export function sinConceptoQueExplicar(output: unknown, respuesta: string): boolean {
  return invocaciones(output).length === 0 && respuesta.length < LARGO_MINIMO_EXPLICACION;
}

export const MOTIVO_SIN_CONCEPTO = "sin concepto que explicar";

export interface DatosPersonalizacion {
  rol: string | null;
  // Qué construye o quiere construir con IA, ya redactada (sin emails ni nombres).
  descripcion: string | null;
  pregunta: string;
  respuesta: string;
}

const NO_INDICADO = "(not provided)";

export function promptPersonalizacion(d: DatosPersonalizacion): string {
  const rol = d.rol ? `"${d.rol}"` : NO_INDICADO;
  const descripcion = d.descripcion ? `"${d.descripcion}"` : NO_INDICADO;
  return `Occupation of the person asking (private, never quote it): ${rol}
What they build or want to build with AI (private, never quote it): ${descripcion}

User question:
"""
${d.pregunta}
"""

Assistant answer:
"""
${d.respuesta}
"""

Decide:
- explica_concepto: false if the answer does not explain any concept (thanks, greetings, goodbyes,
  small talk, a short acknowledgement, or an answer without an explanation); true otherwise.
- ejemplo_aplicado: true if the answer gives at least one concrete example or scenario applied to that
  person's work, to their project (what they build or want to build with AI) or to what such a person
  would build with AI. Referring to their work or project
  naturally is fine (e.g. "piénsalo con tu agente de WhatsApp…"). False if the examples are generic
  (would fit anyone) or there is no example.
- menciona_rol: true if the answer names the occupation or an obvious variant
  (e.g. "como abogada…", "en tu trabajo de docente…").
- recita_datos: true if the answer recites, lists or confirms the stored profile data as data
  (e.g. "tu rol registrado es…", "según tu perfil eres…", "tengo guardado que…").
- razon: one short sentence in Spanish. Refer to them only as "el perfil" or "su proyecto";
  never write the occupation or the project description.

Return JSON: { "explica_concepto": boolean, "ejemplo_aplicado": boolean, "menciona_rol": boolean, "recita_datos": boolean, "razon": string }`;
}

// La razón se guarda en la traza y en la fila del puntaje: si el juez igual
// escribió el rol o la descripción, se reemplazan.
export function razonSinPerfil(razon: string, valores: ReadonlyArray<string | null>): string {
  const terminos = valores.map((v) => (v ? normalizar(v) : "")).filter(Boolean);
  return recortarRazon(redactarTexto(razon, terminos));
}

export interface OpcionesPersonalizacion {
  modelo?: MastraModelConfig;
  nombresConocidos?: NombresConocidos;
}

export function crearPersonalizacion({
  modelo = MODELO_LIGERO,
  nombresConocidos = obtenerNombresAsistentes,
}: OpcionesPersonalizacion = {}) {
  return createScorer({
    id: ID_PERSONALIZACION,
    name: "Personalización",
    description: "¿El ejemplo se aplica al trabajo o proyecto del asistente sin recitar su perfil? 1 / 0,5 / 0. Omite turnos sin concepto que explicar.",
    type: "agent",
    judge: { model: modelo, instructions: INSTRUCCIONES_JUEZ_PERSONALIZACION },
    // El juez necesita el rol y la descripción: son las únicas claves
    // personales que se conservan. Excepción aceptada (T07): pueden quedar en
    // la fila del puntaje; la descripción llega ya sin emails ni nombres.
    prepareRun: prepararEjecucion({ conservar: ["rol", "descripcion"], nombresConocidos }),
  })
    .preprocess(({ run }): DatosPersonalizacion | ReturnType<typeof notScorable> => {
      const rol = valorContexto(run.requestContext, "rol");
      const descripcion = valorContexto(run.requestContext, "descripcion");
      if (!rol && !descripcion) return notScorable("sin perfil en el contexto");
      const respuesta = textoRespuesta(run.output);
      if (!respuesta) return notScorable("sin respuesta de texto");
      if (esMensajeBloqueo(respuesta)) return notScorable("respuesta de guardrail");
      if (sinConceptoQueExplicar(run.output, respuesta)) return notScorable(MOTIVO_SIN_CONCEPTO);
      return { rol, descripcion, pregunta: preguntaUsuario(run.input), respuesta };
    })
    .analyze({
      description: "Evalúa si hay un concepto que explicar, si el ejemplo se aplica a su trabajo o proyecto, si menciona el rol y si recita el perfil.",
      outputSchema: esquemaPersonalizacion,
      createPrompt: ({ results }) => promptPersonalizacion(results.preprocessStepResult),
    })
    .generateScore(({ results }) =>
      results.analyzeStepResult.explica_concepto ? puntajePersonalizacion(results.analyzeStepResult) : notScorable(MOTIVO_SIN_CONCEPTO),
    )
    .generateReason(({ results }) =>
      razonSinPerfil(results.analyzeStepResult.razon, [results.preprocessStepResult.rol, results.preprocessStepResult.descripcion]),
    );
}

export const personalizacion = crearPersonalizacion();
