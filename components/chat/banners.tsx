import { WifiOffIcon, PauseCircleIcon, RotateCcwIcon } from "lucide-react";
import { FOCO } from "@/components/acceso/marco";
import { TEXTOS } from "@/lib/chat-ui";
import { cn } from "@/lib/utils";

const BANNER = "flex items-center gap-2 border-b border-border bg-card px-4 py-2.5 text-sm";

export function BannerSinConexion() {
  return (
    <div role="status" className={BANNER}>
      <WifiOffIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{TEXTOS.sinConexion}</span>
    </div>
  );
}

// 423: el asistente está en pausa. El chat reintenta solo cada 20 s.
export function BannerMantenimiento({ mensaje }: { mensaje: string }) {
  return (
    <div role="status" className={BANNER}>
      <PauseCircleIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{mensaje}</span>
    </div>
  );
}

// 429 tope: mensaje del servidor encima del composer (deshabilitado).
export function AvisoTope({ mensaje }: { mensaje: string }) {
  return (
    <p role="status" className="mb-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      {mensaje}
    </p>
  );
}

// Stream cortado: queda el texto parcial y se ofrece reintentar.
export function AvisoInterrumpida({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
      <span>{TEXTOS.interrumpida}</span>
      <button
        type="button"
        onClick={onReintentar}
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-4 text-foreground hover:bg-muted",
          FOCO,
        )}
      >
        <RotateCcwIcon className="size-4" aria-hidden="true" />
        {TEXTOS.reintentar}
      </button>
    </div>
  );
}
