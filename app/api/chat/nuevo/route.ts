import { NextResponse, type NextRequest } from "next/server";
import { sesiones } from "@/lib/db/sesiones";
import { errorInterno, noAutenticado } from "@/lib/respuestas";
import { leerSesion } from "@/lib/session";

// POST /api/chat/nuevo → { ok: true }. «Nueva conversación» (T11): el asistente
// pasa a un hilo de memoria vacío. El tope de mensajes sigue contando.
export async function POST(request: NextRequest) {
  try {
    const actual = await leerSesion(request);
    if (!actual) return noAutenticado();
    if (!(await sesiones.nuevoHilo(actual.sesion.token))) return noAutenticado();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorInterno("nuevo", error);
  }
}
