import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearEventosSalud } from "./eventos-salud";
import { crearDbTemporal } from "./prueba";

const T0 = Date.parse("2026-12-05T19:42:10.000Z");
const SEG = 1000;
const MIN = 60 * SEG;

describe("eventos de salud (semáforos y registro en vivo del panel)", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  beforeEach(async () => {
    db = await crearDbTemporal();
  });
  afterEach(() => db.cerrar());

  const semaforos = (s: Awaited<ReturnType<ReturnType<typeof crearEventosSalud>["salud"]>>) =>
    Object.fromEntries(s.servicios.map((x) => [x.id, x.semaforo]));

  it("sin eventos → todo en verde y registro vacío", async () => {
    const s = await crearEventosSalud(db.fuente).salud({ ahora: T0, presupuesto: { acumuladoUsd: 0, maximoUsd: 10 } });
    expect(s.eventos).toEqual([]);
    expect(s.servicios.map((x) => x.id)).toEqual(["gemini", "openai", "base_datos", "trazas", "busqueda", "guardrails", "entrada", "presupuesto"]);
    expect(new Set(Object.values(semaforos(s)))).toEqual(new Set(["verde"]));
    expect(s.servicios[0]).toEqual({ id: "gemini", nombre: "Gemini (principal)", semaforo: "verde", detalle: "Responde" });
  });

  it("guarda solo tipo, servicio, nivel, tiempos y trace id", async () => {
    await crearEventosSalud(db.fuente).registrar("busqueda_agotada", { traceId: "t-9", ahora: T0 });
    const r = await db.cliente.execute("SELECT * FROM eventos_salud");
    expect(r.rows[0]).toMatchObject({ tipo: "busqueda_agotada", servicio: "busqueda", nivel: "falla", cantidad: 1, trace_id: "t-9" });
  });

  it("agrupa los eventos repetidos del mismo tipo en 1 minuto (×N) y abre otra línea después", async () => {
    const eventos = crearEventosSalud(db.fuente);
    for (let i = 0; i < 12; i++) await eventos.registrar("gemini_limite_uso", { traceId: `t-${i}`, ahora: T0 + i * 4 * SEG });
    await eventos.registrar("gemini_limite_uso", { traceId: "t-nuevo", ahora: T0 + 2 * MIN });
    const s = await eventos.salud({ ahora: T0 + 2 * MIN, presupuesto: { acumuladoUsd: 0, maximoUsd: null } });
    expect(s.eventos.map((e) => [e.texto, e.trace_id, e.nivel])).toEqual([
      ["Gemini: límite de uso (429) → respondió OpenAI", "t-nuevo", "aviso"],
      ["Gemini: límite de uso (429) → respondió OpenAI ×12 en 1 min", "t-11", "aviso"],
    ]);
    expect(s.eventos[1].hora).toBe(new Date(T0 + 44 * SEG).toISOString());
  });

  it("los semáforos toman el peor evento de los últimos 5 minutos y vuelven a verde solos", async () => {
    const eventos = crearEventosSalud(db.fuente);
    await eventos.registrar("busqueda_reintentos", { ahora: T0 });
    await eventos.registrar("busqueda_agotada", { traceId: "t-1", ahora: T0 + SEG });
    await eventos.registrar("alcance_falla_abierta", { ahora: T0 });
    await eventos.registrar("db_error", { ahora: T0 });
    const ahora = await eventos.salud({ ahora: T0 + MIN, presupuesto: { acumuladoUsd: 0, maximoUsd: null } });
    expect(semaforos(ahora)).toMatchObject({ busqueda: "rojo", guardrails: "ambar", base_datos: "rojo", gemini: "verde" });
    expect(ahora.servicios.find((x) => x.id === "busqueda")!.detalle).toBe("buscar_laminas agotó 3 intentos");
    const despues = await eventos.salud({ ahora: T0 + 6 * MIN, presupuesto: { acumuladoUsd: 0, maximoUsd: null } });
    expect(new Set(Object.values(semaforos(despues)))).toEqual(new Set(["verde"]));
    // El registro conserva la historia.
    expect(despues.eventos).toHaveLength(4);
  });

  it("recuperación: solo se anota si el servicio estaba en ámbar o rojo, y lo devuelve a verde", async () => {
    const eventos = crearEventosSalud(db.fuente);
    // Sin falla previa no hay nada que anunciar.
    await eventos.registrarRecuperacion("gemini_recuperado", { ahora: T0 });
    expect((await eventos.salud({ ahora: T0, presupuesto: { acumuladoUsd: 0, maximoUsd: null } })).eventos).toEqual([]);

    await eventos.registrar("gemini_sobrecarga", { traceId: "t-1", ahora: T0 + SEG });
    await eventos.registrarRecuperacion("gemini_recuperado", { ahora: T0 + 2 * MIN });
    await eventos.registrarRecuperacion("gemini_recuperado", { ahora: T0 + 3 * MIN });
    const s = await eventos.salud({ ahora: T0 + 3 * MIN, presupuesto: { acumuladoUsd: 0, maximoUsd: null } });
    expect(s.eventos.map((e) => [e.texto, e.nivel])).toEqual([
      ["Gemini se recuperó", "ok"],
      ["Gemini respondió 503 → respondió OpenAI", "aviso"],
    ]);
    expect(semaforos(s).gemini).toBe("verde");
  });

  it("presupuesto: < 70 % verde, desde 70 % ámbar, agotado rojo", async () => {
    const eventos = crearEventosSalud(db.fuente);
    const de = async (acumuladoUsd: number) =>
      (await eventos.salud({ ahora: T0, presupuesto: { acumuladoUsd, maximoUsd: 10 } })).servicios.find((x) => x.id === "presupuesto")!;
    expect(await de(6.9)).toMatchObject({ semaforo: "verde", detalle: "69 % usado" });
    expect(await de(7)).toMatchObject({ semaforo: "ambar", detalle: "70 % usado" });
    expect(await de(9.5)).toMatchObject({ semaforo: "ambar", detalle: "95 % usado" });
    expect(await de(10)).toMatchObject({ semaforo: "rojo", detalle: "Agotado → chat en pausa" });
  });
});
