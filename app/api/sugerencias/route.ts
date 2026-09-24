import { NextResponse, type NextRequest } from "next/server";
import { interruptores } from "@/lib/db/interruptores";
import { errorInterno, noAutenticado } from "@/lib/respuestas";
import { leerSesion } from "@/lib/session";
import { tramoDeLamina } from "@/lib/tramos";

// GET → { sugerencias: string[3] }. Requiere sesión.
export async function GET(request: NextRequest) {
  try {
    if (!(await leerSesion(request))) return noAutenticado();
    const { lamina_actual } = await interruptores.obtenerTodos();
    // Next 16 no guarda en caché los GET de un route handler (y este lee la
    // cookie); igual se pide explícitamente que nadie en el camino lo guarde.
    return NextResponse.json(
      // Tres preguntas fijas por tramo (lib/tramos.ts), según `lamina_actual`.
      { sugerencias: [...tramoDeLamina(lamina_actual).preguntas] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorInterno("sugerencias", error);
  }
}
