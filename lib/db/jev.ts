import type { Row } from "@libsql/client";
import type { AnalisisJev } from "@/lib/jev/resultado";
import type { Intencion, Tema } from "@/lib/jev/preguntas";
import { db, type FuenteDb } from "./client";
import { numero, texto, textoONulo } from "./tipos";

// Análisis de Jev por turno (migración 005). Idempotente: la clave es el traceId.

const COLUMNAS = [
  "trace_id",
  "turno_en",
  "pregunta",
  "tema",
  "tema_confianza",
  "intencion",
  "intencion_confianza",
  "confusion",
  "confusion_confianza",
  "valor",
  "valor_confianza",
  "respaldada",
  "motivo_bloqueo",
  "herramienta_caida",
  "respaldo",
  "sin_modelo",
  "falla",
  "latencia_ms",
  "tokens_entrada",
  "modelo",
] as const;

function deFila(f: Row): AnalisisJev {
  const r = textoONulo(f, "respaldada");
  const tokens = textoONulo(f, "tokens_entrada");
  return {
    traceId: texto(f, "trace_id"),
    turnoEn: texto(f, "turno_en"),
    pregunta: texto(f, "pregunta"),
    tema: texto(f, "tema") as Tema,
    temaConfianza: numero(f, "tema_confianza"),
    intencion: texto(f, "intencion") as Intencion,
    intencionConfianza: numero(f, "intencion_confianza"),
    confusion: numero(f, "confusion"),
    confusionConfianza: numero(f, "confusion_confianza"),
    valor: numero(f, "valor"),
    valorConfianza: numero(f, "valor_confianza"),
    respaldada: r === null ? null : Number(r),
    motivoBloqueo: textoONulo(f, "motivo_bloqueo"),
    herramientaCaida: numero(f, "herramienta_caida") === 1,
    respaldo: numero(f, "respaldo") === 1,
    sinModelo: numero(f, "sin_modelo") === 1,
    falla: numero(f, "falla") === 1,
    latenciaMs: numero(f, "latencia_ms"),
    tokensEntrada: tokens === null ? null : Number(tokens),
    modelo: texto(f, "modelo"),
  };
}

export function crearJev(fuente: FuenteDb = db) {
  // Guarda si no existe (un traceId nunca se analiza dos veces).
  async function guardar(a: AnalisisJev): Promise<boolean> {
    const c = await fuente();
    const r = await c.execute({
      sql: `INSERT OR IGNORE INTO jev_analisis (${COLUMNAS.join(", ")}) VALUES (${COLUMNAS.map(() => "?").join(", ")})`,
      args: [
        a.traceId,
        a.turnoEn,
        a.pregunta,
        a.tema,
        a.temaConfianza,
        a.intencion,
        a.intencionConfianza,
        a.confusion,
        a.confusionConfianza,
        a.valor,
        a.valorConfianza,
        a.respaldada,
        a.motivoBloqueo,
        a.herramientaCaida ? 1 : 0,
        a.respaldo ? 1 : 0,
        a.sinModelo ? 1 : 0,
        a.falla ? 1 : 0,
        a.latenciaMs,
        a.tokensEntrada,
        a.modelo,
      ],
    });
    return r.rowsAffected > 0;
  }

  // Cuáles de estos traceIds ya tienen análisis.
  async function analizados(traceIds: readonly string[]): Promise<Set<string>> {
    if (traceIds.length === 0) return new Set();
    const c = await fuente();
    const r = await c.execute({
      sql: `SELECT trace_id FROM jev_analisis WHERE trace_id IN (${traceIds.map(() => "?").join(", ")})`,
      args: [...traceIds],
    });
    return new Set(r.rows.map((f) => texto(f, "trace_id")));
  }

  // Análisis de turnos desde `desdeIso`, del más reciente al más antiguo.
  async function desde(desdeIso: string, limite = 300): Promise<AnalisisJev[]> {
    const c = await fuente();
    const r = await c.execute({
      sql: `SELECT ${COLUMNAS.join(", ")} FROM jev_analisis WHERE turno_en >= ? ORDER BY turno_en DESC LIMIT ?`,
      args: [desdeIso, limite],
    });
    return r.rows.map(deFila);
  }

  async function total(): Promise<number> {
    const c = await fuente();
    const r = await c.execute("SELECT COUNT(*) AS n FROM jev_analisis");
    return numero(r.rows[0], "n");
  }

  return { guardar, analizados, desde, total };
}

export type RepoJev = ReturnType<typeof crearJev>;
export const jev = crearJev();
