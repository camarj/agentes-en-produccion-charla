import type { Client } from "@libsql/client";
import { describe, expect, it, vi } from "vitest";
import { crearBaseLenta } from "./db-lenta";

function clienteFalso() {
  return {
    execute: vi.fn(async () => ({ rows: [{ n: 1 }] })),
    batch: vi.fn(async () => []),
    close: vi.fn(),
    closed: false,
  } as unknown as Client & { execute: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
}

describe("base de datos lenta (interruptor y semáforo «Base de datos»)", () => {
  it("apagado: las consultas pasan sin demora y no avisa", async () => {
    const alLenta = vi.fn();
    const base = crearBaseLenta({ retrasoMs: 40, umbralMs: 30, alLenta });
    const c = clienteFalso();
    const envuelto = base.envolver(c);
    expect(await envuelto.execute("SELECT 1")).toEqual({ rows: [{ n: 1 }] });
    expect(c.execute).toHaveBeenCalledWith("SELECT 1");
    expect(alLenta).not.toHaveBeenCalled();
  });

  it("encendido: suma la demora a execute y batch, y avisa que la consulta fue lenta", async () => {
    const alLenta = vi.fn();
    const base = crearBaseLenta({ retrasoMs: 40, umbralMs: 30, alLenta });
    const envuelto = base.envolver(clienteFalso());
    base.fijar(true);
    const inicio = performance.now();
    await envuelto.execute("SELECT 1");
    await envuelto.batch(["SELECT 1"], "read");
    expect(performance.now() - inicio).toBeGreaterThanOrEqual(75);
    expect(alLenta).toHaveBeenCalledTimes(2);
    base.fijar(false);
    await envuelto.execute("SELECT 1");
    expect(alLenta).toHaveBeenCalledTimes(2);
  });

  it("el resto del cliente sigue igual (close, closed)", () => {
    const c = clienteFalso();
    const envuelto = crearBaseLenta({ alLenta: vi.fn() }).envolver(c);
    envuelto.close();
    expect(c.close).toHaveBeenCalled();
    expect(envuelto.closed).toBe(false);
  });
});
