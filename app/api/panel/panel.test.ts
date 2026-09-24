import { VERSION_APP } from "@/lib/version-app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearAsistentes } from "@/lib/db/asistentes";
import type { FuenteDb } from "@/lib/db/client";
import { crearEscalamientos } from "@/lib/db/escalamientos";
import { crearFeedback } from "@/lib/db/feedback";
import { interruptores } from "@/lib/db/interruptores";
import { crearDbTemporal } from "@/lib/db/prueba";
import { crearSesiones } from "@/lib/db/sesiones";
import type { MetricasTrazas } from "@/lib/panel/metricas-trazas";
import { peticion } from "@/lib/prueba-api";
import { GET as getEscalamientos, PATCH as patchEscalamientos } from "./escalamientos/route";
import { GET as getInterruptores, POST as postInterruptores } from "./interruptores/route";
import { GET as getMetricas } from "./metricas/route";

const estado = vi.hoisted(() => ({
  fuente: null as null | (() => Promise<unknown>),
  leerObservabilidad: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock("@/lib/db/client", async (original) => ({
  ...(await original<typeof import("@/lib/db/client")>()),
  db: (() => estado.fuente!()) as FuenteDb,
}));
vi.mock("@/lib/panel/observabilidad", () => ({ leerMetricasObservabilidad: estado.leerObservabilidad }));

const CLAVE = "clave-del-panel";
const AUTH: Record<string, string> = { authorization: `Basic ${Buffer.from(`speaker:${CLAVE}`).toString("base64")}` };
const MAL = { authorization: `Basic ${Buffer.from("speaker:otra").toString("base64")}` };

let db: Awaited<ReturnType<typeof crearDbTemporal>>;

beforeEach(async () => {
  vi.stubEnv("PANEL_PASSWORD", CLAVE);
  vi.stubEnv("PRESUPUESTO_MAX_USD", "10");
  db = await crearDbTemporal();
  estado.fuente = db.fuente;
  interruptores.limpiarCache();
  estado.leerObservabilidad.mockReset();
  estado.leerObservabilidad.mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  db.cerrar();
});

const metricas = (cabeceras = AUTH) => getMetricas(peticion("/api/panel/metricas", { cabeceras }));
const leerInterruptores = (cabeceras = AUTH) => getInterruptores(peticion("/api/panel/interruptores", { cabeceras }));
const cambiar = (cuerpo: unknown, cabeceras = AUTH) =>
  postInterruptores(peticion("/api/panel/interruptores", { cuerpo, cabeceras }));
const cola = (cabeceras = AUTH) => getEscalamientos(peticion("/api/panel/escalamientos", { cabeceras }));
const marcar = (cuerpo: unknown, cabeceras = AUTH) =>
  patchEscalamientos(peticion("/api/panel/escalamientos", { metodo: "PATCH", cuerpo, cabeceras }));

describe("autorización en cada ruta (además del proxy)", () => {
  it("401 sin contraseña o con una incorrecta", async () => {
    for (const cab of [{}, MAL]) {
      expect((await metricas(cab)).status).toBe(401);
      expect((await leerInterruptores(cab)).status).toBe(401);
      expect((await cambiar({ clave: "kill_switch", valor: "on" }, cab)).status).toBe(401);
      expect((await cola(cab)).status).toBe(401);
      expect((await marcar({ id: 1, estado: "respondida" }, cab)).status).toBe(401);
    }
    expect((await interruptores.obtenerTodos()).kill_switch).toBe("off");
  });

  it("sin PANEL_PASSWORD, 401 siempre (falla cerrada)", async () => {
    vi.stubEnv("PANEL_PASSWORD", "");
    expect((await metricas({ authorization: `Basic ${Buffer.from("x:").toString("base64")}` })).status).toBe(401);
  });
});

describe("GET /api/panel/metricas", () => {
  async function sembrar() {
    const asistentes = crearAsistentes(db.fuente);
    const sesiones = crearSesiones(db.fuente);
    const a = (await asistentes.upsertInscrito({ email: "a@e.com", nombre: "Ana Pérez", rol: "Dev", descripcion: null })).asistente;
    await asistentes.upsertInscrito({ email: "b@e.com", nombre: "Beto Ruiz", rol: "CEO", descripcion: null });
    const s = await sesiones.crear(a.id);
    await sesiones.incrementarMensajes(s.token);
    await sesiones.incrementarMensajes(s.token);
    await crearEscalamientos(db.fuente).crear({ asistenteId: a.id, pregunta: "¿Algo?", motivo: "comercial" });
    const fb = crearFeedback(db.fuente);
    await fb.registrar({ asistenteId: a.id, traceId: "t1", valor: 1 });
    await fb.registrar({ asistenteId: a.id, traceId: "t2", valor: -1 });
    await fb.registrar({ asistenteId: a.id, traceId: "t3", valor: 1 });
    await db.cliente.execute("UPDATE presupuesto SET coste_usd = 0.125 WHERE id = 1");
  }

  it("métricas de charla.db y votos; observabilidad no disponible → disponible: false", async () => {
    await sembrar();
    const r = await metricas();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const cuerpo = await r.json();
    expect(cuerpo).toMatchObject({
      asistentes: { con_mensajes: 1, registrados: 2, inscritos: 2 },
      mensajes: 2,
      escalamientos_pendientes: 1,
      votos: { positivos: 2, negativos: 1 },
      presupuesto: { acumulado_usd: 0.125, maximo_usd: 10 },
      observabilidad: { disponible: false },
    });
    expect(typeof cuerpo.actualizado_en).toBe("string");
    expect(cuerpo.version).toBe(VERSION_APP);
    const json = JSON.stringify(cuerpo);
    for (const p of ["Ana", "Beto", "a@e.com", "Dev", "CEO"]) expect(json).not.toContain(p);
  });

  it("sin PRESUPUESTO_MAX_USD → maximo_usd null (sin tope)", async () => {
    vi.stubEnv("PRESUPUESTO_MAX_USD", "");
    const cuerpo = await (await metricas()).json();
    expect(cuerpo.presupuesto).toEqual({ acumulado_usd: 0, maximo_usd: null });
  });

  it("incluye latencia, errores y bloqueos cuando la observabilidad responde", async () => {
    const obs: MetricasTrazas = {
      latencia: { p50Ms: 2900, p95Ms: 6700, muestras: 10 },
      errores: 2,
      erroresPorTipo: { tiempo: 1, herramienta: 1 },
      bloqueos: { total: 3, porMotivo: { inyeccion: 1, fuera_de_alcance: 2 } },
      turnos: 15,
      respaldo: { ultimaHora: 4, ultimaEn: "2026-09-26T18:55:00.000Z" },
      modeloEnUso: { estado: "respaldo", modelo: "anthropic/claude-sonnet-5", en: "2026-09-26T18:55:00.000Z", traceId: "t-interno" },
    };
    estado.leerObservabilidad.mockResolvedValue(obs);
    const cuerpo = await (await metricas()).json();
    expect(cuerpo.observabilidad).toEqual({
      disponible: true,
      latencia_p50_ms: 2900,
      latencia_p95_ms: 6700,
      muestras_latencia: 10,
      errores: 2,
      errores_por_tipo: { tiempo: 1, herramienta: 1 },
      bloqueos: { total: 3, por_motivo: { inyeccion: 1, fuera_de_alcance: 2 } },
      turnos: 15,
      respaldo: { ultima_hora: 4, ultima_en: "2026-09-26T18:55:00.000Z" },
      // Sin el traceId interno.
      modelo_en_uso: { estado: "respaldo", modelo: "anthropic/claude-sonnet-5", en: "2026-09-26T18:55:00.000Z" },
    });
  });

  it("si la lectura de observabilidad lanza, igual responde las métricas de charla.db", async () => {
    estado.leerObservabilidad.mockRejectedValue(new Error("Neon caído"));
    const r = await metricas();
    expect(r.status).toBe(200);
    expect((await r.json()).observabilidad).toEqual({ disponible: false });
  });

  it("500 genérico si falla charla.db", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    estado.fuente = async () => {
      throw new Error("disco");
    };
    const r = await metricas();
    expect(r.status).toBe(500);
    expect((await r.json()).error).toBe("error_interno");
    error.mockRestore();
  });
});

describe("/api/panel/interruptores", () => {
  it("GET: valores, lámina como número y última activación", async () => {
    const cuerpo = await (await leerInterruptores()).json();
    expect(cuerpo).toEqual({
      valores: { herramienta_caida: "off", latencia_alta: "off", modelo_caido: "off", modelos_caidos: "off", kill_switch: "off", lamina_actual: 1 },
      ultimas_activaciones: { herramienta_caida: null, latencia_alta: null, modelo_caido: null, modelos_caidos: null, kill_switch: null },
    });
  });

  it("POST acepta modelos_caidos (fallan el principal y el respaldo) y guarda su activación", async () => {
    const cuerpo = await (await cambiar({ clave: "modelos_caidos", valor: "on" })).json();
    expect(cuerpo.valores.modelos_caidos).toBe("on");
    expect(cuerpo.ultimas_activaciones.modelos_caidos).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect((await interruptores.obtenerTodos()).modelos_caidos).toBe("on");
    expect((await cambiar({ clave: "modelos_caidos", valor: "tal vez" })).status).toBe(400);
  });

  it("POST enciende y apaga, registra la hora de activación y el chat lo ve al instante", async () => {
    const r = await cambiar({ clave: "herramienta_caida", valor: "on" });
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo.valores.herramienta_caida).toBe("on");
    expect(cuerpo.ultimas_activaciones.herramienta_caida).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect((await interruptores.obtenerTodos()).herramienta_caida).toBe("on");

    await cambiar({ clave: "kill_switch", valor: "on" });
    expect((await interruptores.obtenerTodos()).kill_switch).toBe("on");
    const apagado = await (await cambiar({ clave: "kill_switch", valor: "off" })).json();
    expect(apagado.valores.kill_switch).toBe("off");
    // Apagar no borra la última activación.
    expect(apagado.ultimas_activaciones.kill_switch).not.toBeNull();
  });

  it.each([1, 40, "12", 20])("lámina %s válida", async (valor) => {
    const r = await cambiar({ clave: "lamina_actual", valor });
    expect(r.status).toBe(200);
    expect((await r.json()).valores.lamina_actual).toBe(Number(valor));
    expect((await interruptores.obtenerTodos()).lamina_actual).toBe(String(Number(valor)));
  });

  it.each([0, 41, -1, 1.5, "abc", "", null, "12a"])("lámina %s fuera de rango → 400", async (valor) => {
    const r = await cambiar({ clave: "lamina_actual", valor });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("interruptor_invalido");
    expect((await interruptores.obtenerTodos()).lamina_actual).toBe("1");
  });

  it.each([
    { clave: "kill_switch", valor: "encendido" },
    { clave: "kill_switch", valor: true },
    { clave: "no_existe", valor: "on" },
    { clave: "modelo_caido" },
    "no es json",
  ])("cuerpo inválido %j → 400", async (cuerpo) => {
    expect((await cambiar(cuerpo)).status).toBe(400);
  });
});

describe("/api/panel/escalamientos", () => {
  it("GET: cola ordenada, redactada y con rol anónimo", async () => {
    const asistentes = crearAsistentes(db.fuente);
    const esc = crearEscalamientos(db.fuente);
    const a = (await asistentes.upsertInscrito({ email: "zoraida@e.com", nombre: "Zoraida Paredes", rol: "Gerente de ventas", descripcion: "Bots" })).asistente;
    const b = (await asistentes.upsertInscrito({ email: "marco@e.com", nombre: "Marco Villacrés", rol: "Desarrollador", descripcion: null })).asistente;
    const e1 = await esc.crear({ asistenteId: a.id, pregunta: "Soy Zoraida, escríbeme a zoraida@e.com", motivo: "comercial", traceId: "t9" });
    await esc.crear({ asistenteId: b.id, pregunta: "¿Por qué falló?", motivo: "falla_tecnica" });
    await esc.crear({ asistenteId: b.id, pregunta: "¿Otra?", motivo: "desacuerdo" });
    await esc.actualizarEstado(e1.id, "respondida");

    const r = await cola();
    expect(r.status).toBe(200);
    const { escalamientos } = await r.json();
    expect(escalamientos.map((e: { pregunta: string; estado: string; rol_anonimo: string; motivo: string }) => [e.pregunta, e.estado, e.rol_anonimo, e.motivo])).toEqual([
      ["¿Por qué falló?", "pendiente", "tecnico", "falla_tecnica"],
      ["¿Otra?", "pendiente", "tecnico", "desacuerdo"],
      ["Soy [redactado], escríbeme a [email]", "respondida", "negocio", "comercial"],
    ]);
    const json = JSON.stringify(escalamientos);
    for (const p of ["Zoraida", "Marco", "zoraida@e.com", "Gerente", "Desarrollador", a.id, b.id, "t9"]) {
      expect(json).not.toContain(p);
    }
  });

  it("PATCH marca respondida o descartada", async () => {
    const a = (await crearAsistentes(db.fuente).upsertInscrito({ email: "a@e.com", nombre: "Ana", rol: "Dev", descripcion: null })).asistente;
    const esc = crearEscalamientos(db.fuente);
    const { id } = await esc.crear({ asistenteId: a.id, pregunta: "¿X?", motivo: "falla_tecnica" });
    const r = await marcar({ id, estado: "respondida" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect((await esc.listar())[0].estado).toBe("respondida");
    await marcar({ id, estado: "descartada" });
    expect((await esc.listar())[0].estado).toBe("descartada");
  });

  it("PATCH: 404 si no existe y 400 con datos inválidos", async () => {
    expect((await marcar({ id: 999, estado: "respondida" })).status).toBe(404);
    for (const cuerpo of [{ id: 1, estado: "borrada" }, { id: "1", estado: "respondida" }, { id: 0, estado: "respondida" }, {}, "x"]) {
      expect((await marcar(cuerpo)).status).toBe(400);
    }
  });
});
