import type { MastraDBMessage } from "@mastra/core/memory";
import { TODOS_LOS_MENSAJES_BLOQUEO } from "../processors/mensajes";

// Lectura de una ejecución del agente tal como la reciben los scorers en vivo
// (@mastra/core 1.69, `type: 'agent'`):
// - run.input: { inputMessages, rememberedMessages, systemMessages, taggedSystemMessages }
// - run.output: MastraDBMessage[] del turno. Cada llamada a herramienta está en
//   content.parts (type 'tool-invocation') y en content.toolInvocations, con
//   { state: 'result' | 'call' | 'output-error', toolCallId, toolName, args, result }.
// - run.requestContext: objeto plano (instantánea del RequestContext).

export const HERRAMIENTA_BUSQUEDA = "buscar_laminas";

export interface Invocacion {
  toolCallId: string;
  toolName: string;
  state?: string;
  args?: unknown;
  result?: unknown;
}

export interface Fragmento {
  lamina: number;
  titulo: string;
  fragmento: string;
  notas: string | null;
}

export interface Busquedas {
  // Se llamó buscar_laminas al menos una vez.
  llamada: boolean;
  // Alguna llamada devolvió al menos un resultado.
  conResultados: boolean;
  fragmentos: Fragmento[];
}

type ParteLibre = { type?: string; text?: string; toolInvocation?: Invocacion };
type ContenidoLibre = { parts?: ParteLibre[]; toolInvocations?: Invocacion[]; content?: unknown };

function contenido(m: MastraDBMessage | undefined): ContenidoLibre {
  const c = (m as { content?: unknown } | undefined)?.content;
  return c && typeof c === "object" ? (c as ContenidoLibre) : {};
}

function comoLista(mensajes: unknown): MastraDBMessage[] {
  return Array.isArray(mensajes) ? (mensajes as MastraDBMessage[]) : [];
}

// Todas las llamadas a herramientas, sin duplicados (una llamada aparece en
// `parts` y en `toolInvocations`; gana la que tiene resultado).
export function invocaciones(mensajes: unknown): Invocacion[] {
  const porId = new Map<string, Invocacion>();
  for (const m of comoLista(mensajes)) {
    const c = contenido(m);
    const candidatas = [
      ...(c.parts ?? []).filter((p) => p?.type === "tool-invocation").map((p) => p.toolInvocation),
      ...(c.toolInvocations ?? []),
    ];
    for (const inv of candidatas) {
      if (!inv || typeof inv.toolCallId !== "string") continue;
      const previa = porId.get(inv.toolCallId);
      if (!previa || (previa.state !== "result" && inv.state === "result")) porId.set(inv.toolCallId, inv);
    }
  }
  return [...porId.values()];
}

function esFragmento(v: unknown): v is Fragmento {
  const f = v as Fragmento;
  return !!f && typeof f === "object" && typeof f.lamina === "number" && typeof f.fragmento === "string";
}

export function busquedasDeLaminas(mensajes: unknown): Busquedas {
  const llamadas = invocaciones(mensajes).filter((i) => i.toolName === HERRAMIENTA_BUSQUEDA);
  const fragmentos: Fragmento[] = [];
  for (const inv of llamadas) {
    if (inv.state !== "result") continue;
    const resultados = (inv.result as { resultados?: unknown } | undefined)?.resultados;
    if (!Array.isArray(resultados)) continue;
    for (const r of resultados.filter(esFragmento)) {
      if (!fragmentos.some((f) => f.lamina === r.lamina)) {
        fragmentos.push({ lamina: r.lamina, titulo: String(r.titulo ?? ""), fragmento: r.fragmento, notas: r.notas ?? null });
      }
    }
  }
  return { llamada: llamadas.length > 0, conResultados: fragmentos.length > 0, fragmentos };
}

function textoDeMensaje(m: MastraDBMessage): string {
  const c = contenido(m);
  const partes = (c.parts ?? []).filter((p) => p?.type === "text" && typeof p.text === "string").map((p) => p.text!);
  if (partes.length > 0) return partes.join("");
  return typeof c.content === "string" ? c.content : "";
}

// Texto final del agente en el turno (todas sus partes de texto).
export function textoRespuesta(output: unknown): string {
  return comoLista(output)
    .filter((m) => m.role === "assistant")
    .map(textoDeMensaje)
    .filter(Boolean)
    .join("\n")
    .trim();
}

// Último mensaje del usuario en el turno.
export function preguntaUsuario(input: unknown): string {
  const mensajes = comoLista((input as { inputMessages?: unknown } | undefined)?.inputMessages);
  const usuario = mensajes.filter((m) => m.role === "user");
  const ultimo = usuario[usuario.length - 1];
  return ultimo ? textoDeMensaje(ultimo).trim() : "";
}

// Mensajes recordados de turnos anteriores (memoria del hilo).
export function mensajesRecordados(input: unknown): MastraDBMessage[] {
  return comoLista((input as { rememberedMessages?: unknown } | undefined)?.rememberedMessages);
}

export function valorContexto(requestContext: unknown, clave: string): string | null {
  if (!requestContext || typeof requestContext !== "object") return null;
  const c = requestContext as { get?: (k: string) => unknown } & Record<string, unknown>;
  const v = typeof c.get === "function" ? c.get(clave) : c[clave];
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

const TEXTOS_BLOQUEO = new Set(TODOS_LOS_MENSAJES_BLOQUEO);

// La respuesta es uno de los mensajes fijos de los guardrails (T06).
export function esMensajeBloqueo(texto: string): boolean {
  return TEXTOS_BLOQUEO.has(texto.trim());
}

export function formatearFragmentos(fragmentos: Fragmento[]): string {
  return fragmentos
    .map((f) => {
      const notas = f.notas ? `\nSpeaker notes: ${f.notas}` : "";
      return `[Slide ${f.lamina}] ${f.titulo}\n${f.fragmento}${notas}`;
    })
    .join("\n\n");
}

const LARGO_RAZON = 300;

export function recortarRazon(razon: string): string {
  const t = razon.replace(/\s+/g, " ").trim();
  return t.length <= LARGO_RAZON ? t : `${t.slice(0, LARGO_RAZON - 1)}…`;
}
