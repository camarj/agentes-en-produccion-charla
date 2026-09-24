// Convierte una traza `agent_run` de la observabilidad de Mastra en el turno
// que Jev analiza: pregunta, respuesta, evidencia de `buscar_laminas` y las
// señales del turno (bloqueo, herramienta caída, respaldo, sin modelo).
// Las trazas ya vienen redactadas (sin emails ni nombres); igual pasan otra vez
// por `redactarTexto` como defensa en profundidad.

import { esTrazaDeEval } from "@/lib/origen-eval";
import { motivoDeBloqueo, tipoDeFalla, type RaizTraza, type SpanDetalle } from "@/lib/panel/metricas-trazas";
import { redactarTexto } from "@/src/mastra/observabilidad/redaccion";
import type { FragmentoLamina } from "./preguntas";

export const LARGO_MAXIMO_PREGUNTA = 600;
export const LARGO_MAXIMO_RESPUESTA = 2500;
export const LARGO_MAXIMO_FRAGMENTO = 700;
export const FRAGMENTOS_MAXIMOS = 6;
// Una raíz abierta sin bloqueo más vieja que esto se da por abandonada.
export const ABANDONADA_MS = 5 * 60 * 1000;

// Span completo (getTrace) con lo que se usa aquí.
export interface SpanTraza extends SpanDetalle {
  name?: string | null;
  input?: unknown;
  output?: unknown;
  attributes?: Record<string, unknown> | null;
}

export interface RaizListada extends RaizTraza {
  inputPreview?: string | null;
}

export interface TurnoJev {
  traceId: string;
  en: string; // ISO de inicio del turno
  pregunta: string;
  respuesta: string | null;
  evidencia: FragmentoLamina[];
  motivoBloqueo: string | null;
  herramientaCaida: boolean;
  respaldo: boolean;
  sinModelo: boolean;
  // Falló sin respuesta por otra causa (tiempo, otro).
  falla: boolean;
}

const recortar = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);
const limpio = (t: string, max: number) => recortar(redactarTexto(t).replace(/\s+/g, " ").trim(), max);

// Texto de la pregunta: el input de agent_run es un string o una lista de mensajes.
export function textoDePregunta(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) {
    for (let i = input.length - 1; i >= 0; i--) {
      const m = input[i] as { role?: unknown; content?: unknown } | null;
      if (m?.role !== "user") continue;
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        const partes = m.content
          .map((p) => (typeof (p as { text?: unknown })?.text === "string" ? (p as { text: string }).text : ""))
          .filter(Boolean);
        if (partes.length) return partes.join(" ");
      }
    }
  }
  return null;
}

function textoDeRespuesta(output: unknown): string | null {
  if (typeof output === "string") return output;
  const t = (output as { text?: unknown } | null)?.text;
  return typeof t === "string" && t.trim() ? t : null;
}

const esBuscarLaminas = (s: SpanTraza) =>
  s.spanType === "tool_call" && (s.name?.includes("buscar_laminas") || s.attributes?.toolId === "buscar_laminas");

function evidenciaDe(spans: readonly SpanTraza[]): FragmentoLamina[] {
  const salida: FragmentoLamina[] = [];
  const vistos = new Set<string>();
  for (const s of spans.filter(esBuscarLaminas)) {
    const resultados = (s.output as { resultados?: unknown } | null)?.resultados;
    if (!Array.isArray(resultados)) continue;
    for (const r of resultados as Record<string, unknown>[]) {
      if (typeof r?.fragmento !== "string" || !r.fragmento.trim()) continue;
      const lamina = typeof r.lamina === "number" ? r.lamina : null;
      const clave = `${lamina}|${r.fragmento}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      salida.push({
        lamina,
        titulo: typeof r.titulo === "string" ? limpio(r.titulo, 120) : null,
        fragmento: limpio(r.fragmento, LARGO_MAXIMO_FRAGMENTO),
      });
    }
  }
  return salida.slice(0, FRAGMENTOS_MAXIMOS);
}

// Motivo del bloqueo en la raíz o en cualquier span (en Postgres la raíz de
// un turno bloqueado queda abierta y el motivo está en el span del guardrail).
export function motivoDelTurno(raiz: RaizTraza, spans: readonly SpanDetalle[]): string | null {
  const enRaiz = motivoDeBloqueo(raiz.metadata);
  if (enRaiz) return enRaiz;
  for (const s of spans) {
    const m = s.metadata;
    if (typeof m?.guardrail === "string" && m.guardrail) return typeof m.motivo === "string" && m.motivo ? m.motivo : "otro";
  }
  return null;
}

// ¿Vale la pena pedir el detalle de esta raíz? Las de evals nunca; las abiertas
// solo cuando pueden ser un bloqueo (se confirma con el detalle).
export function esCandidata(raiz: RaizListada, ahora: number): boolean {
  if (esTrazaDeEval(raiz.metadata)) return false;
  if (raiz.status !== "running") return true;
  return ahora - new Date(raiz.startedAt).getTime() < ABANDONADA_MS * 2;
}

export type ResultadoTurno = { tipo: "turno"; turno: TurnoJev } | { tipo: "pendiente" } | { tipo: "descartar" };

// Turno listo para analizar, o por qué todavía no (pendiente) o nunca (descartar).
export function turnoDeTraza(raiz: RaizListada, spans: readonly SpanTraza[], ahora: number): ResultadoTurno {
  if (esTrazaDeEval(raiz.metadata)) return { tipo: "descartar" };
  const agente = spans.find((s) => s.spanType === "agent_run");
  const motivo = motivoDelTurno(raiz, spans);
  const inicio = new Date(raiz.startedAt).getTime();

  if (raiz.status === "running" && !motivo) {
    return ahora - inicio > ABANDONADA_MS ? { tipo: "descartar" } : { tipo: "pendiente" };
  }

  const bruta = textoDePregunta(agente?.input) ?? raiz.inputPreview ?? null;
  if (!bruta || !bruta.trim()) return { tipo: "descartar" };

  const errorRaiz = raiz.status === "error" || (raiz.error != null && raiz.error !== false);
  const falla = motivo ? null : tipoDeFalla(raiz, spans, false);
  const herramientaCaida =
    raiz.metadata?.falla_herramienta === true ||
    spans.some((s) => esBuscarLaminas(s) && (s.metadata?.falla_herramienta === true || s.status === "error"));
  const respuesta = motivo || errorRaiz ? null : textoDeRespuesta(agente?.output);

  return {
    tipo: "turno",
    turno: {
      traceId: raiz.traceId,
      en: new Date(inicio).toISOString(),
      pregunta: limpio(bruta, LARGO_MAXIMO_PREGUNTA),
      respuesta: respuesta ? limpio(respuesta, LARGO_MAXIMO_RESPUESTA) : null,
      evidencia: motivo || herramientaCaida ? [] : evidenciaDe(spans),
      motivoBloqueo: motivo,
      herramientaCaida,
      respaldo: raiz.metadata?.modelo_respaldo === true,
      sinModelo: errorRaiz && falla === "modelo",
      falla: errorRaiz && !motivo && falla !== "modelo" && falla !== "herramienta",
    },
  };
}
