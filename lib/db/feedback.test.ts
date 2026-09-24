import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearAsistentes } from "./asistentes";
import { crearFeedback } from "./feedback";
import { crearDbTemporal } from "./prueba";

describe("feedback", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  let repo: ReturnType<typeof crearFeedback>;
  let a: string;
  let b: string;
  beforeEach(async () => {
    db = await crearDbTemporal();
    repo = crearFeedback(db.fuente);
    const asis = crearAsistentes(db.fuente);
    a = (await asis.crearInvitado({ email: "a@e.com", nombre: "A" })).id;
    b = (await asis.crearInvitado({ email: "b@e.com", nombre: "B" })).id;
  });
  afterEach(() => db.cerrar());

  it("sin votos, los totales son cero y no hay trazas", async () => {
    expect(await repo.totales()).toEqual({ positivos: 0, negativos: 0, total: 0 });
    expect(await repo.porTrace()).toEqual([]);
  });

  it("un voto repetido del mismo asistente en la misma traza actualiza el valor", async () => {
    await repo.registrar({ asistenteId: a, traceId: "t1", valor: 1 });
    await repo.registrar({ asistenteId: a, traceId: "t1", valor: -1 });
    const filas = await db.cliente.execute("SELECT asistente_id, trace_id, valor FROM feedback");
    expect(filas.rows).toHaveLength(1);
    expect(Number(filas.rows[0].valor)).toBe(-1);
    expect(await repo.totales()).toEqual({ positivos: 0, negativos: 1, total: 1 });
  });

  it("totales y porTrace agregan por traza, de la más reciente a la más antigua", async () => {
    await repo.registrar({ asistenteId: a, traceId: "t1", valor: 1 });
    await repo.registrar({ asistenteId: b, traceId: "t1", valor: -1 });
    await repo.registrar({ asistenteId: a, traceId: "t2", valor: 1 });
    expect(await repo.totales()).toEqual({ positivos: 2, negativos: 1, total: 3 });
    const lista = await repo.porTrace();
    expect(lista).toHaveLength(2);
    expect(lista[0]).toMatchObject({ traceId: "t2", positivos: 1, negativos: 0 });
    expect(lista[1]).toMatchObject({ traceId: "t1", positivos: 1, negativos: 1 });
    expect(typeof lista[0].ultimoEn).toBe("string");
  });

  it("la base rechaza valores distintos de 1 y -1 y asistentes inexistentes", async () => {
    await expect(repo.registrar({ asistenteId: a, traceId: "t", valor: 0 as 1 })).rejects.toThrow();
    await expect(repo.registrar({ asistenteId: "no-existe", traceId: "t", valor: 1 })).rejects.toThrow();
  });

  it("borrar al asistente borra sus votos (ON DELETE CASCADE)", async () => {
    await repo.registrar({ asistenteId: a, traceId: "t1", valor: 1 });
    await repo.registrar({ asistenteId: b, traceId: "t1", valor: 1 });
    await db.cliente.execute({ sql: "DELETE FROM asistentes WHERE id = ?", args: [a] });
    expect(await repo.totales()).toEqual({ positivos: 1, negativos: 0, total: 1 });
  });
});
