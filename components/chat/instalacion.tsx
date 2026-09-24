"use client";

import { DownloadIcon, ShareIcon, XIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { FOCO } from "@/components/acceso/marco";
import {
  TEXTOS_PWA,
  descartarOferta,
  entornoActual,
  ofertaDescartada,
  ofertaInstalacion,
  pedirInstalacion,
  suscribirInstalacion,
  type Oferta,
} from "@/lib/pwa";
import { cn } from "@/lib/utils";

// Qué se puede ofrecer ahora mismo en este navegador (se actualiza con
// `beforeinstallprompt` y `appinstalled`).
export function useOfertaInstalacion(): Oferta {
  return useSyncExternalStore(
    suscribirInstalacion,
    () => ofertaInstalacion(entornoActual()),
    () => null,
  );
}

export function instruccionIos(oferta: Oferta): string {
  return oferta === "ios-otro" ? TEXTOS_PWA.iosOtro : TEXTOS_PWA.iosSafari;
}

// Banner discreto bajo la cabecera. Nunca tapa el cuadro de texto: ocupa su
// propia fila en la columna del chat. «Ahora no» lo oculta para siempre.
export function BannerInstalacion() {
  const oferta = useOfertaInstalacion();
  const [descartada, setDescartada] = useState(ofertaDescartada);
  if (!oferta || descartada) return null;

  function cerrar() {
    descartarOferta();
    setDescartada(true);
  }

  return (
    <div role="region" aria-label={TEXTOS_PWA.instalar} className="flex items-center gap-2 border-b border-border bg-card py-1 pr-1 pl-4 text-sm">
      {oferta === "instalar" ? (
        <>
          <DownloadIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex-1 text-muted-foreground">{TEXTOS_PWA.ofertaAndroid}</span>
          <button
            type="button"
            onClick={() => void pedirInstalacion()}
            className={cn("min-h-11 shrink-0 rounded-full border border-border px-4 font-medium text-foreground hover:bg-muted", FOCO)}
          >
            {TEXTOS_PWA.instalar}
          </button>
        </>
      ) : (
        <>
          <ShareIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex-1 py-2 text-muted-foreground">{instruccionIos(oferta)}</span>
        </>
      )}
      <button
        type="button"
        onClick={cerrar}
        aria-label={TEXTOS_PWA.cerrar}
        className={cn("flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted", FOCO)}
      >
        <XIcon className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
