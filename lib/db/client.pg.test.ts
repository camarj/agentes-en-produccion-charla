import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirCliente, type Cliente } from "./client";
import { migrar } from "./migrate";
import { crearSesiones } from "./sesiones";

// Cuántas migraciones hay en el repo (no un número fijo: crece con cada archivo).
const MIGRACIONES = fs.readdirSync(path.join(__dirname, "migrations")).filter((f) => f.endsWith(".sql")).length;

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
    expect([x.length, y.length].sort()).toEqual([0, MIGRACIONES]);
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

  // Verificación independiente 2026-11-12 (B2): con varias copias de la app,
  // dos entradas a la vez del mismo asistente dejaban varias sesiones activas.
  it("6 entradas simultáneas del mismo asistente (6 copias) dejan 1 sola sesión activa", async () => {
    const clientes = Array.from({ length: 6 }, () => abrirCliente(URL_PRUEBA, { max: 1 }));
    try {
      await a.execute("INSERT INTO asistentes (id, email, nombre, origen) VALUES ('conc', 'conc@x.com', 'C', 'invitado')");
      await Promise.all(clientes.map((c) => crearSesiones(async () => c).reemplazar("conc")));
      await Promise.all([crearSesiones(async () => a).reemplazar("conc"), crearSesiones(async () => b).reemplazar("conc")]);
      const r = await a.execute("SELECT count(*) AS n FROM sesiones WHERE asistente_id = 'conc' AND revocada_en IS NULL");
      expect(r.rows[0].n).toBe(1);
    } finally {
      await Promise.all(clientes.map((c) => c.close()));
    }
  });
});
