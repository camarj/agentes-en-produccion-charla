"use client";

import { ArrowDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { FOCO } from "@/components/acceso/marco";
import { Skeleton } from "@/components/ui/skeleton";
import type { useAutoScroll } from "@/hooks/use-auto-scroll";
import { TEXTOS, textoVisible, type Grupo, type Indicador } from "@/lib/chat-ui";
import { cn } from "@/lib/utils";
import { AvisoInterrumpida } from "./banners";
import { Indicadores } from "./indicadores";
import { MensajeAsistente } from "./mensaje-asistente";
import { MensajeUsuario } from "./mensaje-usuario";

export interface PropsListaMensajes {
  grupos: Grupo[];
  cargando: boolean;
  // La última respuesta todavía se está generando.
  enCurso: boolean;
  indicador: Indicador | null;
  interrumpida: boolean;
  vacio: ReactNode;
  scroll: ReturnType<typeof useAutoScroll<HTMLDivElement>>;
  onReintentar: () => void;
  onSesionExpirada: () => void;
}

export function ListaMensajes(p: PropsListaMensajes) {
  const { ref, alDesplazar, irAlFinal, mostrarBajar } = p.scroll;
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} onScroll={alDesplazar} className="h-full overflow-y-auto overscroll-contain">
        <div
          role="log"
          aria-live="polite"
          aria-busy={p.enCurso}
          className="mx-auto flex min-h-full w-full max-w-[720px] flex-col gap-6 px-4 pt-6 pb-4"
        >
          {p.cargando ? (
            <div className="flex flex-col gap-3" aria-hidden="true">
              <Skeleton className="ml-auto h-10 w-2/3 rounded-[18px]" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ) : p.grupos.length === 0 ? (
            p.vacio
          ) : (
            p.grupos.map((g, i) =>
              g.role === "user" ? (
                <MensajeUsuario key={g.id} texto={textoVisible(g.parts)} />
              ) : (
                <MensajeAsistente
                  key={g.id}
                  partes={g.parts}
                  traceId={g.traceId}
                  terminado={!((p.enCurso || p.interrumpida) && i === p.grupos.length - 1)}
                  onSesionExpirada={p.onSesionExpirada}
                />
              ),
            )
          )}
          {p.indicador && <Indicadores tipo={p.indicador} />}
          {p.interrumpida && <AvisoInterrumpida onReintentar={p.onReintentar} />}
        </div>
      </div>
      {mostrarBajar && (
        <button
          type="button"
          aria-label={TEXTOS.irAlFinal}
          onClick={() => irAlFinal()}
          className={cn(
            "absolute bottom-3 left-1/2 flex size-11 -translate-x-1/2 items-center justify-center rounded-full",
            "border border-border bg-card text-foreground shadow-lg hover:bg-muted",
            FOCO,
          )}
        >
          <ArrowDownIcon className="size-5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
