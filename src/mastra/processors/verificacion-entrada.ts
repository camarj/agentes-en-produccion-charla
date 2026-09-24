import crypto from "node:crypto";
import { TripWire } from "@mastra/core/agent";
import type { MastraDBMessage } from "@mastra/core/memory";
import type { ProcessInputArgs } from "@mastra/core/processors";
import type { RequestContext } from "@mastra/core/request-context";
import { AlcanceCharla } from "./alcance-charla";
import { DeteccionInyeccion } from "./deteccion-inyeccion";
import { MENSAJES_BLOQUEO, mensajeDeBloqueo, motivoDeTripwire, type MotivoBloqueo } from "./mensajes";

// Guardrails de entrada fuera del bucle del agente (decisión de Raúl,
// 2026-09-23): la detección de inyección y el clasificador de alcance corren en
// paralelo entre sí Y en paralelo con el primer paso del agente. El veredicto
// se comparte por el requestContext (`veredicto_entrada`) con la herramienta
// `escalar_pregunta` y con el procesador `GuardiaEntrada`, y `ejecutarTurno`
// (src/mastra/turno.ts) retiene la salida hasta conocerlo.

export const CLAVE_VEREDICTO = "veredicto_entrada";

export type Veredicto =
  | { bloqueado: false; metadata: Record<string, unknown> }
  | {
      bloqueado: true;
      motivo: MotivoBloqueo;
      guardrail: string;
      confianza?: number;
      // Texto fijo en español que ve el asistente.
      mensaje: string;
      // Procesador que bloqueó (para el chunk `tripwire`).
      processorId: string;
      // Para la traza (agent_run). Nunca lleva el texto del usuario.
      metadata: Record<string, unknown>;
    };

export interface ContextoVerificacion {
  requestContext?: RequestContext;
  // Solo cuando se llama desde dentro del agente (Studio): anida las llamadas
  // de los guardrails en la traza del agente.
  tracingContext?: ProcessInputArgs["tracingContext"];
}

export type VerificarEntrada = (
  mensaje: string,
  contexto?: ContextoVerificacion,
  signal?: AbortSignal,
) => Promise<Veredicto>;

export interface OpcionesVerificador {
  deteccion?: DeteccionInyeccion;
  alcance?: AlcanceCharla;
}

type Resultado = { tipo: "ok" } | { tipo: "bloqueo"; tripwire: TripWire<unknown> } | { tipo: "error" };

const ID_INYECCION = "deteccion-inyeccion";
const ID_ALCANCE = "alcance-charla";

function mensajeDeUsuario(texto: string): MastraDBMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    createdAt: new Date(),
    content: { format: 2, parts: [{ type: "text", text: texto }] },
  };
}

function bloqueo(
  tripwire: TripWire<unknown>,
  guardrailPorDefecto: string,
  processorId: string,
  ms: number,
): Veredicto {
  const metadata = (tripwire.options?.metadata ?? {}) as Record<string, unknown>;
  const motivo = motivoDeTripwire({ reason: tripwire.message, metadata }) ?? "inyeccion";
  const guardrail = typeof metadata.guardrail === "string" ? metadata.guardrail : guardrailPorDefecto;
  const confianza = typeof metadata.confianza === "number" ? metadata.confianza : undefined;
  return {
    bloqueado: true,
    motivo,
    guardrail,
    ...(confianza !== undefined ? { confianza } : {}),
    mensaje: mensajeDeBloqueo(motivo),
    processorId,
    metadata: { ...metadata, guardrail, motivo, guardrails_entrada: "bloqueado", guardrails_entrada_ms: ms },
  };
}

// Falla cerrada de inyección: error inesperado del detector o cliente que se fue.
function bloqueoCerrado(ms: number, extra: Record<string, unknown>): Veredicto {
  return {
    bloqueado: true,
    motivo: "inyeccion",
    guardrail: "deteccion_inyeccion",
    mensaje: MENSAJES_BLOQUEO.inyeccion,
    processorId: ID_INYECCION,
    metadata: {
      guardrail: "deteccion_inyeccion",
      motivo: "inyeccion",
      falla_detector: true,
      ...extra,
      guardrails_entrada: "bloqueado",
      guardrails_entrada_ms: ms,
    },
  };
}

export function crearVerificadorEntrada(opciones: OpcionesVerificador = {}): VerificarEntrada {
  let deteccion = opciones.deteccion;
  let alcance = opciones.alcance;

  return async (mensaje, contexto = {}, signal) => {
    const inicio = performance.now();
    const ms = () => Math.round(performance.now() - inicio);
    const texto = mensaje.trim();
    if (!texto) return { bloqueado: false, metadata: { guardrails_entrada: "permitido", guardrails_entrada_ms: 0 } };
    if (signal?.aborted) return bloqueoCerrado(ms(), { cancelado: true });

    deteccion ??= new DeteccionInyeccion();
    alcance ??= new AlcanceCharla();

    // Cancela el clasificador si inyección ya decidió bloquear, o si el cliente se fue.
    const control = new AbortController();
    const senal = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
    const mensajes = [mensajeDeUsuario(texto)];

    const ejecutar = async (procesador: DeteccionInyeccion | AlcanceCharla, processorId: string): Promise<Resultado> => {
      const args = {
        messages: mensajes,
        systemMessages: [],
        state: {},
        retryCount: 0,
        messageList: undefined as never,
        requestContext: contexto.requestContext,
        tracingContext: contexto.tracingContext,
        abortSignal: senal,
        abort: (reason?: string, options?: { metadata?: unknown }): never => {
          throw new TripWire(reason ?? "", options, processorId);
        },
      } as unknown as ProcessInputArgs;
      try {
        await procesador.processInput(args);
        return { tipo: "ok" };
      } catch (error) {
        if (error instanceof TripWire) return { tipo: "bloqueo", tripwire: error };
        return { tipo: "error" };
      }
    };

    const inyeccion = ejecutar(deteccion, ID_INYECCION).then((r): Veredicto | null => {
      if (r.tipo === "ok") return null;
      if (r.tipo === "bloqueo") return bloqueo(r.tripwire, "deteccion_inyeccion", ID_INYECCION, ms());
      return bloqueoCerrado(ms(), {});
    });
    // Alcance falla abierta: un error inesperado deja pasar.
    const deAlcance = ejecutar(alcance, ID_ALCANCE).then((r): Veredicto | null =>
      r.tipo === "bloqueo" ? bloqueo(r.tripwire, "alcance_charla", ID_ALCANCE, ms()) : null,
    );

    let alCancelar: (() => void) | undefined;
    const cancelado = new Promise<"cancelado">((resolver) => {
      alCancelar = () => resolver("cancelado");
      signal?.addEventListener("abort", alCancelar, { once: true });
    });

    try {
      // Inyección gana siempre: si bloquea primero, no se espera al clasificador;
      // si alcance bloquea primero, se espera a inyección.
      const decision = (async (): Promise<Veredicto> => {
        const primero = await Promise.race([inyeccion.then((v) => ({ de: "inyeccion", v })), deAlcance.then((v) => ({ de: "alcance", v }))]);
        if (primero.de === "inyeccion" && primero.v) return primero.v;
        const [vi, va] = await Promise.all([inyeccion, deAlcance]);
        return vi ?? va ?? { bloqueado: false, metadata: { guardrails_entrada: "permitido", guardrails_entrada_ms: ms() } };
      })();
      const r = await Promise.race([decision, cancelado]);
      return r === "cancelado" ? bloqueoCerrado(ms(), { cancelado: true }) : r;
    } finally {
      control.abort();
      if (alCancelar) signal?.removeEventListener("abort", alCancelar);
    }
  };
}

// Instancia por defecto (modelos reales), creada al primer uso.
export const verificarEntrada: VerificarEntrada = crearVerificadorEntrada();

function esPromesa(valor: unknown): valor is Promise<Veredicto> {
  return typeof (valor as { then?: unknown } | null)?.then === "function";
}

// Veredicto guardado en el requestContext, o undefined si no hay (p. ej. la
// herramienta ejecutada fuera del agente).
export function promesaDeVeredicto(requestContext: RequestContext | undefined): Promise<Veredicto> | undefined {
  const valor = requestContext?.get(CLAVE_VEREDICTO);
  return esPromesa(valor) ? valor : undefined;
}

const PENDIENTE = Symbol("pendiente");

// El veredicto si ya se conoce, sin esperar (undefined si sigue pendiente).
export async function veredictoSiListo(promesa: Promise<Veredicto> | undefined): Promise<Veredicto | undefined> {
  if (!promesa) return undefined;
  const r = await Promise.race([promesa, Promise.resolve(PENDIENTE)]);
  return r === PENDIENTE ? undefined : r;
}
