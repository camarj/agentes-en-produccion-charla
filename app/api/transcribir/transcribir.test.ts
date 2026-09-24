import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FuenteDb } from "@/lib/db/client";
import { crearAsistentes } from "@/lib/db/asistentes";
import { interruptores } from "@/lib/db/interruptores";
import { crearDbTemporal } from "@/lib/db/prueba";
import { crearSesiones } from "@/lib/db/sesiones";
import { costeTranscripcion, crearPresupuesto } from "@/lib/presupuesto";
import { LIMITE_TRANSCRIBIR_POR_MINUTO, limitadorTranscribir } from "@/lib/rate-limit";
import { TAMANO_MAXIMO_AUDIO } from "@/lib/transcripcion";
import { NOMBRE_COOKIE, firmarToken } from "@/lib/session";
import { transcribirAudio } from "@/src/mastra/voz";
import { POST as transcribir } from "./route";

const estado = vi.hoisted(() => ({ fuente: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/db/client", async (original) => ({
  ...(await original<typeof import("@/lib/db/client")>()),
  db: (() => estado.fuente!()) as FuenteDb,
}));
vi.mock("@/src/mastra/voz", () => ({ transcribirAudio: vi.fn(async () => "¿Qué es el harness de un agente?") }));

const voz = vi.mocked(transcribirAudio);
let db: Awaited<ReturnType<typeof crearDbTemporal>>;

async function preparar(rol: string | null = "Gerente de operaciones") {
  const { asistente } = await crearAsistentes(db.fuente).upsertInscrito({
    email: `a-${crypto.randomUUID()}@e.com`,
    nombre: "Andrea Salazar",
    rol,
    descripcion: "Un bot de soporte",
  });
  const sesion = await crearSesiones(db.fuente).crear(asistente.id);
  return { asistente, cookie: firmarToken(sesion.token) };
}

const AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);

function peticion(
  cookie: string | undefined,
  { tipo = "audio/webm;codecs=opus", cuerpo = AUDIO as BodyInit, duracion = "12.5" as string | null } = {},
) {
  const cabeceras = new Headers({ "content-type": tipo });
  if (cookie !== undefined) cabeceras.set("cookie", `${NOMBRE_COOKIE}=${cookie}`);
  const url = new URL("/api/transcribir", "http://localhost:3000");
  if (duracion !== null) url.searchParams.set("duracion", duracion);
  return new NextRequest(url, { method: "POST", headers: cabeceras, body: cuerpo });
}

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "secreto-de-prueba-0123456789");
  vi.stubEnv("PRESUPUESTO_MAX_USD", "100");
  db = await crearDbTemporal();
  estado.fuente = db.fuente;
  limitadorTranscribir.reiniciar();
  interruptores.limpiarCache();
  voz.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  db.cerrar();
});

describe("POST /api/transcribir", () => {
  it("sin cookie o con cookie inválida → 401, sin transcribir", async () => {
    for (const cookie of [undefined, "basura"]) {
      const r = await transcribir(peticion(cookie));
      expect(r.status).toBe(401);
      expect((await r.json()).error).toBe("no_autenticado");
    }
    expect(voz).not.toHaveBeenCalled();
  });

  it("perfil incompleto → 403 falta_perfil", async () => {
    const { cookie } = await preparar(null);
    const r = await transcribir(peticion(cookie));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("falta_perfil");
    expect(voz).not.toHaveBeenCalled();
  });

  it("kill switch activo → 423 mantenimiento, sin transcribir", async () => {
    const { cookie } = await preparar();
    await interruptores.actualizar("kill_switch", "on");
    const r = await transcribir(peticion(cookie));
    expect(r.status).toBe(423);
    expect(await r.json()).toEqual({
      error: "mantenimiento",
      mensaje: "El asistente está en pausa unos minutos. Vuelve a intentarlo pronto.",
    });
    expect(voz).not.toHaveBeenCalled();
  });

  it("presupuesto alcanzado → activa el kill switch y responde 423", async () => {
    vi.stubEnv("PRESUPUESTO_MAX_USD", "5");
    await crearPresupuesto(db.fuente).sumar(5);
    const { cookie } = await preparar();
    const r = await transcribir(peticion(cookie));
    expect(r.status).toBe(423);
    expect(voz).not.toHaveBeenCalled();
    interruptores.limpiarCache();
    expect((await interruptores.obtenerTodos()).kill_switch).toBe("on");
  });

  it("tipo que no es audio → 400 audio_invalido", async () => {
    const { cookie } = await preparar();
    for (const tipo of ["application/json", "text/plain", "audio/ogg"]) {
      const r = await transcribir(peticion(cookie, { tipo }));
      expect(r.status).toBe(400);
      const cuerpo = await r.json();
      expect(cuerpo.error).toBe("audio_invalido");
      expect(cuerpo.mensaje).toMatch(/audio/i);
    }
    expect(voz).not.toHaveBeenCalled();
  });

  it("audio vacío o de más de 5 MB → 400", async () => {
    const { cookie } = await preparar();
    const vacio = await transcribir(peticion(cookie, { cuerpo: new Uint8Array(0) }));
    expect(vacio.status).toBe(400);
    const grande = await transcribir(peticion(cookie, { cuerpo: new Uint8Array(TAMANO_MAXIMO_AUDIO + 1) }));
    expect(grande.status).toBe(400);
    expect((await grande.json()).error).toBe("audio_invalido");
    expect(voz).not.toHaveBeenCalled();
  });

  it(`${LIMITE_TRANSCRIBIR_POR_MINUTO + 1}.º dictado en un minuto → 429 con Retry-After; otro asistente sigue`, async () => {
    const a = await preparar();
    for (let i = 0; i < LIMITE_TRANSCRIBIR_POR_MINUTO; i++) expect((await transcribir(peticion(a.cookie))).status).toBe(200);
    const r = await transcribir(peticion(a.cookie));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await r.json()).error).toBe("demasiados_dictados");
    const b = await preparar();
    expect((await transcribir(peticion(b.cookie))).status).toBe(200);
  });

  it("éxito: transcribe en español con el formato del audio, devuelve { texto } y suma el coste por duración", async () => {
    const { cookie } = await preparar();
    const r = await transcribir(peticion(cookie, { tipo: "audio/mp4", duracion: "20" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ texto: "¿Qué es el harness de un agente?" });
    expect(voz).toHaveBeenCalledTimes(1);
    const [audio, formato] = voz.mock.calls[0];
    expect(Buffer.from(audio)).toEqual(Buffer.from(AUDIO));
    expect(formato).toBe("mp4");
    expect(await crearPresupuesto(db.fuente).acumulado()).toBeCloseTo(costeTranscripcion(20), 12);
  });

  it("sin duración: cobra el máximo (60 s)", async () => {
    const { cookie } = await preparar();
    await transcribir(peticion(cookie, { duracion: null }));
    expect(await crearPresupuesto(db.fuente).acumulado()).toBeCloseTo(costeTranscripcion(60), 12);
  });

  it("transcripción vacía → 200 { texto: \"\" } (el cliente avisa)", async () => {
    voz.mockResolvedValueOnce("   ");
    const { cookie } = await preparar();
    const r = await transcribir(peticion(cookie));
    expect(await r.json()).toEqual({ texto: "" });
  });

  it("falla del proveedor → 502 genérico, sin detalles ni texto en logs", async () => {
    voz.mockRejectedValueOnce(new Error("sk-secreta: 500 upstream con audio"));
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cookie } = await preparar();
    const r = await transcribir(peticion(cookie));
    expect(r.status).toBe(502);
    const cuerpo = await r.json();
    expect(cuerpo.error).toBe("transcripcion_fallida");
    expect(JSON.stringify(cuerpo)).not.toMatch(/sk-|upstream/);
    expect(JSON.stringify(errores.mock.calls)).not.toMatch(/sk-|upstream|audio/);
    errores.mockRestore();
    // El intento se cobra igual: el proveedor pudo haber procesado el audio.
    expect(await crearPresupuesto(db.fuente).acumulado()).toBeGreaterThan(0);
  });

  it("nunca registra la transcripción en logs", async () => {
    const espias = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "error")];
    const { cookie } = await preparar();
    await transcribir(peticion(cookie));
    for (const e of espias) {
      expect(JSON.stringify(e.mock.calls)).not.toContain("harness");
      e.mockRestore();
    }
  });
});
