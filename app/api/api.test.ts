import { VERSION_APP } from "@/lib/version-app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FuenteDb } from "@/lib/db/client";
import { crearAsistentes } from "@/lib/db/asistentes";
import { interruptores } from "@/lib/db/interruptores";
import { crearDbTemporal } from "@/lib/db/prueba";
import { cookieDe, peticion } from "@/lib/prueba-api";
import { limitadorIdentificar } from "@/lib/rate-limit";
import { firmarToken } from "@/lib/session";
import { POST as feedback } from "./feedback/route";
import { POST as identificar } from "./identificar/route";
import { POST as perfil } from "./perfil/route";
import { GET as sesion } from "./sesion/route";
import { GET as sugerencias } from "./sugerencias/route";
import { TRAMOS } from "@/lib/tramos";

// Las rutas usan los repositorios por defecto; aquí apuntan a una base temporal.
const estado = vi.hoisted(() => ({
  fuente: null as null | (() => Promise<unknown>),
  addFeedback: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/client", async (original) => ({
  ...(await original<typeof import("@/lib/db/client")>()),
  db: (() => estado.fuente!()) as FuenteDb,
}));
vi.mock("@/src/mastra", () => ({
  mastra: { observability: { addFeedback: estado.addFeedback } },
}));

let db: Awaited<ReturnType<typeof crearDbTemporal>>;
let repo: ReturnType<typeof crearAsistentes>;
let ipSiguiente = 0;
// IP distinta por test para no chocar con el rate limit.
const ipNueva = () => `10.0.0.${++ipSiguiente}`;

async function identificarCon(email: unknown, ip = ipNueva()) {
  const r = await identificar(peticion("/api/identificar", { cuerpo: { email }, cabeceras: { "x-forwarded-for": ip } }));
  return { r, cuerpo: await r.json(), cookie: cookieDe(r) };
}

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "secreto-de-prueba-0123456789");
  db = await crearDbTemporal();
  estado.fuente = db.fuente;
  repo = crearAsistentes(db.fuente);
  limitadorIdentificar.reiniciar();
  interruptores.limpiarCache();
  estado.addFeedback.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  db.cerrar();
});

describe("POST /api/identificar", () => {
  it("inscrito con rol → listo, nombre_pila y cookie seteada", async () => {
    await repo.upsertInscrito({ email: "andrea@e.com", nombre: "Andrea Salazar", rol: "Gerente", descripcion: "Bots" });
    const { r, cuerpo, cookie } = await identificarCon("  ANDREA@e.com ");
    expect(r.status).toBe(200);
    expect(cuerpo).toEqual({ estado: "listo", nombre_pila: "Andrea" });
    expect(cookie).toBeTruthy();
    const cabecera = r.headers.get("set-cookie")!;
    expect(cabecera).toMatch(/HttpOnly/i);
    expect(cabecera).toMatch(/SameSite=lax/i);
  });

  it("inscrito sin rol → falta_perfil", async () => {
    await repo.upsertInscrito({ email: "bruno@e.com", nombre: "Bruno Díaz", rol: null, descripcion: null });
    const { cuerpo, cookie } = await identificarCon("bruno@e.com");
    expect(cuerpo).toEqual({ estado: "falta_perfil", nombre_pila: "Bruno" });
    expect(cookie).toBeTruthy();
  });

  it("desconocido → nuevo, crea invitado sin nombre y setea cookie", async () => {
    const { cuerpo, cookie } = await identificarCon("nueva@e.com");
    expect(cuerpo).toEqual({ estado: "nuevo" });
    expect(cookie).toBeTruthy();
    const creado = await repo.buscarPorEmail("nueva@e.com");
    expect(creado).toMatchObject({ nombre: "", origen: "invitado", rol: null });
  });

  it("identificar dos veces el mismo desconocido no duplica ni falla", async () => {
    await identificarCon("dos@e.com");
    const { r, cuerpo } = await identificarCon("dos@e.com");
    expect(r.status).toBe(200);
    expect(cuerpo).toEqual({ estado: "nuevo" });
  });

  it("nunca devuelve rol, descripción ni email", async () => {
    await repo.upsertInscrito({
      email: "carla@e.com",
      nombre: "Carla Ruiz",
      rol: "Directora de producto",
      descripcion: "Un agente de soporte",
    });
    const { r, cuerpo } = await identificarCon("carla@e.com");
    expect(Object.keys(cuerpo).sort()).toEqual(["estado", "nombre_pila"]);
    const texto = JSON.stringify(cuerpo) + JSON.stringify([...r.headers.entries()]);
    expect(texto).not.toMatch(/Directora|soporte|carla@e\.com/i);
  });

  it("email inválido o cuerpo ilegible → 400 email_invalido en español", async () => {
    for (const email of ["no-es-email", "", 42, undefined]) {
      const { r, cuerpo, cookie } = await identificarCon(email);
      expect(r.status).toBe(400);
      expect(cuerpo.error).toBe("email_invalido");
      expect(cuerpo.mensaje).toMatch(/correo/i);
      expect(cookie).toBeUndefined();
    }
    const r = await identificar(peticion("/api/identificar", { cuerpo: "{roto", cabeceras: { "x-forwarded-for": ipNueva() } }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("email_invalido");
  });

  // Decisión de Raúl (2026-09-23): 60/min, porque todo el público comparte el Wi‑Fi del lugar.
  it("61 intentos en un minuto desde la misma IP → el 61.º es 429", async () => {
    const ip = ipNueva();
    for (let i = 0; i < 60; i++) {
      const { r } = await identificarCon(`p${i}@e.com`, ip);
      expect(r.status).toBe(200);
    }
    const { r, cuerpo } = await identificarCon("p60@e.com", ip);
    expect(r.status).toBe(429);
    expect(cuerpo.error).toBe("demasiados_intentos");
    expect(cuerpo.mensaje).toMatch(/intent/i);
    expect(r.headers.get("retry-after")).toBeTruthy();
    // Otra IP sigue pudiendo entrar.
    expect((await identificarCon("otra@e.com")).r.status).toBe(200);
  });

  it("error interno → 500 genérico sin detalles técnicos", async () => {
    estado.fuente = async () => {
      throw new Error("SQLITE_BUSY: database is locked");
    };
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const { r, cuerpo } = await identificarCon("x@e.com");
    expect(r.status).toBe(500);
    expect(cuerpo.error).toBe("error_interno");
    expect(JSON.stringify(cuerpo)).not.toMatch(/SQLITE|locked/);
    expect(JSON.stringify(espia.mock.calls)).not.toMatch(/x@e\.com/);
    espia.mockRestore();
  });
});

describe("POST /api/perfil y GET /api/sesion", () => {
  it("desconocido → nuevo; tras perfil con nombre y rol queda listo", async () => {
    const { cookie } = await identificarCon("nuevo@e.com");
    expect(await (await sesion(peticion("/api/sesion", { cookie }))).json()).toEqual({
      autenticado: true,
      estado: "nuevo",
    });

    const r = await perfil(
      peticion("/api/perfil", { cookie, cuerpo: { nombre: "  Diego  Paz ", rol: "Desarrollador", descripcion: "Un copiloto" } }),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, nombre_pila: "Diego" });

    expect(await (await sesion(peticion("/api/sesion", { cookie }))).json()).toEqual({
      autenticado: true,
      estado: "listo",
      nombre_pila: "Diego",
    });
    const guardado = await repo.buscarPorEmail("nuevo@e.com");
    expect(guardado).toMatchObject({ nombre: "Diego Paz", rol: "Desarrollador", descripcion: "Un copiloto" });
  });

  it("nuevo sin nombre → 400 nombre_requerido", async () => {
    const { cookie } = await identificarCon("sin-nombre@e.com");
    const r = await perfil(peticion("/api/perfil", { cookie, cuerpo: { rol: "Docente" } }));
    expect(r.status).toBe(400);
    const cuerpo = await r.json();
    expect(cuerpo.error).toBe("nombre_requerido");
    expect(cuerpo.mensaje).toMatch(/nombre/i);
  });

  it("falta_perfil: basta el rol y conserva el nombre inscrito", async () => {
    await repo.upsertInscrito({ email: "eva@e.com", nombre: "Eva Mora", rol: null, descripcion: null });
    const { cookie } = await identificarCon("eva@e.com");
    const r = await perfil(peticion("/api/perfil", { cookie, cuerpo: { rol: "Contadora" } }));
    expect(await r.json()).toEqual({ ok: true, nombre_pila: "Eva" });
    expect(await repo.buscarPorEmail("eva@e.com")).toMatchObject({ nombre: "Eva Mora", rol: "Contadora" });
  });

  it("valida rol (2–120) y descripción (≤ 300) → 400 perfil_invalido", async () => {
    await repo.upsertInscrito({ email: "f@e.com", nombre: "F G", rol: null, descripcion: null });
    const { cookie } = await identificarCon("f@e.com");
    const casos = [{}, { rol: "x" }, { rol: " x " }, { rol: "a".repeat(121) }, { rol: "Dev", descripcion: "a".repeat(301) }, { rol: 5 }];
    for (const cuerpo of casos) {
      const r = await perfil(peticion("/api/perfil", { cookie, cuerpo }));
      expect(r.status).toBe(400);
      const c = await r.json();
      expect(c.error).toBe("perfil_invalido");
      expect(typeof c.mensaje).toBe("string");
    }
    const ok = await perfil(peticion("/api/perfil", { cookie, cuerpo: { rol: "ab", descripcion: "a".repeat(300) } }));
    expect(ok.status).toBe(200);
  });

  it("perfil sin cookie o con cookie manipulada → 401", async () => {
    const { cookie } = await identificarCon("g@e.com");
    const manipulada = cookie!.slice(0, -2) + (cookie!.endsWith("A") ? "BB" : "AA");
    for (const c of [undefined, manipulada, "basura"]) {
      const r = await perfil(peticion("/api/perfil", { cookie: c, cuerpo: { nombre: "G", rol: "Dev" } }));
      expect(r.status).toBe(401);
      const cuerpo = await r.json();
      expect(cuerpo.error).toBe("no_autenticado");
      expect(cuerpo.mensaje).toMatch(/sesión/i);
    }
  });

  it("/api/sesion sin cookie o manipulada → autenticado false", async () => {
    const { cookie } = await identificarCon("h@e.com");
    for (const c of [undefined, cookie + "x"]) {
      const r = await sesion(peticion("/api/sesion", { cookie: c }));
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ autenticado: false, estado: "sin_sesion" });
    }
  });

  it("cookie firmada para un token que no existe → 401", async () => {
    const r = await perfil(peticion("/api/perfil", { cookie: firmarToken("no-existe"), cuerpo: { rol: "Dev" } }));
    expect(r.status).toBe(401);
  });
});

describe("GET /api/sugerencias", () => {
  async function sugerenciasEn(lamina: string | null) {
    if (lamina !== null) await interruptores.actualizar("lamina_actual", lamina);
    const { cookie } = await identificarCon(`s${ipSiguiente}@e.com`);
    const r = await sugerencias(peticion("/api/sugerencias", { cookie }));
    expect(r.status).toBe(200);
    const { sugerencias: lista } = await r.json();
    expect(lista).toHaveLength(3);
    for (const s of lista) expect(typeof s).toBe("string");
    return lista as string[];
  }

  it("incluye la versión del build (el chat recarga si cambió tras un redespliegue)", async () => {
    const { cookie } = await identificarCon(`ver${ipSiguiente}@e.com`);
    const cuerpo = await (await sugerencias(peticion("/api/sugerencias", { cookie }))).json();
    expect(cuerpo.version).toBe(VERSION_APP);
    vi.stubEnv("VERSION_APP_FORZADA", "otra-version");
    const forzada = await (await sugerencias(peticion("/api/sugerencias", { cookie }))).json();
    expect(forzada.version).toBe("otra-version");
  });

  it("nunca se guarda en caché (el chat las vuelve a pedir cada 5 s)", async () => {
    const { cookie } = await identificarCon(`nc${ipSiguiente}@e.com`);
    const r = await sugerencias(peticion("/api/sugerencias", { cookie }));
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("devuelve 3 preguntas por tramo de lámina", async () => {
    const t1 = await sugerenciasEn("1");
    expect(await sugerenciasEn("13")).toEqual(t1);
    expect(t1.join(" ")).toMatch(/agente/i);
    expect(t1.join(" ")).toMatch(/loop/i);
    expect(t1.join(" ")).toMatch(/harness/i);

    const t2 = await sugerenciasEn("14");
    expect(await sugerenciasEn("32")).toEqual(t2);
    expect(t2.join(" ")).toMatch(/PRD/);
    expect(t2.join(" ")).toMatch(/patrón agéntico/i);
    expect(t2).not.toEqual(t1);

    const t3 = await sugerenciasEn("33");
    expect(await sugerenciasEn("40")).toEqual(t3);
    expect(t3.join(" ")).toMatch(/resiliencia|guardrail|eval|observabilidad/i);
    expect(t3).not.toEqual(t2);
  });

  it("salen del módulo compartido de tramos (el mismo que usa el panel)", async () => {
    for (const t of TRAMOS) {
      expect(await sugerenciasEn(String(t.desde))).toEqual([...t.preguntas]);
      expect(await sugerenciasEn(String(t.hasta))).toEqual([...t.preguntas]);
    }
  });

  it("lámina fuera de rango o inválida usa el tramo más cercano o el primero", async () => {
    const t1 = await sugerenciasEn("1");
    const t3 = await sugerenciasEn("40");
    expect(await sugerenciasEn("45")).toEqual(t3);
    expect(await sugerenciasEn("0")).toEqual(t1);
    expect(await sugerenciasEn("abc")).toEqual(t1);
  });

  it("sin sesión → 401", async () => {
    const r = await sugerencias(peticion("/api/sugerencias", { cookie: "manipulada" }));
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe("no_autenticado");
  });
});

describe("POST /api/feedback", () => {
  async function votar(cookie: string | undefined, cuerpo: unknown) {
    return feedback(peticion("/api/feedback", { cookie, cuerpo }));
  }
  async function votosGuardados() {
    const r = await db.cliente.execute("SELECT asistente_id, trace_id, valor FROM feedback ORDER BY id");
    return r.rows.map((f) => ({ asistente: String(f.asistente_id), trace: String(f.trace_id), valor: Number(f.valor) }));
  }

  it("guarda el voto en charla.db y también lo envía a la observabilidad de Mastra", async () => {
    const { cookie } = await identificarCon("fb@e.com");
    const r = await votar(cookie, { trace_id: "abc123", valor: -1 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const yo = await repo.buscarPorEmail("fb@e.com");
    expect(await votosGuardados()).toEqual([{ asistente: yo!.id, trace: "abc123", valor: -1 }]);
    expect(estado.addFeedback).toHaveBeenCalledTimes(1);
    expect(estado.addFeedback).toHaveBeenCalledWith({
      traceId: "abc123",
      feedback: { feedbackSource: "user", feedbackType: "rating", value: -1 },
    });
    // Sin datos personales en el feedback de observabilidad.
    expect(JSON.stringify(estado.addFeedback.mock.calls)).not.toMatch(/fb@e\.com/);
  });

  it("un voto repetido en la misma traza reemplaza el anterior (queda solo el último)", async () => {
    const { cookie } = await identificarCon("cambia@e.com");
    expect((await votar(cookie, { trace_id: "t-1", valor: 1 })).status).toBe(200);
    expect((await votar(cookie, { trace_id: "t-1", valor: -1 })).status).toBe(200);
    const votos = await votosGuardados();
    expect(votos).toHaveLength(1);
    expect(votos[0]).toMatchObject({ trace: "t-1", valor: -1 });
  });

  it("valida trace_id y valor ∈ {1, -1} → 400 feedback_invalido", async () => {
    const { cookie } = await identificarCon("fb2@e.com");
    const casos = [{}, { trace_id: "t" }, { trace_id: "t", valor: 0 }, { trace_id: "t", valor: 2 }, { trace_id: "", valor: 1 }, { valor: 1 }, { trace_id: "t", valor: "1" }];
    for (const cuerpo of casos) {
      const r = await votar(cookie, cuerpo);
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("feedback_invalido");
    }
    expect(estado.addFeedback).not.toHaveBeenCalled();
    expect(await votosGuardados()).toEqual([]);
  });

  it("sin sesión → 401 y no registra", async () => {
    const r = await votar(undefined, { trace_id: "t", valor: 1 });
    expect(r.status).toBe(401);
    expect(estado.addFeedback).not.toHaveBeenCalled();
    expect(await votosGuardados()).toEqual([]);
  });

  it("si la observabilidad falla, responde ok, el voto queda guardado y solo se registra el tipo de error", async () => {
    const { cookie } = await identificarCon("fb3@e.com");
    estado.addFeedback.mockRejectedValueOnce(new Error("storage caído fb3@e.com"));
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await votar(cookie, { trace_id: "t", valor: 1 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await votosGuardados()).toMatchObject([{ trace: "t", valor: 1 }]);
    await vi.waitFor(() => expect(espia).toHaveBeenCalled());
    expect(JSON.stringify(espia.mock.calls)).not.toMatch(/fb3@e\.com|caído/);
    espia.mockRestore();
  });

  it("si la observabilidad lanza de forma síncrona o nunca responde, la respuesta no espera", async () => {
    const { cookie } = await identificarCon("fb4@e.com");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    estado.addFeedback.mockImplementationOnce(() => {
      throw new Error("síncrono");
    });
    expect((await votar(cookie, { trace_id: "s1", valor: 1 })).status).toBe(200);
    estado.addFeedback.mockImplementationOnce(() => new Promise<void>(() => {}));
    expect((await votar(cookie, { trace_id: "s2", valor: -1 })).status).toBe(200);
    expect((await votosGuardados()).map((v) => v.trace)).toEqual(["s1", "s2"]);
    espia.mockRestore();
  });

  it("si la base falla al guardar → 500 genérico en español y no envía a la observabilidad", async () => {
    const { cookie } = await identificarCon("fb5@e.com");
    await db.cliente.execute("DROP TABLE feedback");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await votar(cookie, { trace_id: "t", valor: 1 });
    expect(r.status).toBe(500);
    const cuerpo = await r.json();
    expect(cuerpo.error).toBe("error_interno");
    expect(typeof cuerpo.mensaje).toBe("string");
    expect(JSON.stringify(cuerpo)).not.toMatch(/SQLITE|feedback/i);
    expect(JSON.stringify(espia.mock.calls)).not.toMatch(/fb5@e\.com/);
    expect(estado.addFeedback).not.toHaveBeenCalled();
    espia.mockRestore();
  });
});
