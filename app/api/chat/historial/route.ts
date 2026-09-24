import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import { NextResponse, type NextRequest } from "next/server";
import { errorInterno, noAutenticado } from "@/lib/respuestas";
import { leerSesion } from "@/lib/session";
import { mastra } from "@/src/mastra";

// GET /api/chat/historial → `{ messages: UIMessage[] }` (AI SDK v7) del hilo
// del asistente, para hidratar useChat al recargar. Sale de la memoria de
// Mastra: un turno bloqueado por los guardrails de entrada nunca se guardó.
// Cada mensaje del asistente lleva `metadata.trace_id` (para el feedback) si
// la traza existe.
export async function GET(request: NextRequest) {
  try {
    const actual = await leerSesion(request);
    if (!actual) return noAutenticado();
    const { sesion, asistente } = actual;
    const memoria = await mastra.getAgent("charla").getMemory();
    if (!memoria) return NextResponse.json({ messages: [] });

    // Sin preguntas todavía, el hilo no existe (y recall fallaría).
    const hilo = await memoria.getThreadById({ threadId: sesion.threadId });
    if (!hilo) return NextResponse.json({ messages: [] });
    const { messages: guardados } = await memoria.recall({
      threadId: sesion.threadId,
      resourceId: asistente.id,
      perPage: false,
    });
    const trazas = new Map<string, string>();
    for (const m of guardados) {
      const traceId = (m.content?.metadata as { traceId?: unknown } | undefined)?.traceId;
      if (typeof traceId === "string") trazas.set(m.id, traceId);
    }
    const messages = toAISdkMessages(guardados, { version: "v7" })
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const traceId = trazas.get(m.id);
        return {
          id: m.id,
          role: m.role,
          parts: m.parts,
          ...(m.role === "assistant" && traceId ? { metadata: { trace_id: traceId } } : {}),
        };
      });
    return NextResponse.json({ messages });
  } catch (error) {
    return errorInterno("historial", error);
  }
}
