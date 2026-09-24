import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { FallbackModelo, modelosConRespaldo } from "../processors/fallback-modelo";
import { GuardiaEntrada } from "../processors/guardia-entrada";
import { RespuestaFinal } from "../processors/respuesta-final";
import { SinDatosPersonales } from "../processors/sin-datos-personales";
import { scorersDelAgente } from "../scorers";
import { almacenamiento } from "../storage";
import { buscarLaminas } from "../tools/buscar-laminas";
import { escalarPregunta } from "../tools/escalar-pregunta";
import { VERSION_INSTRUCCIONES, construirInstrucciones } from "./instructions";

export const MAX_PASOS = 5;

// Guardrails de entrada (inyección ∥ alcance) en paralelo con el agente: la
// misma instancia va en entrada (lanza/lee el veredicto, una vez por mensaje) y
// en salida (retiene o corta hasta conocerlo). Ver guardia-entrada.ts y turno.ts.
const guardiaEntrada = new GuardiaEntrada();

export const charla = new Agent({
  id: "charla",
  name: "Asistente de la charla",
  instructions: ({ requestContext }) => construirInstrucciones(requestContext),
  // OpenAI (MODELO_PRINCIPAL) con 1 reintento y, si vuelve a fallar, Anthropic
  // (MODELO_RESPALDO), con el fallback nativo de Mastra.
  model: modelosConRespaldo(),
  tools: { buscar_laminas: buscarLaminas, escalar_pregunta: escalarPregunta },
  memory: new Memory({ storage: almacenamiento, options: { lastMessages: 20 } }),
  // GuardiaEntrada no espera a los guardrails: el primer paso del modelo
  // arranca enseguida. Luego los procesadores por paso de T05.
  inputProcessors: [guardiaEntrada, new FallbackModelo(), new RespuestaFinal(MAX_PASOS)],
  // GuardiaEntrada primero (nada sale sin veredicto); después se reemplaza la
  // respuesta si trae emails o datos de asistentes.
  outputProcessors: [guardiaEntrada, new SinDatosPersonales()],
  // Scorers en vivo (T07): fidelidad, relevancia, sin errores y cita al 100 %;
  // personalización al 50 %.
  scorers: scorersDelAgente,
  defaultOptions: {
    maxSteps: MAX_PASOS,
    // Queda en la metadata del span raíz (agent_run) de cada traza.
    tracingOptions: { metadata: { version_instrucciones: VERSION_INSTRUCCIONES } },
  },
});
