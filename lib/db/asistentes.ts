import crypto from "node:crypto";
import type { Row } from "@libsql/client";
import { db, type FuenteDb } from "./client";
import { texto, textoONulo } from "./tipos";

export type OrigenAsistente = "inscrito" | "invitado";

export interface Asistente {
  id: string;
  email: string;
  nombre: string;
  rol: string | null;
  descripcion: string | null;
  origen: OrigenAsistente;
  creadoEn: string;
}

// Datos que usa el guardrail de privacidad (T06). Sin email.
export interface PerfilPrivado {
  id: string;
  nombre: string;
  rol: string | null;
  descripcion: string | null;
}

export interface CambiosPerfil {
  nombre?: string;
  rol: string;
  descripcion?: string | null;
}

export interface DatosInscrito {
  email: string;
  nombre: string;
  rol: string | null;
  descripcion: string | null;
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

function aAsistente(f: Row): Asistente {
  return {
    id: texto(f, "id"),
    email: texto(f, "email"),
    nombre: texto(f, "nombre"),
    rol: textoONulo(f, "rol"),
    descripcion: textoONulo(f, "descripcion"),
    origen: texto(f, "origen") as OrigenAsistente,
    creadoEn: texto(f, "creado_en"),
  };
}

export function crearAsistentes(fuente: FuenteDb = db) {
  async function obtenerPorId(id: string): Promise<Asistente | null> {
    const c = await fuente();
    const r = await c.execute({ sql: "SELECT * FROM asistentes WHERE id = ?", args: [id] });
    return r.rows[0] ? aAsistente(r.rows[0]) : null;
  }

  async function buscarPorEmail(email: string): Promise<Asistente | null> {
    const c = await fuente();
    const r = await c.execute({
      sql: "SELECT * FROM asistentes WHERE email = ?",
      args: [normalizarEmail(email)],
    });
    return r.rows[0] ? aAsistente(r.rows[0]) : null;
  }

  async function crearInvitado(datos: { email: string; nombre: string }): Promise<Asistente> {
    const c = await fuente();
    const r = await c.execute({
      sql: "INSERT INTO asistentes (id, email, nombre, origen) VALUES (?, ?, ?, 'invitado') RETURNING *",
      args: [crypto.randomUUID(), normalizarEmail(datos.email), datos.nombre.trim()],
    });
    return aAsistente(r.rows[0]);
  }

  async function actualizarPerfil(id: string, cambios: CambiosPerfil): Promise<Asistente | null> {
    const c = await fuente();
    const sets = ["rol = ?"];
    const args: (string | null)[] = [cambios.rol];
    if (cambios.nombre !== undefined) {
      sets.push("nombre = ?");
      args.push(cambios.nombre);
    }
    if (cambios.descripcion !== undefined) {
      sets.push("descripcion = ?");
      args.push(cambios.descripcion);
    }
    const r = await c.execute({
      sql: `UPDATE asistentes SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
      args: [...args, id],
    });
    return r.rows[0] ? aAsistente(r.rows[0]) : null;
  }

  // Upsert por email (importación de inscritos). Al actualizar conserva el id y
  // no borra un rol o descripción que el asistente ya haya completado.
  async function upsertInscrito(
    datos: DatosInscrito,
  ): Promise<{ asistente: Asistente; insertado: boolean }> {
    const c = await fuente();
    const idNuevo = crypto.randomUUID();
    const r = await c.execute({
      sql: `INSERT INTO asistentes (id, email, nombre, rol, descripcion, origen)
        VALUES (?, ?, ?, ?, ?, 'inscrito')
        ON CONFLICT(email) DO UPDATE SET nombre = excluded.nombre,
          rol = coalesce(excluded.rol, asistentes.rol),
          descripcion = coalesce(excluded.descripcion, asistentes.descripcion),
          origen = 'inscrito'
        RETURNING *`,
      args: [idNuevo, normalizarEmail(datos.email), datos.nombre.trim(), datos.rol, datos.descripcion],
    });
    const asistente = aAsistente(r.rows[0]);
    return { asistente, insertado: asistente.id === idNuevo };
  }

  async function listarPerfiles(): Promise<PerfilPrivado[]> {
    const c = await fuente();
    const r = await c.execute("SELECT id, nombre, rol, descripcion FROM asistentes");
    return r.rows.map((f) => ({
      id: texto(f, "id"),
      nombre: texto(f, "nombre"),
      rol: textoONulo(f, "rol"),
      descripcion: textoONulo(f, "descripcion"),
    }));
  }

  return { obtenerPorId, buscarPorEmail, crearInvitado, actualizarPerfil, upsertInscrito, listarPerfiles };
}

export const asistentes = crearAsistentes();
