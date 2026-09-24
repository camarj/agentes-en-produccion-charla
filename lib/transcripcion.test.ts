import { describe, expect, it } from "vitest";
import { DURACION_MAXIMA_DICTADO_S, TAMANO_MAXIMO_AUDIO, elegirTipoAudio, formatoDeAudio } from "./transcripcion";

describe("formatoDeAudio", () => {
  it.each([
    ["audio/webm;codecs=opus", "webm"],
    ["audio/webm", "webm"],
    ["audio/mp4", "mp4"],
    ["audio/mp4;codecs=mp4a.40.2", "mp4"],
    ["audio/x-m4a", "m4a"],
    ["audio/m4a", "m4a"],
    ["audio/mpeg", "mp3"],
    ["audio/wav", "wav"],
    ["audio/x-wav", "wav"],
    ["AUDIO/WEBM; codecs=opus", "webm"],
  ])("%s → %s", (tipo, formato) => {
    expect(formatoDeAudio(tipo)).toBe(formato);
  });

  it.each([null, "", "application/json", "text/plain", "audio/ogg", "video/mp4", "multipart/form-data"])(
    "%s no es un audio aceptado",
    (tipo) => {
      expect(formatoDeAudio(tipo)).toBeNull();
    },
  );
});

describe("elegirTipoAudio", () => {
  it("Chrome/Android: webm con opus", () => {
    expect(elegirTipoAudio((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
  });

  it("iOS Safari: mp4 (AAC)", () => {
    expect(elegirTipoAudio((t) => t.startsWith("audio/mp4"))).toBe("audio/mp4");
  });

  it("sin ninguno soportado: undefined (el navegador elige)", () => {
    expect(elegirTipoAudio(() => false)).toBeUndefined();
  });
});

describe("límites", () => {
  it("60 s por dictado y ~5 MB por audio", () => {
    expect(DURACION_MAXIMA_DICTADO_S).toBe(60);
    expect(TAMANO_MAXIMO_AUDIO).toBe(5 * 1024 * 1024);
  });
});
