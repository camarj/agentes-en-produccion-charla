import type { MastraDBMessage } from "@mastra/core/memory";
import type {
  ProcessOutputResultArgs,
  ProcessOutputStreamArgs,
  Processor,
  ProcessorStreamWriter,
} from "@mastra/core/processors";
import type { RequestContext } from "@mastra/core/request-context";
import type { ChunkType } from "@mastra/core/stream";
import { asistentes, type PerfilPrivado } from "@/lib/db/asistentes";
import { esNombreSpeaker } from "@/lib/speaker";
import { CLAVE_ASISTENTE } from "../tools/contexto";
import { MENSAJES_BLOQUEO, TIPO_PARTE_GUARDRAIL } from "./mensajes";
import { registrarEnTraza } from "./traza-guardrail";

export const CACHE_ASISTENTES_MS = 60_000;
// Solo cuentan nombres, roles y descripciones de más de 4 caracteres
// (normalizados): evita bloquear por "Ana", "CTO" o "Dev".
export const LARGO_MINIMO = 5;

// Clave interna de Mastra (`REPROCESS_PART_KEY`, no exportada en 1.69): una
// parte guardada aquí se vuelve a pasar por los procesadores de salida después
// de la parte devuelta. Permite emitir el texto retenido Y el `text-end`.
const CLAVE_REPROCESO = "__mastraReprocessPart";

const MENSAJE = MENSAJES_BLOQUEO.datos_personales;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u;
const LETRA_O_NUMERO = /[\p{L}\p{N}]/u;
const ESPACIO = /\s/;

export type TipoDatoPersonal = "email" | "otro_asistente";

export interface Terminos {
  otros: string[];
  // Cuántos caracteres del final del texto se retienen en el stream.
  reserva: number;
}

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function util(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const n = normalizar(valor);
  return n.length >= LARGO_MINIMO ? n : null;
}

// Un rol de una sola palabra ("Contador", "Tecnología") es una palabra común:
// vigilarlo bloquearía respuestas normales. Solo cuentan roles de 2+ palabras.
function rolUtil(valor: unknown): string | null {
  const n = util(valor);
  return n && n.includes(" ") ? n : null;
}

export interface PerfilActual {
  asistenteId?: string | null;
  rol?: string | null;
  descripcion?: string | null;
}

export function construirTerminos(perfiles: PerfilPrivado[], actual: PerfilActual): Terminos {
  const propio = actual.asistenteId ? perfiles.find((p) => p.id === actual.asistenteId) : undefined;
  const nombrePropio = propio ? normalizar(propio.nombre) : null;
  // El perfil propio se permite (Raúl, 2026-09-23): es la persona viendo sus
  // datos en su teléfono. Un rol que comparte con otro asistente tampoco es ajeno.
  const propios = new Set<string>();
  for (const n of [nombrePropio, rolUtil(actual.rol), rolUtil(propio?.rol)]) {
    if (n) propios.add(n);
  }
  const otros = new Set<string>();
  for (const p of perfiles) {
    if (p.id === actual.asistenteId) continue;
    // El speaker (Raúl Camacho) no es un asistente: el agente habla de él.
    if (esNombreSpeaker(p.nombre)) continue;
    for (const n of [util(p.nombre), rolUtil(p.rol)]) {
      if (n && !propios.has(n)) otros.add(n);
    }
  }
  const largo = Math.max(0, ...[...otros].map((t) => t.length));
  return { otros: [...otros], reserva: Math.ceil(largo * 1.25) + 8 };
}

// ¿Aparece `termino` como palabra(s) completa(s) en `texto` (ambos normalizados)?
// Si `final` es false, una coincidencia pegada al final no cuenta todavía: el
// siguiente trozo del stream podría continuar la palabra.
function contienePalabra(texto: string, termino: string, final: boolean): boolean {
  for (let i = texto.indexOf(termino); i !== -1; i = texto.indexOf(termino, i + 1)) {
    const fin = i + termino.length;
    const antesOk = i === 0 || !LETRA_O_NUMERO.test(texto[i - 1]);
    if (!antesOk) continue;
    if (fin === texto.length) {
      if (final) return true;
      continue;
    }
    if (!LETRA_O_NUMERO.test(texto[fin])) return true;
  }
  return false;
}

export function buscarDatoPersonal(texto: string, terminos: Terminos, { final }: { final: boolean }): TipoDatoPersonal | null {
  if (EMAIL.test(texto)) return "email";
  const n = normalizar(texto);
  if (terminos.otros.some((t) => contienePalabra(n, t, final))) return "otro_asistente";
  return null;
}

// Hasta dónde se puede emitir `pendiente` sin soltar el comienzo de un dato
// que aún podría completarse: se retienen los últimos `reserva` caracteres y
// se corta siempre después de un espacio (un email o una palabra a medias
// nunca sale).
function puntoDeCorte(pendiente: string, reserva: number): number {
  for (let i = pendiente.length - reserva - 1; i >= 0; i--) {
    if (ESPACIO.test(pendiente[i])) return i + 1;
  }
  return 0;
}

interface ParteTexto {
  type: "text-delta";
  payload: { text: string; id?: string };
  [clave: string]: unknown;
}

interface EstadoPrivacidad {
  terminos?: Promise<Terminos>;
  procesado?: string; // texto ya revisado (emitido), con saltos entre bloques
  pendiente?: string; // texto retenido, aún no emitido
  plantilla?: ParteTexto;
  bloqueo?: TipoDatoPersonal | "error";
  huboTexto?: boolean;
}

export interface OpcionesSinDatosPersonales {
  cargarAsistentes?: () => Promise<PerfilPrivado[]>;
  cacheMs?: number;
  ahora?: () => number;
}

function textoDe(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

function perfilActual(requestContext: RequestContext | undefined): PerfilActual {
  return {
    asistenteId: textoDe(requestContext?.get(CLAVE_ASISTENTE)),
    rol: textoDe(requestContext?.get("rol")),
    descripcion: textoDe(requestContext?.get("descripcion")),
  };
}

function textoAsistente(messages: MastraDBMessage[]): string {
  return messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.content.parts ?? [])
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

// Deja un único texto (el mensaje seguro) en la última respuesta del asistente
// y quita el texto (y el razonamiento) de las demás. Conserva herramientas y
// partes `data-*`.
function reemplazarRespuesta(messages: MastraDBMessage[]): MastraDBMessage[] {
  let ultimo = -1;
  messages.forEach((m, i) => {
    if (m.role === "assistant") ultimo = i;
  });
  const salida: MastraDBMessage[] = [];
  messages.forEach((m, i) => {
    if (m.role !== "assistant") return void salida.push(m);
    const otras = (m.content.parts ?? []).filter((p) => p.type !== "text" && p.type !== "reasoning");
    if (i === ultimo) {
      salida.push({ ...m, content: { ...m.content, parts: [...otras, { type: "text", text: MENSAJE }], content: MENSAJE } });
    } else if (otras.length > 0) {
      salida.push({ ...m, content: { ...m.content, parts: otras, content: undefined } });
    }
  });
  return salida;
}

// Guardrail de salida: nunca deja salir emails, ni nombres o roles de otros
// asistentes. El perfil propio sí se permite. Si encuentra uno,
// reemplaza la respuesta por el mensaje seguro (no aborta en silencio).
//
// Stream: retiene el final del texto (lo justo para que ningún dato quede a
// medias) y revisa todo lo acumulado en cada trozo, así que ningún dato
// personal llega al cliente y el resto del texto sigue saliendo token a token.
// Al detectar uno, emite el mensaje seguro y una parte `data-guardrail`, y
// descarta el resto del texto. `processOutputResult` deja el mensaje seguro
// como respuesta final (texto de generate/stream y memoria).
export class SinDatosPersonales implements Processor<"sin-datos-personales"> {
  readonly id = "sin-datos-personales" as const;
  readonly name = "Sin datos personales";
  private readonly cargarAsistentes: () => Promise<PerfilPrivado[]>;
  private readonly cacheMs: number;
  private readonly ahora: () => number;
  private cache?: { hasta: number; datos: PerfilPrivado[] };
  private cargando?: Promise<PerfilPrivado[] | null>;

  constructor(opciones: OpcionesSinDatosPersonales = {}) {
    this.cargarAsistentes = opciones.cargarAsistentes ?? (() => asistentes.listarPerfiles());
    this.cacheMs = opciones.cacheMs ?? CACHE_ASISTENTES_MS;
    this.ahora = opciones.ahora ?? Date.now;
  }

  // Asistentes con caché de 60 s. Si la carga falla, usa la caché vencida o,
  // sin caché, null (modo degradado: solo emails).
  private async perfiles(): Promise<PerfilPrivado[] | null> {
    if (this.cache && this.ahora() < this.cache.hasta) return this.cache.datos;
    this.cargando ??= this.cargarAsistentes()
      .then((datos) => {
        this.cache = { hasta: this.ahora() + this.cacheMs, datos };
        return datos;
      })
      .catch(() => this.cache?.datos ?? null)
      .finally(() => {
        this.cargando = undefined;
      });
    return this.cargando;
  }

  private terminos(estado: EstadoPrivacidad, args: { requestContext?: RequestContext; tracingContext?: unknown }) {
    estado.terminos ??= this.perfiles().then((perfiles) => {
      if (!perfiles) {
        registrarEnTraza(args.tracingContext as never, { sin_datos_personales_degradado: true });
      }
      return construirTerminos(perfiles ?? [], perfilActual(args.requestContext));
    });
    return estado.terminos;
  }

  private async bloquear(
    estado: EstadoPrivacidad,
    tipo: TipoDatoPersonal | "error",
    plantilla: ParteTexto,
    writer: ProcessorStreamWriter | undefined,
    tracingContext: unknown,
  ): Promise<ParteTexto> {
    estado.bloqueo = tipo;
    estado.pendiente = "";
    registrarEnTraza(tracingContext as never, {
      guardrail: "sin_datos_personales",
      motivo: "datos_personales",
      tipo_dato: tipo,
    });
    try {
      await writer?.custom({ type: TIPO_PARTE_GUARDRAIL, data: { guardrail: "sin_datos_personales", motivo: "datos_personales" } });
    } catch {
      // la parte de datos es un aviso para la UI; el texto seguro sale igual
    }
    const separador = estado.huboTexto ? "\n\n" : "";
    estado.huboTexto = true;
    return { ...plantilla, payload: { ...plantilla.payload, text: separador + MENSAJE } };
  }

  async processOutputStream(args: ProcessOutputStreamArgs): Promise<ChunkType | null> {
    const { part, writer, tracingContext } = args;
    const estado = args.state as EstadoPrivacidad;
    const esTexto = part.type === "text-delta";
    try {
      if (estado.bloqueo) return esTexto ? null : part;

      if (esTexto) {
        const parte = part as unknown as ParteTexto;
        estado.plantilla = parte;
        estado.pendiente = (estado.pendiente ?? "") + parte.payload.text;
        const terminos = await this.terminos(estado, args);
        const total = (estado.procesado ?? "") + estado.pendiente;
        const tipo = buscarDatoPersonal(total, terminos, { final: false });
        if (tipo) return (await this.bloquear(estado, tipo, parte, writer, tracingContext)) as unknown as ChunkType;
        const corte = puntoDeCorte(estado.pendiente, terminos.reserva);
        if (corte === 0) return null;
        const salida = estado.pendiente.slice(0, corte);
        estado.pendiente = estado.pendiente.slice(corte);
        estado.procesado = (estado.procesado ?? "") + salida;
        estado.huboTexto = true;
        return { ...parte, payload: { ...parte.payload, text: salida } } as unknown as ChunkType;
      }

      // Cualquier otra parte cierra el bloque de texto: se revisa lo retenido
      // como final y se emite antes de esa parte.
      if (!estado.pendiente || !estado.plantilla) return part;
      const plantilla = estado.plantilla;
      const terminos = await this.terminos(estado, args);
      const total = (estado.procesado ?? "") + estado.pendiente;
      const tipo = buscarDatoPersonal(total, terminos, { final: true });
      const salida = tipo
        ? await this.bloquear(estado, tipo, plantilla, writer, tracingContext)
        : { ...plantilla, payload: { ...plantilla.payload, text: estado.pendiente } };
      if (!tipo) {
        estado.procesado = total + "\n";
        estado.pendiente = "";
        estado.huboTexto = true;
      }
      if (!writer) {
        // Sin writer Mastra no puede reemitir la parte: se prioriza no romper el
        // protocolo del stream. El texto retenido queda solo en la respuesta
        // final (processOutputResult), nunca sale sin revisar.
        estado.pendiente = "";
        return part;
      }
      args.state[CLAVE_REPROCESO] = part;
      return salida as unknown as ChunkType;
    } catch {
      // Error inesperado: falla cerrada, se reemplaza la respuesta.
      if (esTexto) {
        return (await this.bloquear(estado, "error", part as unknown as ParteTexto, writer, tracingContext)) as unknown as ChunkType;
      }
      estado.bloqueo = "error";
      estado.pendiente = "";
      return part;
    }
  }

  async processOutputResult(args: ProcessOutputResultArgs): Promise<MastraDBMessage[]> {
    const { messages, tracingContext } = args;
    const estado = (args.state ?? {}) as EstadoPrivacidad;
    try {
      if (estado.bloqueo) return reemplazarRespuesta(messages);
      const texto = textoAsistente(messages);
      if (!texto) return messages;
      const tipo = buscarDatoPersonal(texto, await this.terminos(estado, args), { final: true });
      if (!tipo) return messages;
      registrarEnTraza(tracingContext, { guardrail: "sin_datos_personales", motivo: "datos_personales", tipo_dato: tipo });
      return reemplazarRespuesta(messages);
    } catch {
      registrarEnTraza(tracingContext, { guardrail: "sin_datos_personales", motivo: "datos_personales", tipo_dato: "error" });
      return reemplazarRespuesta(messages);
    }
  }
}
