import { TEXTOS, type Indicador } from "@/lib/chat-ui";

// Antes del primer token: tres puntos. Con una herramienta en curso, qué hace.
// Las animaciones solo corren si el sistema no pide menos movimiento.
export function Indicadores({ tipo }: { tipo: Indicador }) {
  if (tipo === "pensando") {
    return (
      <div role="status" className="flex h-7 items-center gap-1.5" aria-label={TEXTOS.pensando}>
        <span className="sr-only">{TEXTOS.pensando}</span>
        {[0, 150, 300].map((retraso) => (
          <span
            key={retraso}
            aria-hidden="true"
            className="size-2 rounded-full bg-muted-foreground motion-safe:animate-pulse"
            style={{ animationDelay: `${retraso}ms` }}
          />
        ))}
      </div>
    );
  }
  return (
    <p role="status" className="flex h-7 items-center gap-2 text-sm text-muted-foreground">
      <span aria-hidden="true" className="size-2 rounded-full bg-muted-foreground motion-safe:animate-pulse" />
      {tipo === "escalando" ? TEXTOS.escalando : TEXTOS.buscando}
    </p>
  );
}
