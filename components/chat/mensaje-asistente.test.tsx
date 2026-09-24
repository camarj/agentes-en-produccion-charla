// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MensajeAsistente } from "./mensaje-asistente";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

let fetchSimulado: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSimulado = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchSimulado);
  toastError.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const texto = (t: string) => [{ type: "text" as const, text: t }];

describe("MensajeAsistente", () => {
  it("renderiza Markdown (negritas, listas, código)", () => {
    render(<MensajeAsistente partes={texto("Es **clave**:\n\n- uno\n- dos\n\n`codigo`")} terminado onSesionExpirada={vi.fn()} />);
    expect(screen.getByText("clave").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("codigo").tagName).toBe("CODE");
  });

  it("«lámina N» se muestra como chip mono", () => {
    render(<MensajeAsistente partes={texto("El harness rodea al modelo (lámina 11).")} terminado onSesionExpirada={vi.fn()} />);
    const chip = screen.getByText("lámina 11");
    expect(chip.getAttribute("data-lamina")).toBe("");
    expect(chip.className).toContain("font-mono");
  });

  it("sin acciones mientras el stream sigue", () => {
    render(<MensajeAsistente partes={texto("Hola")} traceId="t1" terminado={false} onSesionExpirada={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Copiar" })).toBeNull();
  });

  it("copiar confirma con «Copiado»", async () => {
    const escribir = vi.fn(async () => {});
    render(<MensajeAsistente partes={texto("Respuesta **útil**")} traceId="t1" terminado onSesionExpirada={vi.fn()} />);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: escribir } });
    await userEvent.click(screen.getByRole("button", { name: "Copiar" }));
    expect(escribir).toHaveBeenCalledWith("Respuesta **útil**");
    expect(await screen.findByRole("button", { name: "Copiado" })).toBeTruthy();
  });

  it("pulgar arriba envía el trace_id y queda marcado; cambiar de opinión envía -1", async () => {
    render(<MensajeAsistente partes={texto("Hola")} traceId="traza-9" terminado onSesionExpirada={vi.fn()} />);
    const arriba = screen.getByRole("button", { name: "Me sirvió" });
    const abajo = screen.getByRole("button", { name: "No me sirvió" });
    await userEvent.click(arriba);
    expect(fetchSimulado).toHaveBeenCalledWith("/api/feedback", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchSimulado.mock.calls[0][1].body)).toEqual({ trace_id: "traza-9", valor: 1 });
    await waitFor(() => expect(arriba.getAttribute("aria-pressed")).toBe("true"));
    expect(abajo.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(abajo);
    expect(JSON.parse(fetchSimulado.mock.calls[1][1].body)).toEqual({ trace_id: "traza-9", valor: -1 });
    await waitFor(() => expect(abajo.getAttribute("aria-pressed")).toBe("true"));
    expect(arriba.getAttribute("aria-pressed")).toBe("false");
  });

  it("si el voto falla, se desmarca y avisa en español", async () => {
    fetchSimulado.mockResolvedValueOnce(new Response(JSON.stringify({ error: "error_interno", mensaje: "Algo salió mal." }), { status: 500 }));
    render(<MensajeAsistente partes={texto("Hola")} traceId="t" terminado onSesionExpirada={vi.fn()} />);
    const arriba = screen.getByRole("button", { name: "Me sirvió" });
    await userEvent.click(arriba);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No pudimos registrar tu valoración. Intenta de nuevo."));
    expect(arriba.getAttribute("aria-pressed")).toBe("false");
  });

  it("voto con la sesión vencida → vuelve a la entrada", async () => {
    fetchSimulado.mockResolvedValueOnce(new Response(JSON.stringify({ error: "no_autenticado", mensaje: "Tu sesión expiró." }), { status: 401 }));
    const onSesionExpirada = vi.fn();
    render(<MensajeAsistente partes={texto("Hola")} traceId="t" terminado onSesionExpirada={onSesionExpirada} />);
    await userEvent.click(screen.getByRole("button", { name: "Me sirvió" }));
    await waitFor(() => expect(onSesionExpirada).toHaveBeenCalled());
  });

  it("sin trace_id no hay pulgares (pero sí copiar)", () => {
    render(<MensajeAsistente partes={texto("Hola")} terminado onSesionExpirada={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Copiar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Me sirvió" })).toBeNull();
  });

  it("los botones de acción miden al menos 44 px", () => {
    render(<MensajeAsistente partes={texto("Hola")} traceId="t" terminado onSesionExpirada={vi.fn()} />);
    for (const b of screen.getAllByRole("button")) expect(b.className).toMatch(/size-11|min-h-11/);
  });
});
