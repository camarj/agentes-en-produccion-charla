import type { NextRequest } from "next/server";
import { feedback } from "@/lib/db/feedback";
import { metricasCharla } from "@/lib/db/metricas";
import { autorizadoPanel, noAutorizado } from "@/lib/panel/auth";
import type { MetricasTrazas } from "@/lib/panel/metricas-trazas";
import { leerMetricasObservabilidad } from "@/lib/panel/observabilidad";
import { jsonPanel } from "@/lib/panel/respuestas";
import type { MetricasPanel } from "@/lib/panel/tipos";
import { presupuesto, presupuestoMaximoUsd } from "@/lib/presupuesto";
import { errorInterno } from "@/lib/respuestas";

function observabilidad(m: MetricasTrazas | null): MetricasPanel["observabilidad"] {
  if (!m) return { disponible: false };
  return {
    disponible: true,
    latencia_p50_ms: m.latencia.p50Ms,
    latencia_p95_ms: m.latencia.p95Ms,
    muestras_latencia: m.latencia.muestras,
    errores: m.errores,
    errores_por_tipo: m.erroresPorTipo,
    bloqueos: { total: m.bloqueos.total, por_motivo: m.bloqueos.porMotivo },
    turnos: m.turnos,
    respaldo: { ultima_hora: m.respaldo.ultimaHora, ultima_en: m.respaldo.ultimaEn },
  };
}

// GET → MetricasPanel. Las de charla.db nunca esperan a la observabilidad:
// si Mastra no responde (arranque, Neon caído), sale `disponible: false`.
export async function GET(request: NextRequest) {
  if (!autorizadoPanel(request)) return noAutorizado();
  try {
    const trazas = leerMetricasObservabilidad().catch(() => null);
    const [resumen, votos, acumulado, obs] = await Promise.all([
      metricasCharla.resumen(),
      feedback.totales(),
      presupuesto.acumulado(),
      trazas,
    ]);
    const cuerpo: MetricasPanel = {
      asistentes: {
        con_mensajes: resumen.asistentesConMensajes,
        registrados: resumen.asistentesRegistrados,
        inscritos: resumen.inscritos,
      },
      mensajes: resumen.mensajes,
      escalamientos_pendientes: resumen.escalamientosPendientes,
      votos: { positivos: votos.positivos, negativos: votos.negativos },
      presupuesto: { acumulado_usd: acumulado, maximo_usd: presupuestoMaximoUsd() },
      observabilidad: observabilidad(obs),
      actualizado_en: new Date().toISOString(),
    };
    return jsonPanel(cuerpo);
  } catch (error) {
    return errorInterno("panel/metricas", error);
  }
}
