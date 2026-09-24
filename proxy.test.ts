import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

const basic = (clave: string) => `Basic ${Buffer.from(`speaker:${clave}`).toString("base64")}`;
const pedir = (ruta: string, autorizacion?: string) =>
  new NextRequest(new URL(ruta, "http://localhost:3000"), {
    headers: autorizacion ? { authorization: autorizacion } : {},
  });

afterEach(() => vi.unstubAllEnvs());

const RUTAS = ["/panel", "/api/panel/metricas", "/api/panel/interruptores", "/api/panel/escalamientos"];

describe("proxy (Basic Auth del panel)", () => {
  it.each(RUTAS)("%s sin contraseña → 401", (ruta) => {
    vi.stubEnv("PANEL_PASSWORD", "clave-del-panel");
    const r = proxy(pedir(ruta));
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/^Basic /);
  });

  it.each(RUTAS)("%s con contraseña incorrecta → 401", (ruta) => {
    vi.stubEnv("PANEL_PASSWORD", "clave-del-panel");
    expect(proxy(pedir(ruta, basic("clave-del-panelX"))).status).toBe(401);
  });

  it.each(RUTAS)("%s con la contraseña correcta pasa", (ruta) => {
    vi.stubEnv("PANEL_PASSWORD", "clave-del-panel");
    const r = proxy(pedir(ruta, basic("clave-del-panel")));
    expect(r.status).toBe(200);
    expect(r.headers.get("x-middleware-next")).toBe("1");
  });

  it("falla cerrada: sin PANEL_PASSWORD responde 401 aunque manden algo", () => {
    vi.stubEnv("PANEL_PASSWORD", "");
    expect(proxy(pedir("/panel", basic(""))).status).toBe(401);
    expect(proxy(pedir("/api/panel/metricas", basic("cualquiera"))).status).toBe(401);
  });

  it("solo se aplica al panel y a su API", () => {
    expect(config.matcher).toEqual(["/panel/:path*", "/api/panel/:path*"]);
  });
});
