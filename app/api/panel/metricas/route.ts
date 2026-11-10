import type { NextRequest } from "next/server";
import { feedback } from "@/lib/db/feedback";
import { metricasCharla } from "@/lib/db/metricas";
import { turnos } from "@/lib/db/turnos";
import { autorizadoPanel, noAutorizado } from "@/lib/panel/auth";
import type { MetricasTrazas } from "@/lib/panel/metricas-trazas";
import { jsonPanel } from "@/lib/panel/respuestas";
import type { MetricasPanel } from "@/lib/panel/tipos";
import { presupuesto, presupuestoMaximoUsd } from "@/lib/presupuesto";
import { errorInterno } from "@/lib/respuestas";
import { versionServidor } from "@/lib/version-app";

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
    modelo_en_uso: m.modeloEnUso
      ? { estado: m.modeloEnUso.estado, modelo: m.modeloEnUso.modelo, en: m.modeloEnUso.en }
      : null,
  };
}

// Turnos, latencia, fallas, bloqueos y respaldo salen de la tabla `turnos` de
// charla.db con agregados SQL (PRD §15 G7): sin releer las trazas de Mastra y
// sin tope. Si esa lectura falla, el resto responde igual (`disponible: false`).
function leerTurnos(): Promise<MetricasTrazas | null> {
  return turnos.resumen().catch((error: unknown) => {
    console.error("[panel/metricas] no se pudieron leer los turnos", { tipo: error instanceof Error ? error.name : typeof error });
    return null;
  });
}

// GET → MetricasPanel.
export async function GET(request: NextRequest) {
  if (!autorizadoPanel(request)) return noAutorizado();
  try {
    const trazas = leerTurnos();
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
      version: versionServidor(),
    };
    return jsonPanel(cuerpo);
  } catch (error) {
    return errorInterno("panel/metricas", error);
  }
}
