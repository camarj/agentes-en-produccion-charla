import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearDbTemporal } from "../lib/db/prueba";
import { esConfirmacion, purgarPersonales } from "./purgar-personales";

describe("purgarPersonales", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  beforeEach(async () => {
    db = await crearDbTemporal();
  });
  afterEach(() => db.cerrar());

  it("borra asistentes, sesiones, escalamientos y votos y no toca láminas ni interruptores", async () => {
    await db.cliente.batch(
      [
        "INSERT INTO asistentes (id, email, nombre, origen) VALUES ('a1', 'x@ejemplo.test', 'X', 'inscrito')",
        "INSERT INTO asistentes (id, email, nombre, origen) VALUES ('a2', 'y@ejemplo.test', 'Y', 'invitado')",
        "INSERT INTO sesiones (token, asistente_id, thread_id) VALUES ('t1', 'a1', 'th1')",
        "INSERT INTO escalamientos (asistente_id, pregunta, motivo) VALUES ('a1', '¿?', 'comercial')",
        "INSERT INTO feedback (asistente_id, trace_id, valor) VALUES ('a1', 'tr1', 1)",
        "INSERT INTO feedback (asistente_id, trace_id, valor) VALUES ('a2', 'tr1', -1)",
        "INSERT INTO laminas (numero, titulo, contenido) VALUES (1, 'T', 'C')",
      ],
      "write",
    );
    expect(await purgarPersonales(db.fuente)).toEqual({ asistentes: 2, sesiones: 1, escalamientos: 1, feedback: 2 });
    const r = await db.cliente.execute(
      "SELECT (SELECT count(*) FROM asistentes) + (SELECT count(*) FROM sesiones) + (SELECT count(*) FROM escalamientos) + (SELECT count(*) FROM feedback) AS personales, (SELECT count(*) FROM laminas) AS laminas, (SELECT count(*) FROM interruptores) AS interruptores",
    );
    expect(Number(r.rows[0].personales)).toBe(0);
    expect(Number(r.rows[0].laminas)).toBe(1);
    expect(Number(r.rows[0].interruptores)).toBeGreaterThan(0);
  });

  it("acepta solo respuestas afirmativas explícitas", () => {
    for (const si of ["si", "Sí", " s ", "SI"]) expect(esConfirmacion(si)).toBe(true);
    for (const no of ["", "no", "n", "quizás"]) expect(esConfirmacion(no)).toBe(false);
  });
});
