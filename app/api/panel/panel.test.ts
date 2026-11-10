import { VERSION_APP } from "@/lib/version-app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearAsistentes } from "@/lib/db/asistentes";
import type { FuenteDb } from "@/lib/db/client";
import { crearEscalamientos } from "@/lib/db/escalamientos";
import { crearFeedback } from "@/lib/db/feedback";
import { interruptores } from "@/lib/db/interruptores";
import { crearDbTemporal } from "@/lib/db/prueba";
import { crearSesiones } from "@/lib/db/sesiones";
import { crearTurnos, turnos } from "@/lib/db/turnos";
import { peticion } from "@/lib/prueba-api";
import { GET as getEscalamientos, PATCH as patchEscalamientos } from "./escalamientos/route";
import { GET as getInterruptores, POST as postInterruptores } from "./interruptores/route";
import { GET as getMetricas } from "./metricas/route";
import { GET as getSalud } from "./salud/route";
import { crearEventosSalud } from "@/lib/db/eventos-salud";

const estado = vi.hoisted(() => ({
  fuente: null as null | (() => Promise<unknown>),
}));
const sondear = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/salud/observabilidad", () => ({ sondearObservabilidad: sondear }));
vi.mock("@/lib/db/client", async (original) => ({
  ...(await original<typeof import("@/lib/db/client")>()),
  db: (() => estado.fuente!()) as FuenteDb,
}));

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

  it("métricas de charla.db y votos; sin turnos → observabilidad disponible en cero", async () => {
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
      observabilidad: { disponible: true, turnos: 0, errores: 0, latencia_p50_ms: null, modelo_en_uso: null },
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

  it("latencia, fallas, bloqueos, respaldo y modelo en uso salen de la tabla turnos (sin leer trazas)", async () => {
    const ahora = Date.now();
    const t = crearTurnos(db.fuente);
    const base = { motivoBloqueo: null, tipoFalla: null, respaldo: false, modelo: "gemini-3.8-flash", traceId: "t-x" } as const;
    for (const d of [2900, 2000, 6700]) await t.registrar({ ...base, iniciadoMs: ahora - 10 * 60_000, duracionMs: d, resultado: "ok" });
    await t.registrar({ ...base, iniciadoMs: ahora - 5 * 60_000, duracionMs: null, resultado: "falla", tipoFalla: "tiempo", modelo: null });
    await t.registrar({ ...base, iniciadoMs: ahora - 5 * 60_000, duracionMs: 4000, resultado: "falla", tipoFalla: "herramienta" });
    await t.registrar({ ...base, iniciadoMs: ahora - 4 * 60_000, duracionMs: 500, resultado: "bloqueo", motivoBloqueo: "inyeccion", modelo: null });
    await t.registrar({ ...base, iniciadoMs: ahora - 4 * 60_000, duracionMs: 500, resultado: "bloqueo", motivoBloqueo: "fuera_de_alcance", modelo: null });
    await t.registrar({ ...base, iniciadoMs: ahora - 60_000, duracionMs: 3500, resultado: "ok", respaldo: true, modelo: "openai/gpt-6-luna", traceId: "t-interno" });
    const cuerpo = await (await metricas()).json();
    const en = new Date(ahora - 60_000).toISOString();
    expect(cuerpo.observabilidad).toEqual({
      disponible: true,
      latencia_p50_ms: 3500,
      latencia_p95_ms: 6700,
      muestras_latencia: 5,
      errores: 2,
      errores_por_tipo: { tiempo: 1, herramienta: 1 },
      bloqueos: { total: 2, por_motivo: { inyeccion: 1, fuera_de_alcance: 1 } },
      turnos: 8,
      respaldo: { ultima_hora: 1, ultima_en: en },
      // Sin el traceId interno.
      modelo_en_uso: { estado: "respaldo", modelo: "openai/gpt-6-luna", en },
    });
  });

  it("si la lectura de turnos falla, igual responde las métricas de charla.db", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const espia = vi.spyOn(turnos, "resumen").mockRejectedValue(new Error("tabla bloqueada"));
    const r = await metricas();
    expect(r.status).toBe(200);
    expect((await r.json()).observabilidad).toEqual({ disponible: false });
    espia.mockRestore();
    error.mockRestore();
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

describe("GET /api/panel/salud", () => {
  const salud = (cabeceras = AUTH) => getSalud(peticion("/api/panel/salud", { cabeceras }));

  it("401 sin la contraseña del panel", async () => {
    expect((await salud({})).status).toBe(401);
    expect((await salud(MAL)).status).toBe(401);
  });

  it("semáforos por servicio y registro en vivo, más nuevo primero, con trace id; sondea la observabilidad", async () => {
    const eventos = crearEventosSalud(db.fuente);
    await eventos.registrar("gemini_sobrecarga", { traceId: "t-1", ahora: Date.now() - 2000 });
    await eventos.registrar("busqueda_agotada", { traceId: "t-2", ahora: Date.now() - 1000 });
    await db.cliente.execute("UPDATE presupuesto SET coste_usd = 8 WHERE id = 1");
    const r = await salud();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const cuerpo = await r.json();
    expect(Object.fromEntries(cuerpo.servicios.map((x: { id: string; semaforo: string }) => [x.id, x.semaforo]))).toEqual({
      gemini: "ambar",
      openai: "verde",
      base_datos: "verde",
      trazas: "verde",
      busqueda: "rojo",
      guardrails: "verde",
      entrada: "verde",
      presupuesto: "ambar",
    });
    expect(cuerpo.eventos.map((e: { texto: string; trace_id: string; nivel: string }) => [e.texto, e.trace_id, e.nivel])).toEqual([
      ["buscar_laminas agotó 3 intentos", "t-2", "falla"],
      ["Gemini con alta demanda (503) → respaldo activo", "t-1", "aviso"],
    ]);
    expect(sondear).toHaveBeenCalled();
  });
});

describe("/api/panel/interruptores", () => {
  it("GET: valores, lámina como número y última activación", async () => {
    const cuerpo = await (await leerInterruptores()).json();
    expect(cuerpo).toEqual({
      valores: { herramienta_caida: "off", latencia_alta: "off", modelo_caido: "off", modelos_caidos: "off", limite_gemini: "off", base_datos_lenta: "off", kill_switch: "off", lamina_actual: 1 },
      ultimas_activaciones: { herramienta_caida: null, latencia_alta: null, modelo_caido: null, modelos_caidos: null, limite_gemini: null, base_datos_lenta: null, kill_switch: null },
    });
  });

  it("POST acepta limite_gemini y base_datos_lenta (apagados por defecto) y guarda su activación", async () => {
    for (const clave of ["limite_gemini", "base_datos_lenta"] as const) {
      const cuerpo = await (await cambiar({ clave, valor: "on" })).json();
      expect(cuerpo.valores[clave]).toBe("on");
      expect(cuerpo.ultimas_activaciones[clave]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect((await cambiar({ clave, valor: "quizas" })).status).toBe(400);
      await cambiar({ clave, valor: "off" });
    }
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
