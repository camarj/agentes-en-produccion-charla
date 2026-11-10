import { describe, expect, it } from "vitest";
import { filaDeTurno, type DatosFinTurno } from "./fin-turno";

const INICIO = Date.parse("2026-12-05T19:00:00.000Z");

function datos(d: Partial<DatosFinTurno> = {}): DatosFinTurno {
  return {
    iniciadoMs: INICIO,
    finMs: INICIO + 2500,
    desenlace: { motivoBloqueo: null, error: null },
    senales: {},
    modeloRespuesta: "gemini-3.8-flash",
    abortado: false,
    traceId: "t-1",
    ...d,
  };
}

describe("filaDeTurno: cómo cerró un turno de chat", () => {
  it("respuesta del principal → ok, con duración y modelo", () => {
    expect(filaDeTurno(datos())).toEqual({
      iniciadoMs: INICIO,
      duracionMs: 2500,
      resultado: "ok",
      tipoFalla: null,
      motivoBloqueo: null,
      modelo: "gemini-3.8-flash",
      respaldo: false,
      traceId: "t-1",
    });
  });

  it("respondió el respaldo → ok con respaldo y el modelo del respaldo", () => {
    const f = filaDeTurno(datos({ senales: { respaldo: { modelo: "openai/gpt-6-luna", causa: "limite_uso" } }, modeloRespuesta: "gpt-6-luna" }));
    expect(f).toMatchObject({ resultado: "ok", respaldo: true, modelo: "openai/gpt-6-luna", duracionMs: 2500 });
  });

  it("bloqueo → resultado bloqueo con su motivo y sin modelo", () => {
    const f = filaDeTurno(datos({ desenlace: { motivoBloqueo: "fuera_de_alcance", error: null } }));
    expect(f).toMatchObject({ resultado: "bloqueo", motivoBloqueo: "fuera_de_alcance", tipoFalla: null, modelo: null });
  });

  it("buscar_laminas agotó sus intentos pero el agente respondió → falla de herramienta con duración", () => {
    const f = filaDeTurno(datos({ senales: { busqueda: { intentos: 3, agotada: true } } }));
    expect(f).toMatchObject({ resultado: "falla", tipoFalla: "herramienta", duracionMs: 2500, modelo: "gemini-3.8-flash" });
  });

  it("fallaron los modelos → falla de modelo, sin duración ni modelo", () => {
    const f = filaDeTurno(datos({ desenlace: { motivoBloqueo: null, error: "proveedor" }, modeloRespuesta: null }));
    expect(f).toMatchObject({ resultado: "falla", tipoFalla: "modelo", duracionMs: null, modelo: null, respaldo: false });
  });

  it("turno cortado por el tope de tiempo o la cancelación → falla de tiempo", () => {
    const f = filaDeTurno(datos({ desenlace: { motivoBloqueo: null, error: "otro" }, abortado: true }));
    expect(f).toMatchObject({ resultado: "falla", tipoFalla: "tiempo", duracionMs: null });
  });

  it("otro error → falla otro", () => {
    expect(filaDeTurno(datos({ desenlace: { motivoBloqueo: null, error: "otro" } }))).toMatchObject({ resultado: "falla", tipoFalla: "otro" });
  });

  it("el turno nunca terminó (sin desenlace) → falla de tiempo", () => {
    expect(filaDeTurno(datos({ desenlace: null, finMs: null }))).toMatchObject({ resultado: "falla", tipoFalla: "tiempo", duracionMs: null });
  });
});
