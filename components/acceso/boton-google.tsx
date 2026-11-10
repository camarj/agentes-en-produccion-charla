"use client";

import { useEffect, useRef, useState } from "react";

// Botón oficial «Continuar con Google» (Google Identity Services). Google
// dibuja el botón y, cuando la persona elige su cuenta, entrega un ID token
// (`credential`) que el servidor verifica en /api/identificar.

const URL_SCRIPT = "https://accounts.google.com/gsi/client";

interface RespuestaCredencial {
  credential?: string;
}

export interface GoogleIdentity {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (respuesta: RespuestaCredencial) => void;
        ux_mode?: "popup" | "redirect";
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
      }): void;
      renderButton(padre: HTMLElement, opciones: Record<string, unknown>): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

let cargaScript: Promise<GoogleIdentity> | null = null;

function cargarGoogle(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  cargaScript ??= new Promise<GoogleIdentity>((resolver, rechazar) => {
    const script = document.createElement("script");
    script.src = URL_SCRIPT;
    script.async = true;
    script.onload = () => (window.google?.accounts?.id ? resolver(window.google) : rechazar(new Error("gsi sin cargar")));
    script.onerror = () => {
      cargaScript = null; // permite reintentar al volver a montar
      rechazar(new Error("gsi sin cargar"));
    };
    document.head.appendChild(script);
  });
  return cargaScript;
}

export const MENSAJE_GOOGLE_NO_DISPONIBLE =
  "No pudimos cargar el acceso con Google. Revisa tu conexión y recarga la página.";

type Props = {
  onCredencial: (credencial: string) => void;
  deshabilitado?: boolean;
};

export function BotonGoogle({ onCredencial, deshabilitado = false }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const alRecibir = useRef(onCredencial);
  const clienteId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  const [errorCarga, setErrorCarga] = useState(false);
  const error = !clienteId || errorCarga ? MENSAJE_GOOGLE_NO_DISPONIBLE : null;

  useEffect(() => {
    alRecibir.current = onCredencial;
  }, [onCredencial]);

  useEffect(() => {
    if (!clienteId) return;
    let activo = true;
    cargarGoogle()
      .then((google) => {
        if (!activo || !contenedor.current) return;
        google.accounts.id.initialize({
          client_id: clienteId,
          callback: (respuesta) => {
            if (respuesta.credential) alRecibir.current(respuesta.credential);
          },
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        google.accounts.id.renderButton(contenedor.current, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "left",
          locale: "es",
          width: Math.min(400, contenedor.current.clientWidth || 320),
        });
      })
      .catch(() => {
        if (activo) setErrorCarga(true);
      });
    return () => {
      activo = false;
    };
  }, [clienteId]);

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={contenedor}
        aria-busy={deshabilitado || undefined}
        className={deshabilitado ? "pointer-events-none min-h-11 w-full opacity-60" : "min-h-11 w-full"}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
