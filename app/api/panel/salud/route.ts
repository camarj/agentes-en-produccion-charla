import type { NextRequest } from "next/server";
import { eventosSalud } from "@/lib/db/eventos-salud";
import { autorizadoPanel, noAutorizado } from "@/lib/panel/auth";
import { jsonPanel } from "@/lib/panel/respuestas";
import { presupuesto, presupuestoMaximoUsd } from "@/lib/presupuesto";
import { errorInterno } from "@/lib/respuestas";
import type { SaludPanel } from "@/lib/salud/catalogo";
import { sondearObservabilidad } from "@/lib/salud/observabilidad";

// GET → SaludPanel (PRD §15 G7): semáforo por servicio (eventos de los
// últimos 5 minutos) y registro en vivo de eventos, el más nuevo primero.
// La sonda de la observabilidad corre aparte (cada 30 s como mucho) y no
// retrasa la respuesta.
export async function GET(request: NextRequest) {
  if (!autorizadoPanel(request)) return noAutorizado();
  try {
    void sondearObservabilidad();
    const acumuladoUsd = await presupuesto.acumulado();
    const cuerpo: SaludPanel = await eventosSalud.salud({ presupuesto: { acumuladoUsd, maximoUsd: presupuestoMaximoUsd() } });
    return jsonPanel(cuerpo);
  } catch (error) {
    return errorInterno("panel/salud", error);
  }
}
