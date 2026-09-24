import { createScorer, notScorable } from "@mastra/core/evals";
import { obtenerNombresAsistentes } from "../observabilidad/nombres";
import { prepararEjecucion, type NombresConocidos } from "../observabilidad/redaccion";
import { busquedasDeLaminas, esMensajeBloqueo, textoRespuesta } from "./ejecucion";

export const ID_CITA_LAMINA = "cita_lamina";
export const PATRON_CITA = /l[aá]mina \d+/i;

// Determinista: 1 si la respuesta cita una lámina cuando buscar_laminas
// devolvió resultados en esta ejecución. En cualquier otro caso la ejecución
// no es puntuable (`notScorable`): no se guarda puntaje ni cuenta en promedios.
export function crearCitaLamina({ nombresConocidos = obtenerNombresAsistentes }: { nombresConocidos?: NombresConocidos } = {}) {
  return createScorer({
    id: ID_CITA_LAMINA,
    name: "Cita de lámina",
    description: "1 si la respuesta cita «lámina N» cuando buscar_laminas devolvió resultados; se omite en otros casos.",
    type: "agent",
    prepareRun: prepararEjecucion({ nombresConocidos }),
  })
    .preprocess(({ run }) => {
      if (!busquedasDeLaminas(run.output).conResultados) return notScorable("buscar_laminas sin resultados o no llamada");
      const respuesta = textoRespuesta(run.output);
      if (!respuesta || esMensajeBloqueo(respuesta)) return notScorable("sin respuesta del agente");
      return { cita: PATRON_CITA.test(respuesta) };
    })
    .generateScore(({ results }) => (results.preprocessStepResult.cita ? 1 : 0))
    .generateReason(({ results }) =>
      results.preprocessStepResult.cita
        ? "La respuesta cita al menos una lámina."
        : "buscar_laminas devolvió resultados, pero la respuesta no cita ninguna lámina.",
    );
}

export const citaLamina = crearCitaLamina();
