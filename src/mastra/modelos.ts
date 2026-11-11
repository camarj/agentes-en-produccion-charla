import { createVertex } from "@ai-sdk/google-vertex";
import { ID_GEMINI } from "./modelos-ids";

export { ID_GEMINI, MODELO_LIGERO, MODELO_LIGERO_RESPALDO, MODELO_PRINCIPAL, MODELO_RESPALDO } from "./modelos-ids";

// Modelos del proyecto. Desde el DevFest (decisión de Raúl, 2026-11-10; PRD
// §15 G5): Gemini es el principal y OpenAI el respaldo. Gemini va por Vertex
// AI (no por Google AI Studio) para que lo cubran los créditos de Google Cloud.
//
// El principal se identifica como «google-vertex/gemini-3.8-flash» en todo el
// código (panel, precios, evals, interruptores de caos); el modelo real lo
// crea `modeloPrincipal()`.

// Credenciales de Vertex (las lee el proveedor del entorno):
// - GOOGLE_VERTEX_PROJECT + credenciales por defecto de Google (cuenta de
//   servicio en Cloud Run o GOOGLE_APPLICATION_CREDENTIALS en local), o
// - GOOGLE_VERTEX_API_KEY (modo express, sin proyecto ni región).
// Región: `global` (donde Gemini 3.8 Flash está disponible y es más barato que
// los endpoints regionales); se cambia con GOOGLE_VERTEX_LOCATION.
export function modeloPrincipal() {
  const location = process.env.GOOGLE_VERTEX_LOCATION?.trim() || "global";
  return createVertex({ location })(ID_GEMINI);
}

// Opciones de proveedor para guardrails y jueces rápidos. gpt-6-luna es un
// modelo de razonamiento (esfuerzo `medium` por defecto): con `none` responde
// en ~1 s en vez de ~2-3 s. Anthropic ignora la clave `openai`.
export const OPCIONES_PROVEEDOR_LIGERO = { openai: { reasoningEffort: "none" } } as const;

// Razonamiento bajo en el agente: con el nivel por defecto (`medium`) el primer
// token tarda más. Gemini 3.8 Flash no admite `minimal`.
export const OPCIONES_PROVEEDOR_PRINCIPAL = { vertex: { thinkingConfig: { thinkingLevel: "low" } } } as const;
// gpt-6-luna como respaldo: esfuerzo `low` (con `medium`, ~10 s al primer token).
export const OPCIONES_PROVEEDOR_RESPALDO = { openai: { reasoningEffort: "low" } } as const;
