import { toAISdkStream } from "@mastra/ai-sdk";
import type { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { ChunkFrom, type ChunkType, type MastraModelOutput } from "@mastra/core/stream";
import { MENSAJES_BLOQUEO, TIPO_PARTE_GUARDRAIL, mensajeDeTripwire, motivoDeTripwire, type MotivoBloqueo } from "./processors/mensajes";
import {
  CLAVE_VEREDICTO,
  verificarEntrada as verificarPorDefecto,
  type Veredicto,
  type VerificarEntrada,
} from "./processors/verificacion-entrada";

// Un turno de chat (decisión de Raúl, 2026-09-23): los guardrails de entrada
// (inyección ∥ alcance) corren EN PARALELO con el agente, no antes.
//
// 1. Arranca la verificación y `agente.stream(...)` a la vez. El veredicto va en
//    el requestContext (`veredicto_entrada`): `escalar_pregunta` lo espera antes
//    de escribir y el procesador `GuardiaEntrada` lo registra en la traza.
// 2. Retiene TODOS los chunks del agente hasta conocer el veredicto. Suele
//    costar poco: el primer paso casi siempre es una llamada a herramienta.
// 3. Permitido: entrega lo retenido en orden y deja pasar el resto.
//    Bloqueado: descarta lo retenido y emite solo un chunk `tripwire` con el
//    mensaje fijo, igual que el bloqueo de entrada de T06 (misma UI).
//    El agente se detiene solo: `GuardiaEntrada` lanza un tripwire en su
//    siguiente punto de control, y así la memoria no guarda nada. NO se cancela
//    con `abortSignal`: Mastra guardaría la pregunta y la respuesta parcial.

export interface OpcionesTurno {
  // Cualquier agente con `GuardiaEntrada` en sus procesadores (p. ej. `charla`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agente: Agent<any, any, any, any>;
  mensaje: string;
  requestContext?: RequestContext;
  memory?: { thread: string; resource: string };
  // Cancelación externa (cliente que se va, timeout). Corta el agente.
  abortSignal?: AbortSignal;
  maxSteps?: number;
  // Solo para tests: guardrails falsos.
  verificar?: VerificarEntrada;
}

export interface Turno {
  // Chunks de Mastra ya verificados. Es lo único que debe llegar al cliente.
  fullStream: ReadableStream<ChunkType>;
  veredicto: Promise<Veredicto>;
  runId: string;
  traceId: string | undefined;
  // Señal que recibe el agente (se aborta si el consumidor cancela el stream).
  senal: AbortSignal;
  // Se resuelve cuando la ejecución del agente terminó del todo (memoria
  // guardada o descartada, procesadores de salida ejecutados).
  fin: Promise<void>;
  // Salida cruda del agente: solo para metadatos (usage, traceId). NUNCA
  // enviar su texto ni su stream al cliente: no pasan por la retención.
  salidaAgente: MastraModelOutput;
  metricas: MetricasTurno;
}

// Tiempos en ms desde el inicio del turno (para trazas, panel y mediciones).
export interface MetricasTurno {
  veredictoMs?: number;
  // Primer text-delta que produjo el agente (quizá retenido).
  primerTextoAgenteMs?: number;
  // Primer text-delta entregado al consumidor.
  primerTextoEntregadoMs?: number;
  // Cuánto retrasaron los guardrails el primer texto (0 si ya estaban listos).
  readonly retencionMs?: number;
}

function chunkDeBloqueo(v: Extract<Veredicto, { bloqueado: true }>, runId: string): ChunkType {
  return {
    type: "tripwire",
    runId,
    from: ChunkFrom.AGENT,
    payload: { reason: v.mensaje, metadata: v.metadata, processorId: v.processorId },
  } as ChunkType;
}

export async function ejecutarTurno(opciones: OpcionesTurno): Promise<Turno> {
  const inicio = performance.now();
  const ahora = () => Math.round(performance.now() - inicio);
  const metricas: MetricasTurno = {
    get retencionMs() {
      const { primerTextoAgenteMs: a, primerTextoEntregadoMs: e } = this;
      return a === undefined || e === undefined ? undefined : Math.max(0, e - a);
    },
  };
  const requestContext = opciones.requestContext ?? new RequestContext();
  const control = new AbortController();
  const senal = opciones.abortSignal ? AbortSignal.any([opciones.abortSignal, control.signal]) : control.signal;

  const verificar = opciones.verificar ?? verificarPorDefecto;
  const veredicto = verificar(opciones.mensaje, { requestContext }, senal);
  requestContext.set(CLAVE_VEREDICTO, veredicto);

  let salida: MastraModelOutput;
  try {
    salida = (await opciones.agente.stream(opciones.mensaje, {
      requestContext,
      abortSignal: senal,
      ...(opciones.memory ? { memory: opciones.memory } : {}),
      ...(opciones.maxSteps ? { maxSteps: opciones.maxSteps } : {}),
    })) as MastraModelOutput;
  } catch (error) {
    control.abort();
    throw error;
  }

  type Estado = "pendiente" | "permitido" | "bloqueado" | "cancelado";
  // (cast: el estado cambia desde callbacks; evita que TS lo fije en "pendiente")
  let estado = "pendiente" as Estado;
  const retenidos: ChunkType[] = [];
  let fuenteTerminada = false;
  let errorFuente: unknown;
  let cerrado = false;
  let controlador!: ReadableStreamDefaultController<ChunkType>;

  const fullStream = new ReadableStream<ChunkType>({
    start(c) {
      controlador = c;
    },
    cancel() {
      estado = "cancelado";
      cerrado = true;
      retenidos.length = 0;
      control.abort();
    },
  });

  const entregar = (c: ChunkType) => {
    if (c.type === "text-delta" && metricas.primerTextoEntregadoMs === undefined) metricas.primerTextoEntregadoMs = ahora();
    controlador.enqueue(c);
  };

  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    if (errorFuente !== undefined) controlador.error(errorFuente);
    else controlador.close();
  };

  const fin = (async () => {
    const lector = salida.fullStream.getReader();
    try {
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        if (value.type === "text-delta" && metricas.primerTextoAgenteMs === undefined) metricas.primerTextoAgenteMs = ahora();
        if (estado === "permitido" && !cerrado) entregar(value);
        else if (estado === "pendiente") retenidos.push(value);
        // bloqueado o cancelado: se descarta (el agente se está deteniendo)
      }
    } catch (error) {
      errorFuente = error ?? new Error("stream del agente falló");
    } finally {
      fuenteTerminada = true;
      if (estado === "permitido") cerrar();
    }
  })();

  void veredicto.then((v) => {
    metricas.veredictoMs = ahora();
    if (estado === "cancelado") return;
    if (v.bloqueado) {
      estado = "bloqueado";
      retenidos.length = 0;
      if (!cerrado) {
        controlador.enqueue(chunkDeBloqueo(v, salida.runId));
        errorFuente = undefined;
        cerrar();
      }
      return;
    }
    estado = "permitido";
    for (const c of retenidos.splice(0)) entregar(c);
    if (fuenteTerminada) cerrar();
  });

  return {
    fullStream,
    veredicto,
    runId: salida.runId,
    traceId: salida.traceId,
    senal,
    fin,
    salidaAgente: salida,
    metricas,
  };
}

// Stream de AI SDK UI (v7) a partir del turno, para `createUIMessageStreamResponse`.
// Un bloqueo de entrada llega como parte `data-tripwire` (como en T06).
export function streamUI(turno: Pick<Turno, "fullStream">, opciones: Omit<Parameters<typeof toAISdkStream>[1], "from" | "version"> = {}) {
  // toAISdkStream solo lee `fullStream` del objeto que recibe.
  return toAISdkStream(turno as unknown as MastraModelOutput, { ...opciones, from: "agent", version: "v7" });
}

export interface ResultadoTurno {
  bloqueado: boolean;
  motivo: MotivoBloqueo | null;
  // Lo que ve el asistente: el mensaje fijo si hubo bloqueo o reemplazo.
  texto: string;
  herramientas: { nombre: string; args: unknown }[];
  tripwire: { reason: string; metadata?: unknown; processorId?: string } | null;
  // SinDatosPersonales reemplazó la respuesta.
  reemplazoSalida: boolean;
}

// Consume el stream del turno y resume lo que vería el asistente (evals, tests
// y mediciones). No usar en la ruta de chat: allí el stream va al cliente.
export async function consumirTurno(turno: Pick<Turno, "fullStream">): Promise<ResultadoTurno> {
  let texto = "";
  const herramientas: ResultadoTurno["herramientas"] = [];
  let tripwire: ResultadoTurno["tripwire"] = null;
  let reemplazoSalida = false;
  const lector = turno.fullStream.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    const c = value as { type: string; payload?: Record<string, unknown> };
    if (c.type === "text-delta") texto += String(c.payload?.text ?? "");
    else if (c.type === "tool-call") herramientas.push({ nombre: String(c.payload?.toolName), args: c.payload?.args });
    else if (c.type === "tripwire") tripwire = c.payload as ResultadoTurno["tripwire"];
    else if (c.type === TIPO_PARTE_GUARDRAIL) reemplazoSalida = true;
  }
  const motivo = motivoDeTripwire(tripwire) ?? (reemplazoSalida ? "datos_personales" : null);
  return {
    bloqueado: motivo !== null,
    motivo,
    texto: tripwire ? mensajeDeTripwire(tripwire) : reemplazoSalida ? MENSAJES_BLOQUEO.datos_personales : texto,
    herramientas,
    tripwire,
    reemplazoSalida,
  };
}
