// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "./page";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
// El chat (T11) tiene sus propios tests; aquí solo importa el ruteo.
vi.mock("@/components/chat/pantalla-chat", () => ({
  PantallaChat: ({ nombrePila, onSesionExpirada }: { nombrePila?: string; onSesionExpirada: () => void }) => (
    <div>
      <h1>{nombrePila ? `Hola, ${nombrePila}` : "Hola"}</h1>
      <button onClick={onSesionExpirada}>simular 401</button>
    </div>
  ),
}));

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
});

function sesion(cuerpo: unknown) {
  fetchSimulado.mockResolvedValueOnce(respuestaJson(200, cuerpo));
}

describe("página principal: ruteo por sesión", () => {
  it("mientras revisa la sesión muestra un esqueleto de carga", () => {
    fetchSimulado.mockReturnValue(new Promise(() => {}));
    render(<Home />);
    expect(screen.getByRole("status", { name: "Cargando" })).toBeTruthy();
    expect(fetchSimulado).toHaveBeenCalledWith("/api/sesion", expect.anything());
  });

  it("sin sesión muestra la entrada", async () => {
    sesion({ autenticado: false, estado: "sin_sesion" });
    render(<Home />);
    expect(await screen.findByLabelText("Tu email de registro")).toBeTruthy();
  });

  it("nuevo muestra el perfil con el nombre", async () => {
    sesion({ autenticado: true, estado: "nuevo" });
    render(<Home />);
    expect(await screen.findByLabelText("¿Cómo te llamas?")).toBeTruthy();
    expect(screen.getByLabelText("¿A qué te dedicas?")).toBeTruthy();
  });

  it("falta_perfil muestra el perfil sin el nombre", async () => {
    sesion({ autenticado: true, estado: "falta_perfil", nombre_pila: "Diego" });
    render(<Home />);
    expect(await screen.findByLabelText("¿A qué te dedicas?")).toBeTruthy();
    expect(screen.queryByLabelText("¿Cómo te llamas?")).toBeNull();
  });

  it("listo (p. ej., al recargar con sesión válida) va directo al chat", async () => {
    sesion({ autenticado: true, estado: "listo", nombre_pila: "Andrea" });
    render(<Home />);
    expect(await screen.findByRole("heading", { name: "Hola, Andrea" })).toBeTruthy();
  });

  it("si no puede revisar la sesión, muestra la entrada", async () => {
    fetchSimulado.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<Home />);
    expect(await screen.findByLabelText("Tu email de registro")).toBeTruthy();
  });
});

describe("página principal: transiciones sin recargar", () => {
  it("entrada → perfil nuevo → chat en la misma página", async () => {
    sesion({ autenticado: false, estado: "sin_sesion" });
    fetchSimulado.mockResolvedValueOnce(respuestaJson(200, { estado: "nuevo" }));
    fetchSimulado.mockResolvedValueOnce(respuestaJson(200, { ok: true, nombre_pila: "Zoe" }));
    render(<Home />);

    await userEvent.type(await screen.findByLabelText("Tu email de registro"), "zoe@ejemplo.com{Enter}");
    await userEvent.type(await screen.findByLabelText("¿Cómo te llamas?"), "Zoe Ruiz");
    await userEvent.type(screen.getByLabelText("¿A qué te dedicas?"), "Diseñadora");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("heading", { name: "Hola, Zoe" })).toBeTruthy();
    // Una recarga volvería a pedir /api/sesion: solo se pidió al abrir.
    expect(fetchSimulado.mock.calls.map((c) => c[0])).toEqual(["/api/sesion", "/api/identificar", "/api/perfil"]);
  });

  it("entrada con un inscrito que ya tiene rol → chat directo", async () => {
    sesion({ autenticado: false, estado: "sin_sesion" });
    fetchSimulado.mockResolvedValueOnce(respuestaJson(200, { estado: "listo", nombre_pila: "Andrea" }));
    render(<Home />);
    await userEvent.type(await screen.findByLabelText("Tu email de registro"), "andrea@ejemplo.com{Enter}");
    expect(await screen.findByRole("heading", { name: "Hola, Andrea" })).toBeTruthy();
  });

  it("chat con sesión vencida (401) vuelve a la entrada", async () => {
    sesion({ autenticado: true, estado: "listo", nombre_pila: "Andrea" });
    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: "simular 401" }));
    expect(await screen.findByLabelText("Tu email de registro")).toBeTruthy();
  });

  it("perfil con sesión vencida vuelve a la entrada", async () => {
    sesion({ autenticado: true, estado: "falta_perfil", nombre_pila: "Diego" });
    fetchSimulado.mockResolvedValueOnce(respuestaJson(401, { error: "no_autenticado", mensaje: "Tu sesión expiró." }));
    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: "Saltar" }));
    await waitFor(() => expect(screen.getByLabelText("Tu email de registro")).toBeTruthy());
  });
});
