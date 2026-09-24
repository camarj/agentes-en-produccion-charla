// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VistaJev } from "@/lib/jev/vista";
import { emojiConfusion, SalaEnVivo } from "./sala-en-vivo";

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

const VACIA: VistaJev = {
  jev_disponible: true,
  total_analisis: 0,
  latencia_media_ms: null,
  tarjetas: [],
  temas: [],
  termometro: { porcentaje: null, turnos: 0, mas_confunde: null },
  destacadas: [],
  actualizado_en: "2026-09-25T20:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SalaEnVivo", () => {
  it("estado vacío", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(VACIA)));
    render(<SalaEnVivo />);
    expect(await screen.findByText("Esperando preguntas de la sala…")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Jev · la sala en vivo");
  });

  it("con tarjetas y Jev caído: muestra lo guardado y el aviso, sin errores técnicos", async () => {
    const vista: VistaJev = {
      ...VACIA,
      jev_disponible: false,
      total_analisis: 1,
      latencia_media_ms: 180,
      tarjetas: [
        {
          traceId: "t1",
          en: "2026-09-25T19:59:00.000Z",
          pregunta: "¿Qué es un eval?",
          tema: "Evals",
          intencion: "Entender un concepto",
          confusion: 0.25,
          lineas: [{ tipo: "no_respaldada", probabilidad: 0.3 }, { tipo: "respaldo" }],
          latenciaMs: 180,
        },
      ],
      temas: [{ tema: "Evals", turnos: 1 }],
      termometro: { porcentaje: 25, turnos: 1, mas_confunde: "Evals" },
    };
    vi.stubGlobal("fetch", vi.fn(async () => json(vista)));
    render(<SalaEnVivo />);
    expect(await screen.findByText("«¿Qué es un eval?»")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Jev no disponible por ahora");
    expect(screen.getByText(/dijo algo que no está en la charla/)).toBeTruthy();
    expect(screen.getByText("🔁 respondió el respaldo")).toBeTruthy();
    expect(screen.getByText(/180 ms/, { selector: "p" })).toBeTruthy();
  });

  it("si la API falla, avisa sin mostrar detalles técnicos", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "error_interno" }, 500)));
    render(<SalaEnVivo />);
    expect((await screen.findByText("Sin conexión · reintentando")).textContent).not.toMatch(/500|HTTP/);
  });
});

describe("emojiConfusion", () => {
  it("de entiende a perdido; null sin emoji", () => {
    expect([0, 0.3, 0.5, 0.7, 0.95].map(emojiConfusion)).toEqual(["😎", "🙂", "🤔", "😕", "😵"]);
    expect(emojiConfusion(null)).toBeNull();
  });
});
