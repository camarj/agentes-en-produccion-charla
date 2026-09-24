import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { describe, expect, it, vi } from "vitest";
import type { PerfilPrivado } from "@/lib/db/asistentes";
import { MENSAJES_BLOQUEO, TIPO_PARTE_GUARDRAIL } from "./mensajes";
import { modeloFalso } from "./pruebas-modelo";
import {
  CACHE_ASISTENTES_MS,
  SinDatosPersonales,
  buscarDatoPersonal,
  construirTerminos,
  normalizar,
} from "./sin-datos-personales";

const MENSAJE = MENSAJES_BLOQUEO.datos_personales;

const PERFILES: PerfilPrivado[] = [
  { id: "yo", nombre: "Andrea Salazar", rol: "Gerente de operaciones", descripcion: "Gestiono logística en una empresa de distribución" },
  { id: "o1", nombre: "Juan Pérez", rol: "Desarrollador backend", descripcion: "Construyo bots de soporte" },
  { id: "o2", nombre: "María José Núñez", rol: "Docente universitaria", descripcion: null },
  { id: "o3", nombre: "Ana", rol: "CTO", descripcion: null }, // nombre y rol cortos (≤ 4)
];

const cargar = () => vi.fn(async () => PERFILES);

function contextoAndrea() {
  const rc = new RequestContext();
  rc.set("asistente_id", "yo");
  rc.set("rol", "Gerente de operaciones");
  rc.set("descripcion", "Gestiono logística en una empresa de distribución");
  return rc;
}

describe("normalizar", () => {
  it("quita tildes, pasa a minúsculas y colapsa espacios", () => {
    expect(normalizar("  MARÍA   José\nNÚÑEZ ")).toBe("maria jose nunez");
  });
});

describe("buscarDatoPersonal", () => {
  const t = construirTerminos(PERFILES, { asistenteId: "yo", rol: "Gerente de operaciones", descripcion: PERFILES[0].descripcion });

  it("detecta cualquier email", () => {
    expect(buscarDatoPersonal("Escríbele a juan.perez@empresa.com.ec", t, { final: true })).toBe("email");
    expect(buscarDatoPersonal("contacto: RAUL@Inteliside.com", t, { final: true })).toBe("email");
  });

  it("detecta el nombre completo de otro asistente sin importar mayúsculas ni tildes", () => {
    expect(buscarDatoPersonal("También vino juan perez.", t, { final: true })).toBe("otro_asistente");
    expect(buscarDatoPersonal("Está MARIA JOSE NUÑEZ", t, { final: true })).toBe("otro_asistente");
  });

  it("detecta el rol de otro asistente", () => {
    expect(buscarDatoPersonal("Hay una docente universitaria en la sala", t, { final: true })).toBe("otro_asistente");
    expect(buscarDatoPersonal("Un DESARROLLADOR BACKEND preguntó", t, { final: true })).toBe("otro_asistente");
  });

  it("solo coincide con palabras completas", () => {
    expect(buscarDatoPersonal("juan perezoso", t, { final: true })).toBeNull();
    expect(buscarDatoPersonal("sanjuan perez", t, { final: true })).toBeNull();
  });

  it("ignora nombres y roles de 4 caracteres o menos", () => {
    expect(buscarDatoPersonal("Ana es un nombre y CTO un cargo", t, { final: true })).toBeNull();
  });

  it("permite el nombre del propio usuario", () => {
    expect(buscarDatoPersonal("Hola, Andrea Salazar. Un agente es...", t, { final: true })).toBeNull();
  });

  // Decisión de Raúl (2026-09-23): la persona viendo su propio perfil en su
  // teléfono no es una fuga; bloquearlo tiraba respuestas personalizadas buenas.
  it("permite el rol y la descripción del propio usuario", () => {
    expect(buscarDatoPersonal("Tu rol registrado es gerente de operaciones.", t, { final: true })).toBeNull();
    expect(
      buscarDatoPersonal("Dijiste: gestiono logistica en una empresa de distribucion", t, { final: true }),
    ).toBeNull();
  });

  it("un rol que comparte con otro asistente no cuenta como dato ajeno", () => {
    const perfiles: PerfilPrivado[] = [
      { id: "yo", nombre: "Andrea Salazar", rol: "Docente universitaria", descripcion: null },
      { id: "o2", nombre: "María José Núñez", rol: "Docente universitaria", descripcion: null },
    ];
    const t4 = construirTerminos(perfiles, { asistenteId: "yo", rol: "Docente universitaria" });
    expect(buscarDatoPersonal("Como docente universitaria, podrías…", t4, { final: true })).toBeNull();
    expect(buscarDatoPersonal("Vino María José Núñez", t4, { final: true })).toBe("otro_asistente");
  });

  it("ignora roles de una sola palabra (propios y ajenos): son palabras comunes", () => {
    const perfiles: PerfilPrivado[] = [
      { id: "yo", nombre: "Andrea Salazar", rol: "Contador", descripcion: null },
      { id: "o1", nombre: "Juan Pérez", rol: "Tecnología", descripcion: null },
    ];
    const t3 = construirTerminos(perfiles, { asistenteId: "yo", rol: "Contador" });
    expect(buscarDatoPersonal("La tecnología de IA permite a un contador conciliar cuentas.", t3, { final: true })).toBeNull();
    expect(buscarDatoPersonal("Vino Juan Pérez", t3, { final: true })).toBe("otro_asistente");
  });

  it("el nombre del speaker (Raúl Camacho) está permitido aunque su fila esté en asistentes", () => {
    const conSpeaker: PerfilPrivado[] = [
      ...PERFILES,
      { id: "speaker", nombre: "RAUL  camacho", rol: "Fundador de Inteliside", descripcion: null },
    ];
    const t = construirTerminos(conSpeaker, { asistenteId: "yo" });
    expect(t.otros).not.toContain("raul camacho");
    expect(buscarDatoPersonal("Como explica Raúl Camacho en la lámina 11, el harness…", t, { final: true })).toBeNull();
  });

  it("no da falsos positivos con una respuesta normal", () => {
    expect(
      buscarDatoPersonal("Un LLM es un modelo de lenguaje. En la lámina 8 se explica cómo un agente usa herramientas.", t, { final: true }),
    ).toBeNull();
  });

  it("a mitad del stream no confirma una coincidencia pegada al final (puede seguir la palabra)", () => {
    expect(buscarDatoPersonal("Vino Juan Pérez", t, { final: false })).toBeNull();
    expect(buscarDatoPersonal("Vino Juan Pérez", t, { final: true })).toBe("otro_asistente");
    expect(buscarDatoPersonal("Vino Juan Pérez.", t, { final: false })).toBe("otro_asistente");
  });

  it("sin perfil en el contexto, el rol registrado del usuario tampoco cuenta como ajeno", () => {
    const t2 = construirTerminos(PERFILES, { asistenteId: "yo" });
    expect(buscarDatoPersonal("Eres gerente de operaciones", t2, { final: true })).toBeNull();
  });
});

function agente(cargarAsistentes: () => Promise<PerfilPrivado[]>, trozos: string[], extra: Record<string, unknown> = {}) {
  const principal = modeloFalso("openai/gpt-6-luna", () => ({ texto: trozos }));
  return new Agent({
    id: `prueba-privacidad-${Math.random().toString(36).slice(2)}`,
    name: "prueba",
    instructions: "x",
    model: principal.modelo as never,
    outputProcessors: [new SinDatosPersonales({ cargarAsistentes })],
    ...extra,
  });
}

async function leerStream(a: Agent, rc = contextoAndrea(), opciones: Record<string, unknown> = {}) {
  const s = await a.stream("pregunta", { requestContext: rc, ...opciones });
  const chunks: { type: string; payload?: { text?: string }; data?: unknown }[] = [];
  for await (const c of s.fullStream) chunks.push(c as never);
  const enviado = chunks.filter((c) => c.type === "text-delta").map((c) => c.payload?.text).join("");
  return { chunks, enviado, texto: await s.text, tripwire: await s.tripwire };
}

describe("SinDatosPersonales con un agente real", () => {
  it("sin datos personales: el stream llega completo, en orden y con varios trozos", async () => {
    const trozos = [
      "Un agente ", "decide y ", "actúa con ", "herramientas para lograr un objetivo. ",
      "La charla lo explica en la lámina 8, ", "y luego muestra cómo medirlo con evals ",
      "y observarlo con trazas en producción. ", "Ver lámina 8.",
    ];
    const { chunks, enviado, texto, tripwire } = await leerStream(agente(cargar(), trozos));
    expect(enviado).toBe(trozos.join(""));
    expect(texto).toBe(trozos.join(""));
    expect(tripwire).toBeUndefined();
    const tipos = chunks.map((c) => c.type);
    expect(tipos.lastIndexOf("text-delta")).toBeLessThan(tipos.indexOf("text-end"));
    expect(chunks.filter((c) => c.type === "text-delta").length).toBeGreaterThan(1);
  });

  it("un nombre partido entre trozos nunca llega al cliente y la respuesta se reemplaza", async () => {
    const trozos = ["En la charla ", "está ", "Ju", "an Pé", "rez, que ", "construye bots."];
    const { chunks, enviado, texto } = await leerStream(agente(cargar(), trozos));
    // Ningún fragmento del nombre sale, ni siquiera "Ju" o "Pé".
    expect(enviado).not.toMatch(/Ju|Pé|rez/);
    expect(enviado).toContain(MENSAJE);
    expect(texto).toBe(MENSAJE);
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: TIPO_PARTE_GUARDRAIL, data: { guardrail: "sin_datos_personales", motivo: "datos_personales" } }),
    );
  });

  it("si el dato aparece tarde, lo ya enviado era seguro y la respuesta final es solo el mensaje", async () => {
    const trozos = [
      "Un agente decide y actúa con herramientas para lograr un objetivo. ",
      "La charla lo explica en la lámina 8 y luego muestra cómo medirlo con evals. ",
      "Por cierto, en la sala está ", "Juan ", "Pérez", ".",
    ];
    const { enviado, texto, chunks } = await leerStream(agente(cargar(), trozos));
    expect(enviado.startsWith("Un agente decide")).toBe(true);
    expect(enviado).not.toMatch(/Juan|Pérez/);
    expect(enviado.endsWith(`\n\n${MENSAJE}`)).toBe(true);
    expect(texto).toBe(MENSAJE);
    expect(chunks.some((c) => c.type === TIPO_PARTE_GUARDRAIL)).toBe(true);
  });

  it("un email partido entre trozos nunca llega al cliente", async () => {
    const trozos = ["Su correo es ", "juan", ".perez@", "empresa", ".com", " y nada más."];
    const { enviado, texto } = await leerStream(agente(cargar(), trozos));
    expect(enviado).not.toContain("@");
    expect(enviado).not.toContain("juan");
    expect(texto).toBe(MENSAJE);
  });

  it("una respuesta personalizada con el rol propio sale completa", async () => {
    const trozos = ["Como ", "GERENTE DE ", "OPERACIONES", ", un agente podría avisarte de retrasos."];
    const { texto } = await leerStream(agente(cargar(), trozos));
    expect(texto).toBe(trozos.join(""));
  });

  it("el nombre propio sí se permite", async () => {
    const trozos = ["Hola ", "Andrea Salazar", ", un LLM es un modelo de lenguaje."];
    const { texto } = await leerStream(agente(cargar(), trozos));
    expect(texto).toBe(trozos.join(""));
  });

  it("generate(): también reemplaza el texto final", async () => {
    const a = agente(cargar(), ["Escríbele a ana.torres@correo.com"]);
    const r = await a.generate("pregunta", { requestContext: contextoAndrea() });
    expect(r.text).toBe(MENSAJE);
    expect(r.tripwire).toBeUndefined();
  });

  it("la memoria guarda el mensaje seguro, no el dato personal", async () => {
    const storage = new LibSQLStore({ id: "prueba-privacidad", url: "file::memory:" });
    const memoria = new Memory({ storage });
    const a = agente(cargar(), ["Está ", "María José ", "Núñez", " en la sala."], { memory: memoria });
    await leerStream(a, contextoAndrea(), { memory: { thread: "h1", resource: "r1" } });
    const { messages } = await memoria.recall({ threadId: "h1", resourceId: "r1" });
    const guardado = JSON.stringify(messages);
    expect(guardado).toContain(MENSAJE);
    expect(normalizar(guardado)).not.toContain("nunez");
  });

  it("carga los asistentes una vez cada 60 s (caché)", async () => {
    let ahora = 1_000_000;
    const cargarAsistentes = cargar();
    const p = new SinDatosPersonales({ cargarAsistentes, ahora: () => ahora });
    const principal = modeloFalso("openai/gpt-6-luna", () => ({ texto: "Hola" }));
    const a = new Agent({ id: "prueba-cache", name: "p", instructions: "x", model: principal.modelo as never, outputProcessors: [p] });
    await leerStream(a);
    await leerStream(a);
    expect(cargarAsistentes).toHaveBeenCalledTimes(1);
    ahora += CACHE_ASISTENTES_MS + 1;
    await leerStream(a);
    expect(cargarAsistentes).toHaveBeenCalledTimes(2);
  });

  it("si no puede cargar asistentes, sigue bloqueando emails", async () => {
    const roto = vi.fn(async () => Promise.reject(new Error("db caída")));
    const { texto } = await leerStream(agente(roto, ["Mi correo: a@b.co"]));
    expect(texto).toBe(MENSAJE);
  });
});

describe("SinDatosPersonales (traza)", () => {
  it("registra guardrail, motivo y tipo en el span, sin el texto ni el email", async () => {
    const p = new SinDatosPersonales({ cargarAsistentes: cargar() });
    const span = { update: vi.fn() };
    const texto = "Escríbele a juan.perez@empresa.com";
    const messages = [
      { id: "m1", role: "assistant", createdAt: new Date(), content: { format: 2, parts: [{ type: "text", text: texto }], content: texto } },
    ];
    const r = (await p.processOutputResult({
      messages,
      state: {},
      requestContext: contextoAndrea(),
      tracingContext: { currentSpan: span },
      abort: vi.fn(),
    } as never)) as typeof messages;
    expect(r[0].content.parts).toEqual([{ type: "text", text: MENSAJE }]);
    expect(r[0].content.content).toBe(MENSAJE);
    expect(span.update).toHaveBeenCalledWith({
      metadata: { guardrail: "sin_datos_personales", motivo: "datos_personales", tipo_dato: "email" },
    });
    expect(JSON.stringify(span.update.mock.calls)).not.toContain("@");
  });

  it("no toca mensajes sin datos personales", async () => {
    const p = new SinDatosPersonales({ cargarAsistentes: cargar() });
    const messages = [
      { id: "m1", role: "assistant", createdAt: new Date(), content: { format: 2, parts: [{ type: "text", text: "Un LLM es..." }] } },
    ];
    const r = await p.processOutputResult({ messages, state: {}, requestContext: contextoAndrea(), abort: vi.fn() } as never);
    expect(r).toBe(messages);
  });
});
