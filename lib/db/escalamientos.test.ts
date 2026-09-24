import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearAsistentes } from "./asistentes";
import { crearEscalamientos } from "./escalamientos";
import { crearDbTemporal } from "./prueba";

describe("escalamientos", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  let repo: ReturnType<typeof crearEscalamientos>;
  let a: string;
  let b: string;
  beforeEach(async () => {
    db = await crearDbTemporal();
    repo = crearEscalamientos(db.fuente);
    const asis = crearAsistentes(db.fuente);
    a = (await asis.crearInvitado({ email: "a@e.com", nombre: "A" })).id;
    b = (await asis.crearInvitado({ email: "b@e.com", nombre: "B" })).id;
  });
  afterEach(() => db.cerrar());

  it("deduplica la misma pregunta pendiente del mismo asistente", async () => {
    const r1 = await repo.crear({ asistenteId: a, pregunta: "¿Cuánto cobras por una consultoría?", motivo: "comercial" });
    const r2 = await repo.crear({ asistenteId: a, pregunta: "  ¿cuánto   cobras por una consultoría?  ", motivo: "comercial", traceId: "t2" });
    expect(r1.creado).toBe(true);
    expect(r2.creado).toBe(false);
    expect(r2.id).toBe(r1.id);
    const filas = await db.cliente.execute("SELECT COUNT(*) AS n FROM escalamientos");
    expect(Number(filas.rows[0].n)).toBe(1);
  });

  it("no deduplica entre asistentes ni si la anterior ya no está pendiente", async () => {
    const r1 = await repo.crear({ asistenteId: a, pregunta: "Hola", motivo: "fuera_de_charla" });
    const r2 = await repo.crear({ asistenteId: b, pregunta: "Hola", motivo: "fuera_de_charla" });
    expect(r2.creado).toBe(true);
    expect(await repo.actualizarEstado(r1.id, "respondida")).toBe(true);
    const r3 = await repo.crear({ asistenteId: a, pregunta: "Hola", motivo: "fuera_de_charla" });
    expect(r3.creado).toBe(true);
    expect(r3.id).not.toBe(r1.id);
  });

  it("cuenta por asistente y lista por estado", async () => {
    const r1 = await repo.crear({ asistenteId: a, pregunta: "P1", motivo: "desacuerdo", traceId: "tr-1" });
    await repo.crear({ asistenteId: a, pregunta: "P2", motivo: "falla_tecnica" });
    await repo.crear({ asistenteId: b, pregunta: "P3", motivo: "experiencia_personal" });
    expect(await repo.contarPorAsistente(a)).toBe(2);
    expect(await repo.contarPorAsistente(b)).toBe(1);
    await repo.actualizarEstado(r1.id, "descartada");
    const pendientes = await repo.listar({ estado: "pendiente" });
    expect(pendientes.map((e) => e.pregunta).sort()).toEqual(["P2", "P3"]);
    const descartadas = await repo.listar({ estado: "descartada" });
    expect(descartadas).toHaveLength(1);
    expect(descartadas[0]).toMatchObject({ id: r1.id, asistenteId: a, motivo: "desacuerdo", traceId: "tr-1", estado: "descartada" });
    expect(await repo.listar()).toHaveLength(3);
    expect(await repo.actualizarEstado(9999, "respondida")).toBe(false);
  });

  it("crearConLimite crea hasta el límite, deduplica sin contar y luego rechaza", async () => {
    const r1 = await repo.crearConLimite({ asistenteId: a, pregunta: "P1", motivo: "comercial" }, 3);
    const r2 = await repo.crearConLimite({ asistenteId: a, pregunta: "P2", motivo: "comercial" }, 3);
    const r3 = await repo.crearConLimite({ asistenteId: a, pregunta: "P3", motivo: "comercial" }, 3);
    expect([r1.estado, r2.estado, r3.estado]).toEqual(["creado", "creado", "creado"]);
    const repetida = await repo.crearConLimite({ asistenteId: a, pregunta: " p2 ", motivo: "comercial" }, 3);
    expect(repetida).toEqual({ estado: "duplicado", id: r2.id });
    const cuarta = await repo.crearConLimite({ asistenteId: a, pregunta: "P4", motivo: "comercial", traceId: "t" }, 3);
    expect(cuarta).toEqual({ estado: "limite", id: null });
    expect(await repo.contarPorAsistente(a)).toBe(3);
    const otro = await repo.crearConLimite({ asistenteId: b, pregunta: "P4", motivo: "comercial" }, 3);
    expect(otro.estado).toBe("creado");
  });

  it("posicion cuenta los pendientes creados antes, más uno", async () => {
    const r1 = await repo.crear({ asistenteId: a, pregunta: "P1", motivo: "comercial" });
    const r2 = await repo.crear({ asistenteId: b, pregunta: "P2", motivo: "comercial" });
    const r3 = await repo.crear({ asistenteId: a, pregunta: "P3", motivo: "comercial" });
    expect(await repo.posicion(r1.id)).toBe(1);
    expect(await repo.posicion(r2.id)).toBe(2);
    expect(await repo.posicion(r3.id)).toBe(3);
    await repo.actualizarEstado(r1.id, "respondida");
    expect(await repo.posicion(r3.id)).toBe(2);
  });
});
