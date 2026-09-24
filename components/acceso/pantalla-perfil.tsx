"use client";

import { Loader2Icon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  guardarPerfil,
  LARGO_MAXIMO_DESCRIPCION,
  LARGO_MAXIMO_NOMBRE,
  LARGO_MAXIMO_ROL,
  MENSAJE_NOMBRE_REQUERIDO,
  MENSAJE_SIN_CONEXION,
  puedeContinuar,
  ROL_OMITIDO,
  type EstadoPerfil,
} from "@/lib/acceso";
import { cn } from "@/lib/utils";
import { Eyebrow, FOCO, Marco, mostrarAlAbrirTeclado } from "./marco";

type Props = {
  estado: EstadoPerfil;
  nombrePila?: string;
  onCompletado: (nombrePila: string) => void;
  onSesionExpirada: () => void;
};

const CAMPO = cn("px-3 text-base md:text-base", FOCO);

export function PantallaPerfil({ estado, nombrePila, onCompletado, onSesionExpirada }: Props) {
  const pideNombre = estado === "nuevo";
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nombreRef = useRef<HTMLInputElement>(null);
  const rolRef = useRef<HTMLTextAreaElement>(null);
  const accionesRef = useRef<HTMLDivElement>(null);
  const idErrorNombre = useId();
  const idContador = useId();

  // El rol crece con su contenido (2 filas como mínimo).
  useLayoutEffect(() => {
    const campo = rolRef.current;
    if (!campo) return;
    campo.style.height = "auto";
    const alto = campo.scrollHeight + (campo.offsetHeight - campo.clientHeight);
    if (alto > 0) campo.style.height = `${alto}px`;
  }, [rol]);

  async function enviar(rolElegido: string) {
    setError(null);
    if (pideNombre && !nombre.trim()) {
      setErrorNombre(MENSAJE_NOMBRE_REQUERIDO);
      nombreRef.current?.focus();
      return;
    }
    setGuardando(true);
    const resultado = await guardarPerfil({
      ...(pideNombre ? { nombre } : {}),
      rol: rolElegido,
      descripcion,
    });
    setGuardando(false);

    if (resultado.ok) {
      onCompletado(resultado.datos.nombre_pila);
    } else if (resultado.tipo === "red") {
      setError(MENSAJE_SIN_CONEXION);
    } else if (resultado.status === 401) {
      toast.error(resultado.mensaje);
      onSesionExpirada();
    } else if (resultado.error === "nombre_requerido") {
      setErrorNombre(resultado.mensaje);
    } else {
      setError(resultado.mensaje);
    }
  }

  const alEnfocar = () => mostrarAlAbrirTeclado(accionesRef.current);

  return (
    <Marco>
      <Eyebrow />
      <h1 className="mt-3 text-[28px] leading-tight font-semibold sm:text-[32px]">
        {nombrePila ? `Hola, ${nombrePila}` : "Hola"}
      </h1>

      <form
        className="mt-8 flex flex-col gap-6"
        noValidate
        onSubmit={(evento) => {
          evento.preventDefault();
          if (!guardando && puedeContinuar(rol)) void enviar(rol);
        }}
      >
        {pideNombre && (
          <div className="flex flex-col gap-2">
            <label htmlFor="nombre" className="text-sm font-medium">
              ¿Cómo te llamas?
            </label>
            <Input
              ref={nombreRef}
              id="nombre"
              name="nombre"
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="next"
              required
              maxLength={LARGO_MAXIMO_NOMBRE}
              value={nombre}
              disabled={guardando}
              aria-invalid={errorNombre ? true : undefined}
              aria-describedby={errorNombre ? idErrorNombre : undefined}
              onChange={(evento) => {
                setNombre(evento.target.value);
                if (errorNombre) setErrorNombre(null);
              }}
              onFocus={alEnfocar}
              className={cn("h-12", CAMPO)}
            />
            {errorNombre && (
              <p id={idErrorNombre} className="text-sm text-destructive">
                {errorNombre}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="rol" className="text-sm font-medium">
            ¿A qué te dedicas?
          </label>
          <Textarea
            ref={rolRef}
            id="rol"
            name="rol"
            rows={2}
            maxLength={LARGO_MAXIMO_ROL}
            placeholder="Ej.: Contadora en una pyme de retail"
            value={rol}
            disabled={guardando}
            onChange={(evento) => setRol(evento.target.value)}
            onFocus={alEnfocar}
            className={cn("field-sizing-fixed min-h-0 resize-none overflow-hidden", CAMPO)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="descripcion" className="text-sm font-medium">
            ¿Qué construyes o quieres construir con IA? <span className="text-muted-foreground">(opcional)</span>
          </label>
          <Textarea
            id="descripcion"
            name="descripcion"
            rows={3}
            maxLength={LARGO_MAXIMO_DESCRIPCION}
            placeholder="Ej.: Un agente que responda a mis clientes por WhatsApp"
            value={descripcion}
            disabled={guardando}
            aria-describedby={idContador}
            onChange={(evento) => setDescripcion(evento.target.value)}
            onFocus={alEnfocar}
            className={cn("field-sizing-fixed min-h-0 resize-none", CAMPO)}
          />
          <p id={idContador} className="self-end font-mono text-[13px] text-muted-foreground">
            {descripcion.length}/{LARGO_MAXIMO_DESCRIPCION}
          </p>
        </div>

        <div ref={accionesRef} className="flex flex-col gap-2">
          <div aria-live="polite">
            {error && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <Button
            type="submit"
            disabled={!puedeContinuar(rol) || guardando}
            aria-busy={guardando || undefined}
            className={cn("h-12 w-full text-base font-semibold", FOCO)}
          >
            {guardando && <Loader2Icon aria-hidden="true" className="size-5 animate-spin" />}
            Continuar
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={guardando}
            onClick={() => void enviar(ROL_OMITIDO)}
            className={cn("h-12 w-full text-base", FOCO)}
          >
            Saltar
          </Button>
        </div>
      </form>
    </Marco>
  );
}
