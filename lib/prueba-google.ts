import { vi } from "vitest";

// Google Identity Services simulado para pruebas de UI (jsdom): renderButton
// dibuja un botón «Continuar con Google» que, al pulsarlo, entrega la
// credencial indicada al callback registrado con initialize.
export const CLIENTE_ID_PRUEBA = "cliente-prueba.apps.googleusercontent.com";

export function instalarGoogleSimulado(credencial = "cred-prueba") {
  const estado: { config?: { client_id: string; callback: (r: { credential?: string }) => void } } = {};
  const initialize = vi.fn((config) => {
    estado.config = config;
  });
  const renderButton = vi.fn<(padre: HTMLElement, opciones: Record<string, unknown>) => void>((padre) => {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.textContent = "Continuar con Google";
    boton.addEventListener("click", () => estado.config?.callback({ credential: credencial }));
    padre.replaceChildren(boton);
  });
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", CLIENTE_ID_PRUEBA);
  vi.stubGlobal("google", { accounts: { id: { initialize, renderButton } } });
  return { initialize, renderButton, estado };
}
