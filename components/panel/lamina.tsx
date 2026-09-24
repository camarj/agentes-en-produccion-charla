"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { FOCO } from "@/components/acceso/marco";
import { LAMINA_MAX, LAMINA_MIN, acotarLamina } from "@/lib/panel/tipos";
import { cn } from "@/lib/utils";

const BOTON = cn(
  "inline-flex size-16 items-center justify-center rounded-xl border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40",
  FOCO,
);

// Lámina actual (1–39): stepper − / + y campo numérico. Enter o salir del campo
// guarda; un número fuera de rango se lleva al límite más cercano.
export function SelectorLamina({ valor, onCambiar }: { valor: number; onCambiar: (n: number) => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const mostrado = editando ? texto : String(valor);

  function confirmar() {
    setEditando(false);
    if (!/^\s*-?\d+\s*$/.test(texto)) return;
    const n = acotarLamina(Number(texto));
    if (n !== valor) onCambiar(n);
  }

  return (
    <section aria-labelledby="titulo-lamina" className="rounded-xl border border-border bg-card p-5">
      <h2 id="titulo-lamina" className="text-xl font-medium">
        Lámina actual
      </h2>
      <p className="text-base text-muted-foreground">Cambia las preguntas sugeridas del chat.</p>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          aria-label="Lámina anterior"
          className={BOTON}
          disabled={valor <= LAMINA_MIN}
          onClick={() => onCambiar(acotarLamina(valor - 1))}
        >
          <MinusIcon className="size-7" aria-hidden="true" />
        </button>
        <input
          aria-label="Número de lámina"
          inputMode="numeric"
          className={cn(
            "h-16 w-28 rounded-xl border border-border bg-background text-center font-mono text-[40px] tabular-nums",
            FOCO,
          )}
          value={mostrado}
          onFocus={() => {
            setTexto(String(valor));
            setEditando(true);
          }}
          onChange={(e) => {
            setTexto(e.target.value);
            setEditando(true);
          }}
          onBlur={() => editando && confirmar()}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmar();
            if (e.key === "Escape") setEditando(false);
          }}
        />
        <button
          type="button"
          aria-label="Lámina siguiente"
          className={BOTON}
          disabled={valor >= LAMINA_MAX}
          onClick={() => onCambiar(acotarLamina(valor + 1))}
        >
          <PlusIcon className="size-7" aria-hidden="true" />
        </button>
        <span className="font-mono text-xl text-muted-foreground">de {LAMINA_MAX}</span>
      </div>
    </section>
  );
}
