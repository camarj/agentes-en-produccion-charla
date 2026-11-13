// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENTE_ID_PRUEBA, instalarGoogleSimulado } from "@/lib/prueba-google";
import { PantallaEntrada } from "./pantalla-entrada";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

function respuestaJson(status: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

let fetchSimulado: ReturnType<typeof vi.fn>;
let google: ReturnType<typeof instalarGoogleSimulado>;

beforeEach(() => {
  fetchSimulado = vi.fn();
  vi.stubGlobal("fetch", fetchSimulado);
  google = instalarGoogleSimulado("cred-andrea");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  toastError.mockReset();
});

const botonGoogle = () => screen.findByRole("button", { name: "Continuar con Google" });

describe("PantallaEntrada", () => {
  it("muestra los textos de la charla y el botón de Google, sin campo de email", async () => {
    render(<PantallaEntrada onIdentificado={vi.fn()} />);
    expect(screen.getByText("Charla · Inteliside")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Inteliside" }).getAttribute("src")).toContain("inteliside-logo");
    expect(screen.getByRole("heading", { level: 1, name: "Cómo lograr que tus agentes sobrevivan a producción" })).toBeTruthy();
    expect(screen.getByText("Pregúntale al asistente cualquier cosa de la charla.")).toBeTruthy();
    expect(screen.getByText("Usamos tu cuenta de Google solo para saber quién eres y personalizar las respuestas durante la charla.")).toBeTruthy();
    expect(await botonGoogle()).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("inicializa Google con nuestro client id, en ventana emergente y en español", async () => {
    render(<PantallaEntrada onIdentificado={vi.fn()} />);
    await botonGoogle();
    expect(google.initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: CLIENTE_ID_PRUEBA, ux_mode: "popup" }));
    expect(google.renderButton.mock.calls[0][1]).toMatchObject({ locale: "es", text: "continue_with" });
  });

  it("al elegir la cuenta envía la credencial de Google y avisa el resultado", async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(200, { estado: "listo", nombre_pila: "Andrea" }));
    const onIdentificado = vi.fn();
    render(<PantallaEntrada onIdentificado={onIdentificado} />);
    await userEvent.click(await botonGoogle());
    await waitFor(() => expect(onIdentificado).toHaveBeenCalledWith({ estado: "listo", nombre_pila: "Andrea" }));
    const [url, init] = fetchSimulado.mock.calls[0];
    expect(url).toBe("/api/identificar");
    expect(JSON.parse(init.body)).toEqual({ credencial: "cred-andrea" });
  });

  it("mientras envía muestra que está ocupado", async () => {
    let resolver: (r: Response) => void = () => {};
    fetchSimulado.mockReturnValue(new Promise<Response>((r) => (resolver = r)));
    render(<PantallaEntrada onIdentificado={vi.fn()} />);
    await userEvent.click(await botonGoogle());
    expect(await screen.findByText("Entrando…")).toBeTruthy();
    resolver(respuestaJson(200, { estado: "nuevo" }));
    await waitFor(() => expect(screen.queryByText("Entrando…")).toBeNull());
  });

  it("un 429 muestra «Demasiados intentos, espera un minuto»", async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(429, { error: "demasiados_intentos", mensaje: "x" }));
    const onIdentificado = vi.fn();
    render(<PantallaEntrada onIdentificado={onIdentificado} />);
    await userEvent.click(await botonGoogle());
    expect((await screen.findByRole("alert")).textContent).toContain("Demasiados intentos, espera un minuto");
    expect(onIdentificado).not.toHaveBeenCalled();
  });

  it("una credencial rechazada (401) o un 500 muestra el mensaje en español de la API", async () => {
    for (const [status, mensaje] of [
      [401, "No pudimos confirmar tu cuenta de Google. Intenta de nuevo."],
      [500, "Algo salió mal. Intenta de nuevo en un momento."],
    ] as const) {
      fetchSimulado.mockResolvedValueOnce(respuestaJson(status, { error: "x", mensaje }));
      render(<PantallaEntrada onIdentificado={vi.fn()} />);
      await userEvent.click(await botonGoogle());
      expect((await screen.findByRole("alert")).textContent).toContain(mensaje);
      cleanup();
    }
  });

  it("un error de red abre un toast con «Reintentar» que vuelve a enviar la misma credencial", async () => {
    fetchSimulado.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchSimulado.mockResolvedValueOnce(respuestaJson(200, { estado: "falta_perfil", nombre_pila: "Diego" }));
    const onIdentificado = vi.fn();
    render(<PantallaEntrada onIdentificado={onIdentificado} />);
    await userEvent.click(await botonGoogle());
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const [texto, opciones] = toastError.mock.calls[0];
    expect(texto).not.toMatch(/fetch/i);
    expect(opciones.action.label).toBe("Reintentar");

    opciones.action.onClick();
    await waitFor(() => expect(onIdentificado).toHaveBeenCalledWith({ estado: "falta_perfil", nombre_pila: "Diego" }));
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchSimulado.mock.calls[1][1].body)).toEqual({ credencial: "cred-andrea" });
  });

  it("enlaza la política de privacidad", () => {
    render(<PantallaEntrada onIdentificado={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Política de privacidad" }).getAttribute("href")).toBe("/privacidad");
  });

  it("sin client id configurado avisa que el acceso con Google no está disponible", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "");
    render(<PantallaEntrada onIdentificado={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("No pudimos cargar el acceso con Google");
  });
});
