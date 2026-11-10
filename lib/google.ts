import { OAuth2Client, type TokenPayload } from "google-auth-library";

// Entrar con Google (DevFest 2026-12-05): el navegador recibe un ID token de
// Google Identity Services y el servidor lo verifica. Nunca se confía en un
// email escrito: solo abre sesión un token firmado por Google, emitido para
// nuestro client ID y con el email verificado.

export interface IdentidadGoogle {
  // Id estable de la cuenta de Google (`sub`). Sirve para el límite de intentos; nunca se registra.
  cuenta: string;
  email: string;
  nombre: string | null;
}

export interface VerificadorTokens {
  verifyIdToken(opciones: { idToken: string; audience: string }): Promise<{ getPayload(): TokenPayload | undefined }>;
}

export type VerificarCredencial = (credencial: string) => Promise<IdentidadGoogle | null>;

export function clienteIdGoogle(): string {
  const id = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
  if (!id) throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID ausente");
  return id;
}

// Devuelve la identidad, o null si Google rechaza el token (firma, vencido,
// otra audiencia) o el email no está verificado. Los errores de configuración
// (falta el client id) se lanzan: son nuestros, no del asistente.
export function crearVerificadorGoogle(
  opciones: { cliente?: VerificadorTokens; audiencia?: () => string } = {},
): VerificarCredencial {
  const audiencia = opciones.audiencia ?? clienteIdGoogle;
  let cliente = opciones.cliente;
  return async (credencial) => {
    const audience = audiencia();
    cliente ??= new OAuth2Client();
    let payload: TokenPayload | undefined;
    try {
      payload = (await cliente.verifyIdToken({ idToken: credencial, audience })).getPayload();
    } catch {
      return null;
    }
    if (!payload?.sub || !payload.email || payload.email_verified !== true) return null;
    const nombre = payload.name?.trim();
    return { cuenta: payload.sub, email: payload.email.trim().toLowerCase(), nombre: nombre ? nombre : null };
  };
}

export const verificarCredencialGoogle: VerificarCredencial = crearVerificadorGoogle();
