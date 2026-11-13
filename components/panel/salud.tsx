import { ExternalLinkIcon } from "lucide-react";
import { FOCO } from "@/components/acceso/marco";
import { urlTrazaStudio } from "@/lib/panel/studio";
import type { NivelEvento, SaludPanel, Semaforo } from "@/lib/salud/catalogo";
import { cn } from "@/lib/utils";

// Salud del sistema (PRD §15 G7): un semáforo por servicio y, debajo, el
// registro en vivo de eventos (el más nuevo primero) con enlace a la traza en
// Mastra Studio. Los colores del semáforo son la excepción a la paleta: el
// rojo, el ámbar y el verde son el mensaje.

const COLOR: Record<Semaforo, string> = { verde: "bg-emerald-400", ambar: "bg-amber-400", rojo: "bg-red-500" };
const NOMBRE_COLOR: Record<Semaforo, string> = { verde: "verde", ambar: "ámbar", rojo: "rojo" };
const COLOR_NIVEL: Record<NivelEvento, string> = { ok: "bg-emerald-400", aviso: "bg-amber-400", falla: "bg-red-500" };
const NOMBRE_NIVEL: Record<NivelEvento, string> = { ok: "recuperado", aviso: "aviso", falla: "falla" };

// «19:42:10» en la hora local del navegador del speaker.
function horaConSegundos(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "—";
  return fecha.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function Punto({ clase, etiqueta }: { clase: string; etiqueta?: string }) {
  return <span aria-hidden={etiqueta ? undefined : true} aria-label={etiqueta} className={cn("inline-block size-3.5 shrink-0 rounded-full", clase)} />;
}

export function Salud({ datos, studioUrl }: { datos: SaludPanel; studioUrl: string | null }) {
  return (
    <section aria-labelledby="titulo-salud" className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
      <h2 id="titulo-salud" className="text-xl font-medium">
        Salud del sistema
      </h2>
      <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1">
        {datos.servicios.map((s) => (
          <li key={s.id} aria-label={`${s.nombre}: ${NOMBRE_COLOR[s.semaforo]}`} className="flex items-start gap-2">
            <Punto clase={cn("mt-1.5", COLOR[s.semaforo])} />
            <div className="min-w-0">
              <p className="text-base leading-tight">{s.nombre}</p>
              <p className={cn("text-sm leading-tight", s.semaforo === "verde" ? "text-muted-foreground" : "text-foreground")}>{s.detalle}</p>
            </div>
          </li>
        ))}
      </ul>
      <h3 className="mt-3 text-base text-muted-foreground">Eventos en vivo</h3>
      {datos.eventos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin eventos por ahora.</p>
      ) : (
        <ul aria-label="Registro de eventos" className="mt-1 min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {datos.eventos.map((e) => {
            const traza = urlTrazaStudio(studioUrl, e.trace_id);
            return (
              <li key={e.id} className="flex items-center gap-2 py-1 text-sm">
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{horaConSegundos(e.hora)}</span>
                <Punto clase={COLOR_NIVEL[e.nivel]} etiqueta={NOMBRE_NIVEL[e.nivel]} />
                <span data-texto className="min-w-0 flex-1">
                  {e.texto}
                </span>
                {traza ? (
                  <a
                    href={traza}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn("inline-flex shrink-0 items-center gap-1 rounded text-primary underline-offset-4 hover:underline", FOCO)}
                  >
                    ver traza
                    <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
