// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function movil(esMovil: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(pointer: coarse)" ? esMovil : false, media: q }));
}

function Envoltura(props: Partial<React.ComponentProps<typeof Composer>> & { inicial?: string }) {
  const [valor, setValor] = useState(props.inicial ?? "");
  return (
    <Composer
      valor={valor}
      onCambiar={setValor}
      onEnviar={props.onEnviar ?? vi.fn()}
      onDetener={props.onDetener ?? vi.fn()}
      ocupado={props.ocupado ?? false}
      deshabilitado={props.deshabilitado ?? false}
    />
  );
}

const caja = () => screen.getByPlaceholderText("Pregunta sobre la charla…") as HTMLTextAreaElement;

describe("Composer", () => {
  it("en escritorio Enter envía y Shift+Enter hace salto de línea", async () => {
    movil(false);
    const onEnviar = vi.fn();
    render(<Envoltura onEnviar={onEnviar} />);
    await userEvent.type(caja(), "hola{Shift>}{Enter}{/Shift}mundo");
    expect(caja().value).toBe("hola\nmundo");
    expect(onEnviar).not.toHaveBeenCalled();
    await userEvent.type(caja(), "{Enter}");
    expect(onEnviar).toHaveBeenCalledWith("hola\nmundo");
  });

  it("en móvil Enter hace salto de línea y se envía con el botón", async () => {
    movil(true);
    const onEnviar = vi.fn();
    render(<Envoltura onEnviar={onEnviar} />);
    await userEvent.type(caja(), "hola{Enter}mundo");
    expect(caja().value).toBe("hola\nmundo");
    expect(onEnviar).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(onEnviar).toHaveBeenCalledWith("hola\nmundo");
  });

  it("no envía texto vacío ni solo espacios", async () => {
    movil(false);
    const onEnviar = vi.fn();
    render(<Envoltura onEnviar={onEnviar} />);
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(caja(), "   {Enter}");
    expect(onEnviar).not.toHaveBeenCalled();
  });

  it("el contador aparece desde 800 caracteres y el máximo es 1.000", () => {
    render(<Envoltura inicial={"a".repeat(799)} />);
    expect(screen.queryByText(/\/1\.000$/)).toBeNull();
    cleanup();
    render(<Envoltura inicial={"a".repeat(800)} />);
    expect(screen.getByText("800/1.000")).toBeTruthy();
    expect(caja().maxLength).toBe(1000);
  });

  it("crece de 1 a 6 líneas", () => {
    render(<Envoltura />);
    const t = caja();
    Object.defineProperty(t, "scrollHeight", { configurable: true, value: 88 });
    fireEvent.change(t, { target: { value: "a\nb\nc" } });
    expect(t.style.height).toBe("88px");
    expect(t.style.overflowY).toBe("hidden");
    Object.defineProperty(t, "scrollHeight", { configurable: true, value: 500 });
    fireEvent.change(t, { target: { value: "a\nb\nc\nd\ne\nf\ng\nh" } });
    expect(t.style.height).toBe("160px");
    expect(t.style.overflowY).toBe("auto");
  });

  it("durante el stream el botón es «Detener»", async () => {
    const onDetener = vi.fn();
    render(<Envoltura ocupado onDetener={onDetener} inicial="x" />);
    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Detener" }));
    expect(onDetener).toHaveBeenCalled();
  });

  it("deshabilitado bloquea escribir y enviar", () => {
    render(<Envoltura deshabilitado inicial="hola" />);
    expect(caja().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
