// Tiempo límite y reintentos acotados para las herramientas del agente.

export class ToolUnavailableError extends Error {
  constructor(message = "Herramienta no disponible") {
    super(message);
    this.name = "ToolUnavailableError";
  }
}

export class TiempoAgotadoError extends Error {
  constructor(ms: number) {
    super(`El intento superó ${ms} ms`);
    this.name = "TiempoAgotadoError";
  }
}

export class ReintentosAgotadosError extends Error {
  readonly intentos: number;
  constructor(intentos: number, cause: unknown) {
    super(`Fallaron ${intentos} intentos`, { cause });
    this.name = "ReintentosAgotadosError";
    this.intentos = intentos;
  }
}

export interface OpcionesReintento {
  intentos: number;
  timeoutMs: number;
  /** Espera antes del intento i+1; si faltan valores se repite el último. */
  esperas: number[];
  /** Señal externa (p. ej. el abortSignal de la herramienta): corta sin más intentos. */
  signal?: AbortSignal;
}

export interface ResultadoReintentos<T> {
  valor: T;
  intentos: number;
}

export const REINTENTOS_POR_DEFECTO: OpcionesReintento = {
  intentos: 3,
  timeoutMs: 5000,
  esperas: [300, 900],
};

function motivoAborto(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Operación abortada");
}

// Espera cancelable: si la señal se aborta, limpia el temporizador y rechaza.
export function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(motivoAborto(signal));
    const alAbortar = () => {
      clearTimeout(temporizador);
      reject(motivoAborto(signal!));
    };
    const temporizador = setTimeout(() => {
      signal?.removeEventListener("abort", alAbortar);
      resolve();
    }, ms);
    signal?.addEventListener("abort", alAbortar, { once: true });
  });
}

// Ejecuta un intento con tiempo límite. Al vencer (o al abortarse la señal
// externa) aborta la señal del intento para que `fn` libere sus recursos.
async function intentar<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externa?: AbortSignal,
): Promise<T> {
  const control = new AbortController();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  let alAbortarExterna: (() => void) | undefined;
  const corte = new Promise<never>((_, reject) => {
    temporizador = setTimeout(() => {
      const error = new TiempoAgotadoError(timeoutMs);
      control.abort(error);
      reject(error);
    }, timeoutMs);
    if (externa) {
      alAbortarExterna = () => {
        const motivo = motivoAborto(externa);
        control.abort(motivo);
        reject(motivo);
      };
      externa.addEventListener("abort", alAbortarExterna, { once: true });
    }
  });
  try {
    return await Promise.race([fn(control.signal), corte]);
  } finally {
    clearTimeout(temporizador);
    if (alAbortarExterna) externa?.removeEventListener("abort", alAbortarExterna);
    // Si `fn` sigue viva (perdió la carrera por otra causa), se le pide parar.
    if (!control.signal.aborted) control.abort(new Error("Intento finalizado"));
  }
}

export async function conReintentos<T>(
  fn: (signal: AbortSignal, intento: number) => Promise<T>,
  opciones: OpcionesReintento = REINTENTOS_POR_DEFECTO,
): Promise<ResultadoReintentos<T>> {
  const { intentos, timeoutMs, esperas, signal } = opciones;
  let ultimoError: unknown;
  for (let i = 1; i <= intentos; i++) {
    if (signal?.aborted) throw new ReintentosAgotadosError(i - 1, motivoAborto(signal));
    try {
      const valor = await intentar((s) => fn(s, i), timeoutMs, signal);
      return { valor, intentos: i };
    } catch (error) {
      ultimoError = error;
      if (signal?.aborted) throw new ReintentosAgotadosError(i, error);
      if (i < intentos) {
        const espera = esperas[i - 1] ?? esperas.at(-1) ?? 0;
        try {
          await esperar(espera, signal);
        } catch (abortado) {
          throw new ReintentosAgotadosError(i, abortado);
        }
      }
    }
  }
  throw new ReintentosAgotadosError(intentos, ultimoError);
}
