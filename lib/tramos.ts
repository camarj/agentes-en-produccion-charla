// Tramos de la presentación: ÚNICO lugar donde se definen.
//
// Cada tramo agrupa láminas seguidas y tiene sus 3 preguntas sugeridas. Lo usan:
// - `/api/sugerencias`: el chat muestra las preguntas del tramo de `lamina_actual`;
// - el panel del speaker: un botón por tramo, que guarda `lamina_actual` = `hasta`
//   (la última lámina del tramo; así el agente puede hablar de todo el tramo).
//
// Si cambia una presentación, edita solo su lista:
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

// Una lista por presentación (los HTML están en la raíz del repo). La activa
// se elige al construir la imagen con NEXT_PUBLIC_PRESENTACION (va también al
// navegador): «espol» (por defecto) o «devfest».
export type Presentacion = "espol" | "devfest";

const PREGUNTAS_CONCEPTOS = [
  "¿Qué es un agente de IA?",
  "¿Qué es el loop de un agente?",
  "¿Qué es el harness y por qué importa?",
] as const;

const PREGUNTAS_PRODUCCION = [
  "¿Cómo hago que un agente sea resiliente cuando falla el modelo?",
  "¿Qué guardrails conviene poner en un agente en producción?",
  "¿Cómo uso evals y observabilidad para mejorar un agente?",
] as const;

export const TRAMOS_POR_PRESENTACION: Record<Presentacion, readonly Tramo[]> = {
  // ESPOL 2026-11-25: agentes-produccion-espol-60min.html (26 láminas).
  espol: [
    { id: "conceptos", desde: 1, hasta: 11, nombre: "Conceptos", preguntas: PREGUNTAS_CONCEPTOS },
    {
      id: "decision-diseno",
      desde: 12,
      hasta: 19,
      nombre: "Decisión y diseño",
      preguntas: [
        "¿Cómo decido si necesito un agente o basta un flujo fijo?",
        "¿Qué debe incluir el PRD de un agente?",
        "¿Qué es un patrón agéntico y cuáles se mostraron en la charla?",
      ],
    },
    { id: "produccion", desde: 20, hasta: 26, nombre: "En producción", preguntas: PREGUNTAS_PRODUCCION },
  ],
  // DevFest Guayaquil 2026-12-05: agentes-produccion-devfest-60min.html (25
  // láminas). No tiene la lámina «Qué es un patrón agéntico», solo los patrones.
  devfest: [
    { id: "conceptos", desde: 1, hasta: 8, nombre: "Conceptos", preguntas: PREGUNTAS_CONCEPTOS },
    {
      id: "decision-diseno",
      desde: 9,
      hasta: 17,
      nombre: "Decisión y diseño",
      preguntas: [
        "¿Cómo decido si necesito un agente o basta un flujo fijo?",
        "¿Qué debe incluir el PRD de un agente?",
        "¿Qué patrones de agentes se mostraron en la charla?",
      ],
    },
    { id: "produccion", desde: 18, hasta: 25, nombre: "En producción", preguntas: PREGUNTAS_PRODUCCION },
  ],
};

// `process.env.NEXT_PUBLIC_PRESENTACION` va escrito literal: Next lo reemplaza al construir.
export function presentacionActiva(valor: string | undefined = process.env.NEXT_PUBLIC_PRESENTACION): Presentacion {
  return valor?.trim().toLowerCase() === "devfest" ? "devfest" : "espol";
}

export const TRAMOS: readonly Tramo[] = TRAMOS_POR_PRESENTACION[presentacionActiva()];

// Tramo de una lámina (número o texto, como se guarda `lamina_actual`).
// Inválida o menor que la primera → primer tramo; mayor que la última → último.
export function tramoDeLamina(lamina: unknown, tramos: readonly Tramo[] = TRAMOS): Tramo {
  const n = typeof lamina === "number" ? lamina : Number.parseInt(String(lamina ?? ""), 10);
  const numero = Number.isFinite(n) ? n : tramos[0].desde;
  return tramos.find((t) => numero <= t.hasta) ?? tramos[tramos.length - 1];
}

// «Láminas 1–13 · Conceptos»
export function etiquetaTramo(t: Tramo): string {
  return `Láminas ${t.desde}–${t.hasta} · ${t.nombre}`;
}
