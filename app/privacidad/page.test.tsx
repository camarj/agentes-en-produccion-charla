// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PaginaPrivacidad, { metadata } from "./page";

afterEach(cleanup);

describe("/privacidad (política de privacidad para Google Auth Platform)", () => {
  it("tiene título y nombra a Raúl Camacho como responsable", () => {
    render(<PaginaPrivacidad />);
    expect(metadata.title).toBe("Política de privacidad · Demo de agentes en producción");
    expect(screen.getByRole("heading", { level: 1, name: "Política de privacidad" })).toBeTruthy();
    expect(screen.getByText(/Raúl Camacho/)).toBeTruthy();
  });

  it("enlaza el correo de contacto para pedir el borrado", () => {
    render(<PaginaPrivacidad />);
    const correo = screen.getByRole("link", { name: "raulj.camacho@gmail.com" });
    expect(correo.getAttribute("href")).toBe("mailto:raulj.camacho@gmail.com");
  });

  it("explica qué datos se usan, quién los procesa y cuándo se borran", () => {
    render(<PaginaPrivacidad />);
    for (const titulo of ["Qué datos usamos", "Para qué los usamos", "Con quién se comparten", "Cuánto tiempo los guardamos", "Tus derechos"]) {
      expect(screen.getByRole("heading", { level: 2, name: titulo })).toBeTruthy();
    }
    expect(screen.getByText(/Google \(Gemini\)/)).toBeTruthy();
    expect(screen.getByText(/OpenAI/)).toBeTruthy();
    expect(screen.getByText(/No vendemos/)).toBeTruthy();
  });

  it("no menciona a Inteliside", () => {
    const { container } = render(<PaginaPrivacidad />);
    expect(container.textContent).not.toMatch(/inteliside/i);
  });
});
