import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirCliente, type Cliente } from "./client";
import { migrar } from "./migrate";

// Adaptador de producción (`pg`) contra un Postgres real. Opcional: corre solo
// con PRUEBA_DATABASE_URL apuntando a una base desechable (se borra su esquema
// `public`). Ejemplo: PRUEBA_DATABASE_URL=postgres://prueba@127.0.0.1:55491/charla_prueba
const URL_PRUEBA = process.env.PRUEBA_DATABASE_URL?.trim();

describe.skipIf(!URL_PRUEBA)("cliente pg sobre Postgres real", () => {
  let a: Cliente;
  let b: Cliente;

  beforeAll(async () => {
    const limpieza = abrirCliente(URL_PRUEBA, { max: 1 });
    await limpieza.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await limpieza.close();
    a = abrirCliente(URL_PRUEBA);
    b = abrirCliente(URL_PRUEBA);
  });
  afterAll(async () => {
    await a?.close();
    await b?.close();
  });

  it("dos contenedores migran a la vez: el cerrojo deja que solo uno aplique", async () => {
    const [x, y] = await Promise.all([migrar(a), migrar(b)]);
    expect([x.length, y.length].sort()).toEqual([0, 1]);
  });

  it("execute, batch con rollback, rowsAffected y números como número", async () => {
    const r = await a.execute({ sql: "SELECT count(*) AS n, ? AS t FROM interruptores", args: ["¿?"] });
    expect(r.rows).toEqual([{ n: 8, t: "¿?" }]);
    await expect(a.batch(["UPDATE interruptores SET valor = 'on'", "SELECT * FROM no_existe"], "write")).rejects.toThrow();
    const u = await a.execute({ sql: "UPDATE interruptores SET valor = ? WHERE valor = ?", args: ["off", "off"] });
    expect(u.rowsAffected).toBe(7);
  });

  it("un error con argumentos no deja la conexión inutilizable", async () => {
    await expect(a.execute({ sql: "SELECT nada FROM interruptores WHERE clave = ?", args: ["x"] })).rejects.toThrow();
    const r = await a.execute({ sql: "SELECT valor FROM interruptores WHERE clave = ?", args: ["lamina_actual"] });
    expect(r.rows[0].valor).toBe("1");
  });
});
