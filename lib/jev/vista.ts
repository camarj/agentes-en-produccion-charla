// Modelo de vista de «Jev · la sala en vivo». Puro: recibe los análisis
// guardados y arma lo que muestra la página. Este módulo va también al
// navegador (tipos y etiquetas): sin imports de servidor.

import type { Intencion, Tema } from "./preguntas";
import type { AnalisisJev } from "./resultado";

export const TARJETAS_MAXIMAS = 6;
export const VENTANA_TEMAS_MS = 30 * 60 * 1000;
export const TURNOS_TERMOMETRO = 20;
export const UMBRAL_RESPALDADA = 0.5;
export const PREGUNTAS_DESTACADAS = 3;

export const ETIQUETAS_TEMA: Record<Tema, string> = {
  agent_basics: "Conceptos básicos",
  harness: "Harness",
  agent_or_workflow: "¿Hace falta un agente?",
  prd_and_spec: "PRD y especificación",
  agentic_patterns: "Patrones agénticos",
  architecture: "Arquitectura",
  implementation: "Implementación y marcos",
  resilience: "Resiliencia",
  guardrails: "Guardrails",
  evals: "Evals",
  observability: "Observabilidad",
  launch: "Lanzamiento",
  about_assistant: "Sobre el asistente",
  other: "Otro",
};

export const ETIQUETAS_INTENCION: Record<Intencion, string> = {
  understand_concept: "Entender un concepto",
  apply_to_own_case: "Aplicarlo a su caso",
  critique_or_disagreement: "Crítica o desacuerdo",
  about_assistant_or_data: "Sobre el asistente",
  off_topic: "Fuera de tema",
};

const MOTIVOS: Record<string, string> = {
  inyeccion: "intento de inyección",
  fuera_de_alcance: "fuera de alcance",
  datos_personales: "datos personales",
};

export type LineaTarjeta =
  | { tipo: "respaldada" }
  | { tipo: "no_respaldada"; probabilidad: number }
  | { tipo: "sin_laminas" }
  | { tipo: "bloqueada"; motivo: string }
  | { tipo: "herramienta_caida" }
  | { tipo: "respaldo" }
  | { tipo: "sin_modelo" }
  | { tipo: "falla" };

export interface TarjetaJev {
  traceId: string;
  en: string;
  pregunta: string;
  tema: string;
  intencion: string;
  // 0–1; null cuando no aplica (bloqueada o fuera de tema).
  confusion: number | null;
  lineas: LineaTarjeta[];
  latenciaMs: number;
}

export interface VistaJev {
  jev_disponible: boolean;
  total_analisis: number;
  latencia_media_ms: number | null;
  tarjetas: TarjetaJev[];
  temas: { tema: string; turnos: number }[];
  termometro: { porcentaje: number | null; turnos: number; mas_confunde: string | null };
  destacadas: { traceId: string; pregunta: string; tema: string; parecidas: number }[];
  actualizado_en: string;
}

// ¿Cuenta para confusión, temas destacados y la sesión de preguntas?
const esPreguntaReal = (a: AnalisisJev) => !a.motivoBloqueo && a.intencion !== "off_topic";

export function lineasDe(a: AnalisisJev): LineaTarjeta[] {
  if (a.motivoBloqueo) return [{ tipo: "bloqueada", motivo: MOTIVOS[a.motivoBloqueo] ?? "otro motivo" }];
  const lineas: LineaTarjeta[] = [];
  if (a.sinModelo) lineas.push({ tipo: "sin_modelo" });
  else if (a.falla) lineas.push({ tipo: "falla" });
  else if (a.respaldada !== null) {
    lineas.push(
      a.respaldada >= UMBRAL_RESPALDADA ? { tipo: "respaldada" } : { tipo: "no_respaldada", probabilidad: a.respaldada },
    );
  } else if (!a.herramientaCaida && a.intencion !== "off_topic") lineas.push({ tipo: "sin_laminas" });
  if (a.herramientaCaida) lineas.push({ tipo: "herramienta_caida" });
  if (a.respaldo) lineas.push({ tipo: "respaldo" });
  return lineas;
}

function tarjeta(a: AnalisisJev): TarjetaJev {
  return {
    traceId: a.traceId,
    en: a.turnoEn,
    pregunta: a.pregunta,
    tema: ETIQUETAS_TEMA[a.tema] ?? ETIQUETAS_TEMA.other,
    intencion: ETIQUETAS_INTENCION[a.intencion] ?? ETIQUETAS_INTENCION.off_topic,
    confusion: esPreguntaReal(a) ? a.confusion : null,
    lineas: lineasDe(a),
    latenciaMs: a.latenciaMs,
  };
}

const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// `analisis`: del más reciente al más antiguo (como los devuelve el repositorio).
export function construirVista(
  analisis: readonly AnalisisJev[],
  { ahora, total, jevDisponible }: { ahora: number; total: number; jevDisponible: boolean },
): VistaJev {
  const orden = [...analisis].sort((a, b) => b.turnoEn.localeCompare(a.turnoEn));

  const conteo = new Map<Tema, number>();
  for (const a of orden) {
    if (Date.parse(a.turnoEn) < ahora - VENTANA_TEMAS_MS) continue;
    if (a.motivoBloqueo) continue;
    conteo.set(a.tema, (conteo.get(a.tema) ?? 0) + 1);
  }
  const temas = [...conteo]
    .map(([tema, turnos]) => ({ tema: ETIQUETAS_TEMA[tema] ?? tema, turnos, clave: tema }))
    .sort((a, b) => b.turnos - a.turnos || (a.clave === "other" ? 1 : b.clave === "other" ? -1 : 0))
    .map(({ tema, turnos }) => ({ tema, turnos }));

  const recientes = orden.filter(esPreguntaReal).slice(0, TURNOS_TERMOMETRO);
  const promedio = media(recientes.map((a) => a.confusion));
  const porTema = new Map<Tema, number[]>();
  for (const a of recientes) {
    if (a.tema === "other") continue;
    porTema.set(a.tema, [...(porTema.get(a.tema) ?? []), a.confusion]);
  }
  let masConfunde: string | null = null;
  let peor = -1;
  for (const [tema, valores] of porTema) {
    const m = media(valores)!;
    if (m > peor) {
      peor = m;
      masConfunde = ETIQUETAS_TEMA[tema];
    }
  }

  const reales = orden.filter(esPreguntaReal);
  const grupo = (a: AnalisisJev) => `${a.tema}|${a.intencion}`;
  const porGrupo = new Map<string, number>();
  for (const a of reales) porGrupo.set(grupo(a), (porGrupo.get(grupo(a)) ?? 0) + 1);
  // Una por grupo (la más valiosa), para no repetir la misma pregunta tres veces.
  const vistos = new Set<string>();
  const destacadas = [...reales]
    .sort((a, b) => b.valor - a.valor || b.turnoEn.localeCompare(a.turnoEn))
    .filter((a) => (vistos.has(grupo(a)) ? false : (vistos.add(grupo(a)), true)))
    .slice(0, PREGUNTAS_DESTACADAS)
    .map((a) => ({
      traceId: a.traceId,
      pregunta: a.pregunta,
      tema: ETIQUETAS_TEMA[a.tema] ?? a.tema,
      parecidas: (porGrupo.get(grupo(a)) ?? 1) - 1,
    }));

  const latencias = orden.map((a) => a.latenciaMs);
  const latenciaMedia = media(latencias);

  return {
    jev_disponible: jevDisponible,
    total_analisis: total,
    latencia_media_ms: latenciaMedia === null ? null : Math.round(latenciaMedia),
    tarjetas: orden.slice(0, TARJETAS_MAXIMAS).map(tarjeta),
    temas,
    termometro: {
      porcentaje: promedio === null ? null : Math.round(promedio * 100),
      turnos: recientes.length,
      mas_confunde: masConfunde,
    },
    destacadas,
    actualizado_en: new Date(ahora).toISOString(),
  };
}
