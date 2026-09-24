"use client";

import { EllipsisVerticalIcon, ShareIcon } from "lucide-react";
import { useState } from "react";
import { FOCO } from "@/components/acceso/marco";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { COMO_FUNCIONA, TEXTOS } from "@/lib/chat-ui";
import { TEXTOS_PWA, pedirInstalacion } from "@/lib/pwa";
import { cn } from "@/lib/utils";
import { instruccionIos, useOfertaInstalacion } from "./instalacion";

// Cabecera fija de 56 px: título y menú (nueva conversación, cómo funciona y,
// en el teléfono, instalar la app). La opción de instalar sigue en el menú
// aunque se haya cerrado el banner.
export function Cabecera({ onNuevaConversacion }: { onNuevaConversacion: () => void }) {
  const [ayuda, setAyuda] = useState(false);
  const [instrucciones, setInstrucciones] = useState(false);
  const oferta = useOfertaInstalacion();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border pr-1 pl-4">
      <p className="font-medium">{TEXTOS.titulo}</p>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={TEXTOS.menu}
          className={cn("flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted", FOCO)}
        >
          <EllipsisVerticalIcon className="size-5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem className="min-h-11 px-3 text-base" onClick={onNuevaConversacion}>
            {TEXTOS.nuevaConversacion}
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11 px-3 text-base" onClick={() => setAyuda(true)}>
            {TEXTOS.comoFunciona}
          </DropdownMenuItem>
          {oferta === "instalar" && (
            <DropdownMenuItem className="min-h-11 px-3 text-base" onClick={() => void pedirInstalacion()}>
              {TEXTOS_PWA.instalar}
            </DropdownMenuItem>
          )}
          {(oferta === "ios-safari" || oferta === "ios-otro") && (
            <DropdownMenuItem className="min-h-11 px-3 text-base" onClick={() => setInstrucciones(true)}>
              {TEXTOS_PWA.agregarInicio}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={ayuda} onOpenChange={setAyuda}>
        <DialogContent showCloseButton={false} className="gap-3 p-5">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">{TEXTOS.comoFunciona}</DialogTitle>
          </DialogHeader>
          {COMO_FUNCIONA.map((p) => (
            <p key={p} className="text-sm leading-6 text-muted-foreground">
              {p}
            </p>
          ))}
          <DialogClose
            className={cn("mt-1 min-h-11 rounded-full border border-border px-5 font-medium hover:bg-muted", FOCO)}
          >
            {TEXTOS.entendido}
          </DialogClose>
        </DialogContent>
      </Dialog>
      <Dialog open={instrucciones} onOpenChange={setInstrucciones}>
        <DialogContent showCloseButton={false} className="gap-3 p-5">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">{TEXTOS_PWA.agregarInicio}</DialogTitle>
          </DialogHeader>
          <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
            <ShareIcon className="mt-1 size-4 shrink-0" aria-hidden="true" />
            <span>{instruccionIos(oferta)}</span>
          </p>
          <DialogClose
            className={cn("mt-1 min-h-11 rounded-full border border-border px-5 font-medium hover:bg-muted", FOCO)}
          >
            {TEXTOS_PWA.entendido}
          </DialogClose>
        </DialogContent>
      </Dialog>
    </header>
  );
}
