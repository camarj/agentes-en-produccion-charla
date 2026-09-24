import type { NextRequest } from "next/server";
import { z } from "zod";
import { asistentes } from "@/lib/db/asistentes";
import { escalamientos } from "@/lib/db/escalamientos";
import { autorizadoPanel, noAutorizado } from "@/lib/panel/auth";
import { colaDelPanel } from "@/lib/panel/escalamientos";
import { jsonPanel } from "@/lib/panel/respuestas";
import { errorInterno, leerJson, respuestaError } from "@/lib/respuestas";

// GET → { escalamientos: FilaEscalamiento[] }: pendientes primero, redactados
// y con rol anónimo (nunca nombre, email ni rol).
export async function GET(request: NextRequest) {
  if (!autorizadoPanel(request)) return noAutorizado();
  try {
    const [lista, perfiles] = await Promise.all([escalamientos.listar(), asistentes.listarPerfiles()]);
    return jsonPanel({ escalamientos: colaDelPanel(lista, perfiles) });
  } catch (error) {
    return errorInterno("panel/escalamientos", error);
  }
}

const esquema = z.object({
  id: z.number().int().positive(),
  estado: z.enum(["respondida", "descartada"]),
});

// PATCH { id, estado: "respondida" | "descartada" } → { ok: true }.
export async function PATCH(request: NextRequest) {
  if (!autorizadoPanel(request)) return noAutorizado();
  try {
    const datos = esquema.safeParse(await leerJson(request));
    if (!datos.success) return respuestaError(400, "escalamiento_invalido", "Datos no válidos.");
    const cambiado = await escalamientos.actualizarEstado(datos.data.id, datos.data.estado);
    if (!cambiado) return respuestaError(404, "no_encontrado", "Ese escalamiento ya no existe.");
    return jsonPanel({ ok: true });
  } catch (error) {
    return errorInterno("panel/escalamientos", error);
  }
}
