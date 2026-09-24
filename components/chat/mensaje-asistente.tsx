"use client";

import { CheckIcon, CopyIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { useEffect, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { FOCO } from "@/components/acceso/marco";
import { TEXTOS, enviarFeedback, partirLaminas, textoVisible, type MensajeChat } from "@/lib/chat-ui";
import { cn } from "@/lib/utils";

type NodoMd = { type: string; value?: string; children?: NodoMd[]; data?: Record<string, unknown> };

const CLASE_CHIP =
  "mx-0.5 inline-block rounded-md border border-border bg-card px-1.5 py-px align-baseline font-mono text-[0.8em] leading-5 text-muted-foreground";

// Plugin de remark: cada «lámina N» de un texto pasa a ser un <span> chip.
// No toca el código (sus nodos no son `text`).
function remarkLaminas() {
  const recorrer = (nodo: NodoMd) => {
    if (!nodo.children) return;
    nodo.children = nodo.children.flatMap((hijo): NodoMd[] => {
      if (hijo.type !== "text" || !hijo.value) {
        recorrer(hijo);
        return [hijo];
      }
      return partirLaminas(hijo.value).map((trozo) =>
        typeof trozo === "string"
          ? { type: "text", value: trozo }
          : {
              type: "text",
              value: trozo.lamina,
              data: { hName: "span", hProperties: { dataLamina: "", className: CLASE_CHIP } },
            },
      );
    });
  };
  return (arbol: NodoMd) => recorrer(arbol);
}

const COMPONENTES: Components = {
  a: ({ node, ...props }) => {
    void node;
    return <a {...props} target="_blank" rel="noreferrer" className={cn("text-primary underline underline-offset-4", FOCO)} />;
  },
};

const CLASES_MD = cn(
  "text-base leading-7 break-words",
  "[&_p]:my-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1",
  "[&_strong]:font-semibold [&_h1]:text-lg [&_h2]:text-lg [&_h3]:font-semibold [&_h1,&_h2,&_h3]:mt-5 [&_h1,&_h2,&_h3]:mb-2",
  "[&_code]:font-mono [&_code]:text-[0.9em] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-3",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_table]:my-3 [&_table]:block [&_table]:overflow-x-auto [&_td,&_th]:border [&_td,&_th]:border-border [&_td,&_th]:px-2 [&_td,&_th]:py-1",
);

const BOTON_ACCION = cn(
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2 text-sm text-muted-foreground",
  "hover:bg-muted hover:text-foreground aria-pressed:text-foreground",
  FOCO,
);

export interface PropsMensajeAsistente {
  partes: MensajeChat["parts"];
  traceId?: string;
  // El stream de este mensaje terminó: se muestran las acciones.
  terminado: boolean;
  onSesionExpirada: () => void;
}

export function MensajeAsistente({ partes, traceId, terminado, onSesionExpirada }: PropsMensajeAsistente) {
  const texto = textoVisible(partes);
  const [copiado, setCopiado] = useState(false);
  const [voto, setVoto] = useState<1 | -1 | null>(null);

  useEffect(() => {
    if (!copiado) return;
    const t = window.setTimeout(() => setCopiado(false), 2000);
    return () => window.clearTimeout(t);
  }, [copiado]);

  if (!texto) return null;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      toast.error("No pudimos copiar el texto.");
    }
  }

  async function votar(valor: 1 | -1) {
    if (!traceId || voto === valor) return;
    const anterior = voto;
    setVoto(valor);
    const r = await enviarFeedback(traceId, valor);
    if (r.ok) return;
    setVoto(anterior);
    if (r.tipo === "http" && r.status === 401) {
      toast.error(r.mensaje);
      onSesionExpirada();
      return;
    }
    toast.error(TEXTOS.errorFeedback);
  }

  return (
    <div className="w-full">
      <div className={CLASES_MD}>
        <Markdown remarkPlugins={[remarkGfm, remarkLaminas]} components={COMPONENTES}>
          {texto}
        </Markdown>
      </div>
      {terminado && (
        <div className="-ml-2 mt-1 flex items-center gap-0.5">
          <button type="button" className={BOTON_ACCION} aria-label={copiado ? TEXTOS.copiado : TEXTOS.copiar} onClick={copiar}>
            {copiado ? <CheckIcon className="size-4" aria-hidden="true" /> : <CopyIcon className="size-4" aria-hidden="true" />}
            {copiado && <span aria-hidden="true">{TEXTOS.copiado}</span>}
          </button>
          {traceId && (
            <>
              <button type="button" className={BOTON_ACCION} aria-label={TEXTOS.meSirvio} aria-pressed={voto === 1} onClick={() => votar(1)}>
                <ThumbsUpIcon className={cn("size-4", voto === 1 && "fill-current")} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={BOTON_ACCION}
                aria-label={TEXTOS.noMeSirvio}
                aria-pressed={voto === -1}
                onClick={() => votar(-1)}
              >
                <ThumbsDownIcon className={cn("size-4", voto === -1 && "fill-current")} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
