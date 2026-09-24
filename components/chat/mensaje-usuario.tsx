import { ClockIcon } from "lucide-react";
import { TEXTOS } from "@/lib/chat-ui";

// Burbuja del usuario: a la derecha, superficie con borde, radio 18 px, máx. 85 %.
// `enEspera`: el asistente está en pausa y la pregunta se enviará sola al volver.
export function MensajeUsuario({ texto, enEspera = false }: { texto: string; enEspera?: boolean }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <p className="max-w-[85%] rounded-[18px] border border-border bg-card px-4 py-2.5 text-base leading-6 whitespace-pre-wrap break-words">
        {texto}
      </p>
      {enEspera ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ClockIcon className="size-3.5" aria-hidden="true" />
          {TEXTOS.enEspera}
        </span>
      ) : null}
    </div>
  );
}
