import type { NextRequest } from "next/server";
import { jev } from "@/lib/db/jev";
import { VENTANA_TRAZAS_MS, type EstadoJev } from "@/lib/jev/analizador";
import { analizadorJev } from "@/lib/jev/servicio";
import { construirVista } from "@/lib/jev/vista";
import { autorizadoPanel, noAutorizado } from "@/lib/panel/auth";
import { jsonPanel } from "@/lib/panel/respuestas";
import { errorInterno } from "@/lib/respuestas";

// Si el ciclo de análisis tarda más, se responde con lo guardado y el ciclo
// sigue en segundo plano (el próximo poll lo comparte).
const ESPERA_MAXIMA_MS = 5000;

function conTope(analisis: Promise<EstadoJev>, respaldo: () => EstadoJev, ms: number): Promise<EstadoJev> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<EstadoJev>((resolver) => {
    temporizador = setTimeout(() => resolver(respaldo()), ms);
  });
  return Promise.race([analisis, tope]).finally(() => clearTimeout(temporizador));
}

// GET → VistaJev. «Jev · la sala en vivo» (/panel/jev) lo pide cada ~3 s.
// Protegido por proxy.ts y comprobado otra vez aquí (defensa en profundidad).
export async function GET(request: NextRequest) {
  if (!autorizadoPanel(request)) return noAutorizado();
  try {
    const analizador = analizadorJev();
    const estado = await conTope(analizador.analizar(), analizador.estado, ESPERA_MAXIMA_MS);
    const ahora = Date.now();
    const [analisis, total] = await Promise.all([
      jev.desde(new Date(ahora - VENTANA_TRAZAS_MS).toISOString()),
      jev.total(),
    ]);
    return jsonPanel(
      construirVista(analisis, { ahora, total, jevDisponible: estado.jevDisponible && estado.trazasDisponibles }),
    );
  } catch (error) {
    return errorInterno("panel/jev", error);
  }
}
