import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { asistentes as repoAsistentes, type Asistente } from "./db/asistentes";
import { sesiones as repoSesiones, type Sesion } from "./db/sesiones";

// Cookie `sesion` = `<token de sesiones>.<vence (s epoch)>.<HMAC-SHA256>`.
// El token apunta a una fila de `sesiones` (asistente e hilo); la firma impide
// manipularlo y el vencimiento corta la sesión a las 12 h.
export const NOMBRE_COOKIE = "sesion";
export const DURACION_SESION_S = 12 * 60 * 60;
const LARGO_MINIMO_SECRETO = 16;

export type EstadoPerfil = "listo" | "falta_perfil" | "nuevo";

export interface SesionActual {
  sesion: Sesion;
  asistente: Asistente;
}

function secreto(): string {
  const valor = process.env.SESSION_SECRET ?? "";
  if (valor.length < LARGO_MINIMO_SECRETO) {
    throw new Error(`SESSION_SECRET ausente o con menos de ${LARGO_MINIMO_SECRETO} caracteres`);
  }
  return valor;
}

function firmar(datos: string): string {
  return crypto.createHmac("sha256", secreto()).update(datos).digest("base64url");
}

export function firmarToken(token: string, ahoraMs = Date.now()): string {
  const vence = Math.floor(ahoraMs / 1000) + DURACION_SESION_S;
  const datos = `${token}.${vence}`;
  return `${datos}.${firmar(datos)}`;
}

// Devuelve el token de sesión si la firma es válida y no venció; si no, null.
export function verificarToken(valor: string | null | undefined, ahoraMs = Date.now()): string | null {
  if (!valor) return null;
  const partes = valor.split(".");
  if (partes.length !== 3) return null;
  const [token, vence, firma] = partes;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(token) || !/^\d{1,12}$/.test(vence)) return null;
  const esperada = Buffer.from(firmar(`${token}.${vence}`));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
  if (Number(vence) * 1000 <= ahoraMs) return null;
  return token;
}

// `secure` siempre, salvo en `next dev`: Safari no guarda cookies `Secure` en
// http://localhost y los teléfonos de prueba en la LAN entran por http.
export function opcionesCookie() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax" as const,
    path: "/",
    maxAge: DURACION_SESION_S,
  };
}

export function establecerCookieSesion<T extends NextResponse>(respuesta: T, token: string): T {
  respuesta.cookies.set({ name: NOMBRE_COOKIE, value: firmarToken(token), ...opcionesCookie() });
  return respuesta;
}

// Sesión de la petición (cookie válida + fila en `sesiones` + asistente), o null.
export async function leerSesion(
  request: NextRequest,
  deps: { sesiones?: Pick<typeof repoSesiones, "obtener">; asistentes?: Pick<typeof repoAsistentes, "obtenerPorId"> } = {},
): Promise<SesionActual | null> {
  const token = verificarToken(request.cookies.get(NOMBRE_COOKIE)?.value);
  if (!token) return null;
  const sesion = await (deps.sesiones ?? repoSesiones).obtener(token);
  if (!sesion) return null;
  const asistente = await (deps.asistentes ?? repoAsistentes).obtenerPorId(sesion.asistenteId);
  return asistente ? { sesion, asistente } : null;
}

export function nombrePila(nombre: string | null | undefined): string | undefined {
  const primera = (nombre ?? "").trim().split(/\s+/)[0];
  return primera ? primera : undefined;
}

export function estadoDe(asistente: Pick<Asistente, "nombre" | "rol">): EstadoPerfil {
  if (asistente.rol?.trim()) return "listo";
  return asistente.nombre.trim() ? "falta_perfil" : "nuevo";
}
