import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearAsistentes } from "./asistentes";
import { crearDbTemporal } from "./prueba";
import { crearSesiones } from "./sesiones";

describe("sesiones", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  let repo: ReturnType<typeof crearSesiones>;
  let asistenteId: string;
  beforeEach(async () => {
    db = await crearDbTemporal();
    repo = crearSesiones(db.fuente);
    asistenteId = (await crearAsistentes(db.fuente).crearInvitado({ email: "s@e.com", nombre: "S" })).id;
  });
  afterEach(() => db.cerrar());

  it("crea sesiones con token base64url de 32 bytes y thread compartido", async () => {
    const s1 = await repo.crear(asistenteId);
    const s2 = await repo.crear(asistenteId);
    expect(s1.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s1.token).not.toBe(s2.token);
    expect(s1.threadId).toBe(`charla-${asistenteId}`);
    expect(s2.threadId).toBe(s1.threadId);
    expect(s1.mensajes).toBe(0);
  });

  it("obtener devuelve la sesión o null", async () => {
    const s = await repo.crear(asistenteId);
    expect((await repo.obtener(s.token))?.asistenteId).toBe(asistenteId);
    expect(await repo.obtener("nope")).toBeNull();
  });

  it("incrementarMensajes devuelve el total del asistente en todas sus sesiones", async () => {
    const s1 = await repo.crear(asistenteId);
    const s2 = await repo.crear(asistenteId);
    expect(await repo.incrementarMensajes(s1.token)).toBe(1);
    expect(await repo.incrementarMensajes(s1.token)).toBe(2);
    expect(await repo.incrementarMensajes(s2.token)).toBe(3);
    expect((await repo.obtener(s2.token))?.mensajes).toBe(1);
    expect(await repo.incrementarMensajes("nope")).toBeNull();
  });

  it("nuevoHilo da un hilo nuevo a todas las sesiones del asistente y conserva el contador", async () => {
    const s1 = await repo.crear(asistenteId);
    const s2 = await repo.crear(asistenteId);
    const otro = (await crearAsistentes(db.fuente).crearInvitado({ email: "o@e.com", nombre: "O" })).id;
    const s3 = await repo.crear(otro);
    await repo.incrementarMensajes(s1.token);
    const hilo = await repo.nuevoHilo(s1.token);
    expect(hilo).toMatch(new RegExp(`^charla-${asistenteId}-[A-Za-z0-9_-]+$`));
    expect((await repo.obtener(s1.token))?.threadId).toBe(hilo);
    expect((await repo.obtener(s2.token))?.threadId).toBe(hilo);
    expect((await repo.obtener(s3.token))?.threadId).toBe(`charla-${otro}`);
    expect(await repo.nuevoHilo(s1.token)).not.toBe(hilo);
    expect(await repo.incrementarMensajes(s2.token)).toBe(2);
    expect(await repo.nuevoHilo("nope")).toBeNull();
  });

  it("una sesión nueva (otro dispositivo, volver a entrar) hereda el hilo actual del asistente", async () => {
    const s1 = await repo.crear(asistenteId);
    const hilo = await repo.nuevoHilo(s1.token);
    const s2 = await repo.crear(asistenteId);
    expect(s2.threadId).toBe(hilo);
  });

  it("la clave foránea impide sesiones de asistentes inexistentes", async () => {
    await expect(repo.crear("fantasma")).rejects.toThrow();
  });
});
