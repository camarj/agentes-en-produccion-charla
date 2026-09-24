import crypto from "node:crypto";
import type { Row } from "@libsql/client";
import { db, type FuenteDb } from "./client";
import { numero, texto } from "./tipos";

export interface Sesion {
  token: string;
  asistenteId: string;
  threadId: string;
  mensajes: number;
  creadoEn: string;
}

function aSesion(f: Row): Sesion {
  return {
    token: texto(f, "token"),
    asistenteId: texto(f, "asistente_id"),
    threadId: texto(f, "thread_id"),
    mensajes: numero(f, "mensajes"),
    creadoEn: texto(f, "creado_en"),
  };
}

export function crearSesiones(fuente: FuenteDb = db) {
  // Varias sesiones del mismo asistente comparten thread_id (varios dispositivos).
  // Una sesión nueva hereda el hilo actual del asistente (puede haber cambiado
  // con «Nueva conversación»); si es la primera, `charla-<asistente_id>`.
  async function crear(asistenteId: string): Promise<Sesion> {
    const c = await fuente();
    const r = await c.execute({
      sql: `INSERT INTO sesiones (token, asistente_id, thread_id)
            VALUES (?, ?, COALESCE((SELECT thread_id FROM sesiones WHERE asistente_id = ? ORDER BY rowid DESC LIMIT 1), ?))
            RETURNING *`,
      args: [crypto.randomBytes(32).toString("base64url"), asistenteId, asistenteId, `charla-${asistenteId}`],
    });
    return aSesion(r.rows[0]);
  }

  async function obtener(token: string): Promise<Sesion | null> {
    const c = await fuente();
    const r = await c.execute({ sql: "SELECT * FROM sesiones WHERE token = ?", args: [token] });
    return r.rows[0] ? aSesion(r.rows[0]) : null;
  }

  // Suma 1 a la sesión y devuelve el total del asistente; null si el token no existe.
  async function incrementarMensajes(token: string): Promise<number | null> {
    const c = await fuente();
    const [actualizada, total] = await c.batch(
      [
        { sql: "UPDATE sesiones SET mensajes = mensajes + 1 WHERE token = ?", args: [token] },
        {
          sql: "SELECT SUM(mensajes) AS total FROM sesiones WHERE asistente_id = (SELECT asistente_id FROM sesiones WHERE token = ?)",
          args: [token],
        },
      ],
      "write",
    );
    if (actualizada.rowsAffected === 0) return null;
    return numero(total.rows[0], "total");
  }

  // «Nueva conversación» (T11): hilo nuevo para todas las sesiones del asistente
  // (siguen compartiendo hilo entre dispositivos). El contador `mensajes` no
  // cambia: el tope sigue contando entre hilos. null si el token no existe.
  async function nuevoHilo(token: string): Promise<string | null> {
    const c = await fuente();
    const sesion = await obtener(token);
    if (!sesion) return null;
    const hilo = `charla-${sesion.asistenteId}-${crypto.randomBytes(9).toString("base64url")}`;
    await c.execute({ sql: "UPDATE sesiones SET thread_id = ? WHERE asistente_id = ?", args: [hilo, sesion.asistenteId] });
    return hilo;
  }

  return { crear, obtener, incrementarMensajes, nuevoHilo };
}

export const sesiones = crearSesiones();
