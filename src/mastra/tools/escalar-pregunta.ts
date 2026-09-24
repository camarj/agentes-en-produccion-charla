import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { escalamientos as escalamientosPorDefecto, type crearEscalamientos } from "@/lib/db/escalamientos";
import { promesaDeVeredicto } from "../processors/verificacion-entrada";
import { asistenteDelContexto, spanActual, traceIdActual } from "./contexto";

export const LIMITE_ESCALAMIENTOS = 3;

export interface DependenciasEscalarPregunta {
  escalamientos: Pick<ReturnType<typeof crearEscalamientos>, "crearConLimite" | "posicion">;
}

export const salidaEscalarPregunta = z.union([
  z.object({ registrado: z.literal(true), posicion: z.number().int().positive() }),
  z.object({ registrado: z.literal(false), motivo: z.enum(["limite", "sin_contexto", "bloqueado"]) }),
]);

export function crearEscalarPregunta(deps: DependenciasEscalarPregunta) {
  return createTool({
    id: "escalar_pregunta",
    description: "Envía una pregunta a la cola que Raúl responderá en la sesión de preguntas.",
    // Sin asistente_id: zod descarta cualquier campo extra que envíe el modelo.
    inputSchema: z.object({
      pregunta: z.string().min(5).max(500),
      motivo: z.enum(["experiencia_personal", "comercial", "fuera_de_charla", "desacuerdo", "falla_tecnica"]),
    }),
    outputSchema: salidaEscalarPregunta,
    execute: async ({ pregunta, motivo }, contexto) => {
      const span = spanActual(contexto);
      // Los guardrails de entrada corren en paralelo con el agente: nunca se
      // escribe antes de conocer su veredicto, y un turno bloqueado no escribe.
      const veredicto = await promesaDeVeredicto(contexto?.requestContext);
      if (veredicto?.bloqueado) {
        span?.update({ metadata: { resultado: "bloqueado" } });
        return { registrado: false as const, motivo: "bloqueado" as const };
      }
      const asistenteId = asistenteDelContexto(contexto);
      if (!asistenteId) {
        span?.update({ metadata: { resultado: "sin_contexto" } });
        return { registrado: false as const, motivo: "sin_contexto" as const };
      }
      const r = await deps.escalamientos.crearConLimite(
        { asistenteId, pregunta, motivo, traceId: traceIdActual(contexto) },
        LIMITE_ESCALAMIENTOS,
      );
      span?.update({ metadata: { resultado: r.estado } });
      if (r.id === null) return { registrado: false as const, motivo: "limite" as const };
      return { registrado: true as const, posicion: await deps.escalamientos.posicion(r.id) };
    },
  });
}

export const escalarPregunta = crearEscalarPregunta({ escalamientos: escalamientosPorDefecto });
