import { describe, expect, it, vi } from "vitest";
import { crearAsistentes } from "../lib/db/asistentes";
import { crearDbTemporal } from "../lib/db/prueba";
import { crearSesiones } from "../lib/db/sesiones";
import { NOMBRE_COOKIE, verificarToken } from "../lib/session";
import { analizarTrozo, cookieDePrueba, emailPrueba, percentil } from "./carga";

describe("carga", () => {
  it("calcula percentiles por rango más cercano", () => {
    expect(percentil([], 95)).toBeNull();
    expect(percentil([3, 1, 2, 4], 50)).toBe(2);
    expect(percentil(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
    expect(percentil([7], 95)).toBe(7);
  });

  it("detecta texto y errores en el stream de AI SDK UI", () => {
    expect(analizarTrozo('data: {"type":"start"}\n\ndata: {"type":"text-delta","id":"1","delta":"Hola"}')).toEqual({
      texto: true,
      error: false,
    });
    expect(analizarTrozo('data: {"type":"error","errorText":"x"}')).toEqual({ texto: false, error: true });
  });

  it("usa emails de prueba reconocibles", () => {
    expect(emailPrueba(7)).toBe("carga+7@carga.example.com");
  });
});

describe("cookieDePrueba", () => {
  it("crea al asistente de prueba y una sesión válida firmada; al repetir reutiliza al asistente y revoca la anterior", async () => {
    vi.stubEnv("SESSION_SECRET", "secreto-de-prueba-0123456789");
    const db = await crearDbTemporal();
    try {
      const primera = await cookieDePrueba(db.cliente, 7);
      const segunda = await cookieDePrueba(db.cliente, 7);
      const token = (cookie: string) => verificarToken(cookie.slice(`${NOMBRE_COOKIE}=`.length));
      const sesiones = crearSesiones(db.fuente);
      expect(await sesiones.obtener(token(primera)!)).toBeNull();
      const activa = await sesiones.obtener(token(segunda)!);
      const asistente = await crearAsistentes(db.fuente).buscarPorEmail(emailPrueba(7));
      expect(activa?.asistenteId).toBe(asistente?.id);
    } finally {
      db.cerrar();
      vi.unstubAllEnvs();
    }
  });
});
