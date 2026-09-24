import { db, type FuenteDb } from "./client";
import { numero } from "./tipos";

// Métricas del panel del speaker (T12) que salen de charla.db. Solo conteos:
// ningún nombre, email ni texto.
export interface MetricasCharla {
  // Asistentes (inscritos o invitados) que enviaron al menos un mensaje.
  asistentesConMensajes: number;
  // Todos los que entraron o estaban inscritos (inscritos + invitados).
  asistentesRegistrados: number;
  inscritos: number;
  // Mensajes enviados al chat (suma de todas las sesiones).
  mensajes: number;
  escalamientosPendientes: number;
}

export function crearMetricasCharla(fuente: FuenteDb = db) {
  async function resumen(): Promise<MetricasCharla> {
    const c = await fuente();
    const r = await c.execute(`SELECT
      (SELECT COUNT(DISTINCT asistente_id) FROM sesiones WHERE mensajes > 0) AS con_mensajes,
      (SELECT COUNT(*) FROM asistentes) AS registrados,
      (SELECT COUNT(*) FROM asistentes WHERE origen = 'inscrito') AS inscritos,
      (SELECT COALESCE(SUM(mensajes), 0) FROM sesiones) AS mensajes,
      (SELECT COUNT(*) FROM escalamientos WHERE estado = 'pendiente') AS pendientes`);
    const f = r.rows[0];
    return {
      asistentesConMensajes: numero(f, "con_mensajes"),
      asistentesRegistrados: numero(f, "registrados"),
      inscritos: numero(f, "inscritos"),
      mensajes: numero(f, "mensajes"),
      escalamientosPendientes: numero(f, "pendientes"),
    };
  }
  return { resumen };
}

export const metricasCharla = crearMetricasCharla();
