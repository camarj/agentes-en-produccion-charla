import { NextResponse, type NextRequest } from "next/server";
import { errorInterno } from "@/lib/respuestas";
import { estadoDe, leerSesion, nombrePila } from "@/lib/session";

// GET → { autenticado, estado, nombre_pila? }. Sin sesión válida:
// { autenticado: false, estado: 'sin_sesion' } (200, para que la UI decida).
export async function GET(request: NextRequest) {
  try {
    const actual = await leerSesion(request);
    if (!actual) return NextResponse.json({ autenticado: false, estado: "sin_sesion" });
    const pila = nombrePila(actual.asistente.nombre);
    return NextResponse.json({
      autenticado: true,
      estado: estadoDe(actual.asistente),
      ...(pila ? { nombre_pila: pila } : {}),
    });
  } catch (error) {
    return errorInterno("sesion", error);
  }
}
