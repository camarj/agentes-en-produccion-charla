// Guardrails falsos (detector de inyección y clasificador de alcance) para los
// tests. Solo se usan en tests.
import { vi } from "vitest";
import type { Clasificacion, Clasificador } from "./alcance-charla";
import { modeloFalso, type LlamadaModelo } from "./pruebas-modelo";

export const INYECCION = { categories: [{ type: "injection", score: 0.96 }], reason: "x" };
export const LIMPIO = { categories: [], reason: null };

// Modelo del PromptInjectionDetector: responde `decidir(prompt)` tras `demoraMs`.
export function detectorFalso(decidir: (prompt: string) => unknown, demoraMs = 0) {
  const falso = modeloFalso("openai/gpt-6-luna", (l: LlamadaModelo) => ({
    texto: JSON.stringify(decidir(JSON.stringify(l.prompt))),
  }));
  const base = falso.modelo.doGenerate;
  falso.modelo.doGenerate = async (o) => {
    await new Promise((r) => setTimeout(r, demoraMs));
    return base(o);
  };
  return falso;
}

// Modelo que siempre falla (red caída).
export function modeloQueFalla() {
  const falso = modeloFalso("openai/gpt-6-luna", () => ({ texto: "" }));
  falso.modelo.doGenerate = async () => {
    throw new Error("red caída");
  };
  return falso;
}

export function clasificadorFalso(resultado: (texto: string) => Clasificacion, demoraMs = 0) {
  return vi.fn<Clasificador>(async (texto) => {
    await new Promise((r) => setTimeout(r, demoraMs));
    return resultado(texto);
  });
}
