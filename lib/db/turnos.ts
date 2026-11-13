import {
  VENTANA_LATENCIA_MS,
  VENTANA_TOTALES_MS,
  type MetricasTrazas,
  type ModeloEnUso,
  type TipoFalla,
} from "@/lib/panel/metricas-trazas";
import { db, type Fila as Row, type FuenteDb, type Sentencia } from "./client";
import { numero, textoONulo } from "./tipos";

// Turnos de chat terminados (PRD §15 G7). La ruta de chat escribe una fila
// corta al cerrar cada turno y el panel del speaker calcula sus métricas con
// agregados SQL: sin releer las trazas de Mastra y sin tope de turnos.
// Solo datos técnicos: nunca emails, nombres ni el texto de la pregunta.
// Los evals no pasan por aquí (usan el agente o bases temporales), así que el
// tráfico de evals sigue fuera de las métricas.

export type ResultadoTurno = "ok" | "bloqueo" | "falla";

export interface FilaTurno {
  iniciadoMs: number;
  // null: el turno no terminó con una respuesta completa (no cuenta en la latencia).
  duracionMs: number | null;
  resultado: ResultadoTurno;
  tipoFalla: TipoFalla | null;
  motivoBloqueo: string | null;
  // Modelo que respondió; null si ninguno pudo.
  modelo: string | null;
  respaldo: boolean;
  traceId: string | null;
}

// Turnos con respuesta completa: los que no fallaron, o los que tuvieron una
// falla de herramienta pero el agente igual respondió (como en las trazas).
const CON_RESPUESTA = "resultado <> 'bloqueo' AND duracion_ms IS NOT NULL AND (tipo_falla IS NULL OR tipo_falla = 'herramienta')";

const iso = (ms: number) => new Date(ms).toISOString();

// Percentil por rango más cercano: la posición ⌈p/100 · n⌉ (1-indexada).
const posicion = (p: number, n: number) => Math.min(n, Math.max(1, Math.ceil((p / 100) * n)));

export function crearTurnos(fuente: FuenteDb = db) {
  async function registrar(f: FilaTurno): Promise<void> {
    const c = await fuente();
    await c.execute({
      sql: `INSERT INTO turnos (iniciado_ms, duracion_ms, resultado, tipo_falla, motivo_bloqueo, modelo, respaldo, trace_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        Math.round(f.iniciadoMs),
        f.duracionMs === null ? null : Math.round(f.duracionMs),
        f.resultado,
        f.tipoFalla,
        f.motivoBloqueo,
        f.modelo,
        f.respaldo ? 1 : 0,
        f.traceId,
      ],
    });
  }

  // Métricas de las últimas 12 h (latencia y respaldo: última hora).
  async function resumen(ahora: number = Date.now()): Promise<MetricasTrazas> {
    const c = await fuente();
    const desde = ahora - VENTANA_TOTALES_MS;
    const desdeHora = ahora - VENTANA_LATENCIA_MS;
    const consultas: Sentencia[] = [
      {
        sql: `SELECT COUNT(*) AS turnos,
            COALESCE(SUM(CASE WHEN respaldo = 1 AND iniciado_ms >= ? THEN 1 ELSE 0 END), 0) AS respaldo_hora,
            MAX(CASE WHEN respaldo = 1 THEN iniciado_ms END) AS ultimo_respaldo
          FROM turnos WHERE iniciado_ms >= ?`,
        args: [desdeHora, desde],
      },
      {
        sql: "SELECT tipo_falla, COUNT(*) AS n FROM turnos WHERE iniciado_ms >= ? AND resultado = 'falla' GROUP BY tipo_falla",
        args: [desde],
      },
      {
        sql: "SELECT motivo_bloqueo, COUNT(*) AS n FROM turnos WHERE iniciado_ms >= ? AND resultado = 'bloqueo' GROUP BY motivo_bloqueo",
        args: [desde],
      },
      {
        sql: `SELECT COUNT(*) AS n FROM turnos WHERE iniciado_ms >= ? AND ${CON_RESPUESTA}`,
        args: [desdeHora],
      },
      {
        sql: `SELECT iniciado_ms, modelo, respaldo, tipo_falla, trace_id FROM turnos
          WHERE iniciado_ms >= ? AND (tipo_falla = 'modelo' OR ${CON_RESPUESTA})
          ORDER BY iniciado_ms DESC, id DESC LIMIT 1`,
        args: [desde],
      },
    ];
    const [totales, fallas, bloqueos, muestras, ultimo] = await c.batch(consultas, "read");

    const t = totales.rows[0];
    const erroresPorTipo: Partial<Record<TipoFalla, number>> = {};
    let errores = 0;
    for (const r of fallas.rows) {
      const tipo = (textoONulo(r, "tipo_falla") ?? "otro") as TipoFalla;
      erroresPorTipo[tipo] = (erroresPorTipo[tipo] ?? 0) + numero(r, "n");
      errores += numero(r, "n");
    }
    const porMotivo: Record<string, number> = {};
    let totalBloqueos = 0;
    for (const r of bloqueos.rows) {
      const motivo = textoONulo(r, "motivo_bloqueo") ?? "otro";
      porMotivo[motivo] = (porMotivo[motivo] ?? 0) + numero(r, "n");
      totalBloqueos += numero(r, "n");
    }

    const n = numero(muestras.rows[0], "n");
    const [p50Ms, p95Ms] = n === 0 ? [null, null] : await Promise.all([50, 95].map((p) => duracionEn(posicion(p, n), desdeHora)));
    const ultimoRespaldo = textoONulo(t, "ultimo_respaldo");

    return {
      latencia: { p50Ms, p95Ms, muestras: n },
      errores,
      erroresPorTipo,
      bloqueos: { total: totalBloqueos, porMotivo },
      turnos: numero(t, "turnos"),
      respaldo: { ultimaHora: numero(t, "respaldo_hora"), ultimaEn: ultimoRespaldo === null ? null : iso(Number(ultimoRespaldo)) },
      modeloEnUso: ultimo.rows[0] ? modeloEnUso(ultimo.rows[0]) : null,
    };
  }

  // Duración en la posición `k` (1-indexada) de las respuestas de la última hora, en orden.
  async function duracionEn(k: number, desdeHora: number): Promise<number | null> {
    const c = await fuente();
    const r = await c.execute({
      sql: `SELECT duracion_ms FROM turnos WHERE iniciado_ms >= ? AND ${CON_RESPUESTA}
        ORDER BY duracion_ms LIMIT 1 OFFSET ?`,
      args: [desdeHora, k - 1],
    });
    return r.rows[0] ? numero(r.rows[0], "duracion_ms") : null;
  }

  return { registrar, resumen };
}

function modeloEnUso(r: Row): ModeloEnUso {
  const estado: ModeloEnUso["estado"] =
    textoONulo(r, "tipo_falla") === "modelo" ? "sin_modelo" : numero(r, "respaldo") === 1 ? "respaldo" : "principal";
  return {
    estado,
    modelo: estado === "sin_modelo" ? null : textoONulo(r, "modelo"),
    en: iso(numero(r, "iniciado_ms")),
    traceId: textoONulo(r, "trace_id") ?? "",
  };
}

export const turnos = crearTurnos();
