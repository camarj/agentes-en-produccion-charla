import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cuerpoChat, elegirModoRuta, puertoLibre } from "./ruta";

describe("elegirModoRuta", () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "evals-ruta-"));
  afterAll(() => fs.rmSync(raiz, { recursive: true, force: true }));

  it("respeta el modo pedido", () => {
    expect(elegirModoRuta("dev", raiz)).toBe("dev");
    expect(elegirModoRuta("proceso", raiz)).toBe("proceso");
    expect(elegirModoRuta("omitir", raiz)).toBe("omitir");
  });
  it("auto: el build standalone si existe (producción); si no, next dev", () => {
    expect(elegirModoRuta(undefined, raiz)).toBe("dev");
    fs.mkdirSync(path.join(raiz, ".next", "standalone"), { recursive: true });
    fs.writeFileSync(path.join(raiz, ".next", "standalone", "server.js"), "");
    expect(elegirModoRuta("auto", raiz)).toBe("standalone");
  });
  it("rechaza un modo desconocido", () => {
    expect(() => elegirModoRuta("otro", raiz)).toThrow(/--ruta/);
  });
});

describe("cuerpoChat", () => {
  it("arma el cuerpo de useChat con un solo mensaje del usuario", () => {
    expect(cuerpoChat("Hola, ¿sigues ahí?")).toEqual({
      messages: [{ id: "eval-u1", role: "user", parts: [{ type: "text", text: "Hola, ¿sigues ahí?" }] }],
    });
  });
});

describe("puertoLibre", () => {
  it("devuelve un puerto TCP libre", async () => {
    const p = await puertoLibre();
    expect(p).toBeGreaterThan(1023);
    expect(p).toBeLessThan(65536);
  });
});
