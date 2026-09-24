import { SpanType } from "@mastra/core/observability";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { interruptores as interruptoresPorDefecto, type Interruptores } from "@/lib/db/interruptores";
import { laminas as laminasPorDefecto, type ResultadoBusqueda } from "@/lib/db/laminas";
import { spanActual } from "./contexto";
import {
  REINTENTOS_POR_DEFECTO,
  ToolUnavailableError,
  conReintentos,
  esperar,
  type OpcionesReintento,
} from "./resiliencia";

export const MAX_FRAGMENTO = 800;
export const MAX_NOTAS = 1200;
const LATENCIA_SIMULADA_MS = 8000;

type ClaveCaos = "herramienta_caida" | "latencia_alta";

export interface DependenciasBuscarLaminas {
  laminas: { buscar: (consulta: string, limite?: number) => Promise<ResultadoBusqueda[]> };
  interruptores: { obtenerTodos: () => Promise<Pick<Interruptores, ClaveCaos>> };
  reintentos?: OpcionesReintento;
}

const resultadoSchema = z.object({
  lamina: z.number(),
  titulo: z.string(),
  fragmento: z.string().max(MAX_FRAGMENTO),
  notas: z.string().max(MAX_NOTAS).nullable(),
  puntaje: z.number(),
});

export const salidaBuscarLaminas = z.union([
  z.object({ resultados: z.array(resultadoSchema), sin_resultados: z.boolean() }),
  z.object({ error: z.literal("no_disponible") }),
]);

export function truncar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}

async function leerCaos(deps: DependenciasBuscarLaminas): Promise<ClaveCaos[]> {
  try {
    const valores = await deps.interruptores.obtenerTodos();
    return (["herramienta_caida", "latencia_alta"] as const).filter((c) => valores[c] === "on");
  } catch {
    // Si no se pueden leer, se asume que no hay caos; la búsqueda decide.
    return [];
  }
}

export function crearBuscarLaminas(deps: DependenciasBuscarLaminas) {
  return createTool({
    id: "buscar_laminas",
    description:
      "Busca en las láminas de la charla. Úsala antes de responder sobre el contenido de la presentación.",
    inputSchema: z.object({
      consulta: z.string().min(2).max(200),
      max_resultados: z.number().int().min(1).max(5).default(3),
    }),
    outputSchema: salidaBuscarLaminas,
    execute: async ({ consulta, max_resultados }, contexto) => {
      const activos = await leerCaos(deps);
      let intentos = 0;
      let salida: z.infer<typeof salidaBuscarLaminas>;
      try {
        const r = await conReintentos(
          async (signal, intento) => {
            intentos = intento;
            if (activos.includes("herramienta_caida")) throw new ToolUnavailableError();
            if (activos.includes("latencia_alta")) await esperar(LATENCIA_SIMULADA_MS, signal);
            return deps.laminas.buscar(consulta, max_resultados ?? 3);
          },
          { ...(deps.reintentos ?? REINTENTOS_POR_DEFECTO), signal: contexto?.abortSignal },
        );
        intentos = r.intentos;
        const resultados = r.valor.map((res) => ({
          lamina: res.lamina,
          titulo: res.titulo,
          fragmento: truncar(res.fragmento, MAX_FRAGMENTO),
          notas: res.notas === null ? null : truncar(res.notas, MAX_NOTAS),
          puntaje: res.puntaje,
        }));
        salida = { resultados, sin_resultados: resultados.length === 0 };
      } catch {
        salida = { error: "no_disponible" };
      }
      const span = spanActual(contexto);
      const fallo = "error" in salida;
      span?.update({
        metadata: {
          intentos,
          interruptores_activos: activos,
          cantidad_resultados: "resultados" in salida ? salida.resultados.length : 0,
          ...(fallo ? { falla_herramienta: true } : {}),
        },
      });
      // En la raíz del turno, para que el panel cuente la falla aunque el agente responda.
      if (fallo) span?.findParent?.(SpanType.AGENT_RUN)?.update({ metadata: { falla_herramienta: true } });
      return salida;
    },
  });
}

export const buscarLaminas = crearBuscarLaminas({
  laminas: laminasPorDefecto,
  interruptores: interruptoresPorDefecto,
});
