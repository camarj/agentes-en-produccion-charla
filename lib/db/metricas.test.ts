import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearAsistentes } from "./asistentes";
import { crearEscalamientos } from "./escalamientos";
import { crearMetricasCharla } from "./metricas";
import { crearDbTemporal } from "./prueba";
import { crearSesiones } from "./sesiones";

describe("metricas de charla.db", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  beforeEach(async () => {
    db = await crearDbTemporal();
  });
  afterEach(() => db.cerrar());

  it("base vacía → todo en cero", async () => {
    expect(await crearMetricasCharla(db.fuente).resumen()).toEqual({
      asistentesConMensajes: 0,
      asistentesRegistrados: 0,
      inscritos: 0,
      mensajes: 0,
      escalamientosPendientes: 0,
    });
  });

  it("cuenta asistentes con al menos un mensaje (sin duplicar dispositivos), mensajes y pendientes", async () => {
    const asistentes = crearAsistentes(db.fuente);
    const sesiones = crearSesiones(db.fuente);
    const escalamientos = crearEscalamientos(db.fuente);
    const a = (await asistentes.upsertInscrito({ email: "a@e.com", nombre: "Ana", rol: "Dev", descripcion: null })).asistente;
    const b = (await asistentes.upsertInscrito({ email: "b@e.com", nombre: "Beto", rol: "CEO", descripcion: null })).asistente;
    await asistentes.upsertInscrito({ email: "c@e.com", nombre: "Caro", rol: null, descripcion: null });
    const invitado = await asistentes.crearInvitado({ email: "d@e.com", nombre: "Dani" });

    // Ana en dos dispositivos (3 + 2 mensajes); el invitado 1; Beto entró pero no preguntó.
    const s1 = await sesiones.crear(a.id);
    const s2 = await sesiones.crear(a.id);
    await sesiones.crear(b.id);
    const s3 = await sesiones.crear(invitado.id);
    for (const t of [s1.token, s1.token, s1.token, s2.token, s2.token, s3.token]) await sesiones.incrementarMensajes(t);

    const e1 = await escalamientos.crear({ asistenteId: a.id, pregunta: "¿Uno?", motivo: "comercial" });
    await escalamientos.crear({ asistenteId: b.id, pregunta: "¿Dos?", motivo: "falla_tecnica" });
    await escalamientos.actualizarEstado(e1.id, "respondida");

    expect(await crearMetricasCharla(db.fuente).resumen()).toEqual({
      asistentesConMensajes: 2,
      asistentesRegistrados: 4,
      inscritos: 3,
      mensajes: 6,
      escalamientosPendientes: 1,
    });
  });
});
