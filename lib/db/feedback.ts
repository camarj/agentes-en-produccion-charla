import { db, type FuenteDb } from "./client";
import { numero, texto } from "./tipos";

export type ValorVoto = 1 | -1;

export interface NuevoVoto {
  asistenteId: string;
  traceId: string;
  valor: ValorVoto;
}

export interface TotalesVotos {
  positivos: number;
  negativos: number;
  total: number;
}

export interface VotosDeTraza {
  traceId: string;
  positivos: number;
  negativos: number;
  // Momento del voto más reciente de la traza (texto `datetime('now')` de SQLite, UTC).
  ultimoEn: string;
}

export function crearFeedback(fuente: FuenteDb = db) {
  // Un voto por asistente y traza: si ya votó, se reemplaza el valor y la hora.
  async function registrar(voto: NuevoVoto): Promise<void> {
    const c = await fuente();
    await c.execute({
      sql: `INSERT INTO feedback (asistente_id, trace_id, valor) VALUES (?, ?, ?)
        ON CONFLICT (asistente_id, trace_id)
        DO UPDATE SET valor = excluded.valor, creado_en = datetime('now')`,
      args: [voto.asistenteId, voto.traceId, voto.valor],
    });
  }

  async function totales(): Promise<TotalesVotos> {
    const c = await fuente();
    const r = await c.execute(
      `SELECT COALESCE(SUM(valor = 1), 0) AS positivos, COALESCE(SUM(valor = -1), 0) AS negativos,
        COUNT(*) AS total FROM feedback`,
    );
    const f = r.rows[0];
    return { positivos: numero(f, "positivos"), negativos: numero(f, "negativos"), total: numero(f, "total") };
  }

  // Votos agrupados por traza, de la votada más recientemente a la más antigua.
  async function porTrace(limite = 100): Promise<VotosDeTraza[]> {
    const c = await fuente();
    const r = await c.execute({
      sql: `SELECT trace_id, SUM(valor = 1) AS positivos, SUM(valor = -1) AS negativos,
          MAX(creado_en) AS ultimo_en, MAX(id) AS ultimo_id
        FROM feedback GROUP BY trace_id ORDER BY ultimo_en DESC, ultimo_id DESC LIMIT ?`,
      args: [limite],
    });
    return r.rows.map((f) => ({
      traceId: texto(f, "trace_id"),
      positivos: numero(f, "positivos"),
      negativos: numero(f, "negativos"),
      ultimoEn: texto(f, "ultimo_en"),
    }));
  }

  return { registrar, totales, porTrace };
}

export const feedback = crearFeedback();
