import { FOCO } from "@/components/acceso/marco";
import { TEXTOS, saludo } from "@/lib/chat-ui";
import { cn } from "@/lib/utils";

export interface PropsEstadoVacio {
  nombrePila?: string;
  sugerencias: string[];
  deshabilitado: boolean;
  onElegir: (pregunta: string) => void;
}

// Saludo y 3 sugerencias (de /api/sugerencias) que se envían al tocarlas.
export function EstadoVacio({ nombrePila, sugerencias, deshabilitado, onElegir }: PropsEstadoVacio) {
  return (
    <div className="flex flex-1 flex-col justify-end gap-6 pb-4">
      <h1 className="text-[28px] leading-tight font-semibold">{saludo(nombrePila)}</h1>
      {sugerencias.length > 0 && (
        <ul className="flex flex-col items-start gap-2">
          {sugerencias.slice(0, 3).map((s) => (
            <li key={s}>
              <button
                type="button"
                disabled={deshabilitado}
                onClick={() => onElegir(s)}
                className={cn(
                  "min-h-11 rounded-2xl border border-border bg-card px-4 py-2.5 text-left text-sm leading-5 hover:bg-muted",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  FOCO,
                )}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Con conversación: fila compacta de sugerencias sobre el composer, con scroll
// horizontal. Botones de 44 px de alto (mínimo táctil).
export function SugerenciasCompactas({ sugerencias, onElegir }: { sugerencias: string[]; onElegir: (pregunta: string) => void }) {
  if (sugerencias.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={TEXTOS.sugeridas}
      className="-mx-4 mb-2 flex gap-2 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {sugerencias.slice(0, 3).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onElegir(s)}
          className={cn(
            "min-h-11 shrink-0 rounded-full border border-border bg-card px-4 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground",
            FOCO,
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
