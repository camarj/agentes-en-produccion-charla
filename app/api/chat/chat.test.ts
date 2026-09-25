import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Agent } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FuenteDb } from "@/lib/db/client";
import { crearAsistentes } from "@/lib/db/asistentes";
import { crearEscalamientos } from "@/lib/db/escalamientos";
import { interruptores } from "@/lib/db/interruptores";
import { crearDbTemporal } from "@/lib/db/prueba";
import { crearSesiones } from "@/lib/db/sesiones";
import { LARGO_MAXIMO_PREGUNTA, MENSAJE_FALLA_TECNICA, TIEMPO_MAXIMO_TURNO_MS } from "@/lib/chat";
import { costeEstimadoTurno, crearPresupuesto } from "@/lib/presupuesto";
import { limitadorChat } from "@/lib/rate-limit";
import { NOMBRE_COOKIE, firmarToken } from "@/lib/session";
import { MENSAJES_BLOQUEO } from "@/src/mastra/processors/mensajes";
import { modeloFalso } from "@/src/mastra/processors/pruebas-modelo";
import type { Veredicto, VerificarEntrada } from "@/src/mastra/processors/verificacion-entrada";
import { ejecutarTurno } from "@/src/mastra/turno";
import { GET as historial } from "./historial/route";
import { POST as nuevo } from "./nuevo/route";
import { POST as chat } from "./route";

const PERMITIDO: Veredicto = { bloqueado: false, metadata: { guardrails_entrada: "permitido" } };
const BLOQUEADO: Veredicto = {
  bloqueado: true,
  motivo: "fuera_de_alcance",
  guardrail: "alcance_charla",
  confianza: 0.99,
  mensaje: MENSAJES_BLOQUEO.fuera_de_alcance,
  processorId: "alcance-charla",
  metadata: { guardrail: "alcance_charla", motivo: "fuera_de_alcance", guardrails_entrada: "bloqueado" },
};

// La ruta usa los repositorios por defecto (base temporal), el agente
// registrado en Mastra (aquí uno con modelo falso) y el turno real con
// guardrails falsos.
const estado = vi.hoisted(() => ({
  fuente: null as null | (() => Promise<unknown>),
  agente: null as unknown,
  verificar: null as unknown,
  traceId: "traza-prueba-1" as string | undefined,
  fallarTurno: false,
}));
vi.mock("@/lib/db/client", async (original) => ({
  ...(await original<typeof import("@/lib/db/client")>()),
  db: (() => estado.fuente!()) as FuenteDb,
}));
vi.mock("@/src/mastra", () => ({
  mastra: { getAgent: () => estado.agente },
}));
vi.mock("@/src/mastra/turno", async (original) => {
  const real = await original<typeof import("@/src/mastra/turno")>();
  return {
    ...real,
    ejecutarTurno: vi.fn(async (o: Parameters<typeof real.ejecutarTurno>[0]) => {
      if (estado.fallarTurno) throw new Error("proveedor caído");
      const turno = await real.ejecutarTurno({ ...o, verificar: estado.verificar as VerificarEntrada });
      // Sin observabilidad no hay traceId: se fija uno para comprobar que viaja.
      return { ...turno, traceId: estado.traceId };
    }),
  };
});

let db: Awaited<ReturnType<typeof crearDbTemporal>>;
let rutaMemoria: string;
let memoria: Memory;
let falso: ReturnType<typeof modeloFalso>;

function crearAgente(responder?: Parameters<typeof modeloFalso>[1], demoraMs = 0) {
  falso = modeloFalso("openai/gpt-6-luna", responder ?? (() => ({ texto: ["El harness ", "rodea al modelo ", "(lámina 11)."] })));
  if (demoraMs) {
    const base = falso.modelo.doStream;
    falso.modelo.doStream = async (o) => {
      await new Promise((r) => setTimeout(r, demoraMs));
      return base(o);
    };
  }
  estado.agente = new Agent({
    id: "charla",
    name: "prueba",
    instructions: "x",
    model: falso.modelo as never,
    memory: memoria,
  });
}

async function crearAsistenteConSesion(datos: { email?: string; nombre?: string; rol?: string | null; descripcion?: string | null } = {}) {
  const { asistente } = await crearAsistentes(db.fuente).upsertInscrito({
    email: datos.email ?? `a-${crypto.randomUUID()}@e.com`,
    nombre: datos.nombre ?? "Andrea Salazar",
    rol: datos.rol === undefined ? "Gerente de operaciones" : datos.rol,
    descripcion: datos.descripcion === undefined ? "Un bot de soporte" : datos.descripcion,
  });
  return asistente;
}

async function sesionPara(asistenteId: string) {
  const sesion = await crearSesiones(db.fuente).crear(asistenteId);
  return { sesion, cookie: firmarToken(sesion.token) };
}

async function preparar(datos?: Parameters<typeof crearAsistenteConSesion>[0]) {
  const email = datos?.email ?? `a-${crypto.randomUUID()}@e.com`;
  const asistente = await crearAsistenteConSesion({ ...datos, email });
  return { asistente, ...(await sesionPara(asistente.id)) };
}

function mensajesUI(texto: string) {
  return {
    id: "chat-1",
    trigger: "submit-message",
    messages: [
      { id: "m0", role: "user", parts: [{ type: "text", text: "pregunta vieja" }] },
      { id: "m1", role: "assistant", parts: [{ type: "text", text: "respuesta vieja" }] },
      { id: "m2", role: "user", parts: [{ type: "text", text: texto }] },
    ],
  };
}

function peticionChat(cookie: string | undefined, cuerpo: unknown, signal?: AbortSignal) {
  const cabeceras = new Headers({ "content-type": "application/json" });
  if (cookie !== undefined) cabeceras.set("cookie", `${NOMBRE_COOKIE}=${cookie}`);
  return new NextRequest(new URL("/api/chat", "http://localhost:3000"), {
    method: "POST",
    headers: cabeceras,
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    signal,
  });
}

function peticionHistorial(cookie?: string) {
  const cabeceras = new Headers();
  if (cookie !== undefined) cabeceras.set("cookie", `${NOMBRE_COOKIE}=${cookie}`);
  return new NextRequest(new URL("/api/chat/historial", "http://localhost:3000"), { headers: cabeceras });
}

type Parte = { type: string; delta?: string; messageMetadata?: Record<string, unknown>; data?: unknown; errorText?: string };

// Lee el SSE de AI SDK UI y devuelve las partes.
async function partesDe(r: Response): Promise<Parte[]> {
  const texto = await r.text();
  return texto
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice("data: ".length)) as Parte);
}

const textoDe = (partes: Parte[]) =>
  partes
    .filter((p) => p.type === "text-delta")
    .map((p) => p.delta)
    .join("");

const turnoMock = vi.mocked(ejecutarTurno);

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "secreto-de-prueba-0123456789");
  vi.stubEnv("MAX_MENSAJES_ASISTENTE", "30");
  vi.stubEnv("PRESUPUESTO_MAX_USD", "100");
  db = await crearDbTemporal();
  estado.fuente = db.fuente;
  rutaMemoria = path.join(os.tmpdir(), `mastra-chat-${crypto.randomUUID()}.db`);
  memoria = new Memory({ storage: new LibSQLStore({ id: `mem-${crypto.randomUUID()}`, url: `file:${rutaMemoria}` }) });
  estado.verificar = vi.fn<VerificarEntrada>(async () => PERMITIDO);
  estado.traceId = "traza-prueba-1";
  estado.fallarTurno = false;
  crearAgente();
  limitadorChat.reiniciar();
  interruptores.limpiarCache();
  turnoMock.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  db.cerrar();
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(rutaMemoria + s, { force: true });
});

describe("POST /api/chat: validaciones previas (el agente no se llama)", () => {
  it("sin cookie o con cookie inválida → 401", async () => {
    for (const cookie of [undefined, "basura", firmarToken("token-que-no-existe")]) {
      const r = await chat(peticionChat(cookie, mensajesUI("hola")));
      expect(r.status).toBe(401);
      expect((await r.json()).error).toBe("no_autenticado");
    }
    expect(turnoMock).not.toHaveBeenCalled();
  });

  it("asistente sin rol → 403 falta_perfil", async () => {
    const { cookie } = await preparar({ rol: null });
    const r = await chat(peticionChat(cookie, mensajesUI("hola")));
    expect(r.status).toBe(403);
    const cuerpo = await r.json();
    expect(cuerpo.error).toBe("falta_perfil");
    expect(cuerpo.mensaje).toMatch(/perfil/i);
    expect(turnoMock).not.toHaveBeenCalled();
  });

  it("kill switch activo → 423 mantenimiento, sin turno (no hay traza) y sin contar el mensaje", async () => {
    const { cookie, sesion } = await preparar();
    await interruptores.actualizar("kill_switch", "on");
    const r = await chat(peticionChat(cookie, mensajesUI("hola")));
    expect(r.status).toBe(423);
    expect(await r.json()).toEqual({
      error: "mantenimiento",
      mensaje: "El asistente está en pausa unos minutos. Vuelve a intentarlo pronto.",
    });
    expect(turnoMock).not.toHaveBeenCalled();
    expect(falso.llamadas).toHaveLength(0);
    expect((await crearSesiones(db.fuente).obtener(sesion.token))!.mensajes).toBe(0);
  });

  it("mensaje vacío, solo espacios, > 1.000 caracteres o cuerpo inválido → 400", async () => {
    const { cookie } = await preparar();
    const casos: unknown[] = [
      mensajesUI(""),
      mensajesUI("   \n  "),
      mensajesUI("a".repeat(LARGO_MAXIMO_PREGUNTA + 1)),
      "no es json",
      {},
      { messages: [] },
      { messages: [{ id: "x", role: "assistant", parts: [{ type: "text", text: "hola" }] }] },
    ];
    for (const cuerpo of casos) {
      const r = await chat(peticionChat(cookie, cuerpo));
      expect(r.status).toBe(400);
      const json = await r.json();
      expect(json.error).toBe("mensaje_invalido");
      expect(json.mensaje).toMatch(/1\.000/);
    }
    expect(turnoMock).not.toHaveBeenCalled();
  });

  it("exactamente 1.000 caracteres es válido", async () => {
    const { cookie } = await preparar();
    const r = await chat(peticionChat(cookie, mensajesUI("a".repeat(LARGO_MAXIMO_PREGUNTA))));
    expect(r.status).toBe(200);
    await r.text();
  });

  it("11.º mensaje en un minuto del mismo asistente → 429 con Retry-After; otro asistente sigue", async () => {
    const { cookie } = await preparar();
    for (let i = 0; i < 10; i++) {
      const r = await chat(peticionChat(cookie, mensajesUI(`pregunta ${i}`)));
      expect(r.status).toBe(200);
      await r.text();
    }
    const r = await chat(peticionChat(cookie, mensajesUI("una más")));
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe("demasiados_mensajes");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);

    const otro = await preparar();
    const r2 = await chat(peticionChat(otro.cookie, mensajesUI("hola")));
    expect(r2.status).toBe(200);
    await r2.text();
  });

  it("mensaje 31 del mismo asistente → 429 tope (MAX_MENSAJES_ASISTENTE), sumando todas sus sesiones", async () => {
    const { asistente, cookie } = await preparar();
    await sesionPara(asistente.id); // otro dispositivo del mismo asistente
    await db.cliente.execute({ sql: "UPDATE sesiones SET mensajes = 15 WHERE asistente_id = ?", args: [asistente.id] });
    const r = await chat(peticionChat(cookie, mensajesUI("la pregunta 31")));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({
      error: "tope",
      mensaje: "Llegaste al límite de preguntas de esta charla. Guarda tus dudas para la sesión de preguntas con Raúl.",
    });
    expect(turnoMock).not.toHaveBeenCalled();
  });

  it("el tope se lee de MAX_MENSAJES_ASISTENTE", async () => {
    vi.stubEnv("MAX_MENSAJES_ASISTENTE", "2");
    const { cookie } = await preparar();
    const estados: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await chat(peticionChat(cookie, mensajesUI(`p${i}`)));
      estados.push(r.status);
      await r.text();
    }
    expect(estados).toEqual([200, 200, 429]);
  });

  it("presupuesto alcanzado → activa el kill switch y responde 423 sin llamar al agente", async () => {
    vi.stubEnv("PRESUPUESTO_MAX_USD", "5");
    await crearPresupuesto(db.fuente).sumar(5);
    const { cookie } = await preparar();
    const r = await chat(peticionChat(cookie, mensajesUI("hola")));
    expect(r.status).toBe(423);
    expect((await r.json()).error).toBe("mantenimiento");
    expect(turnoMock).not.toHaveBeenCalled();
    interruptores.limpiarCache();
    expect((await interruptores.obtenerTodos()).kill_switch).toBe("on");
  });

  it("sin PRESUPUESTO_MAX_USD no hay tope de coste", async () => {
    vi.stubEnv("PRESUPUESTO_MAX_USD", "");
    await crearPresupuesto(db.fuente).sumar(1000);
    const { cookie } = await preparar();
    const r = await chat(peticionChat(cookie, mensajesUI("hola")));
    expect(r.status).toBe(200);
    await r.text();
  });
});

describe("POST /api/chat: turno", () => {
  it("hace streaming en formato AI SDK UI con trace_id en la metadata del mensaje", async () => {
    const { cookie } = await preparar();
    const r = await chat(peticionChat(cookie, mensajesUI("¿Qué es el harness?")));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/event-stream/);
    const partes = await partesDe(r);
    expect(textoDe(partes)).toBe("El harness rodea al modelo (lámina 11).");
    expect(partes.filter((p) => p.type === "text-delta").length).toBeGreaterThan(1);
    const inicio = partes.find((p) => p.type === "start")!;
    const fin = partes.find((p) => p.type === "finish")!;
    expect(inicio.messageMetadata).toEqual({ trace_id: "traza-prueba-1" });
    expect(fin.messageMetadata).toEqual({ trace_id: "traza-prueba-1" });
  });

  it("envía al agente solo el último mensaje, con el hilo del asistente y el requestContext completo", async () => {
    await interruptores.actualizar("latencia_alta", "on");
    await interruptores.actualizar("lamina_actual", "12");
    const { asistente, sesion, cookie } = await preparar();
    const r = await chat(peticionChat(cookie, mensajesUI("  ¿Qué es el harness?  ")));
    await r.text();
    const opciones = turnoMock.mock.calls[0][0];
    expect(opciones.mensaje).toBe("¿Qué es el harness?");
    expect(opciones.memory).toEqual({ thread: sesion.threadId, resource: asistente.id });
    expect(opciones.maxSteps).toBe(5);
    const rc = opciones.requestContext as RequestContext;
    expect(rc.get("asistente_id")).toBe(asistente.id);
    expect(rc.get("nombre_pila")).toBe("Andrea");
    expect(rc.get("rol")).toBe("Gerente de operaciones");
    expect(rc.get("descripcion")).toBe("Un bot de soporte");
    expect(rc.get("rol_anonimo")).toBe("negocio");
    expect(rc.get("lamina_actual")).toBe(12);
    expect(rc.get("interruptores_activos")).toEqual(["latencia_alta"]);
    expect(rc.get("version_instrucciones")).toBe("1.2.0");
    // La pregunta vieja del cuerpo no llega al modelo: el historial es de la memoria.
    expect(JSON.stringify(falso.llamadas[0].prompt)).not.toContain("pregunta vieja");
  });

  it("reenvía la cancelación del cliente al turno (y el turno tiene un tope de 45 s)", async () => {
    expect(TIEMPO_MAXIMO_TURNO_MS).toBe(45_000);
    const { cookie } = await preparar();
    const control = new AbortController();
    const r = await chat(peticionChat(cookie, mensajesUI("hola"), control.signal));
    const senal = turnoMock.mock.calls[0][0].abortSignal!;
    expect(senal.aborted).toBe(false);
    control.abort();
    expect(senal.aborted).toBe(true);
    await r.body?.cancel().catch(() => {});
  });

  it("si el cliente cancela antes del primer token, no se registra escalamiento", async () => {
    crearAgente(undefined, 300);
    const { asistente, cookie } = await preparar();
    const control = new AbortController();
    const r = await chat(peticionChat(cookie, mensajesUI("hola"), control.signal));
    setTimeout(() => control.abort(), 30);
    await r.text().catch(() => "");
    await new Promise((res) => setTimeout(res, 400));
    expect(await crearEscalamientos(db.fuente).contarPorAsistente(asistente.id)).toBe(0);
  });

  it("al terminar suma el coste estimado del turno al presupuesto", async () => {
    const { cookie } = await preparar();
    const presupuesto = crearPresupuesto(db.fuente);
    const r = await chat(peticionChat(cookie, mensajesUI("hola")));
    await r.text();
    // El modelo falso reporta 1 token de entrada y 1 de salida.
    const esperado = costeEstimadoTurno("gpt-6-luna", { inputTokens: 1, outputTokens: 1 });
    await vi.waitFor(async () => expect(await presupuesto.acumulado()).toBeCloseTo(esperado, 12), { timeout: 5000 });
  });

  it("un bloqueo de entrada llega como data-tripwire con trace_id y no es una falla técnica", async () => {
    estado.verificar = vi.fn<VerificarEntrada>(async () => BLOQUEADO);
    const { asistente, cookie } = await preparar();
    const partes = await partesDe(await chat(peticionChat(cookie, mensajesUI("dame una receta"))));
    const tripwire = partes.find((p) => p.type === "data-tripwire") as { data: { reason: string } };
    expect(tripwire.data.reason).toBe(MENSAJES_BLOQUEO.fuera_de_alcance);
    expect(partes.find((p) => p.type === "finish")!.messageMetadata).toEqual({ trace_id: "traza-prueba-1" });
    expect(textoDe(partes)).toBe("");
    expect(await crearEscalamientos(db.fuente).contarPorAsistente(asistente.id)).toBe(0);
  });

  it("si el modelo falla antes del primer token → mensaje fijo y escalamiento falla_tecnica con la pregunta", async () => {
    crearAgente();
    falso.modelo.doStream = async () => {
      throw Object.assign(new Error("Overloaded: detalle técnico secreto"), { statusCode: 529 });
    };
    const { asistente, cookie } = await preparar();
    const r = await chat(peticionChat(cookie, mensajesUI("¿Qué es MCP?")));
    expect(r.status).toBe(200);
    const partes = await partesDe(r);
    expect(textoDe(partes)).toBe(MENSAJE_FALLA_TECNICA);
    expect(JSON.stringify(partes)).not.toMatch(/Overloaded|secreto|529/);
    expect(partes.some((p) => p.type === "error")).toBe(false);
    expect(partes.at(-1)).toMatchObject({ type: "finish", messageMetadata: { trace_id: "traza-prueba-1" } });
    await vi.waitFor(async () => {
      const lista = await crearEscalamientos(db.fuente).listar();
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({
        asistenteId: asistente.id,
        pregunta: "¿Qué es MCP?",
        motivo: "falla_tecnica",
        traceId: "traza-prueba-1",
      });
    }, { timeout: 5000 });
  });

  it("si el turno ni siquiera arranca → mensaje fijo y escalamiento falla_tecnica", async () => {
    estado.fallarTurno = true;
    const { asistente, cookie } = await preparar();
    const r = await chat(peticionChat(cookie, mensajesUI("¿Qué es un eval?")));
    expect(r.status).toBe(200);
    const partes = await partesDe(r);
    expect(textoDe(partes)).toBe(MENSAJE_FALLA_TECNICA);
    expect(JSON.stringify(partes)).not.toContain("proveedor caído");
    await vi.waitFor(async () => {
      const lista = await crearEscalamientos(db.fuente).listar();
      expect(lista.map((e) => [e.asistenteId, e.pregunta, e.motivo])).toEqual([[asistente.id, "¿Qué es un eval?", "falla_tecnica"]]);
    }, { timeout: 5000 });
  });

  it("no escribe emails ni nombres en los logs", async () => {
    const espias = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log"), vi.spyOn(console, "info")];
    try {
      estado.fallarTurno = true;
      const { cookie } = await preparar({ email: "zoraida.p@correo.ec", nombre: "Zoraida Paredes" });
      await (await chat(peticionChat(cookie, mensajesUI("soy zoraida.p@correo.ec")))).text();
      await new Promise((r) => setTimeout(r, 50));
      const escrito = JSON.stringify(espias.flatMap((e) => e.mock.calls));
      expect(escrito).not.toMatch(/zoraida|paredes|correo\.ec/i);
    } finally {
      for (const e of espias) e.mockRestore();
    }
  });
});

describe("GET /api/chat/historial", () => {
  it("sin sesión → 401", async () => {
    const r = await historial(peticionHistorial());
    expect(r.status).toBe(401);
  });

  it("devuelve la conversación previa en formato UI message; un turno bloqueado no aparece", async () => {
    const { cookie } = await preparar();
    await (await chat(peticionChat(cookie, mensajesUI("¿Qué es el harness?")))).text();
    estado.verificar = vi.fn<VerificarEntrada>(async () => BLOQUEADO);
    await (await chat(peticionChat(cookie, mensajesUI("dame una receta de encebollado")))).text();

    await vi.waitFor(async () => {
      const r = await historial(peticionHistorial(cookie));
      expect(r.status).toBe(200);
      const { messages } = (await r.json()) as {
        messages: { id: string; role: string; parts: { type: string; text?: string }[] }[];
      };
      expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
      const texto = (i: number) =>
        messages[i].parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("");
      expect(texto(0)).toBe("¿Qué es el harness?");
      expect(texto(1)).toBe("El harness rodea al modelo (lámina 11).");
      expect(JSON.stringify(messages)).not.toContain("encebollado");
      for (const m of messages) expect(typeof m.id).toBe("string");
    }, { timeout: 5000 });
  });

  it("un asistente nuevo sin conversación recibe una lista vacía", async () => {
    const { cookie } = await preparar();
    const r = await historial(peticionHistorial(cookie));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ messages: [] });
  });
});

describe("POST /api/chat/nuevo", () => {
  function peticionNuevo(cookie?: string) {
    const cabeceras = new Headers();
    if (cookie !== undefined) cabeceras.set("cookie", `${NOMBRE_COOKIE}=${cookie}`);
    return new NextRequest(new URL("/api/chat/nuevo", "http://localhost:3000"), { method: "POST", headers: cabeceras });
  }

  it("sin sesión → 401", async () => {
    const r = await nuevo(peticionNuevo());
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe("no_autenticado");
  });

  it("crea un hilo nuevo: el historial queda vacío y el siguiente turno usa ese hilo", async () => {
    const { cookie, sesion, asistente } = await preparar();
    await (await chat(peticionChat(cookie, mensajesUI("¿Qué es el harness?")))).text();
    await vi.waitFor(async () => {
      const { messages } = await (await historial(peticionHistorial(cookie))).json();
      expect(messages.length).toBeGreaterThan(0);
    }, { timeout: 5000 });

    const r = await nuevo(peticionNuevo(cookie));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await (await historial(peticionHistorial(cookie))).json()).toEqual({ messages: [] });

    await (await chat(peticionChat(cookie, mensajesUI("¿Y los evals?")))).text();
    const hilo = turnoMock.mock.calls.at(-1)![0].memory!.thread as string;
    expect(hilo).not.toBe(sesion.threadId);
    expect(hilo.startsWith(`charla-${asistente.id}-`)).toBe(true);
  });

  it("el tope de mensajes sigue contando entre hilos", async () => {
    vi.stubEnv("MAX_MENSAJES_ASISTENTE", "2");
    const { cookie } = await preparar();
    expect((await chat(peticionChat(cookie, mensajesUI("uno")))).status).toBe(200);
    await nuevo(peticionNuevo(cookie));
    expect((await chat(peticionChat(cookie, mensajesUI("dos")))).status).toBe(200);
    await nuevo(peticionNuevo(cookie));
    const r = await chat(peticionChat(cookie, mensajesUI("tres")));
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe("tope");
  });
});
