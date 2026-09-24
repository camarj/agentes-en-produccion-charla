"use client";

import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { BotonDictado } from "./dictado";
import { FOCO } from "@/components/acceso/marco";
import { LARGO_MAXIMO_PREGUNTA } from "@/lib/chat";
import { TEXTOS, alturaComposer, contador, largoPregunta } from "@/lib/chat-ui";
import { cn } from "@/lib/utils";

export interface PropsComposer {
  valor: string;
  onCambiar: (valor: string) => void;
  onEnviar: (texto: string) => void;
  onDetener: () => void;
  // Hay una respuesta en curso: el botón pasa a «Detener».
  ocupado: boolean;
  deshabilitado: boolean;
  // 423 al dictar: el asistente está en pausa.
  onPausaDictado?: (mensaje: string) => void;
  // true mientras se graba o transcribe un dictado.
  onDictando?: (activo: boolean) => void;
}

// En teléfonos (puntero táctil) Enter hace salto de línea y se envía con el botón.
function esMovil(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

export function Composer({ valor, onCambiar, onEnviar, onDetener, ocupado, deshabilitado, onPausaDictado, onDictando }: PropsComposer) {
  const caja = useRef<HTMLTextAreaElement>(null);
  // El dictado termina segundos después: se une al texto que haya en ese momento.
  const valorActual = useRef(valor);
  useLayoutEffect(() => {
    valorActual.current = valor;
  }, [valor]);
  const cuenta = contador(valor.length);
  const puedeEnviar = !deshabilitado && !ocupado && largoPregunta(valor) >= 1;

  // Textarea autoajustable de 1 a 6 líneas.
  useLayoutEffect(() => {
    const t = caja.current;
    if (!t) return;
    t.style.height = "auto";
    const { alto, conScroll } = alturaComposer(t.scrollHeight);
    t.style.height = `${alto}px`;
    t.style.overflowY = conScroll ? "auto" : "hidden";
  }, [valor]);

  // El texto dictado se agrega al final para que la persona lo revise; no se envía solo.
  function insertarDictado(texto: string) {
    const previo = valorActual.current.trimEnd();
    const unido = (previo ? `${previo} ${texto}` : texto).slice(0, LARGO_MAXIMO_PREGUNTA);
    valorActual.current = unido;
    onCambiar(unido);
    requestAnimationFrame(() => {
      const t = caja.current;
      if (!t) return;
      t.focus();
      t.setSelectionRange(unido.length, unido.length);
    });
  }

  function enviar() {
    if (puedeEnviar) onEnviar(valor.trim());
  }

  return (
    <form
      className="flex items-end gap-2 rounded-[26px] border border-border bg-card p-1.5 pl-4"
      onSubmit={(e) => {
        e.preventDefault();
        enviar();
      }}
    >
      <label htmlFor="composer" className="sr-only">
        {TEXTOS.placeholder}
      </label>
      <textarea
        id="composer"
        ref={caja}
        rows={1}
        value={valor}
        maxLength={LARGO_MAXIMO_PREGUNTA}
        disabled={deshabilitado}
        placeholder={TEXTOS.placeholder}
        aria-describedby={cuenta ? "composer-contador" : undefined}
        onChange={(e) => onCambiar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || esMovil()) return;
          e.preventDefault();
          enviar();
        }}
        className={cn(
          "min-w-0 flex-1 resize-none self-center bg-transparent py-2 text-base leading-6 text-foreground outline-none",
          "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />
      {cuenta && (
        <span id="composer-contador" className="self-center font-mono text-xs text-muted-foreground tabular-nums">
          {cuenta}
        </span>
      )}
      <BotonDictado deshabilitado={deshabilitado || ocupado} onTexto={insertarDictado} onPausa={onPausaDictado} onActivo={onDictando} />
      {ocupado ? (
        <button
          type="button"
          aria-label={TEXTOS.detener}
          onClick={onDetener}
          className={cn("flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground", FOCO)}
        >
          <SquareIcon className="size-4 fill-current" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="submit"
          aria-label={TEXTOS.enviar}
          disabled={!puedeEnviar}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground",
            "disabled:bg-muted disabled:text-muted-foreground",
            FOCO,
          )}
        >
          <ArrowUpIcon className="size-5" aria-hidden="true" />
        </button>
      )}
    </form>
  );
}
