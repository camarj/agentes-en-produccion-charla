import { afterEach, describe, expect, it, vi } from "vitest";
import { maxMensajesAsistente } from "./chat";

afterEach(() => vi.unstubAllEnvs());

describe("maxMensajesAsistente", () => {
  // DevFest (PRD §15 G6): charlas de 60 minutos → 15 preguntas por persona.
  it("sin MAX_MENSAJES_ASISTENTE el tope es 15 preguntas por persona", () => {
    vi.stubEnv("MAX_MENSAJES_ASISTENTE", "");
    expect(maxMensajesAsistente()).toBe(15);
  });

  it("MAX_MENSAJES_ASISTENTE lo reemplaza; un valor inválido vuelve al tope por defecto", () => {
    vi.stubEnv("MAX_MENSAJES_ASISTENTE", "40");
    expect(maxMensajesAsistente()).toBe(40);
    for (const malo of ["0", "-3", "2.5", "abc"]) {
      vi.stubEnv("MAX_MENSAJES_ASISTENTE", malo);
      expect(maxMensajesAsistente()).toBe(15);
    }
  });
});
