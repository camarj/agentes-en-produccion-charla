// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PantallaEntrada } from "./pantalla-entrada";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

function respuestaJson(status: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

let fetchSimulado: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSimulado = vi.fn();
  vi.stubGlobal("fetch", fetchSimulado);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toastError.mockReset();
});

function campoEmail() {
  return screen.getByLabelText("Tu email de registro") as HTMLInputElement;
}

describe("PantallaEntrada", () => {
  it("muestra los textos de la charla y un input de email accesible", () => {
    render(<PantallaEntrada onIdentificado={vi.fn()} />);
    expect(screen.getByText("Charla · Inteliside")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Inteliside" }).getAttribute("src")).toContain("inteliside-logo");
    expect(screen.getByRole("heading", { level: 1, name: "Cómo lograr que tus agentes sobrevivan a producción" })).toBeTruthy();
    expect(screen.getByText("Pregúntale al asistente cualquier cosa de la charla.")).toBeTruthy();
    expect(screen.getByText("Usamos tu email solo para personalizar las respuestas durante la charla.")).toBeTruthy();
    const input = campoEmail();
    expect(input.type).toBe("email");
    expect(input.getAttribute("inputmode")).toBe("email");
    expect(input.getAttribute("autocomplete")).toBe("email");
    expect(input.getAttribute("autocapitalize")).toBe("none");
    expect(input.getAttribute("spellcheck")).toBe("false");
  });

  it("con Enter envía el email y avisa el resultado", async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(200, { estado: "listo", nombre_pila: "Andrea" }));
    const onIdentificado = vi.fn();
    render(<PantallaEntrada onIdentificado={onIdentificado} />);
    await userEvent.type(campoEmail(), "andrea@ejemplo.com{Enter}");
    await waitFor(() => expect(onIdentificado).toHaveBeenCalledWith({ estado: "listo", nombre_pila: "Andrea" }));
    expect(JSON.parse(fetchSimulado.mock.calls[0][1].body)).toEqual({ email: "andrea@ejemplo.com" });
  });

  it("mientras envía deshabilita el input y el botón muestra que está ocupado", async () => {
    let resolver: (r: Response) => void = () => {};
    fetchSimulado.mockReturnValue(new Promise<Response>((r) => (resolver = r)));
    render(<PantallaEntrada onIdentificado={vi.fn()} />);
    await userEvent.type(campoEmail(), "andrea@ejemplo.com");
    await userEvent.click(screen.getByRole("button", { name: /Entrar/ }));
    expect(campoEmail().disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Entrar/ }).getAttribute("aria-busy")).toBe("true");
    resolver(respuestaJson(200, { estado: "nuevo" }));
    await waitFor(() => expect(campoEmail().disabled).toBe(false));
  });

  it("un email mal escrito se marca bajo el input sin llamar a la API", async () => {
    render(<PantallaEntrada onIdentificado={vi.fn()} />);
    await userEvent.type(campoEmail(), "andrea@ejemplo{Enter}");
    const input = campoEmail();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const mensaje = screen.getByText("Revisa tu correo: no parece una dirección válida.");
    expect(input.getAttribute("aria-describedby")).toContain(mensaje.id);
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it("un 400 de la API muestra su mensaje bajo el input con aria-invalid", async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(400, { error: "email_invalido", mensaje: "Revisa tu correo: no parece una dirección válida." }));
    render(<PantallaEntrada onIdentificado={vi.fn()} />);
    await userEvent.type(campoEmail(), "andrea@ejemplo.c{Enter}");
    await screen.findByText("Revisa tu correo: no parece una dirección válida.");
    expect(campoEmail().getAttribute("aria-invalid")).toBe("true");
  });

  it("al corregir el email se quita el error", async () => {
    render(<PantallaEntrada onIdentificado={vi.fn()} />);
    await userEvent.type(campoEmail(), "mal{Enter}");
    expect(campoEmail().getAttribute("aria-invalid")).toBe("true");
    await userEvent.type(campoEmail(), "@ejemplo.com");
    expect(campoEmail().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("un 429 muestra «Demasiados intentos, espera un minuto»", async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(429, { error: "demasiados_intentos", mensaje: "x" }));
    const onIdentificado = vi.fn();
    render(<PantallaEntrada onIdentificado={onIdentificado} />);
    await userEvent.type(campoEmail(), "andrea@ejemplo.com{Enter}");
    expect((await screen.findByRole("alert")).textContent).toContain("Demasiados intentos, espera un minuto");
    expect(onIdentificado).not.toHaveBeenCalled();
  });

  it("un 500 muestra el mensaje en español de la API, sin detalles técnicos", async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(500, { error: "error_interno", mensaje: "Algo salió mal. Intenta de nuevo en un momento." }));
    render(<PantallaEntrada onIdentificado={vi.fn()} />);
    await userEvent.type(campoEmail(), "andrea@ejemplo.com{Enter}");
    expect((await screen.findByRole("alert")).textContent).toContain("Algo salió mal. Intenta de nuevo en un momento.");
  });

  it("un error de red abre un toast con «Reintentar» que vuelve a enviar", async () => {
    fetchSimulado.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchSimulado.mockResolvedValueOnce(respuestaJson(200, { estado: "falta_perfil", nombre_pila: "Diego" }));
    const onIdentificado = vi.fn();
    render(<PantallaEntrada onIdentificado={onIdentificado} />);
    await userEvent.type(campoEmail(), "diego@ejemplo.com{Enter}");
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const [texto, opciones] = toastError.mock.calls[0];
    expect(texto).not.toMatch(/fetch/i);
    expect(opciones.action.label).toBe("Reintentar");
    expect(campoEmail().disabled).toBe(false);

    opciones.action.onClick();
    await waitFor(() => expect(onIdentificado).toHaveBeenCalledWith({ estado: "falta_perfil", nombre_pila: "Diego" }));
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
  });
});
