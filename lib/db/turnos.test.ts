import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearDbTemporal } from "./prueba";
import { crearTurnos, type FilaTurno } from "./turnos";

const AHORA = Date.parse("2026-12-05T19:00:00.000Z");
const MIN = 60_000;
const HORA = 60 * MIN;

function fila(datos: Partial<FilaTurno> = {}): FilaTurno {
  return {
    iniciadoMs: AHORA - 5 * MIN,
    duracionMs: 3000,
    resultado: "ok",
    tipoFalla: null,
    motivoBloqueo: null,
    modelo: "gemini-3.8-flash",
    respaldo: false,
    traceId: "t-ok",
    ...datos,
  };
}

describe("turnos de chat en charla.db (métricas del panel sin tope)", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  beforeEach(async () => {
    db = await crearDbTemporal();
  });
  afterEach(() => db.cerrar());

  it("sin turnos → todo en cero, latencia sin dato y sin modelo en uso", async () => {
    expect(await crearTurnos(db.fuente).resumen(AHORA)).toEqual({
      latencia: { p50Ms: null, p95Ms: null, muestras: 0 },
      errores: 0,
      erroresPorTipo: {},
      bloqueos: { total: 0, porMotivo: {} },
      turnos: 0,
      respaldo: { ultimaHora: 0, ultimaEn: null },
      modeloEnUso: null,
    });
  });

  it("guarda solo datos técnicos del turno (ni emails, ni nombres, ni la pregunta)", async () => {
    await crearTurnos(db.fuente).registrar(fila({ traceId: "t-1" }));
    const r = await db.cliente.execute("SELECT * FROM turnos");
    expect(r.rows).toHaveLength(1);
    expect(Object.keys(r.rows[0]).sort()).toEqual(
      ["duracion_ms", "id", "iniciado_ms", "modelo", "motivo_bloqueo", "respaldo", "resultado", "tipo_falla", "trace_id"].sort(),
    );
    expect(r.rows[0]).toMatchObject({ resultado: "ok", modelo: "gemini-3.8-flash", trace_id: "t-1", duracion_ms: 3000, respaldo: 0 });
  });

  it("cuenta turnos, fallas por tipo, bloqueos por motivo, latencia y respaldo con el mismo significado que las trazas", async () => {
    const turnos = crearTurnos(db.fuente);
    for (const d of [1000, 2000, 3000, 4000]) await turnos.registrar(fila({ duracionMs: d }));
    // Respaldo dentro de la última hora y otro de hace 2 h (cuenta en los totales, no en la hora).
    await turnos.registrar(fila({ duracionMs: 5000, respaldo: true, modelo: "openai/gpt-6-luna", iniciadoMs: AHORA - 2 * MIN, traceId: "t-resp" }));
    await turnos.registrar(fila({ duracionMs: 9000, respaldo: true, modelo: "openai/gpt-6-luna", iniciadoMs: AHORA - 2 * HORA }));
    // Falla de herramienta con respuesta completa: cuenta como falla y en la latencia.
    await turnos.registrar(fila({ resultado: "falla", tipoFalla: "herramienta", duracionMs: 6000 }));
    // Fallas sin respuesta: no entran en la latencia.
    await turnos.registrar(fila({ resultado: "falla", tipoFalla: "modelo", duracionMs: null, modelo: null, iniciadoMs: AHORA - 10 * MIN }));
    await turnos.registrar(fila({ resultado: "falla", tipoFalla: "tiempo", duracionMs: null, modelo: null }));
    // Bloqueos: no son fallas ni entran en la latencia.
    await turnos.registrar(fila({ resultado: "bloqueo", motivoBloqueo: "inyeccion", duracionMs: 800 }));
    await turnos.registrar(fila({ resultado: "bloqueo", motivoBloqueo: "fuera_de_alcance", duracionMs: 700 }));
    await turnos.registrar(fila({ resultado: "bloqueo", motivoBloqueo: "fuera_de_alcance", duracionMs: 900 }));
    // Fuera de la ventana de 12 h: no cuenta.
    await turnos.registrar(fila({ iniciadoMs: AHORA - 13 * HORA }));

    const m = await turnos.resumen(AHORA);
    expect(m.turnos).toBe(12);
    expect(m.errores).toBe(3);
    expect(m.erroresPorTipo).toEqual({ herramienta: 1, modelo: 1, tiempo: 1 });
    expect(m.bloqueos).toEqual({ total: 3, porMotivo: { inyeccion: 1, fuera_de_alcance: 2 } });
    // Última hora: 1000, 2000, 3000, 4000, 5000, 6000 → p50 = 3000, p95 = 6000.
    expect(m.latencia).toEqual({ p50Ms: 3000, p95Ms: 6000, muestras: 6 });
    expect(m.respaldo).toEqual({ ultimaHora: 1, ultimaEn: new Date(AHORA - 2 * MIN).toISOString() });
    expect(m.modeloEnUso).toEqual({
      estado: "respaldo",
      modelo: "openai/gpt-6-luna",
      en: new Date(AHORA - 2 * MIN).toISOString(),
      traceId: "t-resp",
    });
  });

  it("modelo en uso: si ningún modelo respondió en el último turno → sin_modelo", async () => {
    const turnos = crearTurnos(db.fuente);
    await turnos.registrar(fila({ iniciadoMs: AHORA - 3 * MIN }));
    await turnos.registrar(fila({ iniciadoMs: AHORA - MIN, resultado: "falla", tipoFalla: "modelo", duracionMs: null, modelo: null, traceId: "t-caido" }));
    // Un bloqueo posterior no cambia el modelo en uso.
    await turnos.registrar(fila({ iniciadoMs: AHORA - 30_000, resultado: "bloqueo", motivoBloqueo: "inyeccion" }));
    expect((await turnos.resumen(AHORA)).modeloEnUso).toEqual({
      estado: "sin_modelo",
      modelo: null,
      en: new Date(AHORA - MIN).toISOString(),
      traceId: "t-caido",
    });
  });

  it("no tiene tope: cuenta más de 2.000 turnos (DevFest ≈ 3.600)", async () => {
    const valores = Array.from({ length: 2500 }, (_, i) => `(${AHORA - 6 * HORA + i}, ${1000 + (i % 10)}, 'ok', 0)`);
    await db.cliente.execute(`INSERT INTO turnos (iniciado_ms, duracion_ms, resultado, respaldo) VALUES ${valores.join(",")}`);
    expect((await crearTurnos(db.fuente).resumen(AHORA)).turnos).toBe(2500);
  });
});
