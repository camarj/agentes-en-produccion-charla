import { afterEach, describe, expect, it, vi } from "vitest";
import { autorizadoPanel, contrasenaDeBasicAuth, contrasenaValida, noAutorizado } from "./auth";

const basic = (usuario: string, clave: string) => `Basic ${Buffer.from(`${usuario}:${clave}`).toString("base64")}`;
const conCabecera = (valor?: string) =>
  new Request("http://localhost/panel", { headers: valor === undefined ? {} : { authorization: valor } });

afterEach(() => vi.unstubAllEnvs());

describe("contrasenaDeBasicAuth", () => {
  it("extrae la contraseña e ignora el usuario", () => {
    expect(contrasenaDeBasicAuth(basic("raul", "s3creta"))).toBe("s3creta");
    expect(contrasenaDeBasicAuth(basic("", "s3creta"))).toBe("s3creta");
  });
  it("admite ':' dentro de la contraseña", () => {
    expect(contrasenaDeBasicAuth(basic("x", "a:b:c"))).toBe("a:b:c");
  });
  it("null sin cabecera, con otro esquema o mal formada", () => {
    expect(contrasenaDeBasicAuth(null)).toBeNull();
    expect(contrasenaDeBasicAuth("Bearer abc")).toBeNull();
    expect(contrasenaDeBasicAuth("Basic")).toBeNull();
    expect(contrasenaDeBasicAuth(`Basic ${Buffer.from("sin-dos-puntos").toString("base64")}`)).toBeNull();
  });
  it("acepta el esquema sin distinguir mayúsculas", () => {
    expect(contrasenaDeBasicAuth(basic("u", "k").replace("Basic", "basic"))).toBe("k");
  });
});

describe("contrasenaValida", () => {
  it("true solo si coincide exactamente", () => {
    expect(contrasenaValida("clave-larga", "clave-larga")).toBe(true);
    expect(contrasenaValida("clave-larg", "clave-larga")).toBe(false);
    expect(contrasenaValida("clave-largaX", "clave-larga")).toBe(false);
    expect(contrasenaValida("", "clave-larga")).toBe(false);
  });
  it("falla cerrada sin contraseña configurada", () => {
    expect(contrasenaValida("", "")).toBe(false);
    expect(contrasenaValida("algo", undefined)).toBe(false);
    expect(contrasenaValida(null, "   ")).toBe(false);
  });
});

describe("autorizadoPanel", () => {
  it("lee PANEL_PASSWORD del entorno", () => {
    vi.stubEnv("PANEL_PASSWORD", "clave-panel");
    expect(autorizadoPanel(conCabecera(basic("raul", "clave-panel")))).toBe(true);
    expect(autorizadoPanel(conCabecera(basic("raul", "otra")))).toBe(false);
    expect(autorizadoPanel(conCabecera())).toBe(false);
  });
  it("sin PANEL_PASSWORD nadie entra", () => {
    vi.stubEnv("PANEL_PASSWORD", "");
    expect(autorizadoPanel(conCabecera(basic("raul", "")))).toBe(false);
  });
});

describe("noAutorizado", () => {
  it("401 con WWW-Authenticate y sin caché", async () => {
    const r = noAutorizado();
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/^Basic realm="Panel del speaker"/);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toMatchObject({ error: "no_autorizado" });
  });
});
