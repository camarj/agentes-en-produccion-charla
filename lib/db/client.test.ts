import { afterEach, describe, expect, it } from "vitest";
import { aPlaceholdersPg } from "./client";
import { crearDbTemporal } from "./prueba";

describe("aPlaceholdersPg", () => {
  it("numera los ? en orden", () => {
    expect(aPlaceholdersPg("SELECT * FROM t WHERE a = ? AND b IN (?, ?) LIMIT ?")).toBe(
      "SELECT * FROM t WHERE a = $1 AND b IN ($2, $3) LIMIT $4",
    );
  });

  it("no toca los ? dentro de literales, identificadores ni comentarios", () => {
    expect(aPlaceholdersPg(`SELECT '¿qué?', 'it''s ?', "col?" FROM t -- ¿y esto?\nWHERE x = ? /* ? */ AND y = $$ ? $$`)).toBe(
      `SELECT '¿qué?', 'it''s ?', "col?" FROM t -- ¿y esto?\nWHERE x = $1 /* ? */ AND y = $$ ? $$`,
    );
  });
});

describe("cliente de charla sobre Postgres", () => {
  let cerrar: () => Promise<void> = async () => {};
  afterEach(() => cerrar());

  async function base() {
    const db = await crearDbTemporal();
    cerrar = db.cerrar;
    return db.cliente;
  }

  it("execute con ? devuelve filas por nombre de columna y números como número", async () => {
    const c = await base();
    const r = await c.execute({ sql: "SELECT ? AS texto, count(*) AS n, '¿?' AS signo FROM interruptores WHERE clave <> ?", args: ["hola", "nada"] });
    expect(r.rows).toEqual([{ texto: "hola", n: 8, signo: "¿?" }]);
  });

  it("rowsAffected cuenta las filas cambiadas", async () => {
    const c = await base();
    const r = await c.execute({ sql: "UPDATE interruptores SET valor = ? WHERE valor = ?", args: ["on", "off"] });
    expect(r.rowsAffected).toBe(7);
    expect((await c.execute("UPDATE interruptores SET valor = 'x' WHERE clave = 'no_existe'")).rowsAffected).toBe(0);
  });

  it("batch aplica todo en una transacción y devuelve un resultado por sentencia", async () => {
    const c = await base();
    const [a, b] = await c.batch(
      [
        { sql: "UPDATE interruptores SET valor = ? WHERE clave = ?", args: ["on", "kill_switch"] },
        "SELECT valor FROM interruptores WHERE clave = 'kill_switch'",
      ],
      "write",
    );
    expect(a.rowsAffected).toBe(1);
    expect(b.rows).toEqual([{ valor: "on" }]);
  });

  it("batch deshace todo si una sentencia falla", async () => {
    const c = await base();
    await expect(
      c.batch(["UPDATE interruptores SET valor = 'on' WHERE clave = 'kill_switch'", "SELECT * FROM no_existe"], "write"),
    ).rejects.toThrow();
    const r = await c.execute("SELECT valor FROM interruptores WHERE clave = 'kill_switch'");
    expect(r.rows[0].valor).toBe("off");
  });

  it("un error en una consulta con argumentos no deja la base inutilizable", async () => {
    const c = await base();
    await expect(c.execute({ sql: "SELECT nada FROM interruptores WHERE clave = ?", args: ["x"] })).rejects.toThrow();
    const r = await c.execute({ sql: "SELECT valor FROM interruptores WHERE clave = ?", args: ["kill_switch"] });
    expect(r.rows[0].valor).toBe("off");
  });

  it("las fechas por defecto conservan el formato de SQLite (UTC, AAAA-MM-DD HH:MM:SS)", async () => {
    const c = await base();
    const r = await c.execute("SELECT actualizado_en FROM interruptores LIMIT 1");
    expect(String(r.rows[0].actualizado_en)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
