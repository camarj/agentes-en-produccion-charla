import { MastraStorageExporter, Observability, SamplingStrategyType, SensitiveDataFilter } from "@mastra/observability";
import { SpanType } from "@mastra/core/observability";
import { CLAVES_CONTEXTO_TRAZA, RedaccionTrazas, type NombresConocidos } from "./redaccion";

export const SERVICIO = "agente-charla";

// 100 % de las trazas en Postgres (esquema `mastra`, vía el storage de la instancia Mastra).
// Procesadores en orden: primero la redacción propia (emails, nombres, perfil,
// requestContext solo con claves permitidas) y después el filtro de claves
// sensibles de Mastra (tokens, claves de API…).
export function crearObservabilidad({ nombresConocidos }: { nombresConocidos?: NombresConocidos } = {}) {
  return new Observability({
    configs: {
      default: {
        serviceName: SERVICIO,
        sampling: { type: SamplingStrategyType.ALWAYS },
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new RedaccionTrazas({ nombresConocidos }), new SensitiveDataFilter()],
        requestContextKeys: [...CLAVES_CONTEXTO_TRAZA],
        // Sin un span por cada trozo del stream: en la prueba de carga con IA
        // (2026-11-12) fueron ~40 000 filas para 100 preguntas y saturaban las
        // conexiones a Postgres. La generación completa (model_generation) y
        // sus pasos se siguen guardando.
        excludeSpanTypes: [SpanType.MODEL_CHUNK],
      },
    },
  });
}
