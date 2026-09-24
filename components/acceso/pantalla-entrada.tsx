"use client";

import { Loader2Icon } from "lucide-react";
import Image from "next/image";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  emailValido,
  identificar,
  MENSAJE_DEMASIADOS_INTENTOS,
  MENSAJE_EMAIL_INVALIDO,
  MENSAJE_SIN_CONEXION,
  TEXTO_REINTENTAR,
  type RespuestaIdentificar,
} from "@/lib/acceso";
import { cn } from "@/lib/utils";
import { Eyebrow, FOCO, Marco, mostrarAlAbrirTeclado } from "./marco";

type Props = { onIdentificado: (resultado: RespuestaIdentificar) => void };

export function PantallaEntrada({ onIdentificado }: Props) {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorEmail, setErrorEmail] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const idError = useId();
  const idNota = useId();

  async function enviar(valor: string) {
    setAviso(null);
    if (!emailValido(valor)) {
      setErrorEmail(MENSAJE_EMAIL_INVALIDO);
      inputRef.current?.focus();
      return;
    }
    setErrorEmail(null);
    setEnviando(true);
    const resultado = await identificar(valor);
    setEnviando(false);

    if (resultado.ok) {
      onIdentificado(resultado.datos);
      return;
    }
    if (resultado.tipo === "red") {
      toast.error(MENSAJE_SIN_CONEXION, {
        action: { label: TEXTO_REINTENTAR, onClick: () => void enviar(valor) },
      });
      return;
    }
    if (resultado.status === 400) {
      setErrorEmail(resultado.mensaje);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else if (resultado.status === 429) {
      setAviso(MENSAJE_DEMASIADOS_INTENTOS);
    } else {
      setAviso(resultado.mensaje);
    }
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

      <form
        className="mt-8 flex flex-col gap-3"
        noValidate
        onSubmit={(evento) => {
          evento.preventDefault();
          if (!enviando) void enviar(email);
        }}
      >
        <label htmlFor="email" className="text-sm font-medium">
          Tu email de registro
        </label>
        <Input
          ref={inputRef}
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          value={email}
          disabled={enviando}
          aria-invalid={errorEmail ? true : undefined}
          aria-describedby={errorEmail ? `${idError} ${idNota}` : idNota}
          onChange={(evento) => {
            setEmail(evento.target.value);
            if (errorEmail) setErrorEmail(null);
          }}
          onFocus={() => mostrarAlAbrirTeclado(botonRef.current)}
          className={cn("h-12 px-3 text-base md:text-base", FOCO)}
        />
        {errorEmail && (
          <p id={idError} className="text-sm text-destructive">
            {errorEmail}
          </p>
        )}

        <Button
          ref={botonRef}
          type="submit"
          aria-busy={enviando || undefined}
          aria-disabled={enviando || undefined}
          className={cn("mt-1 h-12 w-full text-base font-semibold", FOCO)}
        >
          {enviando && <Loader2Icon aria-hidden="true" className="size-5 animate-spin" />}
          Entrar
        </Button>

        <div aria-live="polite">
          {aviso && (
            <p role="alert" className="text-sm text-destructive">
              {aviso}
            </p>
          )}
        </div>

        <p id={idNota} className="text-[13px] leading-snug text-muted-foreground">
          Usamos tu email solo para personalizar las respuestas durante la charla.
        </p>
      </form>
    </Marco>
  );
}
