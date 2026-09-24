// Limitador en memoria, ventana fija por clave (IP o asistente). Vive en el
// proceso: se reinicia con el servidor y no se comparte entre réplicas.
export interface ResultadoLimite {
  permitido: boolean;
  reintentarEnS: number;
}

const MAX_CLAVES_ANTES_DE_LIMPIAR = 5000;

export function crearLimitador({ limite, ventanaMs }: { limite: number; ventanaMs: number }) {
  const registros = new Map<string, { inicio: number; cuenta: number }>();

  function limpiarVencidos(ahora: number) {
    for (const [clave, r] of registros) if (ahora - r.inicio >= ventanaMs) registros.delete(clave);
  }

  function consumir(clave: string, ahora = Date.now()): ResultadoLimite {
    if (registros.size > MAX_CLAVES_ANTES_DE_LIMPIAR) limpiarVencidos(ahora);
    let r = registros.get(clave);
    if (!r || ahora - r.inicio >= ventanaMs) {
      r = { inicio: ahora, cuenta: 0 };
      registros.set(clave, r);
    }
    r.cuenta += 1;
    if (r.cuenta <= limite) return { permitido: true, reintentarEnS: 0 };
    return { permitido: false, reintentarEnS: Math.max(1, Math.ceil((r.inicio + ventanaMs - ahora) / 1000)) };
  }

  function reiniciar() {
    registros.clear();
  }

  return { consumir, reiniciar };
}

// RF-01 pedía 10/min; Raúl lo subió a 60/min porque el público comparte la IP del Wi‑Fi del lugar.
export const LIMITE_IDENTIFICAR_POR_MINUTO = 60;
export const limitadorIdentificar = crearLimitador({ limite: LIMITE_IDENTIFICAR_POR_MINUTO, ventanaMs: 60_000 });

// IP del cliente detrás del proxy (Traefik en Dokploy fija x-forwarded-for).
export function ipDe(request: Request): string {
  const reenviada = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (reenviada) return reenviada;
  return request.headers.get("x-real-ip")?.trim() || "desconocida";
}

// Chat (T09): 10 mensajes por minuto por asistente (no por IP).
export const LIMITE_CHAT_POR_MINUTO = 10;
export const limitadorChat = crearLimitador({ limite: LIMITE_CHAT_POR_MINUTO, ventanaMs: 60_000 });

// Dictado por voz: 10 audios por minuto por asistente.
export const LIMITE_TRANSCRIBIR_POR_MINUTO = 10;
export const limitadorTranscribir = crearLimitador({ limite: LIMITE_TRANSCRIBIR_POR_MINUTO, ventanaMs: 60_000 });
