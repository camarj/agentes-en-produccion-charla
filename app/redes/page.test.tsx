// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PaginaRedes, { metadata } from "./page";

afterEach(cleanup);

describe("/redes (redes sociales de Raúl)", () => {
  it("muestra el logo de Inteliside, el nombre y el cargo", () => {
    render(<PaginaRedes />);
    expect(screen.getByRole("img", { name: "Inteliside" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Raúl Camacho" })).toBeTruthy();
    expect(screen.getByText("CEO de Inteliside")).toBeTruthy();
  });

  it("enlaza las cinco redes con https y en una pestaña nueva segura", () => {
    render(<PaginaRedes />);
    const esperados: [RegExp, string][] = [
      [/^LinkedIn/, "https://www.linkedin.com/in/rauljcamacho"],
      [/^Instagram/, "https://www.instagram.com/raulj.camacho/"],
      [/^X /, "https://x.com/rauljcamacho"],
      [/^GitHub/, "https://github.com/camarj"],
      [/^Blog/, "https://rauljcamacho.online"],
    ];
    for (const [nombre, href] of esperados) {
      const enlace = screen.getByRole("link", { name: nombre });
      expect(enlace.getAttribute("href")).toBe(href);
      expect(enlace.getAttribute("target")).toBe("_blank");
      expect(enlace.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(screen.getAllByRole("link")).toHaveLength(esperados.length);
  });

  it("muestra el retrato del speaker y el título completo de la charla", () => {
    render(<PaginaRedes />);
    expect(screen.getByRole("img", { name: "Retrato de Raúl Camacho" })).toBeTruthy();
    expect(screen.getByText("Cómo lograr que tu agente de IA sobreviva en producción")).toBeTruthy();
  });

  it("tiene título propio", () => {
    expect(metadata.title).toBe("Raúl Camacho · CEO de Inteliside");
  });
});
