// Tramos de la presentación: ÚNICO lugar donde se definen.
//
// Cada tramo agrupa láminas seguidas y tiene sus 3 preguntas sugeridas. Lo usan:
// - `/api/sugerencias`: el chat muestra las preguntas del tramo de `lamina_actual`;
// - el panel del speaker: un botón por tramo, que guarda `lamina_actual` = `hasta`
//   (la última lámina del tramo; así el agente puede hablar de todo el tramo).
//
// Si cambia la presentación, edita solo esta lista:
// - los tramos van en orden, sin huecos: el primero empieza en 1 y cada uno
//   empieza en la lámina siguiente al `hasta` del anterior;
// - el `hasta` del último es el total de láminas (el panel y la API lo usan
//   como tope de `lamina_actual`);
// - `nombre` es corto (se lee en el proyector) y hay exactamente 3 preguntas.
// `lib/tramos.test.ts` avisa si algo queda mal armado.
//
// Este módulo va también al navegador: sin imports de servidor.

export interface Tramo {
  id: string;
  desde: number;
  hasta: number;
  nombre: string;
  preguntas: readonly [string, string, string];
}

export const TRAMOS: readonly Tramo[] = [
  {
    id: "conceptos",
    desde: 1,
    hasta: 13,
    nombre: "Conceptos",
    preguntas: [
      "¿Qué diferencia a un agente de un chatbot?",
      "¿Qué es el loop de un agente?",
      "¿Qué es el harness y por qué importa?",
    ],
  },
  {
    id: "decision-diseno",
    desde: 14,
    hasta: 32,
    nombre: "Decisión y diseño",
    preguntas: [
      "¿Cómo decido si necesito un agente o basta un flujo fijo?",
      "¿Qué debe incluir el PRD de un agente?",
      "¿Qué es un patrón agéntico y cuáles se mostraron en la charla?",
    ],
  },
  {
    id: "produccion",
    desde: 33,
    hasta: 40,
    nombre: "En producción",
    preguntas: [
      "¿Cómo hago que un agente sea resiliente cuando falla el modelo?",
      "¿Qué guardrails conviene poner en un agente en producción?",
      "¿Cómo uso evals y observabilidad para mejorar un agente?",
    ],
  },
];

// Tramo de una lámina (número o texto, como se guarda `lamina_actual`).
// Inválida o menor que la primera → primer tramo; mayor que la última → último.
export function tramoDeLamina(lamina: unknown): Tramo {
  const n = typeof lamina === "number" ? lamina : Number.parseInt(String(lamina ?? ""), 10);
  const numero = Number.isFinite(n) ? n : TRAMOS[0].desde;
  return TRAMOS.find((t) => numero <= t.hasta) ?? TRAMOS[TRAMOS.length - 1];
}

// «Láminas 1–13 · Conceptos»
export function etiquetaTramo(t: Tramo): string {
  return `Láminas ${t.desde}–${t.hasta} · ${t.nombre}`;
}
