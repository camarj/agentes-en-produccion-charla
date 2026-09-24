// El speaker de la charla (decisión de Raúl, 2026-09-23). No es un asistente:
// no se importa en `asistentes`, y su nombre puede aparecer en respuestas y
// trazas (el agente habla de él y de su charla).
// Desvío: en el export real de Luma el speaker está inscrito con su correo de
// Inteliside, no con el de Gmail; se incluyen ambos.
export const EMAILS_SPEAKER = ["raulj.camacho@gmail.com", "raulj.camacho@inteliside.com"] as const;
export const NOMBRE_SPEAKER = "Raúl Camacho";

function normalizarNombre(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function esEmailSpeaker(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return EMAILS_SPEAKER.some((s) => s === e);
}

// Nombre completo del speaker, sin tildes ni mayúsculas.
export const NOMBRE_SPEAKER_NORMALIZADO = normalizarNombre(NOMBRE_SPEAKER);

export function esNombreSpeaker(nombre: string | null | undefined): boolean {
  return !!nombre && normalizarNombre(nombre) === NOMBRE_SPEAKER_NORMALIZADO;
}
