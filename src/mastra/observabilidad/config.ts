import { MastraStorageExporter, Observability, SamplingStrategyType, SensitiveDataFilter } from "@mastra/observability";
import { CLAVES_CONTEXTO_TRAZA, RedaccionTrazas, type NombresConocidos } from "./redaccion";

export const SERVICIO = "agente-charla";

// 100 % de las trazas en mastra.db (vía el storage de la instancia Mastra).
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
      },
    },
  });
}
