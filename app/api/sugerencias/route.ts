import { NextResponse, type NextRequest } from "next/server";
import { interruptores } from "@/lib/db/interruptores";
import { errorInterno, noAutenticado } from "@/lib/respuestas";
import { leerSesion } from "@/lib/session";

// Tres preguntas fijas por tramo de la presentación (según `lamina_actual`).
const TRAMOS: { hasta: number; preguntas: [string, string, string] }[] = [
  {
    hasta: 13,
    preguntas: [
      "¿Qué diferencia a un agente de un chatbot?",
      "¿Qué es el loop de un agente?",
      "¿Qué es el harness y por qué importa?",
    ],
  },
  {
    hasta: 31,
    preguntas: [
      "¿Cómo decido si necesito un agente o basta un flujo fijo?",
      "¿Qué debe incluir el PRD de un agente?",
      "¿Qué patrones de diseño de agentes se mostraron en la charla?",
    ],
  },
  {
    hasta: Number.POSITIVE_INFINITY,
    preguntas: [
      "¿Cómo hago que un agente sea resiliente cuando falla el modelo?",
      "¿Qué guardrails conviene poner en un agente en producción?",
      "¿Cómo uso evals y observabilidad para mejorar un agente?",
    ],
  },
];

// Lámina inválida o menor que 1 → primer tramo; mayor que 39 → último tramo.
function preguntasPara(lamina: string): string[] {
  const n = Number.parseInt(lamina, 10);
  const numero = Number.isFinite(n) && n >= 1 ? n : 1;
  return [...TRAMOS.find((t) => numero <= t.hasta)!.preguntas];
}

// GET → { sugerencias: string[3] }. Requiere sesión.
export async function GET(request: NextRequest) {
  try {
    if (!(await leerSesion(request))) return noAutenticado();
    const { lamina_actual } = await interruptores.obtenerTodos();
    // Next 16 no guarda en caché los GET de un route handler (y este lee la
    // cookie); igual se pide explícitamente que nadie en el camino lo guarde.
    return NextResponse.json(
      { sugerencias: preguntasPara(lamina_actual) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorInterno("sugerencias", error);
  }
}
