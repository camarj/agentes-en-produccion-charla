import { SpanType } from "@mastra/core/observability";
import { TraceStatus } from "@mastra/core/storage";
import { mastra } from "@/src/mastra";
import { crearLectorMetricasTrazas, type StoreTrazas } from "./metricas-trazas";

// Adapta el store de observabilidad de la instancia de Mastra (Neon si
// OBSERVABILIDAD_DATABASE_URL está configurada; si no, LibSQL) a lo que usa el
// panel. `listBranches` solo existe de verdad en Postgres; en LibSQL falla y
// el cálculo sigue solo con las raíces.
async function obtenerStore(): Promise<StoreTrazas | undefined> {
  const store = await mastra.getStorage()?.getStore("observability");
  if (!store) return undefined;
  return {
    listTracesLight: (args) => store.listTracesLight(args),
    // Detalle liviano de una traza con falla (para saber su tipo).
    getTraceLight: (args) => store.getTraceLight(args),
    listBranches: ({ filters, pagination }) =>
      store.listBranches({
        filters: { spanType: SpanType.PROCESSOR_RUN, status: TraceStatus.ERROR, startedAt: filters.startedAt },
        pagination,
      }),
  };
}

// null = no disponible por ahora (el panel muestra «—»).
export const leerMetricasObservabilidad = crearLectorMetricasTrazas({ obtenerStore });
