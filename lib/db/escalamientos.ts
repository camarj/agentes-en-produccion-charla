import type { Row } from "@libsql/client";
import { db, type FuenteDb } from "./client";
import { numero, texto, textoONulo } from "./tipos";

export type MotivoEscalamiento =
  | "experiencia_personal"
  | "comercial"
  | "fuera_de_charla"
  | "desacuerdo"
  | "falla_tecnica";

export type EstadoEscalamiento = "pendiente" | "respondida" | "descartada";

export interface Escalamiento {
  id: number;
  asistenteId: string;
  pregunta: string;
  motivo: MotivoEscalamiento;
  traceId: string | null;
  estado: EstadoEscalamiento;
  creadoEn: string;
}

export interface NuevoEscalamiento {
  asistenteId: string;
  pregunta: string;
  motivo: MotivoEscalamiento;
  traceId?: string | null;
}

export interface ResultadoCrearEscalamiento {
  id: number;
  creado: boolean;
}

export type ResultadoCrearConLimite =
  | { estado: "creado" | "duplicado"; id: number }
  | { estado: "limite"; id: null };

// Recorta y colapsa espacios; es la forma que se guarda.
export function limpiarPregunta(pregunta: string): string {
  return pregunta.trim().replace(/\s+/g, " ");
}

function aEscalamiento(f: Row): Escalamiento {
  return {
    id: numero(f, "id"),
    asistenteId: texto(f, "asistente_id"),
    pregunta: texto(f, "pregunta"),
    motivo: texto(f, "motivo") as MotivoEscalamiento,
    traceId: textoONulo(f, "trace_id"),
    estado: texto(f, "estado") as EstadoEscalamiento,
    creadoEn: texto(f, "creado_en"),
  };
}

export function crearEscalamientos(fuente: FuenteDb = db) {
  // Deduplica en una sola sentencia (atómica): misma pregunta pendiente del
  // mismo asistente, comparando sin mayúsculas ni espacios extra.
  async function crear(datos: NuevoEscalamiento): Promise<ResultadoCrearEscalamiento> {
    const c = await fuente();
    const pregunta = limpiarPregunta(datos.pregunta);
    const existente = `SELECT id FROM escalamientos
      WHERE asistente_id = ? AND estado = 'pendiente' AND lower(pregunta) = lower(?)
      ORDER BY id LIMIT 1`;
    const [insertada, previa] = await c.batch(
      [
        {
          sql: `INSERT INTO escalamientos (asistente_id, pregunta, motivo, trace_id)
            SELECT ?, ?, ?, ? WHERE NOT EXISTS (${existente}) RETURNING id`,
          args: [datos.asistenteId, pregunta, datos.motivo, datos.traceId ?? null, datos.asistenteId, pregunta],
        },
        { sql: existente, args: [datos.asistenteId, pregunta] },
      ],
      "write",
    );
    if (insertada.rows[0]) return { id: numero(insertada.rows[0], "id"), creado: true };
    return { id: numero(previa.rows[0], "id"), creado: false };
  }

  // Como `crear`, pero además respeta un tope de escalamientos por asistente
  // (cualquier estado), todo en una sola sentencia. Una pregunta repetida
  // pendiente no cuenta como nueva: devuelve la existente.
  async function crearConLimite(datos: NuevoEscalamiento, limite: number): Promise<ResultadoCrearConLimite> {
    const c = await fuente();
    const pregunta = limpiarPregunta(datos.pregunta);
    const existente = `SELECT id FROM escalamientos
      WHERE asistente_id = ? AND estado = 'pendiente' AND lower(pregunta) = lower(?)
      ORDER BY id LIMIT 1`;
    const [insertada, previa] = await c.batch(
      [
        {
          sql: `INSERT INTO escalamientos (asistente_id, pregunta, motivo, trace_id)
            SELECT ?, ?, ?, ? WHERE NOT EXISTS (${existente})
              AND (SELECT COUNT(*) FROM escalamientos WHERE asistente_id = ?) < ?
            RETURNING id`,
          args: [
            datos.asistenteId, pregunta, datos.motivo, datos.traceId ?? null,
            datos.asistenteId, pregunta, datos.asistenteId, limite,
          ],
        },
        { sql: existente, args: [datos.asistenteId, pregunta] },
      ],
      "write",
    );
    if (insertada.rows[0]) return { estado: "creado", id: numero(insertada.rows[0], "id") };
    if (previa.rows[0]) return { estado: "duplicado", id: numero(previa.rows[0], "id") };
    return { estado: "limite", id: null };
  }

  // Lugar en la cola: pendientes creados antes (de cualquier asistente), más uno.
  async function posicion(id: number): Promise<number> {
    const c = await fuente();
    const r = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM escalamientos WHERE estado = 'pendiente' AND id < ?",
      args: [id],
    });
    return numero(r.rows[0], "n") + 1;
  }

  async function contarPorAsistente(asistenteId: string): Promise<number> {
    const c = await fuente();
    const r = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM escalamientos WHERE asistente_id = ?",
      args: [asistenteId],
    });
    return numero(r.rows[0], "n");
  }

  async function listar(filtro: { estado?: EstadoEscalamiento } = {}): Promise<Escalamiento[]> {
    const c = await fuente();
    const r = filtro.estado
      ? await c.execute({
          sql: "SELECT * FROM escalamientos WHERE estado = ? ORDER BY id DESC",
          args: [filtro.estado],
        })
      : await c.execute("SELECT * FROM escalamientos ORDER BY id DESC");
    return r.rows.map(aEscalamiento);
  }

  async function actualizarEstado(id: number, estado: EstadoEscalamiento): Promise<boolean> {
    const c = await fuente();
    const r = await c.execute({
      sql: "UPDATE escalamientos SET estado = ? WHERE id = ?",
      args: [estado, id],
    });
    return r.rowsAffected > 0;
  }

  return { crear, crearConLimite, posicion, contarPorAsistente, listar, actualizarEstado };
}

export const escalamientos = crearEscalamientos();
