import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearAsistentes } from "./db/asistentes";
import { crearDbTemporal } from "./db/prueba";
import { crearSesiones } from "./db/sesiones";
import {
  DURACION_SESION_S,
  NOMBRE_COOKIE,
  establecerCookieSesion,
  estadoDe,
  firmarToken,
  leerSesion,
  nombrePila,
  verificarToken,
} from "./session";
import { peticion } from "./prueba-api";

const SECRETO = "secreto-de-prueba-0123456789";

describe("session: token firmado", () => {
  beforeEach(() => vi.stubEnv("SESSION_SECRET", SECRETO));
  afterEach(() => vi.unstubAllEnvs());

  it("firma y verifica un token válido", () => {
    const valor = firmarToken("abcDEF_-123");
    expect(valor.split(".")).toHaveLength(3);
    expect(verificarToken(valor)).toBe("abcDEF_-123");
  });

  it("rechaza firma, token o vencimiento manipulados", () => {
    const valor = firmarToken("abc");
    const [token, vence, firma] = valor.split(".");
    expect(verificarToken(`${token}.${vence}.${firma.slice(0, -1)}x`)).toBeNull();
    expect(verificarToken(`otro.${vence}.${firma}`)).toBeNull();
    expect(verificarToken(`${token}.${Number(vence) + 3600}.${firma}`)).toBeNull();
    expect(verificarToken(`${token}.${vence}`)).toBeNull();
    expect(verificarToken("")).toBeNull();
    expect(verificarToken(undefined)).toBeNull();
    expect(verificarToken("a.b.c.d")).toBeNull();
  });

  it("rechaza un token firmado con otro secreto", () => {
    const valor = firmarToken("abc");
    vi.stubEnv("SESSION_SECRET", "otro-secreto-0123456789");
    expect(verificarToken(valor)).toBeNull();
  });

  it("vence a las 12 horas", () => {
    const ahora = Date.UTC(2026, 8, 23, 18, 0, 0);
    const valor = firmarToken("abc", ahora);
    expect(verificarToken(valor, ahora + (DURACION_SESION_S - 1) * 1000)).toBe("abc");
    expect(verificarToken(valor, ahora + DURACION_SESION_S * 1000)).toBeNull();
  });

  it("falla cerrado sin SESSION_SECRET o con uno demasiado corto", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => firmarToken("abc")).toThrow(/SESSION_SECRET/);
    vi.stubEnv("SESSION_SECRET", "corto");
    expect(() => firmarToken("abc")).toThrow(/SESSION_SECRET/);
  });

  it("la cookie es httpOnly, secure, sameSite=lax, path / y dura 12 h", () => {
    const respuesta = establecerCookieSesion(NextResponse.json({ ok: true }), "abc");
    const cabecera = respuesta.headers.get("set-cookie") ?? "";
    expect(cabecera).toMatch(new RegExp(`^${NOMBRE_COOKIE}=`));
    expect(cabecera).toMatch(/HttpOnly/i);
    expect(cabecera).toMatch(/Secure/i);
    expect(cabecera).toMatch(/SameSite=lax/i);
    expect(cabecera).toMatch(/Path=\//i);
    expect(cabecera).toMatch(new RegExp(`Max-Age=${DURACION_SESION_S}`));
  });
});

describe("session: helpers de perfil", () => {
  it("nombrePila toma la primera palabra, sin espacios, o undefined", () => {
    expect(nombrePila("  Andrea   Salazar ")).toBe("Andrea");
    expect(nombrePila("Andrea")).toBe("Andrea");
    expect(nombrePila("")).toBeUndefined();
    expect(nombrePila("   ")).toBeUndefined();
  });

  it("estadoDe: rol → listo; sin rol y sin nombre → nuevo; sin rol con nombre → falta_perfil", () => {
    expect(estadoDe({ nombre: "Ana", rol: "CTO" })).toBe("listo");
    expect(estadoDe({ nombre: "", rol: "CTO" })).toBe("listo");
    expect(estadoDe({ nombre: "", rol: null })).toBe("nuevo");
    expect(estadoDe({ nombre: "Ana", rol: null })).toBe("falta_perfil");
    expect(estadoDe({ nombre: "Ana", rol: "  " })).toBe("falta_perfil");
  });
});

describe("session: leerSesion", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  let deps: { sesiones: ReturnType<typeof crearSesiones>; asistentes: ReturnType<typeof crearAsistentes> };

  beforeEach(async () => {
    vi.stubEnv("SESSION_SECRET", SECRETO);
    db = await crearDbTemporal();
    deps = { sesiones: crearSesiones(db.fuente), asistentes: crearAsistentes(db.fuente) };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    db.cerrar();
  });

  it("devuelve sesión y asistente con una cookie válida", async () => {
    const a = await deps.asistentes.crearInvitado({ email: "l@e.com", nombre: "Lu" });
    const s = await deps.sesiones.crear(a.id);
    const actual = await leerSesion(peticion("/api/sesion", { cookie: firmarToken(s.token) }), deps);
    expect(actual?.asistente.id).toBe(a.id);
    expect(actual?.sesion.threadId).toBe(`charla-${a.id}`);
  });

  it("null sin cookie, con cookie manipulada o con token inexistente", async () => {
    expect(await leerSesion(peticion("/api/sesion"), deps)).toBeNull();
    expect(await leerSesion(peticion("/api/sesion", { cookie: "basura" }), deps)).toBeNull();
    expect(await leerSesion(peticion("/api/sesion", { cookie: firmarToken("inexistente") }), deps)).toBeNull();
  });
});
