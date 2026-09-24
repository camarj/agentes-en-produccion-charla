"use client";

import { ExternalLinkIcon } from "lucide-react";
import { FOCO } from "@/components/acceso/marco";
import { Skeleton } from "@/components/ui/skeleton";
import { horaCorta } from "@/lib/panel/formato";
import { cn } from "@/lib/utils";
import { ColaEscalamientos } from "./cola-escalamientos";
import { InterruptoresCaos, KillSwitch } from "./interruptores";
import { SelectorLamina } from "./lamina";
import { Metricas } from "./metricas";
import { usePanel } from "./use-panel";

// Panel del speaker (T12), pensado para proyectarse a 1920 × 1080.
export function Panel({ studioUrl }: { studioUrl: string | null }) {
  const { metricas, interruptores, cola, sinConexion, actualizadoEn, cambiarInterruptor, marcarEscalamiento } = usePanel();

  return (
    <main className="flex h-dvh flex-col gap-4 overflow-hidden px-8 py-6">
      <header className="flex items-center gap-6">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-base text-muted-foreground">Charla · Inteliside</p>
          <h1 className="text-3xl font-semibold">Panel del speaker</h1>
        </div>
        <p role="status" className={cn("font-mono text-base", sinConexion ? "text-red-300" : "text-muted-foreground")}>
          {sinConexion
            ? "Sin conexión con el servidor · reintentando"
            : actualizadoEn
              ? `Actualizado ${horaCorta(actualizadoEn)}`
              : "Cargando…"}
        </p>
        {studioUrl ? (
          <a
            href={studioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn("inline-flex items-center gap-2 rounded-lg text-lg text-primary underline-offset-4 hover:underline", FOCO)}
          >
            Abrir Mastra Studio
            <ExternalLinkIcon className="size-5" aria-hidden="true" />
          </a>
        ) : null}
      </header>

      {metricas ? (
        <>
          <Metricas datos={metricas} />
          {!metricas.observabilidad.disponible ? (
            <p className="-mt-2 text-base text-muted-foreground">
              Trazas no disponibles por ahora (Mastra se está conectando). Las demás métricas están al día.
            </p>
          ) : null}
        </>
      ) : (
        <div className="grid grid-cols-5 gap-4" aria-busy="true" aria-label="Cargando métricas">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      )}

      {/* Tres columnas para que la pausa y los 4 interruptores quepan en 1080p sin desplazarse. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,4fr)_minmax(0,5fr)_minmax(0,6fr)] gap-4">
        {interruptores ? (
          <>
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
              <SelectorLamina
                valor={interruptores.valores.lamina_actual}
                onCambiar={(n) => void cambiarInterruptor("lamina_actual", n)}
              />
              <KillSwitch estado={interruptores} onCambiar={(c, v) => void cambiarInterruptor(c, v)} />
            </div>
            <div className="min-h-0 overflow-y-auto">
              <InterruptoresCaos estado={interruptores} onCambiar={(c, v) => void cambiarInterruptor(c, v)} />
            </div>
          </>
        ) : (
          <>
            <Skeleton className="h-full rounded-xl" />
            <Skeleton className="h-full rounded-xl" />
          </>
        )}
        {cola ? (
          <ColaEscalamientos filas={cola} onMarcar={(id, e) => void marcarEscalamiento(id, e)} />
        ) : (
          <Skeleton className="h-full rounded-xl" />
        )}
      </div>
    </main>
  );
}
