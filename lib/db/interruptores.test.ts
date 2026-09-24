import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearInterruptores } from "./interruptores";
import { crearDbTemporal } from "./prueba";

describe("interruptores", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  let repo: ReturnType<typeof crearInterruptores>;
  beforeEach(async () => {
    db = await crearDbTemporal();
    repo = crearInterruptores(db.fuente);
  });
  afterEach(() => db.cerrar());

  it("obtenerTodos devuelve los valores sembrados", async () => {
    expect(await repo.obtenerTodos()).toEqual({
      herramienta_caida: "off",
      latencia_alta: "off",
      modelo_caido: "off",
      modelos_caidos: "off",
      kill_switch: "off",
      lamina_actual: "1",
    });
  });

  it("usa caché de 2 s e invalida al actualizar", async () => {
    await repo.obtenerTodos();
    await db.cliente.execute("UPDATE interruptores SET valor = 'on' WHERE clave = 'kill_switch'");
    expect((await repo.obtenerTodos()).kill_switch).toBe("off");
    repo.limpiarCache();
    expect((await repo.obtenerTodos()).kill_switch).toBe("on");
    await repo.actualizar("kill_switch", "off");
    expect((await repo.obtenerTodos()).kill_switch).toBe("off");
  });

  it("actualizar registra el cambio en eventos_interruptor", async () => {
    await repo.actualizar("lamina_actual", "12");
    await repo.actualizar("modelo_caido", "on");
    const eventos = await db.cliente.execute("SELECT clave, valor FROM eventos_interruptor ORDER BY id");
    expect(eventos.rows.map((r) => [r.clave, r.valor])).toEqual([
      ["lamina_actual", "12"],
      ["modelo_caido", "on"],
    ]);
    expect((await repo.obtenerTodos()).lamina_actual).toBe("12");
  });

  it("ultimasActivaciones: hora (ISO, UTC) del último 'on' de cada interruptor, o null", async () => {
    expect(await repo.ultimasActivaciones()).toEqual({
      herramienta_caida: null,
      latencia_alta: null,
      modelo_caido: null,
      modelos_caidos: null,
      kill_switch: null,
    });
    await db.cliente.execute(`INSERT INTO eventos_interruptor (clave, valor, creado_en) VALUES
      ('herramienta_caida', 'on', '2026-09-26 18:00:00'),
      ('herramienta_caida', 'off', '2026-09-26 18:05:00'),
      ('herramienta_caida', 'on', '2026-09-26 18:10:00'),
      ('kill_switch', 'on', '2026-09-26 18:20:30'),
      ('modelo_caido', 'off', '2026-09-26 18:30:00'),
      ('lamina_actual', '12', '2026-09-26 18:40:00')`);
    expect(await repo.ultimasActivaciones()).toEqual({
      herramienta_caida: "2026-09-26T18:10:00Z",
      latencia_alta: null,
      modelo_caido: null,
      modelos_caidos: null,
      kill_switch: "2026-09-26T18:20:30Z",
    });
  });
});
