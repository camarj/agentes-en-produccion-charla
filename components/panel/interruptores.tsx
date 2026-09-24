"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { PauseCircleIcon, PlayCircleIcon } from "lucide-react";
import { useState } from "react";
import { FOCO } from "@/components/acceso/marco";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { horaCorta } from "@/lib/panel/formato";
import { CLAVES_CAOS, type ClaveActivable, type EstadoInterruptores, type ValorOnOff } from "@/lib/panel/tipos";
import { cn } from "@/lib/utils";

const CAOS: Record<(typeof CLAVES_CAOS)[number], { titulo: string; efecto: string }> = {
  herramienta_caida: { titulo: "Herramienta caída", efecto: "La búsqueda en láminas falla: reintentos y escalamiento." },
  latencia_alta: { titulo: "Latencia alta", efecto: "Cada búsqueda en láminas tarda 8 s por intento." },
  modelo_caido: { titulo: "Modelo caído", efecto: "El modelo principal falla y responde el de respaldo." },
  modelos_caidos: { titulo: "Modelos caídos", efecto: "Fallan el principal y el respaldo: falla técnica y escalamiento." },
};

type OnCambiar = (clave: ClaveActivable, valor: ValorOnOff) => void;

const ultimaActivacion = (iso: string | null) => (iso ? `Última activación: ${horaCorta(iso)}` : "Nunca activado");

// Interruptor grande (el de shadcn mide 18 px: invisible en un proyector).
function InterruptorGrande({ etiqueta, activo, onCambiar }: { etiqueta: string; activo: boolean; onCambiar: (v: boolean) => void }) {
  return (
    <SwitchPrimitive.Root
      aria-label={etiqueta}
      checked={activo}
      onCheckedChange={onCambiar}
      className={cn(
        "relative inline-flex h-9 w-16 shrink-0 items-center rounded-full border border-border px-1",
        "data-checked:bg-foreground data-unchecked:bg-muted",
        FOCO,
      )}
    >
      <SwitchPrimitive.Thumb className="block size-7 rounded-full data-checked:translate-x-7 data-checked:bg-background data-unchecked:bg-muted-foreground" />
    </SwitchPrimitive.Root>
  );
}

export function InterruptoresCaos({ estado, onCambiar }: { estado: EstadoInterruptores; onCambiar: OnCambiar }) {
  return (
    <section aria-labelledby="titulo-caos" className="rounded-xl border border-border bg-card p-5">
      <h2 id="titulo-caos" className="text-xl font-medium">
        Interruptores de caos
      </h2>
      <ul className="mt-3 divide-y divide-border">
        {CLAVES_CAOS.map((clave) => {
          const activo = estado.valores[clave] === "on";
          return (
            <li key={clave} className="flex items-center gap-4 py-3">
              <InterruptorGrande
                etiqueta={CAOS[clave].titulo}
                activo={activo}
                onCambiar={(v) => onCambiar(clave, v ? "on" : "off")}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xl">
                  {CAOS[clave].titulo}
                  {activo ? <span className="ml-3 font-mono text-base font-medium">ACTIVO</span> : null}
                </p>
                <p className="text-base text-muted-foreground">{CAOS[clave].efecto}</p>
                {activo && clave === "modelo_caido" ? (
                  <p className="text-base font-medium text-foreground">Responde el modelo de respaldo</p>
                ) : null}
              </div>
              <p className="shrink-0 font-mono text-base text-muted-foreground">
                {ultimaActivacion(estado.ultimas_activaciones[clave])}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Kill switch: pausar pide confirmación; reanudar es inmediato.
export function KillSwitch({ estado, onCambiar }: { estado: EstadoInterruptores; onCambiar: OnCambiar }) {
  const [confirmando, setConfirmando] = useState(false);
  const activo = estado.valores.kill_switch === "on";

  return (
    <section
      aria-labelledby="titulo-kill"
      className={cn("rounded-xl border p-5", activo ? "border-red-500 bg-red-950/60" : "border-red-900 bg-card")}
    >
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 id="titulo-kill" className="text-xl font-medium">
            {activo ? "Asistente en pausa" : "Kill switch"}
          </h2>
          <p className="text-base text-muted-foreground">
            {activo
              ? "Nadie puede preguntar. El chat muestra un aviso y reintenta solo."
              : `Pausa el chat para todos. ${ultimaActivacion(estado.ultimas_activaciones.kill_switch)}`}
          </p>
        </div>
        {activo ? (
          <button
            type="button"
            onClick={() => onCambiar("kill_switch", "off")}
            className={cn(
              "inline-flex h-14 items-center gap-2 rounded-xl border border-border bg-background px-5 text-lg font-medium hover:bg-muted",
              FOCO,
            )}
          >
            <PlayCircleIcon className="size-6" aria-hidden="true" />
            Reanudar el asistente
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className={cn(
              "inline-flex h-14 items-center gap-2 rounded-xl bg-red-600 px-5 text-lg font-semibold text-white hover:bg-red-700",
              FOCO,
            )}
          >
            <PauseCircleIcon className="size-6" aria-hidden="true" />
            Pausar el asistente
          </button>
        )}
      </div>

      <Dialog open={confirmando} onOpenChange={setConfirmando}>
        <DialogContent showCloseButton={false} className="gap-4 p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">¿Pausar el asistente para todos?</DialogTitle>
            <DialogDescription className="text-base">
              Nadie podrá hacer preguntas hasta que lo reanudes. Verán un aviso de pausa y el chat reintentará solo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <DialogClose
              className={cn("h-12 rounded-xl border border-border px-5 text-base hover:bg-muted", FOCO)}
            >
              Cancelar
            </DialogClose>
            <button
              type="button"
              onClick={() => {
                setConfirmando(false);
                onCambiar("kill_switch", "on");
              }}
              className={cn("h-12 rounded-xl bg-red-600 px-5 text-base font-semibold text-white hover:bg-red-700", FOCO)}
            >
              Sí, pausar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
