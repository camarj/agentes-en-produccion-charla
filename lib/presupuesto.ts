import { MODELO_LIGERO } from "../src/mastra/modelos";
import { db, type FuenteDb } from "./db/client";
import { numero } from "./db/tipos";

// Coste estimado de la charla (PRD §8). Es una estimación, no una factura:
// tokens reportados por el proveedor × precio de lista, más un costo fijo por
// turno para las llamadas que la ruta no ve (guardrails y jueces).

export interface PrecioModelo {
  // USD por millón de tokens.
  entrada: number;
  entradaCache: number;
  salida: number;
}

// Precios de lista estándar (verificados el 2026-09-23):
// - gpt-6-luna: developers.openai.com/api/docs/models/gpt-6-luna
// - claude-sonnet-5 y claude-haiku-4-5: precios de Anthropic (lectura en caché = 10 % de la entrada).
export const PRECIOS_USD_POR_MILLON: Record<string, PrecioModelo> = {
  "gpt-6-luna": { entrada: 0.1, entradaCache: 0.01, salida: 0.5 },
  "claude-sonnet-5": { entrada: 2, entradaCache: 0.2, salida: 10 },
  "claude-haiku-4-5": { entrada: 1, entradaCache: 0.1, salida: 5 },
};

// Modelo sin precio conocido: se cobra como el más caro que usa el agente
// (claude-sonnet-5), para no quedarse corto.
export const PRECIO_DESCONOCIDO: PrecioModelo = PRECIOS_USD_POR_MILLON["claude-sonnet-5"];

// Llamadas que no pasan por el uso del agente, estimadas con holgura:
// detector de inyección + clasificador de alcance (~1.200 tokens de entrada) y
// jueces en vivo de fidelidad, relevancia y personalización (~8.000). Todo va
// a MODELO_LIGERO (gpt-6-luna): ~0,002 USD por turno.
export const TOKENS_AUXILIARES_POR_TURNO = { inputTokens: 10_000, outputTokens: 2_000 };

export interface UsoTokens {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

function tokens(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? valor : 0;
}

// Acepta "openai/gpt-6-luna", "gpt-6-luna" o un id con sufijo de versión
// ("gpt-6-luna-2026-09-01").
function precioDelModelo(modelo: string | undefined): PrecioModelo {
  const id = (modelo ?? "").split("/").pop()!.toLowerCase();
  if (PRECIOS_USD_POR_MILLON[id]) return PRECIOS_USD_POR_MILLON[id];
  const familia = Object.keys(PRECIOS_USD_POR_MILLON).find((k) => id.startsWith(`${k}-`));
  return familia ? PRECIOS_USD_POR_MILLON[familia] : PRECIO_DESCONOCIDO;
}

// Coste en USD de un uso de tokens. Los tokens de entrada en caché (incluidos
// en `inputTokens`) se cobran a la tarifa de caché.
export function precioDe(modelo: string | undefined, uso: UsoTokens | undefined): number {
  const p = precioDelModelo(modelo);
  const entrada = tokens(uso?.inputTokens);
  const cache = Math.min(tokens(uso?.cachedInputTokens), entrada);
  const salida = tokens(uso?.outputTokens);
  return ((entrada - cache) * p.entrada + cache * p.entradaCache + salida * p.salida) / 1_000_000;
}

// Coste estimado de un turno: uso del agente + guardrails y jueces.
export function costeEstimadoTurno(modelo: string | undefined, uso: UsoTokens | undefined): number {
  return precioDe(modelo, uso) + precioDe(MODELO_LIGERO, TOKENS_AUXILIARES_POR_TURNO);
}

// Dictado por voz: gpt-transcribe cuesta $0,0045 por minuto de audio
// (developers.openai.com/api/docs/pricing, verificado el 2026-09-24).
export const PRECIO_TRANSCRIPCION_USD_POR_MINUTO = 0.0045;
const DURACION_MAXIMA_COBRO_S = 60;

// Coste de un dictado según su duración en segundos. Si falta, no es válida o
// pasa del tope de 60 s, se cobra el máximo (para no quedarse corto).
export function costeTranscripcion(segundos: number | undefined): number {
  const valida = typeof segundos === "number" && Number.isFinite(segundos) && segundos > 0;
  const s = valida ? Math.min(segundos, DURACION_MAXIMA_COBRO_S) : DURACION_MAXIMA_COBRO_S;
  return (s / 60) * PRECIO_TRANSCRIPCION_USD_POR_MINUTO;
}

// Tope en USD, o null si PRESUPUESTO_MAX_USD falta o no es un número positivo.
export function presupuestoMaximoUsd(): number | null {
  const valor = Number(process.env.PRESUPUESTO_MAX_USD?.trim() || Number.NaN);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

export function crearPresupuesto(fuente: FuenteDb = db) {
  async function acumulado(): Promise<number> {
    const c = await fuente();
    const r = await c.execute("SELECT coste_usd FROM presupuesto WHERE id = 1");
    return r.rows[0] ? numero(r.rows[0], "coste_usd") : 0;
  }

  // Suma en una sola sentencia (sin carreras entre turnos simultáneos).
  async function sumar(usd: number): Promise<void> {
    if (!Number.isFinite(usd) || usd <= 0) return;
    const c = await fuente();
    await c.execute({
      sql: `INSERT INTO presupuesto (id, coste_usd) VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET coste_usd = coste_usd + excluded.coste_usd, actualizado_en = datetime('now')`,
      args: [usd],
    });
  }

  return { acumulado, sumar };
}

export const presupuesto = crearPresupuesto();
