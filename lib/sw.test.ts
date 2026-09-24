import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Carga public/sw.js tal cual en un «self» simulado y captura sus oyentes.
const codigo = fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
const ORIGEN = "https://charla.example";

type Oyente = (e: unknown) => void;

function cargarSW() {
  const oyentes: Record<string, Oyente> = {};
  const guardados: string[] = [];
  const cache = {
    addAll: vi.fn(async (urls: string[]) => void guardados.push(...urls)),
    put: vi.fn(async (req: Request) => void guardados.push(new URL(req.url).pathname)),
    match: vi.fn(async () => undefined as Response | undefined),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ["agentes-viejo", "otra-cosa"]),
    delete: vi.fn(async () => true),
    match: vi.fn(async () => undefined as Response | undefined),
  };
  const red = vi.fn(async () => new Response("red", { status: 200 }));
  const self = {
    location: new URL(`${ORIGEN}/sw.js`),
    addEventListener: (tipo: string, f: Oyente) => void (oyentes[tipo] = f),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  vm.runInNewContext(codigo, { self, caches, fetch: red, URL, Response, Request, Promise, console });
  return { oyentes, cache, caches, red, guardados };
}

// Simula un FetchEvent: devuelve la promesa pasada a respondWith, o null si el SW no intervino.
function pedir(sw: ReturnType<typeof cargarSW>, ruta: string, opciones: { method?: string; mode?: string } = {}) {
  let respuesta: Promise<Response> | null = null;
  const request = {
    url: ruta.startsWith("http") ? ruta : `${ORIGEN}${ruta}`,
    method: opciones.method ?? "GET",
    mode: opciones.mode ?? "cors",
    clone: () => request,
  };
  sw.oyentes.fetch({ request, respondWith: (p: Promise<Response>) => void (respuesta = p) });
  return respuesta as Promise<Response> | null;
}

let sw: ReturnType<typeof cargarSW>;
beforeEach(() => {
  sw = cargarSW();
});

describe("service worker", () => {
  it("al instalarse guarda solo la página sin conexión y los íconos", async () => {
    let espera: Promise<unknown> = Promise.resolve();
    sw.oyentes.install({ waitUntil: (p: Promise<unknown>) => void (espera = p) });
    await espera;
    expect(sw.guardados).toContain("/offline.html");
    expect(sw.guardados.every((u) => !u.startsWith("/api") && !u.startsWith("/panel"))).toBe(true);
  });

  it("al activarse borra cachés de versiones anteriores y no toca las ajenas", async () => {
    let espera: Promise<unknown> = Promise.resolve();
    sw.oyentes.activate({ waitUntil: (p: Promise<unknown>) => void (espera = p) });
    await espera;
    expect(sw.caches.delete).toHaveBeenCalledWith("agentes-viejo");
    expect(sw.caches.delete).not.toHaveBeenCalledWith("otra-cosa");
  });

  it.each([
    ["/api/chat", "POST"],
    ["/api/chat", "GET"],
    ["/api/sesion", "GET"],
    ["/api/perfil", "GET"],
    ["/api/sugerencias", "GET"],
    ["/api/panel/metricas", "GET"],
  ])("nunca intercepta %s (%s): va directo a la red y no se guarda", (ruta, method) => {
    expect(pedir(sw, ruta, { method })).toBeNull();
    expect(sw.cache.put).not.toHaveBeenCalled();
  });

  it("no intercepta el panel del speaker (Basic Auth)", () => {
    expect(pedir(sw, "/panel", { mode: "navigate" })).toBeNull();
    expect(pedir(sw, "/panel/algo")).toBeNull();
  });

  it("no intercepta otros orígenes ni métodos distintos de GET", () => {
    expect(pedir(sw, "https://otro.example/x.js")).toBeNull();
    expect(pedir(sw, "/_next/static/chunks/a.js", { method: "POST" })).toBeNull();
  });

  it("páginas: siempre desde la red, sin guardarlas", async () => {
    const r = await pedir(sw, "/", { mode: "navigate" });
    expect(await r?.text()).toBe("red");
    expect(sw.cache.put).not.toHaveBeenCalled();
  });

  it("páginas sin conexión: muestra la página «Sin conexión»", async () => {
    sw.red.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    sw.caches.match.mockResolvedValueOnce(new Response("sin conexión"));
    const r = await pedir(sw, "/", { mode: "navigate" });
    expect(await r?.text()).toBe("sin conexión");
    expect(sw.caches.match).toHaveBeenCalledWith("/offline.html");
  });

  it("archivos estáticos de Next: primero la caché; si no están, red y se guardan", async () => {
    const r = await pedir(sw, "/_next/static/chunks/app.js");
    expect(await r?.text()).toBe("red");
    expect(sw.cache.put).toHaveBeenCalledOnce();
  });

  it("archivos estáticos ya guardados no van a la red", async () => {
    sw.caches.match.mockResolvedValueOnce(new Response("guardado"));
    const r = await pedir(sw, "/_next/static/css/app.css");
    expect(await r?.text()).toBe("guardado");
    expect(sw.red).not.toHaveBeenCalled();
  });

  it("no guarda respuestas con error", async () => {
    sw.red.mockResolvedValueOnce(new Response("no", { status: 404 }));
    await pedir(sw, "/_next/static/chunks/x.js");
    expect(sw.cache.put).not.toHaveBeenCalled();
  });
});
