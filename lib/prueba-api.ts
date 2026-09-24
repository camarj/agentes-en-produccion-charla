import { NextRequest } from "next/server";
import { NOMBRE_COOKIE } from "./session";

// Helpers de tests para las rutas de app/api: arman peticiones y leen la cookie.
export function peticion(
  ruta: string,
  opciones: { metodo?: string; cuerpo?: unknown; cookie?: string; cabeceras?: Record<string, string> } = {},
): NextRequest {
  const cabeceras = new Headers(opciones.cabeceras);
  if (opciones.cookie !== undefined) cabeceras.set("cookie", `${NOMBRE_COOKIE}=${opciones.cookie}`);
  let body: string | undefined;
  if (opciones.cuerpo !== undefined) {
    body = typeof opciones.cuerpo === "string" ? opciones.cuerpo : JSON.stringify(opciones.cuerpo);
    cabeceras.set("content-type", "application/json");
  }
  return new NextRequest(new URL(ruta, "http://localhost:3000"), {
    method: opciones.metodo ?? (body === undefined ? "GET" : "POST"),
    headers: cabeceras,
    body,
  });
}

// Valor de la cookie de sesión que setea una respuesta, o undefined.
export function cookieDe(respuesta: Response): string | undefined {
  const cabecera = respuesta.headers.get("set-cookie");
  const m = cabecera?.match(new RegExp(`(?:^|,\\s*)${NOMBRE_COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}
