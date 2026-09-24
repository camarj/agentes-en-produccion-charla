import { describe, expect, it } from "vitest";
import { crearLimitador, ipDe } from "./rate-limit";
import { peticion } from "./prueba-api";

describe("rate-limit", () => {
  it("permite `limite` intentos por ventana y rechaza el siguiente", () => {
    const l = crearLimitador({ limite: 3, ventanaMs: 60_000 });
    const t = 1_000_000;
    expect(l.consumir("ip-1", t).permitido).toBe(true);
    expect(l.consumir("ip-1", t + 1).permitido).toBe(true);
    expect(l.consumir("ip-1", t + 2).permitido).toBe(true);
    const r = l.consumir("ip-1", t + 10_000);
    expect(r.permitido).toBe(false);
    expect(r.reintentarEnS).toBe(50);
  });

  it("las claves son independientes", () => {
    const l = crearLimitador({ limite: 1, ventanaMs: 60_000 });
    expect(l.consumir("a", 0).permitido).toBe(true);
    expect(l.consumir("a", 1).permitido).toBe(false);
    expect(l.consumir("b", 1).permitido).toBe(true);
  });

  it("la ventana se reinicia al vencer", () => {
    const l = crearLimitador({ limite: 1, ventanaMs: 60_000 });
    expect(l.consumir("a", 0).permitido).toBe(true);
    expect(l.consumir("a", 59_999).permitido).toBe(false);
    expect(l.consumir("a", 60_000).permitido).toBe(true);
  });

  it("reiniciar borra los contadores", () => {
    const l = crearLimitador({ limite: 1, ventanaMs: 60_000 });
    l.consumir("a", 0);
    l.reiniciar();
    expect(l.consumir("a", 1).permitido).toBe(true);
  });

  it("ipDe usa el primer x-forwarded-for, luego x-real-ip, luego 'desconocida'", () => {
    expect(ipDe(peticion("/x", { cabeceras: { "x-forwarded-for": " 1.2.3.4 , 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(ipDe(peticion("/x", { cabeceras: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(ipDe(peticion("/x"))).toBe("desconocida");
  });
});
