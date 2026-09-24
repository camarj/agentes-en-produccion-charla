// Modelos del proyecto (decisión de Raúl, 2026-09-23): OpenAI es el proveedor
// principal y Anthropic el respaldo. Todos los ids existen en el registro de
// proveedores de @mastra/core 1.69 (provider-registry.json).
export const MODELO_PRINCIPAL = "openai/gpt-6-luna";
export const MODELO_RESPALDO = "anthropic/claude-sonnet-5";
export const MODELO_LIGERO = "openai/gpt-6-luna"; // guardrails y jueces
export const MODELO_LIGERO_RESPALDO = "anthropic/claude-haiku-4-5";

// Opciones de proveedor para guardrails y jueces rápidos. gpt-6-luna es un
// modelo de razonamiento (esfuerzo `medium` por defecto): con `none` responde
// en ~1 s en vez de ~2-3 s. Anthropic ignora la clave `openai`.
export const OPCIONES_PROVEEDOR_LIGERO = { openai: { reasoningEffort: "none" } } as const;

// Opciones de proveedor del modelo principal del agente. Con el esfuerzo por
// defecto (`medium`) el primer token tardaba ~10 s (p50); con `low`, ~5 s.
export const OPCIONES_PROVEEDOR_PRINCIPAL = { openai: { reasoningEffort: "low" } } as const;
