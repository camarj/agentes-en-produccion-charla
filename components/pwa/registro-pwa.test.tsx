// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entornoActual, reiniciarInstalacionParaPruebas } from "@/lib/pwa";
import { RegistroPwa } from "./registro-pwa";

const register = vi.fn().mockResolvedValue({});

beforeEach(() => {
  reiniciarInstalacionParaPruebas();
  register.mockClear();
  Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
});
afterEach(() => cleanup());

describe("RegistroPwa", () => {
  it("en producción registra /sw.js para todo el sitio, sin caché HTTP del script", () => {
    render(<RegistroPwa registrarSW />);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
  });

  it("en desarrollo no registra el service worker", () => {
    render(<RegistroPwa registrarSW={false} />);
    expect(register).not.toHaveBeenCalled();
  });

  it("si el registro falla no rompe nada", async () => {
    register.mockRejectedValueOnce(new Error("SecurityError"));
    expect(() => render(<RegistroPwa registrarSW />)).not.toThrow();
    await act(async () => {});
  });

  it("guarda el aviso de instalación desde que carga la página (antes de entrar al chat)", () => {
    render(<RegistroPwa registrarSW={false} />);
    act(() => {
      window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: vi.fn() }));
    });
    expect(entornoActual().promptDisponible).toBe(true);
  });
});
