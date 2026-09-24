import { FOCO } from "@/components/acceso/marco";
import { saludo } from "@/lib/chat-ui";
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
