// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PantallaPerfil } from "./pantalla-perfil";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

function respuestaJson(status: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

let fetchSimulado: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSimulado = vi.fn().mockResolvedValue(respuestaJson(200, { ok: true, nombre_pila: "Diego" }));
  vi.stubGlobal("fetch", fetchSimulado);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toastError.mockReset();
});

const rol = () => screen.getByLabelText("¿A qué te dedicas?") as HTMLTextAreaElement;
const descripcion = () => screen.getByLabelText(/¿Qué construyes o quieres construir con IA\?/) as HTMLTextAreaElement;
const continuar = () => screen.getByRole("button", { name: "Continuar" }) as HTMLButtonElement;
const saltar = () => screen.getByRole("button", { name: "Saltar" });
const cuerpoEnviado = (i = 0) => JSON.parse(fetchSimulado.mock.calls[i][1].body);

describe("PantallaPerfil (falta_perfil)", () => {
  it("no pide el nombre y muestra las dos preguntas de Luma", () => {
    render(<PantallaPerfil estado="falta_perfil" nombrePila="Diego" onCompletado={vi.fn()} onSesionExpirada={vi.fn()} />);
    expect(screen.queryByLabelText("¿Cómo te llamas?")).toBeNull();
    expect(rol().placeholder).toBe("Ej.: Contadora en una pyme de retail");
    expect(rol().rows).toBe(2);
    expect(rol().maxLength).toBe(120);
    expect(descripcion().placeholder).toBe("Ej.: Un agente que responda a mis clientes por WhatsApp");
    expect(descripcion().rows).toBe(3);
    expect(descripcion().maxLength).toBe(300);
  });

  it("«Continuar» sigue deshabilitado hasta que el rol tenga 2 caracteres sin espacios", async () => {
    render(<PantallaPerfil estado="falta_perfil" onCompletado={vi.fn()} onSesionExpirada={vi.fn()} />);
    expect(continuar().disabled).toBe(true);
    await userEvent.type(rol(), " a ");
    expect(continuar().disabled).toBe(true);
    await userEvent.type(rol(), "b");
    expect(continuar().disabled).toBe(false);
  });

  it("el contador de la descripción muestra n/300", async () => {
    render(<PantallaPerfil estado="falta_perfil" onCompletado={vi.fn()} onSesionExpirada={vi.fn()} />);
    expect(screen.getByText("0/300")).toBeTruthy();
    await userEvent.type(descripcion(), "Un bot");
    expect(screen.getByText("6/300")).toBeTruthy();
  });

  it("«Continuar» guarda rol y descripción y pasa al chat con el nombre de pila", async () => {
    const onCompletado = vi.fn();
    render(<PantallaPerfil estado="falta_perfil" onCompletado={onCompletado} onSesionExpirada={vi.fn()} />);
    await userEvent.type(rol(), "Contador");
    await userEvent.type(descripcion(), "Un agente");
    await userEvent.click(continuar());
    await waitFor(() => expect(onCompletado).toHaveBeenCalledWith("Diego"));
    expect(fetchSimulado.mock.calls[0][0]).toBe("/api/perfil");
    expect(cuerpoEnviado()).toEqual({ rol: "Contador", descripcion: "Un agente" });
  });

  it("«Saltar» guarda el rol «No indicado»", async () => {
    const onCompletado = vi.fn();
    render(<PantallaPerfil estado="falta_perfil" onCompletado={onCompletado} onSesionExpirada={vi.fn()} />);
    await userEvent.click(saltar());
    await waitFor(() => expect(onCompletado).toHaveBeenCalled());
    expect(cuerpoEnviado()).toEqual({ rol: "No indicado" });
  });

  it("un error de la API se muestra en línea con su mensaje", async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(400, { error: "perfil_invalido", mensaje: "Revisa tu perfil." }));
    const onCompletado = vi.fn();
    render(<PantallaPerfil estado="falta_perfil" onCompletado={onCompletado} onSesionExpirada={vi.fn()} />);
    await userEvent.type(rol(), "Contador");
    await userEvent.click(continuar());
    expect((await screen.findByRole("alert")).textContent).toContain("Revisa tu perfil.");
    expect(onCompletado).not.toHaveBeenCalled();
  });

  it("un error de red se muestra en línea, sin texto técnico", async () => {
    fetchSimulado.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<PantallaPerfil estado="falta_perfil" onCompletado={vi.fn()} onSesionExpirada={vi.fn()} />);
    await userEvent.type(rol(), "Contador");
    await userEvent.click(continuar());
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toMatch(/conexión/);
    expect(alerta.textContent).not.toMatch(/fetch/i);
  });

  it("una sesión vencida (401) devuelve a la entrada", async () => {
    fetchSimulado.mockResolvedValue(respuestaJson(401, { error: "no_autenticado", mensaje: "Tu sesión expiró." }));
    const onSesionExpirada = vi.fn();
    render(<PantallaPerfil estado="falta_perfil" onCompletado={vi.fn()} onSesionExpirada={onSesionExpirada} />);
    await userEvent.click(saltar());
    await waitFor(() => expect(onSesionExpirada).toHaveBeenCalled());
  });

  it("el rol se ajusta a su contenido", () => {
    render(<PantallaPerfil estado="falta_perfil" onCompletado={vi.fn()} onSesionExpirada={vi.fn()} />);
    Object.defineProperty(rol(), "scrollHeight", { configurable: true, value: 97 });
    fireEvent.change(rol(), { target: { value: "Una línea\nOtra línea\nY otra más" } });
    expect(rol().style.height).toBe("97px");
  });
});

describe("PantallaPerfil (nuevo)", () => {
  const nombre = () => screen.getByLabelText("¿Cómo te llamas?") as HTMLInputElement;

  it("pide el nombre arriba del rol", () => {
    render(<PantallaPerfil estado="nuevo" onCompletado={vi.fn()} onSesionExpirada={vi.fn()} />);
    const campos = screen.getAllByRole("textbox");
    expect(campos[0]).toBe(nombre());
    expect(nombre().required).toBe(true);
  });

  it("«Continuar» sin nombre marca el error y no envía", async () => {
    render(<PantallaPerfil estado="nuevo" onCompletado={vi.fn()} onSesionExpirada={vi.fn()} />);
    await userEvent.type(rol(), "Contadora");
    await userEvent.click(continuar());
    expect(nombre().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Cuéntanos tu nombre para continuar.")).toBeTruthy();
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it("«Saltar» solo omite el rol: sin nombre no avanza", async () => {
    render(<PantallaPerfil estado="nuevo" onCompletado={vi.fn()} onSesionExpirada={vi.fn()} />);
    await userEvent.click(saltar());
    expect(nombre().getAttribute("aria-invalid")).toBe("true");
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it("«Saltar» con nombre guarda el nombre y el rol «No indicado»", async () => {
    const onCompletado = vi.fn();
    render(<PantallaPerfil estado="nuevo" onCompletado={onCompletado} onSesionExpirada={vi.fn()} />);
    await userEvent.type(nombre(), "Diego Paz");
    await userEvent.click(saltar());
    await waitFor(() => expect(onCompletado).toHaveBeenCalledWith("Diego"));
    expect(cuerpoEnviado()).toEqual({ nombre: "Diego Paz", rol: "No indicado" });
  });

  it("«Continuar» con nombre y rol envía los dos", async () => {
    render(<PantallaPerfil estado="nuevo" onCompletado={vi.fn()} onSesionExpirada={vi.fn()} />);
    await userEvent.type(nombre(), "Diego");
    await userEvent.type(rol(), "Contador");
    await userEvent.click(continuar());
    await waitFor(() => expect(fetchSimulado).toHaveBeenCalled());
    expect(cuerpoEnviado()).toEqual({ nombre: "Diego", rol: "Contador" });
  });
});
