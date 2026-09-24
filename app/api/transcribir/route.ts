import type { NextRequest } from "next/server";
import { ERRORES_CHAT } from "@/lib/chat";
import { interruptores } from "@/lib/db/interruptores";
import { costeTranscripcion, presupuesto, presupuestoMaximoUsd } from "@/lib/presupuesto";
import { limitadorTranscribir } from "@/lib/rate-limit";
import { errorInterno, noAutenticado, respuestaError } from "@/lib/respuestas";
import { estadoDe, leerSesion } from "@/lib/session";
import { TAMANO_MAXIMO_AUDIO, formatoDeAudio } from "@/lib/transcripcion";
import { transcribirAudio } from "@/src/mastra/voz";

export const ERRORES_TRANSCRIBIR = {
  audio_invalido: "No pudimos leer el audio. Intenta dictar de nuevo o escribe tu pregunta.",
  demasiados_dictados: "Vas muy rápido, espera unos segundos.",
  transcripcion_fallida: "No pudimos transcribir el audio. Intenta de nuevo o escribe tu pregunta.",
} as const;

function audioInvalido() {
  return respuestaError(400, "audio_invalido", ERRORES_TRANSCRIBIR.audio_invalido);
}

// Lee el cuerpo sin pasar del tope; null si está vacío o es demasiado grande.
async function leerAudio(request: NextRequest): Promise<Uint8Array | null> {
  const declarado = Number(request.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declarado) && declarado > TAMANO_MAXIMO_AUDIO) return null;
  const audio = new Uint8Array(await request.arrayBuffer());
  return audio.byteLength > 0 && audio.byteLength <= TAMANO_MAXIMO_AUDIO ? audio : null;
}

// POST /api/transcribir?duracion=<segundos> — cuerpo: el audio crudo con su
// Content-Type (audio/webm, audio/mp4…). Responde `{ texto }`. Privacidad
// (regla 6): el audio no se guarda y ni el audio ni el texto van a los logs.
export async function POST(request: NextRequest) {
  try {
    const actual = await leerSesion(request);
    if (!actual) return noAutenticado();
    const { asistente } = actual;
    if (estadoDe(asistente) !== "listo") return respuestaError(403, "falta_perfil", ERRORES_CHAT.falta_perfil);

    const valores = await interruptores.obtenerTodos();
    if (valores.kill_switch === "on") return respuestaError(423, "mantenimiento", ERRORES_CHAT.mantenimiento);

    const formato = formatoDeAudio(request.headers.get("content-type"));
    if (!formato) return audioInvalido();
    const audio = await leerAudio(request);
    if (!audio) return audioInvalido();

    const limite = limitadorTranscribir.consumir(asistente.id);
    if (!limite.permitido) {
      return respuestaError(429, "demasiados_dictados", ERRORES_TRANSCRIBIR.demasiados_dictados, {
        "Retry-After": String(limite.reintentarEnS),
      });
    }

    const tope = presupuestoMaximoUsd();
    if (tope !== null && (await presupuesto.acumulado()) >= tope) {
      await interruptores.actualizar("kill_switch", "on");
      return respuestaError(423, "mantenimiento", ERRORES_CHAT.mantenimiento);
    }

    const duracion = Number(request.nextUrl.searchParams.get("duracion") ?? Number.NaN);
    // Se cobra aunque falle: el proveedor pudo haber procesado el audio.
    const cobrar = () =>
      presupuesto.sumar(costeTranscripcion(duracion)).catch((error: unknown) => {
        console.error("[transcribir] no se pudo sumar el coste", { tipo: error instanceof Error ? error.name : typeof error });
      });

    let texto: string;
    try {
      texto = await transcribirAudio(audio, formato);
    } catch (error) {
      // Solo el tipo: el mensaje del proveedor podría traer datos.
      console.error("[transcribir] falló la transcripción", { tipo: error instanceof Error ? error.name : typeof error });
      await cobrar();
      return respuestaError(502, "transcripcion_fallida", ERRORES_TRANSCRIBIR.transcripcion_fallida);
    }
    await cobrar();
    return Response.json({ texto: texto.trim() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorInterno("transcribir", error);
  }
}
