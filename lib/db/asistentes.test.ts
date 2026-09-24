import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearAsistentes } from "./asistentes";
import { crearDbTemporal } from "./prueba";

describe("asistentes", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  let repo: ReturnType<typeof crearAsistentes>;
  beforeEach(async () => {
    db = await crearDbTemporal();
    repo = crearAsistentes(db.fuente);
  });
  afterEach(() => db.cerrar());

  it("buscarPorEmail normaliza espacios y mayúsculas", async () => {
    await db.cliente.execute({
      sql: "INSERT INTO asistentes (id, email, nombre, origen) VALUES ('a1', 'ana@ejemplo.com', 'Ana', 'inscrito')",
      args: [],
    });
    const encontrado = await repo.buscarPorEmail(" Ana@Ejemplo.com ");
    expect(encontrado?.id).toBe("a1");
    expect(encontrado?.origen).toBe("inscrito");
    expect(await repo.buscarPorEmail("otro@ejemplo.com")).toBeNull();
  });

  it("crearInvitado usa origen invitado, uuid y email normalizado", async () => {
    const nuevo = await repo.crearInvitado({ email: " Beto@Ejemplo.COM", nombre: "Beto" });
    expect(nuevo.origen).toBe("invitado");
    expect(nuevo.email).toBe("beto@ejemplo.com");
    expect(nuevo.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await repo.buscarPorEmail("beto@ejemplo.com"))?.id).toBe(nuevo.id);
  });

  it("actualizarPerfil cambia rol, descripcion y opcionalmente nombre", async () => {
    const a = await repo.crearInvitado({ email: "c@e.com", nombre: "Caro" });
    const act = await repo.actualizarPerfil(a.id, { rol: "CTO", descripcion: "Agentes de soporte" });
    expect(act).toMatchObject({ nombre: "Caro", rol: "CTO", descripcion: "Agentes de soporte" });
    const act2 = await repo.actualizarPerfil(a.id, { nombre: "Carolina", rol: "CEO" });
    expect(act2).toMatchObject({ nombre: "Carolina", rol: "CEO", descripcion: "Agentes de soporte" });
    expect(await repo.actualizarPerfil("no-existe", { rol: "x" })).toBeNull();
  });
});

describe("asistentes.listarPerfiles", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  let repo: ReturnType<typeof crearAsistentes>;
  beforeEach(async () => {
    db = await crearDbTemporal();
    repo = crearAsistentes(db.fuente);
  });
  afterEach(() => db.cerrar());

  it("devuelve id, nombre, rol y descripcion de todos, sin email", async () => {
    const a = await repo.crearInvitado({ email: "a@e.com", nombre: "Ana Torres" });
    await repo.actualizarPerfil(a.id, { rol: "Docente", descripcion: "Tutor de matemáticas" });
    await repo.crearInvitado({ email: "b@e.com", nombre: "Beto Ruiz" });
    const perfiles = await repo.listarPerfiles();
    expect(perfiles).toHaveLength(2);
    expect(perfiles).toContainEqual({ id: a.id, nombre: "Ana Torres", rol: "Docente", descripcion: "Tutor de matemáticas" });
    expect(perfiles.find((p) => p.nombre === "Beto Ruiz")).toMatchObject({ rol: null, descripcion: null });
    expect(JSON.stringify(perfiles)).not.toContain("@");
  });
});

describe("asistentes.upsertInscrito", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  let repo: ReturnType<typeof crearAsistentes>;
  beforeEach(async () => {
    db = await crearDbTemporal();
    repo = crearAsistentes(db.fuente);
  });
  afterEach(() => db.cerrar());

  it("inserta con origen inscrito y email normalizado", async () => {
    const r = await repo.upsertInscrito({ email: " Iris@Ejemplo.TEST ", nombre: "Iris", rol: null, descripcion: null });
    expect(r.insertado).toBe(true);
    expect(r.asistente).toMatchObject({ email: "iris@ejemplo.test", origen: "inscrito", rol: null });
  });

  it("al actualizar conserva el id, pasa a inscrito y no borra un rol ya completado", async () => {
    const invitado = await repo.crearInvitado({ email: "juan@ejemplo.test", nombre: "Juan" });
    await repo.actualizarPerfil(invitado.id, { rol: "Diseñador" });
    const r = await repo.upsertInscrito({ email: "JUAN@ejemplo.test", nombre: "Juan Pérez", rol: null, descripcion: "Bots" });
    expect(r.insertado).toBe(false);
    expect(r.asistente).toMatchObject({
      id: invitado.id,
      nombre: "Juan Pérez",
      rol: "Diseñador",
      descripcion: "Bots",
      origen: "inscrito",
    });
  });
});
