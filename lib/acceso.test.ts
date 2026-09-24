import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emailValido,
  guardarPerfil,
  identificar,
  MENSAJE_GENERICO,
  obtenerSesion,
  pantallaPara,
  puedeContinuar,
} from "./acceso";

afterEach(() => {
  vi.unstubAllGlobals();
});

function respuestaJson(status: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

describe("pantallaPara", () => {
  it("lleva cada estado de sesión a su pantalla", () => {
    expect(pantallaPara("sin_sesion")).toBe("entrada");
    expect(pantallaPara("nuevo")).toBe("perfil");
    expect(pantallaPara("falta_perfil")).toBe("perfil");
    expect(pantallaPara("listo")).toBe("chat");
  });

  it("un estado desconocido vuelve a la entrada", () => {
    expect(pantallaPara("otro" as never)).toBe("entrada");
  });
});

describe("emailValido", () => {
  it("acepta correos normales, con espacios alrededor", () => {
    expect(emailValido("andrea@ejemplo.com")).toBe(true);
    expect(emailValido("  andrea.paz+charla@ejemplo.com.ec ")).toBe(true);
  });

  it("rechaza vacíos y formatos rotos", () => {
    for (const malo of ["", "   ", "andrea", "andrea@", "@ejemplo.com", "andrea@ejemplo", "an drea@ejemplo.com"]) {
      expect(emailValido(malo)).toBe(false);
    }
  });
});

describe("puedeContinuar", () => {
  it("exige un rol de al menos 2 caracteres sin contar espacios", () => {
    expect(puedeContinuar("")).toBe(false);
    expect(puedeContinuar("  a  ")).toBe(false);
    expect(puedeContinuar(" ab ")).toBe(true);
  });
});

describe("cliente de la API", () => {
  it("obtenerSesion devuelve el cuerpo en éxito", async () => {
    const fetchSimulado = vi.fn().mockResolvedValue(respuestaJson(200, { autenticado: true, estado: "listo", nombre_pila: "Andrea" }));
    vi.stubGlobal("fetch", fetchSimulado);
    const r = await obtenerSesion();
    expect(r).toEqual({ ok: true, datos: { autenticado: true, estado: "listo", nombre_pila: "Andrea" } });
    expect(fetchSimulado).toHaveBeenCalledWith("/api/sesion", expect.objectContaining({ cache: "no-store" }));
  });

  it("identificar envía el email recortado y devuelve el error de la API", async () => {
    const fetchSimulado = vi.fn().mockResolvedValue(respuestaJson(429, { error: "demasiados_intentos", mensaje: "Espera" }));
    vi.stubGlobal("fetch", fetchSimulado);
    const r = await identificar("  andrea@ejemplo.com ");
    expect(r).toEqual({ ok: false, tipo: "http", status: 429, error: "demasiados_intentos", mensaje: "Espera" });
    const [url, init] = fetchSimulado.mock.calls[0];
    expect(url).toBe("/api/identificar");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ email: "andrea@ejemplo.com" });
  });

  it("un fallo de red se informa como tipo 'red'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await identificar("a@b.co")).toEqual({ ok: false, tipo: "red" });
  });

  it("una respuesta que no es JSON usa el mensaje genérico, nunca el texto técnico", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 })));
    expect(await obtenerSesion()).toEqual({
      ok: false,
      tipo: "http",
      status: 502,
      error: "desconocido",
      mensaje: MENSAJE_GENERICO,
    });
  });

  it("guardarPerfil omite la descripción vacía y el nombre cuando no se pide", async () => {
    const fetchSimulado = vi.fn().mockResolvedValue(respuestaJson(200, { ok: true, nombre_pila: "Diego" }));
    vi.stubGlobal("fetch", fetchSimulado);
    await guardarPerfil({ rol: " Contador ", descripcion: "   " });
    expect(JSON.parse(fetchSimulado.mock.calls[0][1].body)).toEqual({ rol: "Contador" });

    await guardarPerfil({ nombre: " Diego Paz ", rol: "Contador", descripcion: " Un agente " });
    expect(JSON.parse(fetchSimulado.mock.calls[1][1].body)).toEqual({
      nombre: "Diego Paz",
      rol: "Contador",
      descripcion: "Un agente",
    });
  });
});
