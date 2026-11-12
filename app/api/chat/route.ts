import { createUIMessageStreamResponse } from "ai";
import type { NextRequest } from "next/server";
import {
  ERRORES_CHAT,
  MAX_PASOS_TURNO,
  MENSAJE_ERROR_STREAM,
  TIEMPO_MAXIMO_TURNO_MS,
  extraerPregunta,
  maxMensajesAsistente,
  protegerStreamUI,
  streamFallaTecnica,
  type MetadataMensaje,
} from "@/lib/chat";
import { escalamientos } from "@/lib/db/escalamientos";
import { turnos } from "@/lib/db/turnos";
import { interruptores } from "@/lib/db/interruptores";
import { sesiones } from "@/lib/db/sesiones";
import { costeEstimadoTurno, presupuesto, presupuestoMaximoUsd } from "@/lib/presupuesto";
import { limitadorChat } from "@/lib/rate-limit";
import { filaDeTurno, modeloDeRespuesta } from "@/lib/salud/fin-turno";
import { anotarEvento, anotarEventosDeTurno, eventosDeTurno } from "@/lib/salud/registro";
import { crearSenales, type SenalesTurno } from "@/lib/salud/senales";
import { errorInterno, leerJson, noAutenticado, respuestaError } from "@/lib/respuestas";
import { construirContextoTurno } from "@/lib/contexto-turno";
import { estadoDe, leerSesion } from "@/lib/session";
import { mastra } from "@/src/mastra";
import { VERSION_INSTRUCCIONES } from "@/src/mastra/agents/instructions";
import { ejecutarTurno, streamUI, tipoDeError, type Turno } from "@/src/mastra/turno";

const ESPERA_MAXIMA_USO_MS = 5000;
// Un turno bloqueado a mitad de una llamada a herramienta puede no cerrar nunca
// `turno.fin` (visto en vivo); el coste se suma igual tras este tope.
const ESPERA_MAXIMA_FIN_MS = TIEMPO_MAXIMO_TURNO_MS + 15_000;

function mantenimiento() {
  return respuestaError(423, "mantenimiento", ERRORES_CHAT.mantenimiento);
}

// Solo el tipo de error: el mensaje podría traer la pregunta o datos.
function registrarError(evento: string, error: unknown) {
  console.error(`[chat] ${evento}`, { tipo: error instanceof Error ? error.name : typeof error });
}

// Falla técnica antes del primer texto: la pregunta pasa a la cola de Raúl.
function escalarFalla(asistenteId: string, pregunta: string, traceId: string | undefined) {
  escalamientos
    .crear({ asistenteId, pregunta, motivo: "falla_tecnica", traceId: traceId ?? null })
    .catch((error: unknown) => registrarError("no se pudo registrar el escalamiento", error));
}

function conTope<T>(promesa: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promesa, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms).unref?.())]);
}

// Cuando el agente termina (memoria guardada): suma el coste estimado y deja
// la fila del turno para las métricas del panel (PRD §15 G7). Una falla en una
// de las dos escrituras no impide la otra.
// `externa`: tope de 45 s o cliente que se fue (no la cancelación interna del turno).
async function cerrarTurno(turno: Turno, iniciadoMs: number, senales: SenalesTurno, externa: AbortSignal) {
  const termino = await conTope(turno.fin.then(() => true), ESPERA_MAXIMA_FIN_MS);
  const finMs = termino ? Date.now() : null;
  let modelo: string | undefined;
  let uso: Awaited<Turno["salidaAgente"]["usage"]> | undefined;
  try {
    const salida = turno.salidaAgente;
    const r = await conTope(Promise.all([salida.usage, salida.response]), ESPERA_MAXIMA_USO_MS);
    uso = r?.[0];
    modelo = modeloDeRespuesta(r?.[1] as Parameters<typeof modeloDeRespuesta>[0]) ?? undefined;
  } catch {
    // Turno fallido o cancelado: queda el costo fijo de guardrails y jueces.
  }
  const desenlace = termino ? await turno.desenlace : null;
  const fila = filaDeTurno({
    iniciadoMs,
    finMs,
    desenlace,
    senales,
    modeloRespuesta: modelo ?? null,
    abortado: externa.aborted,
    traceId: turno.traceId ?? null,
  });
  const veredicto = await conTope(turno.veredicto, 0).catch(() => undefined);
  const meta = veredicto?.metadata as Record<string, unknown> | undefined;
  // Falla cerrada del detector de inyección (no cuenta si el cliente se fue).
  const detectorFallo = meta?.falla_detector === true && meta.cancelado !== true;
  const eventos = eventosDeTurno({ fila, senales, detectorFallo });
  const [coste, registro] = await Promise.allSettled([
    presupuesto.sumar(costeEstimadoTurno(modelo, uso)),
    turnos.registrar(fila),
    anotarEventosDeTurno(eventos, fila.traceId),
  ]);
  if (coste.status === "rejected") registrarError("no se pudo sumar el coste", coste.reason);
  if (registro.status === "rejected") registrarError("no se pudo registrar el turno", registro.reason);
}

// El turno ni siquiera arrancó: también cuenta como turno con falla.
function registrarTurnoSinArrancar(iniciadoMs: number, error: unknown) {
  const fila = filaDeTurno({
    iniciadoMs,
    finMs: Date.now(),
    desenlace: { motivoBloqueo: null, error: tipoDeError(error) },
    senales: {},
    modeloRespuesta: null,
    abortado: false,
    traceId: null,
  });
  turnos.registrar(fila).catch((e: unknown) => registrarError("no se pudo registrar el turno", e));
  void anotarEventosDeTurno(eventosDeTurno({ fila, senales: {}, detectorFallo: false }), null);
}

// POST /api/chat — cuerpo de useChat (`{ messages: UIMessage[] }`); se usa solo
// el texto del último mensaje del usuario. Responde un stream de AI SDK UI.
export async function POST(request: NextRequest) {
  try {
    const actual = await leerSesion(request);
    if (!actual) return noAutenticado();
    const { sesion, asistente } = actual;
    if (estadoDe(asistente) !== "listo") return respuestaError(403, "falta_perfil", ERRORES_CHAT.falta_perfil);

    const valores = await interruptores.obtenerTodos();
    if (valores.kill_switch === "on") return mantenimiento();

    const pregunta = extraerPregunta(await leerJson(request));
    if (!pregunta) return respuestaError(400, "mensaje_invalido", ERRORES_CHAT.mensaje_invalido);
    const limite = limitadorChat.consumir(asistente.id);
    if (!limite.permitido) {
      anotarEvento("limite_chat");
      return respuestaError(429, "demasiados_mensajes", ERRORES_CHAT.demasiados_mensajes, {
        "Retry-After": String(limite.reintentarEnS),
      });
    }

    const total = await sesiones.incrementarMensajes(sesion.token);
    if (total === null) return noAutenticado();
    if (total > maxMensajesAsistente()) return respuestaError(429, "tope", ERRORES_CHAT.tope);

    const tope = presupuestoMaximoUsd();
    if (tope !== null && (await presupuesto.acumulado()) >= tope) {
      await interruptores.actualizar("kill_switch", "on");
      anotarEvento("presupuesto_agotado");
      return mantenimiento();
    }

    // Se cancela si el cliente se va o si el turno pasa de 45 s.
    const abortSignal = AbortSignal.any([request.signal, AbortSignal.timeout(TIEMPO_MAXIMO_TURNO_MS)]);
    const requestContext = construirContextoTurno(asistente, valores, VERSION_INSTRUCCIONES);
    const senales = crearSenales(requestContext);
    const iniciadoMs = Date.now();
    let turno: Turno;
    try {
      turno = await ejecutarTurno({
        agente: mastra.getAgent("charla"),
        mensaje: pregunta,
        requestContext,
        // Un hilo por asistente (`charla-<id>`), compartido por sus dispositivos.
        memory: { thread: sesion.threadId, resource: asistente.id },
        abortSignal,
        maxSteps: MAX_PASOS_TURNO,
      });
    } catch (error) {
      registrarError("el turno no pudo arrancar", error);
      escalarFalla(asistente.id, pregunta, undefined);
      registrarTurnoSinArrancar(iniciadoMs, error);
      return createUIMessageStreamResponse({ stream: streamFallaTecnica() });
    }

    const metadata: MetadataMensaje = turno.traceId ? { trace_id: turno.traceId } : {};
    const ui = streamUI(turno, {
      messageMetadata: ({ part }) => (part.type === "start" || part.type === "finish" ? metadata : undefined),
      onError: () => MENSAJE_ERROR_STREAM,
    });
    const stream = protegerStreamUI(ui, {
      metadata,
      clienteSeFue: () => request.signal.aborted,
      alFallar: () => {
        console.error("[chat] el turno falló antes del primer texto");
        escalarFalla(asistente.id, pregunta, turno.traceId);
      },
    });
    cerrarTurno(turno, iniciadoMs, senales, abortSignal).catch((error: unknown) => registrarError("no se pudo cerrar el turno", error));
    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    return errorInterno("chat", error);
  }
}
