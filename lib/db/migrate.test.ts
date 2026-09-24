import { afterEach, describe, expect, it } from "vitest";
import { migrar } from "./migrate";
import { crearDbTemporal } from "./prueba";

describe("migraciones", () => {
  let cerrar: () => void = () => {};
  afterEach(() => cerrar());

  it("aplica el esquema y es idempotente", async () => {
    const db = await crearDbTemporal();
    cerrar = db.cerrar;
    const segunda = await migrar(db.cliente);
    expect(segunda).toEqual([]);
    const tablas = await db.cliente.execute(
      "SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name",
    );
    const nombres = tablas.rows.map((r) => r.name);
    for (const t of ["asistentes", "sesiones", "escalamientos", "interruptores", "eventos_interruptor", "laminas", "laminas_fts", "feedback", "_migraciones"]) {
      expect(nombres).toContain(t);
    }
    const aplicadas = await db.cliente.execute("SELECT nombre FROM _migraciones");
    expect(aplicadas.rows.map((r) => r.nombre)).toEqual(["001_init.sql", "002_feedback.sql", "003_presupuesto.sql", "004_modelos_caidos.sql", "005_jev.sql"]);
  });

  it("activa foreign_keys y WAL al abrir", async () => {
    const db = await crearDbTemporal();
    cerrar = db.cerrar;
    const fk = await db.cliente.execute("PRAGMA foreign_keys");
    expect(Number(fk.rows[0][0])).toBe(1);
    const modo = await db.cliente.execute("PRAGMA journal_mode");
    expect(String(modo.rows[0][0]).toLowerCase()).toBe("wal");
  });
});
