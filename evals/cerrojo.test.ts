import { describe, expect, it } from "vitest";
import { crearCerrojo } from "./cerrojo";

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("crearCerrojo (compartido / exclusivo)", () => {
  it("varios compartidos corren a la vez", async () => {
    const c = crearCerrojo();
    let activos = 0;
    let maximo = 0;
    const tarea = () =>
      c.compartido(async () => {
        activos++;
        maximo = Math.max(maximo, activos);
        await pausa(20);
        activos--;
      });
    await Promise.all([tarea(), tarea(), tarea()]);
    expect(maximo).toBe(3);
  });

  it("un exclusivo espera a que terminen los compartidos en curso y corre solo", async () => {
    const c = crearCerrojo();
    const eventos: string[] = [];
    const a = c.compartido(async () => {
      eventos.push("a+");
      await pausa(30);
      eventos.push("a-");
    });
    await pausa(1);
    const x = c.exclusivo(async () => {
      eventos.push("x+");
      await pausa(10);
      eventos.push("x-");
    });
    await pausa(1);
    // Llega después del exclusivo: espera a que termine (el exclusivo no se cuela ni se salta).
    const b = c.compartido(async () => {
      eventos.push("b+");
      eventos.push("b-");
    });
    await Promise.all([a, x, b]);
    expect(eventos).toEqual(["a+", "a-", "x+", "x-", "b+", "b-"]);
  });

  it("dos exclusivos no se superponen", async () => {
    const c = crearCerrojo();
    let dentro = 0;
    let maximo = 0;
    const tarea = () =>
      c.exclusivo(async () => {
        dentro++;
        maximo = Math.max(maximo, dentro);
        await pausa(10);
        dentro--;
      });
    await Promise.all([tarea(), tarea(), tarea()]);
    expect(maximo).toBe(1);
  });

  it("libera el cerrojo aunque la tarea lance y devuelve su valor", async () => {
    const c = crearCerrojo();
    await expect(c.exclusivo(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(c.compartido(async () => 7)).resolves.toBe(7);
    await expect(c.exclusivo(async () => 8)).resolves.toBe(8);
  });
});
