// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MENSAJE_DEMASIADOS_INTENTOS } from "@/lib/acceso";
import { ERRORES_CHAT } from "@/lib/chat";
import PaginaQr, { metadata } from "./page";

afterEach(cleanup);

describe("/qr (ayuda para colaboradores)", () => {
  it("muestra el QR y la dirección de la app", () => {
    render(<PaginaQr />);
    expect(screen.getByRole("img", { name: /QR/ }).getAttribute("src")).toBe("/qr-charla.svg");
    expect(screen.getByText("charla.codetrain.cloud")).toBeTruthy();
  });

  it("explica cómo entrar y los problemas comunes con los mismos mensajes de la app", () => {
    render(<PaginaQr />);
    expect(screen.getByRole("heading", { name: "Cómo entrar" })).toBeTruthy();
    expect(screen.getByText(new RegExp(MENSAJE_DEMASIADOS_INTENTOS))).toBeTruthy();
    expect(screen.getByText(new RegExp(ERRORES_CHAT.mantenimiento.split(".")[0]))).toBeTruthy();
    expect(screen.getByText(/Llegaste al límite de preguntas/)).toBeTruthy();
  });

  it("no se indexa en buscadores", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
