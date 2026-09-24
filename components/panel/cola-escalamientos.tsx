"use client";

import { FOCO } from "@/components/acceso/marco";
import { etiquetaMotivoEscalamiento, etiquetaRol, horaCorta } from "@/lib/panel/formato";
import type { FilaEscalamiento } from "@/lib/panel/tipos";
import { cn } from "@/lib/utils";

const ETIQUETA = "inline-flex h-7 items-center rounded-full border px-3 text-sm";
const ACCION = cn("h-11 rounded-xl border border-border px-4 text-base hover:bg-muted", FOCO);

// Cola de preguntas para la sesión de preguntas: pendientes primero (la API ya
// las ordena y redacta). Nunca muestra nombre ni email: solo el rol anónimo.
export function ColaEscalamientos({
  filas,
  onMarcar,
}: {
  filas: FilaEscalamiento[];
  onMarcar: (id: number, estado: "respondida" | "descartada") => void;
}) {
  const pendientes = filas.filter((f) => f.estado === "pendiente").length;
  return (
    <section aria-labelledby="titulo-cola" className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-5">
      <h2 id="titulo-cola" className="text-xl font-medium">
        Cola de escalamientos <span className="font-mono text-muted-foreground">· {pendientes} {pendientes === 1 ? "pendiente" : "pendientes"}</span>
      </h2>
      {filas.length === 0 ? (
        <p className="mt-4 text-lg text-muted-foreground">No hay preguntas en la cola.</p>
      ) : (
        <ul className="mt-3 min-h-0 flex-1 divide-y divide-border overflow-y-auto pr-2">
          {filas.map((f) => {
            const pendiente = f.estado === "pendiente";
            return (
              <li key={f.id} className={cn("flex items-start gap-4 py-4", !pendiente && "opacity-50")}>
                <div className="min-w-0 flex-1">
                  <p className="text-xl leading-snug break-words">{f.pregunta}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={cn(ETIQUETA, f.motivo === "falla_tecnica" ? "border-red-500 text-red-300" : "border-border")}>
                      {etiquetaMotivoEscalamiento(f.motivo)}
                    </span>
                    <span className={cn(ETIQUETA, "border-transparent bg-muted")}>{etiquetaRol(f.rol_anonimo)}</span>
                    <span className="font-mono text-base text-muted-foreground">{horaCorta(f.creado_en)}</span>
                  </div>
                </div>
                {pendiente ? (
                  <div className="flex shrink-0 gap-2">
                    <button type="button" className={ACCION} onClick={() => onMarcar(f.id, "respondida")}>
                      Respondida
                    </button>
                    <button type="button" className={ACCION} onClick={() => onMarcar(f.id, "descartada")}>
                      Descartar
                    </button>
                  </div>
                ) : (
                  <span className="shrink-0 text-base text-muted-foreground">
                    {f.estado === "respondida" ? "Respondida" : "Descartada"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
