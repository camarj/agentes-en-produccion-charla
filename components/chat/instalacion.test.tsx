// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capturarInstalacion, reiniciarInstalacionParaPruebas, TEXTOS_PWA } from "@/lib/pwa";
import { Cabecera } from "./cabecera";
import { BannerInstalacion } from "./instalacion";

const UA = {
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  escritorio:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

function simularNavegador({ ua, tactil = 0, standalone = false }: { ua: string; tactil?: number; standalone?: boolean }) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
  Object.defineProperty(navigator, "maxTouchPoints", { value: tactil, configurable: true });
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: standalone && q.includes("standalone"),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

// `beforeinstallprompt` como lo dispara Chrome en Android.
function avisoInstalacion(outcome: "accepted" | "dismissed" = "accepted") {
  const evento = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => {
    window.dispatchEvent(evento);
  });
  return evento;
}

let soltar: () => void;
beforeEach(() => {
  reiniciarInstalacionParaPruebas();
  window.localStorage.clear();
  soltar = capturarInstalacion();
});
afterEach(() => {
  soltar();
  cleanup();
  vi.restoreAllMocks();
});

describe("BannerInstalacion", () => {
  it("Android: aparece «Instalar app» cuando llega el aviso y al tocarlo abre el diálogo del navegador", async () => {
    simularNavegador({ ua: UA.android, tactil: 5 });
    render(<BannerInstalacion />);
    expect(screen.queryByRole("button", { name: TEXTOS_PWA.instalar })).toBeNull();

    const evento = avisoInstalacion();
    expect(evento.defaultPrevented).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: TEXTOS_PWA.instalar }));

    expect(evento.prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: TEXTOS_PWA.instalar })).toBeNull();
  });

  it("Android: al instalarse (appinstalled) desaparece", () => {
    simularNavegador({ ua: UA.android, tactil: 5 });
    render(<BannerInstalacion />);
    avisoInstalacion();
    expect(screen.getByRole("button", { name: TEXTOS_PWA.instalar })).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(screen.queryByRole("button", { name: TEXTOS_PWA.instalar })).toBeNull();
  });

  it("iPhone con Safari: muestra la instrucción de Compartir → «Agregar a inicio», sin botón de instalar", () => {
    simularNavegador({ ua: UA.iphoneSafari, tactil: 5 });
    render(<BannerInstalacion />);
    expect(screen.getByText(TEXTOS_PWA.iosSafari)).toBeTruthy();
    expect(screen.queryByRole("button", { name: TEXTOS_PWA.instalar })).toBeNull();
  });

  it("iPhone ya abierto desde la pantalla de inicio: no muestra nada", () => {
    simularNavegador({ ua: UA.iphoneSafari, tactil: 5, standalone: true });
    const { container } = render(<BannerInstalacion />);
    expect(container.textContent).toBe("");
  });

  it("escritorio: no muestra nada aunque Chrome ofrezca instalar", () => {
    simularNavegador({ ua: UA.escritorio });
    const { container } = render(<BannerInstalacion />);
    avisoInstalacion();
    expect(container.textContent).toBe("");
  });

  it("«Ahora no» lo oculta y se recuerda en la siguiente visita", async () => {
    simularNavegador({ ua: UA.iphoneSafari, tactil: 5 });
    const { unmount } = render(<BannerInstalacion />);
    await userEvent.click(screen.getByRole("button", { name: TEXTOS_PWA.cerrar }));
    expect(screen.queryByText(TEXTOS_PWA.iosSafari)).toBeNull();
    unmount();

    render(<BannerInstalacion />);
    expect(screen.queryByText(TEXTOS_PWA.iosSafari)).toBeNull();
  });

  it("sin localStorage (modo privado) sigue funcionando y se oculta en esta visita", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    simularNavegador({ ua: UA.iphoneSafari, tactil: 5 });
    render(<BannerInstalacion />);
    await userEvent.click(screen.getByRole("button", { name: TEXTOS_PWA.cerrar }));
    expect(screen.queryByText(TEXTOS_PWA.iosSafari)).toBeNull();
  });
});

describe("Cabecera: opción del menú", () => {
  async function abrirMenu() {
    await userEvent.click(screen.getByRole("button", { name: "Menú" }));
  }

  it("Android: «Instalar app» en el menú abre el diálogo del navegador, aunque se haya descartado el banner", async () => {
    window.localStorage.setItem("pwa-oferta-descartada", "1");
    simularNavegador({ ua: UA.android, tactil: 5 });
    render(<Cabecera onNuevaConversacion={() => {}} />);
    const evento = avisoInstalacion();
    await abrirMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: TEXTOS_PWA.instalar }));
    expect(evento.prompt).toHaveBeenCalledOnce();
  });

  it("iPhone: «Agregar a inicio» en el menú muestra la instrucción", async () => {
    simularNavegador({ ua: UA.iphoneSafari, tactil: 5 });
    render(<Cabecera onNuevaConversacion={() => {}} />);
    await abrirMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: TEXTOS_PWA.agregarInicio }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toContain(TEXTOS_PWA.iosSafari);
  });

  it("escritorio: el menú no ofrece instalar", async () => {
    simularNavegador({ ua: UA.escritorio });
    render(<Cabecera onNuevaConversacion={() => {}} />);
    await abrirMenu();
    await screen.findByRole("menuitem", { name: "Nueva conversación" });
    expect(screen.queryByRole("menuitem", { name: TEXTOS_PWA.instalar })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: TEXTOS_PWA.agregarInicio })).toBeNull();
  });
});
