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
import { interruptores } from "@/lib/db/interruptores";
import { sesiones } from "@/lib/db/sesiones";
import { costeEstimadoTurno, presupuesto, presupuestoMaximoUsd } from "@/lib/presupuesto";
import { limitadorChat } from "@/lib/rate-limit";
import { errorInterno, leerJson, noAutenticado, respuestaError } from "@/lib/respuestas";
import { construirContextoTurno } from "@/lib/contexto-turno";
import { estadoDe, leerSesion } from "@/lib/session";
import { mastra } from "@/src/mastra";
import { VERSION_INSTRUCCIONES } from "@/src/mastra/agents/instructions";
import { ejecutarTurno, streamUI, type Turno } from "@/src/mastra/turno";

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

// Cuando el agente termina (memoria guardada), suma el coste estimado.
async function registrarCoste(turno: Turno) {
  await conTope(turno.fin, ESPERA_MAXIMA_FIN_MS);
  let modelo: string | undefined;
  let uso: Awaited<Turno["salidaAgente"]["usage"]> | undefined;
  try {
    const salida = turno.salidaAgente;
    const r = await conTope(Promise.all([salida.usage, salida.response]), ESPERA_MAXIMA_USO_MS);
    uso = r?.[0];
    modelo = r?.[1]?.modelId;
  } catch {
    // Turno fallido o cancelado: queda el costo fijo de guardrails y jueces.
  }
  await presupuesto.sumar(costeEstimadoTurno(modelo, uso));
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
      return mantenimiento();
    }

    // Se cancela si el cliente se va o si el turno pasa de 45 s.
    const abortSignal = AbortSignal.any([request.signal, AbortSignal.timeout(TIEMPO_MAXIMO_TURNO_MS)]);
    let turno: Turno;
    try {
      turno = await ejecutarTurno({
        agente: mastra.getAgent("charla"),
        mensaje: pregunta,
        requestContext: construirContextoTurno(asistente, valores, VERSION_INSTRUCCIONES),
        // Un hilo por asistente (`charla-<id>`), compartido por sus dispositivos.
        memory: { thread: sesion.threadId, resource: asistente.id },
        abortSignal,
        maxSteps: MAX_PASOS_TURNO,
      });
    } catch (error) {
      registrarError("el turno no pudo arrancar", error);
      escalarFalla(asistente.id, pregunta, undefined);
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
    registrarCoste(turno).catch((error: unknown) => registrarError("no se pudo sumar el coste", error));
    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    return errorInterno("chat", error);
  }
}
