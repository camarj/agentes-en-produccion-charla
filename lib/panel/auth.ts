import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

// Basic Auth del panel del speaker (T12). Solo cuenta la contraseña
// (PANEL_PASSWORD); el usuario que escriba el navegador se ignora. Sin
// PANEL_PASSWORD nadie entra (falla cerrada).

export const REALM_PANEL = "Panel del speaker";

// Contraseña de una cabecera `Authorization: Basic …`, o null.
export function contrasenaDeBasicAuth(cabecera: string | null | undefined): string | null {
  const m = cabecera?.match(/^Basic\s+([A-Za-z0-9+/=]+)\s*$/i);
  if (!m) return null;
  const decodificada = Buffer.from(m[1], "base64").toString("utf8");
  const separador = decodificada.indexOf(":");
  return separador === -1 ? null : decodificada.slice(separador + 1);
}

// Comparación en tiempo constante: se comparan los hash SHA-256 (mismo largo),
// así el tiempo no revela ni el contenido ni el largo de la contraseña.
export function contrasenaValida(recibida: string | null | undefined, esperada: string | null | undefined): boolean {
  if (!esperada || !esperada.trim() || typeof recibida !== "string") return false;
  const a = createHash("sha256").update(recibida, "utf8").digest();
  const b = createHash("sha256").update(esperada, "utf8").digest();
  return timingSafeEqual(a, b);
}

export function autorizadoPanel(request: Request): boolean {
  return contrasenaValida(contrasenaDeBasicAuth(request.headers.get("authorization")), process.env.PANEL_PASSWORD);
}

export function noAutorizado() {
  return NextResponse.json(
    { error: "no_autorizado", mensaje: "Necesitas la contraseña del panel." },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Basic realm="${REALM_PANEL}", charset="UTF-8"`,
        "Cache-Control": "no-store",
      },
    },
  );
}
