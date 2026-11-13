import { afterEach, describe, expect, it, vi } from "vitest";

const anotarEvento = vi.hoisted(() => vi.fn());
vi.mock("@/lib/salud/registro", () => ({ anotarEvento }));

const { errorInterno } = await import("./respuestas");

afterEach(() => vi.restoreAllMocks());

describe("errorInterno", () => {
  it("responde 500 genérico, registra solo el tipo y deja el evento rojo de «Base de datos»", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = errorInterno("chat", new Error("SQLITE_BUSY: ana@e.com"));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "error_interno", mensaje: "Algo salió mal. Intenta de nuevo en un momento." });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SQLITE_BUSY|ana@e\\.com/);
    expect(anotarEvento).toHaveBeenCalledWith("db_error");
  });
});
