// Dictado por voz: límites y formatos compartidos por el cliente y /api/transcribir.

export const DURACION_MAXIMA_DICTADO_S = 60;
// 60 s de webm/opus pesan ~0,5 MB y de mp4/aac ~1 MB: 5 MB deja holgura.
export const TAMANO_MAXIMO_AUDIO = 5 * 1024 * 1024;

// Formatos que acepta la API de transcripción de OpenAI (y OpenAIVoice.listen).
export type FormatoAudio = "webm" | "mp4" | "m4a" | "mp3" | "wav";

const FORMATOS: Record<string, FormatoAudio> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};

// Formato a partir del Content-Type (sin parámetros como `codecs`), o null.
export function formatoDeAudio(tipo: string | null | undefined): FormatoAudio | null {
  const base = (tipo ?? "").split(";")[0].trim().toLowerCase();
  return FORMATOS[base] ?? null;
}

// Preferencias de MediaRecorder: webm/opus en Chrome, Android y Firefox;
// mp4 (AAC) en Safari de iOS y macOS.
const PREFERIDOS = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mp4;codecs=mp4a.40.2"];

export function elegirTipoAudio(soportado: (tipo: string) => boolean): string | undefined {
  return PREFERIDOS.find((t) => {
    try {
      return soportado(t);
    } catch {
      return false;
    }
  });
}
