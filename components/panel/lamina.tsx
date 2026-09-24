"use client";

import { FOCO } from "@/components/acceso/marco";
import { TRAMOS, etiquetaTramo, tramoDeLamina } from "@/lib/tramos";
import { cn } from "@/lib/utils";

// Tramo de la presentación (lib/tramos.ts): un botón grande por tramo. Elegir
// uno guarda `lamina_actual` = su última lámina, así el agente puede hablar de
// todo el tramo y el chat muestra sus 3 preguntas (lo pide cada 5 s).
// El elegido se ve relleno en blanco: el acento queda para foco, enlaces y enviar.
export function SelectorTramo({ valor, onCambiar }: { valor: number; onCambiar: (n: number) => void }) {
  const actual = tramoDeLamina(valor);

  return (
    <section aria-labelledby="titulo-tramo" className="rounded-xl border border-border bg-card p-5">
      <h2 id="titulo-tramo" className="text-xl font-medium">
        Tramo de la presentación
      </h2>
      <div className="mt-3 flex flex-col gap-2">
        {TRAMOS.map((t) => {
          const elegido = t.id === actual.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={elegido}
              className={cn(
                "flex h-14 items-center rounded-xl border px-4 text-left text-xl font-medium",
                elegido
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:bg-muted",
                FOCO,
              )}
              onClick={() => {
                if (!elegido) onCambiar(t.hasta);
              }}
            >
              {etiquetaTramo(t)}
            </button>
          );
        })}
      </div>
      <h3 id="titulo-preguntas" className="mt-4 text-base text-muted-foreground">
        Preguntas sugeridas ahora
      </h3>
      <ul aria-labelledby="titulo-preguntas" className="mt-1 flex flex-col gap-1 text-base leading-snug">
        {actual.preguntas.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </section>
  );
}
