// Del resultado de Jev a lo que se guarda por turno (tabla jev_analisis).
// Los Score se normalizan a 0–1 dividiendo por el nivel más alto.

import { INTENCIONES, NIVELES_CONFUSION, NIVELES_VALOR, TEMAS, type Intencion, type Tema } from "./preguntas";
import type { TurnoJev } from "./turnos";

export const LARGO_EXTRACTO = 180;

interface RespuestaChoice {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
interface RespuestaScore {
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}
export interface ResultadoJev {
  model: string;
  answers: {
    tema: RespuestaChoice;
    intencion: RespuestaChoice;
    confusion: RespuestaScore;
    valor_para_preguntas: RespuestaScore;
    respaldada?: { noul: number };
  };
  usage?: { input_tokens: number; output_tokens: number };
}

export interface AnalisisJev {
  traceId: string;
  turnoEn: string;
  // Extracto corto y redactado de la pregunta (lo único del turno que se guarda).
  pregunta: string;
  tema: Tema;
  temaConfianza: number;
  intencion: Intencion;
  intencionConfianza: number;
  confusion: number; // 0 = entiende y profundiza · 1 = perdido
  confusionConfianza: number;
  valor: number; // 0–1
  valorConfianza: number;
  respaldada: number | null; // probabilidad; null = no se preguntó
  motivoBloqueo: string | null;
  herramientaCaida: boolean;
  respaldo: boolean;
  sinModelo: boolean;
  falla: boolean;
  latenciaMs: number;
  tokensEntrada: number | null;
  modelo: string;
}

const esTema = (v: string): v is Tema => Object.hasOwn(TEMAS, v);
const esIntencion = (v: string): v is Intencion => Object.hasOwn(INTENCIONES, v);
const acotar = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function extracto(texto: string, max = LARGO_EXTRACTO): string {
  return texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto;
}

export function interpretarResultado(turno: TurnoJev, r: ResultadoJev, latenciaMs: number): AnalisisJev {
  const a = r.answers;
  const noul = a.respaldada?.noul;
  return {
    traceId: turno.traceId,
    turnoEn: turno.en,
    pregunta: extracto(turno.pregunta),
    tema: esTema(a.tema.choice) ? a.tema.choice : "other",
    temaConfianza: acotar(a.tema.confidence),
    intencion: esIntencion(a.intencion.choice) ? a.intencion.choice : "off_topic",
    intencionConfianza: acotar(a.intencion.confidence),
    confusion: acotar(a.confusion.score / (NIVELES_CONFUSION.length - 1)),
    confusionConfianza: acotar(a.confusion.confidence),
    valor: acotar(a.valor_para_preguntas.score / (NIVELES_VALOR.length - 1)),
    valorConfianza: acotar(a.valor_para_preguntas.confidence),
    respaldada: typeof noul === "number" ? acotar(noul) : null,
    motivoBloqueo: turno.motivoBloqueo,
    herramientaCaida: turno.herramientaCaida,
    respaldo: turno.respaldo,
    sinModelo: turno.sinModelo,
    falla: turno.falla,
    latenciaMs: Math.max(0, Math.round(latenciaMs)),
    tokensEntrada: typeof r.usage?.input_tokens === "number" ? r.usage.input_tokens : null,
    modelo: r.model,
  };
}
