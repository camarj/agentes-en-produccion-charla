import type { NextRequest } from "next/server";
import { z } from "zod";
import { interruptores } from "@/lib/db/interruptores";
import { autorizadoPanel, noAutorizado } from "@/lib/panel/auth";
import { jsonPanel } from "@/lib/panel/respuestas";
import { laminaValida, type EstadoInterruptores } from "@/lib/panel/tipos";
import { errorInterno, leerJson, respuestaError } from "@/lib/respuestas";

const onOff = z.enum(["on", "off"]);
const esquema = z.discriminatedUnion("clave", [
  z.object({ clave: z.literal("herramienta_caida"), valor: onOff }),
  z.object({ clave: z.literal("latencia_alta"), valor: onOff }),
  z.object({ clave: z.literal("modelo_caido"), valor: onOff }),
  z.object({ clave: z.literal("kill_switch"), valor: onOff }),
  z.object({ clave: z.literal("lamina_actual"), valor: z.unknown() }),
]);

const onOffDe = (v: string) => (v === "on" ? "on" : "off");

async function estado(): Promise<EstadoInterruptores> {
  const [v, ultimas] = await Promise.all([interruptores.obtenerTodos(), interruptores.ultimasActivaciones()]);
  return {
    valores: {
      herramienta_caida: onOffDe(v.herramienta_caida),
      latencia_alta: onOffDe(v.latencia_alta),
      modelo_caido: onOffDe(v.modelo_caido),
      kill_switch: onOffDe(v.kill_switch),
      lamina_actual: laminaValida(v.lamina_actual) ?? 1,
    },
    ultimas_activaciones: ultimas,
  };
}

export async function GET(request: NextRequest) {
  if (!autorizadoPanel(request)) return noAutorizado();
  try {
    return jsonPanel(await estado());
  } catch (error) {
    return errorInterno("panel/interruptores", error);
  }
}

// POST { clave, valor } → EstadoInterruptores. `valor` es "on" | "off" para
// los interruptores y un entero 1–39 para `lamina_actual`. El cambio lo ve el
// chat al instante en este proceso (se limpia la caché de 2 s).
export async function POST(request: NextRequest) {
  if (!autorizadoPanel(request)) return noAutorizado();
  try {
    const datos = esquema.safeParse(await leerJson(request));
    const invalido = () => respuestaError(400, "interruptor_invalido", "Valor no válido para ese interruptor.");
    if (!datos.success) return invalido();
    if (datos.data.clave === "lamina_actual") {
      const lamina = laminaValida(datos.data.valor);
      if (lamina === null) return invalido();
      await interruptores.actualizar("lamina_actual", String(lamina));
    } else {
      await interruptores.actualizar(datos.data.clave, datos.data.valor);
    }
    return jsonPanel(await estado());
  } catch (error) {
    return errorInterno("panel/interruptores", error);
  }
}
