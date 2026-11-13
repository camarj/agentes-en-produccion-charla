// Identificadores de los modelos, sin dependencias: los importa también la UI
// del panel (componentes de cliente), que no puede arrastrar el proveedor de
// Vertex ni google-auth-library al navegador.
export const ID_GEMINI = "gemini-3.8-flash";
export const MODELO_PRINCIPAL = `google-vertex/${ID_GEMINI}`;
export const MODELO_RESPALDO = "openai/gpt-6-luna";
export const MODELO_LIGERO = "openai/gpt-6-luna"; // guardrails y jueces (sin cambio)
export const MODELO_LIGERO_RESPALDO = "anthropic/claude-haiku-4-5";
