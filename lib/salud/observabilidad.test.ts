import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/mastra", () => ({ mastra: {} }));
const { crearSondaObservabilidad } = await import("./observabilidad");

afterEach(() => vi.restoreAllMocks());

describe("sonda de la observabilidad (semáforo «Trazas / observabilidad»)", () => {
  it("si la lectura falla deja el evento rojo, y no vuelve a sondear antes de 30 s", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let t = 0;
    const leer = vi.fn(async () => Promise.reject(new Error("ECONNREFUSED host-secreto")));
    const anotar = vi.fn(async () => {});
    const sondear = crearSondaObservabilidad({ leer, anotar, ahora: () => t });
    await sondear();
    await sondear();
    expect(leer).toHaveBeenCalledTimes(1);
    expect(anotar).toHaveBeenCalledTimes(1);
    t = 30_000;
    await sondear();
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it("si responde, no anota nada", async () => {
    const anotar = vi.fn(async () => {});
    await crearSondaObservabilidad({ leer: async () => ({ spans: [] }), anotar })();
    expect(anotar).not.toHaveBeenCalled();
  });
});
