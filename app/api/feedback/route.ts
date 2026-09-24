import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { feedback as repoFeedback } from "@/lib/db/feedback";
import { errorInterno, leerJson, noAutenticado, respuestaError } from "@/lib/respuestas";
import { leerSesion } from "@/lib/session";
import { mastra } from "@/src/mastra";

const esquema = z.object({
  trace_id: z.string().trim().min(1).max(128),
  valor: z.union([z.literal(1), z.literal(-1)]),
});

// Copia del voto en la observabilidad de Mastra (pestaña Feedback de la traza
// en Studio), sin esperar ni reintentar. Solo se guarda con
// OBSERVABILIDAD_DATABASE_URL (Postgres); sin ella, LibSQL no soporta feedback
// y la llamada falla sin efecto. Mastra solo agrega registros: si alguien
// cambia 👍 por 👎, en Studio quedan los dos con su hora; el voto vigente es el
// de charla.db. Solo se registra el tipo de error: el mensaje podría traer datos.
function enviarAObservabilidad(traceId: string, valor: 1 | -1) {
  Promise.resolve()
    .then(() =>
      mastra.observability.addFeedback?.({
        traceId,
        feedback: { feedbackSource: "user", feedbackType: "rating", value: valor },
      }),
    )
    .catch((error: unknown) => {
      console.error("[feedback] no se pudo enviar a la observabilidad", {
        tipo: error instanceof Error ? error.name : typeof error,
      });
    });
}

// POST { trace_id, valor: 1 | -1 } → { ok: true }. El voto se guarda en la
// tabla `feedback` de charla.db (fuente de verdad; un voto por asistente y
// traza, el último reemplaza al anterior) y luego se copia a la observabilidad.
// A la observabilidad no va ningún dato personal.
export async function POST(request: NextRequest) {
  try {
    const actual = await leerSesion(request);
    if (!actual) return noAutenticado();
    const datos = esquema.safeParse(await leerJson(request));
    if (!datos.success) {
      return respuestaError(400, "feedback_invalido", "No pudimos registrar tu valoración. Intenta de nuevo.");
    }
    const { trace_id: traceId, valor } = datos.data;
    await repoFeedback.registrar({ asistenteId: actual.asistente.id, traceId, valor });
    enviarAObservabilidad(traceId, valor);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorInterno("feedback", error);
  }
}
