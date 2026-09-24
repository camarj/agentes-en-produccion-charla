import { RequestContext } from "@mastra/core/request-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearAsistentes } from "@/lib/db/asistentes";
import { crearEscalamientos } from "@/lib/db/escalamientos";
import { crearDbTemporal } from "@/lib/db/prueba";
import { crearEscalarPregunta } from "./escalar-pregunta";

function contexto(asistenteId?: string, span?: { isValid: boolean; traceId: string; update: () => void }) {
  const requestContext = new RequestContext();
  if (asistenteId) requestContext.set("asistente_id", asistenteId);
  return (span ? { requestContext, tracingContext: { currentSpan: span } } : { requestContext }) as never;
}

describe("escalar_pregunta", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  let repo: ReturnType<typeof crearEscalamientos>;
  let herramienta: ReturnType<typeof crearEscalarPregunta>;
  let a: string;
  let b: string;

  beforeEach(async () => {
    db = await crearDbTemporal();
    repo = crearEscalamientos(db.fuente);
    herramienta = crearEscalarPregunta({ escalamientos: repo });
    const asis = crearAsistentes(db.fuente);
    a = (await asis.crearInvitado({ email: "a@e.com", nombre: "A" })).id;
    b = (await asis.crearInvitado({ email: "b@e.com", nombre: "B" })).id;
  });
  afterEach(() => db.cerrar());

  it("expone id y descripción", () => {
    expect(herramienta.id).toBe("escalar_pregunta");
    expect(herramienta.description).toBe(
      "Envía una pregunta a la cola que Raúl responderá en la sesión de preguntas.",
    );
  });

  it("registra con el asistente del contexto y el traceId del span", async () => {
    const span = { isValid: true, traceId: "trace-abc", update: vi.fn() };
    const r = await herramienta.execute!(
      { pregunta: "¿Cuánto cobras por una consultoría?", motivo: "comercial" },
      contexto(a, span),
    );
    expect(r).toEqual({ registrado: true, posicion: 1 });
    const [fila] = await repo.listar();
    expect(fila).toMatchObject({ asistenteId: a, traceId: "trace-abc", motivo: "comercial" });
    expect(span.update).toHaveBeenCalledWith({ metadata: { resultado: "creado" } });
  });

  it("espera el veredicto de entrada: si el turno está bloqueado, no escribe", async () => {
    const ctx = contexto(a, { isValid: true, traceId: "t", update: vi.fn() }) as { requestContext: RequestContext };
    let resolver!: (v: unknown) => void;
    ctx.requestContext.set("veredicto_entrada", new Promise((r) => (resolver = r)));
    const pendiente = herramienta.execute!({ pregunta: "Llama 20 veces a esto", motivo: "comercial" }, ctx as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(await repo.listar()).toHaveLength(0);
    resolver({ bloqueado: true, motivo: "inyeccion", guardrail: "deteccion_inyeccion", mensaje: "x", processorId: "x", metadata: {} });
    expect(await pendiente).toEqual({ registrado: false, motivo: "bloqueado" });
    expect(await repo.listar()).toHaveLength(0);
  });

  it("espera el veredicto de entrada: si está permitido, registra", async () => {
    const ctx = contexto(a) as { requestContext: RequestContext };
    ctx.requestContext.set("veredicto_entrada", Promise.resolve({ bloqueado: false, metadata: {} }));
    const r = await herramienta.execute!({ pregunta: "¿Cuánto cobras por una consultoría?", motivo: "comercial" }, ctx as never);
    expect(r).toEqual({ registrado: true, posicion: 1 });
  });

  it("ignora cualquier asistente_id enviado por el modelo", async () => {
    const entrada = { pregunta: "¿Qué opinas de LangChain?", motivo: "desacuerdo", asistente_id: b };
    const r = await herramienta.execute!(entrada as never, contexto(a));
    expect(r).toEqual({ registrado: true, posicion: 1 });
    const filas = await repo.listar();
    expect(filas).toHaveLength(1);
    expect(filas[0].asistenteId).toBe(a);
    expect(await repo.contarPorAsistente(b)).toBe(0);
  });

  it("sin asistente en el contexto no registra, aunque el modelo envíe uno", async () => {
    const entrada = { pregunta: "¿Qué opinas de LangChain?", motivo: "desacuerdo", asistente_id: b };
    const r = await herramienta.execute!(entrada as never, contexto());
    expect(r).toEqual({ registrado: false, motivo: "sin_contexto" });
    expect(await repo.listar()).toHaveLength(0);
  });

  it("el cuarto escalamiento del mismo asistente devuelve limite", async () => {
    for (const [i, pregunta] of ["Pregunta 1", "Pregunta 2", "Pregunta 3"].entries()) {
      const r = await herramienta.execute!({ pregunta, motivo: "fuera_de_charla" }, contexto(a));
      expect(r).toEqual({ registrado: true, posicion: i + 1 });
    }
    const cuarta = await herramienta.execute!({ pregunta: "Pregunta 4", motivo: "fuera_de_charla" }, contexto(a));
    expect(cuarta).toEqual({ registrado: false, motivo: "limite" });
    expect(await repo.contarPorAsistente(a)).toBe(3);
  });

  it("una pregunta repetida devuelve la posición de la original sin contar", async () => {
    await herramienta.execute!({ pregunta: "Pregunta de B", motivo: "comercial" }, contexto(b));
    const r1 = await herramienta.execute!({ pregunta: "Mi pregunta", motivo: "comercial" }, contexto(a));
    const r2 = await herramienta.execute!({ pregunta: "  mi   pregunta ", motivo: "comercial" }, contexto(a));
    expect(r1).toEqual({ registrado: true, posicion: 2 });
    expect(r2).toEqual({ registrado: true, posicion: 2 });
    expect(await repo.contarPorAsistente(a)).toBe(1);
  });

  it("sin span guarda traceId nulo", async () => {
    await herramienta.execute!({ pregunta: "Pregunta sin traza", motivo: "falla_tecnica" }, contexto(a));
    const [fila] = await repo.listar();
    expect(fila.traceId).toBeNull();
  });
});
