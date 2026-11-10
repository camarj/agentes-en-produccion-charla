"use client";

import { Loader2Icon } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import {
  identificar,
  MENSAJE_DEMASIADOS_INTENTOS,
  MENSAJE_SIN_CONEXION,
  TEXTO_REINTENTAR,
  type RespuestaIdentificar,
} from "@/lib/acceso";
import { BotonGoogle } from "./boton-google";
import { Eyebrow, Marco } from "./marco";

type Props = { onIdentificado: (resultado: RespuestaIdentificar) => void };

// Entrada con la cuenta de Google (DevFest 2026-12-05): ya no se escribe el
// email, así nadie puede entrar con el correo de otra persona.
export function PantallaEntrada({ onIdentificado }: Props) {
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(credencial: string) {
    setAviso(null);
    setEnviando(true);
    const resultado = await identificar(credencial);
    setEnviando(false);

    if (resultado.ok) {
      onIdentificado(resultado.datos);
      return;
    }
    if (resultado.tipo === "red") {
      toast.error(MENSAJE_SIN_CONEXION, {
        action: { label: TEXTO_REINTENTAR, onClick: () => void enviar(credencial) },
      });
      return;
    }
    setAviso(resultado.status === 429 ? MENSAJE_DEMASIADOS_INTENTOS : resultado.mensaje);
  }

  return (
    <Marco>
      {/* Logo con fondo transparente: texto gris claro y triángulo turquesa, legible sobre negro. */}
      <Image
        src="/inteliside-logo-horizontal-fondo-blanco.webp"
        alt="Inteliside"
        width={372}
        height={124}
        priority
        className="mb-6 h-9 w-auto"
      />
      <Eyebrow />
      <h1 className="mt-3 text-[28px] leading-tight font-semibold text-balance sm:text-[32px]">
        Cómo lograr que tus agentes sobrevivan a producción
      </h1>
      <p className="mt-3 text-muted-foreground">Pregúntale al asistente cualquier cosa de la charla.</p>

      <div className="mt-8 flex flex-col gap-3">
        <BotonGoogle onCredencial={(credencial) => void enviar(credencial)} deshabilitado={enviando} />
        {enviando && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
            Entrando…
          </p>
        )}

        <div aria-live="polite">
          {aviso && (
            <p role="alert" className="text-sm text-destructive">
              {aviso}
            </p>
          )}
        </div>

        <p className="text-[13px] leading-snug text-muted-foreground">
          Usamos tu cuenta de Google solo para saber quién eres y personalizar las respuestas durante la charla.
        </p>
      </div>
    </Marco>
  );
}
