import { describe, expect, it } from "vitest";
import type { FilaTurno } from "@/lib/db/turnos";
import { eventosDeTurno } from "./registro";

const OK: FilaTurno = {
  iniciadoMs: 1,
  duracionMs: 2000,
  resultado: "ok",
  tipoFalla: null,
  motivoBloqueo: null,
  modelo: "gemini-3.8-flash",
  respaldo: false,
  traceId: "t-1",
};

describe("eventosDeTurno: qué eventos de salud deja un turno", () => {
  it("respuesta normal del principal → solo recuperaciones (se anotan si antes hubo falla)", () => {
    expect(eventosDeTurno({ fila: OK, senales: {}, detectorFallo: false })).toEqual([
      { tipo: "gemini_recuperado", recuperacion: true },
      { tipo: "openai_recuperado", recuperacion: true },
    ]);
  });

  it("respondió el respaldo: el evento dice por qué se activó el respaldo (límite de uso, 503 simulado o falla real)", () => {
    const fila = { ...OK, respaldo: true, modelo: "openai/gpt-6-luna" };
    const tipos = (causa: "limite_uso" | "sobrecarga" | null) =>
      eventosDeTurno({ fila, senales: { respaldo: { modelo: "openai/gpt-6-luna", causa } }, detectorFallo: false }).map((e) => e.tipo);
    expect(tipos("limite_uso")).toEqual(["gemini_limite_uso", "openai_recuperado"]);
    expect(tipos("sobrecarga")).toEqual(["gemini_sobrecarga", "openai_recuperado"]);
    expect(tipos(null)).toEqual(["gemini_fallo", "openai_recuperado"]);
  });

  it("fallaron los dos modelos → modelos_caidos", () => {
    const fila: FilaTurno = { ...OK, resultado: "falla", tipoFalla: "modelo", duracionMs: null, modelo: null };
    expect(eventosDeTurno({ fila, senales: { modelosCaidosSimulado: true }, detectorFallo: false })).toEqual([{ tipo: "modelos_caidos", recuperacion: false }]);
  });

  it("búsqueda con reintentos o agotada, falla abierta del alcance y falla cerrada del detector", () => {
    const fila: FilaTurno = { ...OK, resultado: "falla", tipoFalla: "herramienta" };
    expect(eventosDeTurno({ fila, senales: { busqueda: { intentos: 3, agotada: true }, alcanceFallaAbierta: true }, detectorFallo: false }).map((e) => e.tipo)).toEqual([
      "gemini_recuperado",
      "openai_recuperado",
      "busqueda_agotada",
      "alcance_falla_abierta",
    ]);
    expect(eventosDeTurno({ fila: OK, senales: { busqueda: { intentos: 2, agotada: false } }, detectorFallo: false }).map((e) => e.tipo)).toContain("busqueda_reintentos");
    const bloqueo: FilaTurno = { ...OK, resultado: "bloqueo", motivoBloqueo: "inyeccion", modelo: null };
    expect(eventosDeTurno({ fila: bloqueo, senales: {}, detectorFallo: true })).toEqual([{ tipo: "detector_falla_cerrada", recuperacion: false }]);
  });
});
