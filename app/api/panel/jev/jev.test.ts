import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FuenteDb } from "@/lib/db/client";
import { crearJev } from "@/lib/db/jev";
import { crearDbTemporal } from "@/lib/db/prueba";
import type { EstadoJev } from "@/lib/jev/analizador";
import { peticion } from "@/lib/prueba-api";
import { config, proxy } from "@/proxy";
import { GET } from "./route";

const estado = vi.hoisted(() => ({
  fuente: null as null | (() => Promise<unknown>),
  analizar: vi.fn(async (): Promise<EstadoJev> => ({ jevDisponible: true, trazasDisponibles: true, analizadosEnCiclo: 0 })),
}));
vi.mock("@/lib/db/client", async (original) => ({
  ...(await original<typeof import("@/lib/db/client")>()),
  db: (() => estado.fuente!()) as FuenteDb,
}));
// El route no carga Mastra ni TypeSafe en los tests: el analizador es un doble.
vi.mock("@/lib/jev/servicio", () => ({
  analizadorJev: () => ({
    analizar: estado.analizar,
    estado: () => ({ jevDisponible: true, trazasDisponibles: true, analizadosEnCiclo: 0 }),
  }),
}));

const CLAVE = "clave-del-panel";
const AUTH = { authorization: `Basic ${Buffer.from(`speaker:${CLAVE}`).toString("base64")}` };

let db: Awaited<ReturnType<typeof crearDbTemporal>>;
beforeEach(async () => {
  vi.stubEnv("PANEL_PASSWORD", CLAVE);
  db = await crearDbTemporal();
  estado.fuente = db.fuente;
  estado.analizar.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  db.cerrar();
});

const leer = (cabeceras: Record<string, string> = AUTH) => GET(peticion("/api/panel/jev", { cabeceras }));

describe("GET /api/panel/jev", () => {
  it("401 sin la contraseña del panel", async () => {
    expect((await leer({})).status).toBe(401);
    expect(estado.analizar).not.toHaveBeenCalled();
  });

  it("estado vacío: sin análisis todavía", async () => {
    const r = await leer();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toMatchObject({ jev_disponible: true, total_analisis: 0, tarjetas: [] });
  });

  it("si Jev no está disponible, devuelve lo guardado con jev_disponible: false", async () => {
    await crearJev(db.fuente).guardar({
      traceId: "t1",
      turnoEn: new Date().toISOString(),
      pregunta: "¿Qué es un eval?",
      tema: "evals",
      temaConfianza: 1,
      intencion: "understand_concept",
      intencionConfianza: 1,
      confusion: 0.25,
      confusionConfianza: 1,
      valor: 0.3,
      valorConfianza: 1,
      respaldada: 0.9,
      motivoBloqueo: null,
      herramientaCaida: false,
      respaldo: false,
      sinModelo: false,
      falla: false,
      latenciaMs: 180,
      tokensEntrada: 2500,
      modelo: "jev-1.13.0",
    });
    estado.analizar.mockResolvedValueOnce({ jevDisponible: false, trazasDisponibles: true, analizadosEnCiclo: 0 });
    const cuerpo = await (await leer()).json();
    expect(cuerpo).toMatchObject({ jev_disponible: false, total_analisis: 1, latencia_media_ms: 180 });
    expect(cuerpo.tarjetas[0]).toMatchObject({ pregunta: "¿Qué es un eval?", tema: "Evals", lineas: [{ tipo: "respaldada" }] });
  });
});

describe("proxy: Basic Auth en la página y la API de Jev", () => {
  it("el matcher cubre /panel/jev y /api/panel/jev", () => {
    for (const url of ["/panel/jev", "/api/panel/jev"]) expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, url: "/" })).toBe(false);
  });

  it("sin contraseña responde 401; con ella deja pasar", () => {
    const pedir = (h: Record<string, string>) => proxy(new NextRequest("http://localhost:3000/panel/jev", { headers: h }));
    expect(pedir({}).status).toBe(401);
    expect(pedir(AUTH).status).toBe(200);
  });
});
