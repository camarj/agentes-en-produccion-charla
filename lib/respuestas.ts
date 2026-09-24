import { NextResponse } from "next/server";

// Errores de las rutas: `{ error: codigo, mensaje }`, con mensaje en español
// para el asistente. Nunca llevan detalles técnicos.
export function respuestaError(status: number, error: string, mensaje: string, headers?: HeadersInit) {
  return NextResponse.json({ error, mensaje }, { status, headers });
}

export function noAutenticado() {
  return respuestaError(401, "no_autenticado", "Tu sesión expiró o no es válida. Vuelve a ingresar con tu correo.");
}

// Registra solo el tipo de error (nunca emails, nombres ni el mensaje, que
// podría traer datos) y responde un 500 genérico.
export function errorInterno(ruta: string, error: unknown) {
  const tipo = error instanceof Error ? error.name : typeof error;
  const codigo = (error as { code?: unknown } | null)?.code;
  console.error(`[${ruta}] error interno`, { tipo, ...(typeof codigo === "string" ? { codigo } : {}) });
  return respuestaError(500, "error_interno", "Algo salió mal. Intenta de nuevo en un momento.");
}

// Cuerpo JSON de la petición, o undefined si no es JSON válido.
export async function leerJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
