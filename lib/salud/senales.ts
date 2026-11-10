// Señales técnicas de un turno de chat (PRD §15 G7). La ruta de chat deja un
// objeto vacío en el requestContext; el procesador FallbackModelo, la
// herramienta buscar_laminas y el clasificador de alcance anotan ahí lo que
// pasó. Al cerrar el turno, la ruta lo convierte en la fila de `turnos` y en
// eventos de salud. Nunca lleva texto del asistente ni datos personales.
// (RedaccionTrazas deja fuera esta clave: no llega a las trazas.)

export const CLAVE_SENALES = "senales_salud";

// Causa simulada de la caída del modelo principal (interruptores de caos).
export type CausaRespaldo = "limite_uso" | "sobrecarga";

export interface SenalesTurno {
  // Respondió el modelo de respaldo. `causa`: lo simuló un interruptor; null = falla real.
  respaldo?: { modelo: string; causa: CausaRespaldo | null };
  // Fallaron el principal y el respaldo por el interruptor «Modelos caídos».
  modelosCaidosSimulado?: boolean;
  // buscar_laminas: intentos de la última búsqueda y si agotó los reintentos.
  busqueda?: { intentos: number; agotada: boolean };
  // El clasificador de alcance no respondió y dejó pasar la pregunta (falla abierta).
  alcanceFallaAbierta?: boolean;
}

interface ContextoConValores {
  get(clave: string): unknown;
  set(clave: string, valor: unknown): void;
}

export function crearSenales(requestContext: ContextoConValores): SenalesTurno {
  const senales: SenalesTurno = {};
  requestContext.set(CLAVE_SENALES, senales);
  return senales;
}

// Las señales del turno, o undefined fuera de la ruta de chat (Studio, evals, tests).
export function senalesDe(requestContext: { get(clave: string): unknown } | undefined | null): SenalesTurno | undefined {
  const valor = requestContext?.get(CLAVE_SENALES);
  return valor && typeof valor === "object" ? (valor as SenalesTurno) : undefined;
}
