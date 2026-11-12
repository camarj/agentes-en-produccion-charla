import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Cliente, Sentencia } from "./client";
import { CERROJO_MIGRACIONES, migrar } from "./migrate";
import { crearDbTemporal } from "./prueba";

describe("migraciones", () => {
  let cerrar: () => Promise<void> = async () => {};
  afterEach(() => cerrar());

  it("aplica el esquema y es idempotente", async () => {
    const db = await crearDbTemporal();
    cerrar = db.cerrar;
    const segunda = await migrar(db.cliente);
    expect(segunda).toEqual([]);
    const tablas = await db.cliente.execute(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name",
    );
    const nombres = tablas.rows.map((r) => r.name);
    for (const t of ["asistentes", "sesiones", "escalamientos", "interruptores", "eventos_interruptor", "laminas", "feedback", "presupuesto", "jev_analisis", "turnos", "eventos_salud", "_migraciones"]) {
      expect(nombres).toContain(t);
    }
    const aplicadas = await db.cliente.execute("SELECT nombre FROM _migraciones");
    expect(aplicadas.rows.map((r) => r.nombre)).toEqual(["001_base_postgres.sql", "002_busqueda_laminas.sql", "003_busqueda_palabras_y_raices.sql"]);
  });

  it("siembra los interruptores apagados, la lámina 1 y el presupuesto en cero", async () => {
    const db = await crearDbTemporal();
    cerrar = db.cerrar;
    const r = await db.cliente.execute("SELECT clave, valor FROM interruptores ORDER BY clave");
    expect(Object.fromEntries(r.rows.map((f) => [f.clave, f.valor]))).toEqual({
      base_datos_lenta: "off", herramienta_caida: "off", kill_switch: "off", lamina_actual: "1",
      latencia_alta: "off", limite_gemini: "off", modelo_caido: "off", modelos_caidos: "off",
    });
    const p = await db.cliente.execute("SELECT coste_usd FROM presupuesto WHERE id = 1");
    expect(p.rows[0].coste_usd).toBe(0);
  });

  it("aplica las claves foráneas (borrar un asistente borra sus sesiones)", async () => {
    const db = await crearDbTemporal();
    cerrar = db.cerrar;
    await db.cliente.execute("INSERT INTO asistentes (id, email, nombre, origen) VALUES ('a', 'a@x.com', 'A', 'invitado')");
    await db.cliente.execute("INSERT INTO sesiones (token, asistente_id, thread_id) VALUES ('t', 'a', 'h')");
    await expect(db.cliente.execute("INSERT INTO sesiones (token, asistente_id, thread_id) VALUES ('u', 'nadie', 'h')")).rejects.toThrow();
    await db.cliente.execute("DELETE FROM asistentes WHERE id = 'a'");
    expect((await db.cliente.execute("SELECT count(*) AS n FROM sesiones")).rows[0].n).toBe(0);
  });

  it("toma el cerrojo consultivo antes de leer o aplicar migraciones", async () => {
    const vistas: string[] = [];
    const falso: Cliente = {
      execute: async () => ({ rows: [], rowsAffected: 0 }),
      batch: async () => [],
      close: async () => {},
      transaccion: async (fn) =>
        fn({
          execute: async (s: Sentencia) => {
            vistas.push(typeof s === "string" ? s : `${s.sql} ${JSON.stringify(s.args)}`);
            return { rows: [], rowsAffected: 0 };
          },
        }),
    };
    await migrar(falso);
    expect(vistas[0]).toBe(`SELECT pg_advisory_xact_lock(?) [${CERROJO_MIGRACIONES}]`);
    expect(vistas.some((v) => v.includes("CREATE TABLE asistentes"))).toBe(true);
  });

  it("dos arranques a la vez: uno migra y el otro no encuentra nada pendiente", async () => {
    const vacio = await crearDbTemporal({ migrada: false });
    cerrar = vacio.cerrar;
    const [a, b] = await Promise.all([migrar(vacio.cliente), migrar(vacio.cliente)]);
    expect([a, b].map((x) => x.length).sort()).toEqual([0, 3]);
  });

  it("si una migración falla no queda ninguna aplicada a medias", async () => {
    const vacio = await crearDbTemporal({ migrada: false });
    cerrar = vacio.cerrar;
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "charla-migraciones-"));
    try {
      fs.writeFileSync(path.join(carpeta, "001_ok.sql"), "CREATE TABLE uno (id INTEGER);");
      fs.writeFileSync(path.join(carpeta, "002_mala.sql"), "CREATE TABLE dos (id INTEGER); SELECT * FROM no_existe;");
      await expect(migrar(vacio.cliente, carpeta)).rejects.toThrow();
      const r = await vacio.cliente.execute("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('uno', 'dos', '_migraciones')");
      expect(r.rows[0].n).toBe(0);
    } finally {
      fs.rmSync(carpeta, { recursive: true, force: true });
    }
  });
});
