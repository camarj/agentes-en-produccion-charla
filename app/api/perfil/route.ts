import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { asistentes } from "@/lib/db/asistentes";
import { errorInterno, leerJson, noAutenticado, respuestaError } from "@/lib/respuestas";
import { estadoDe, leerSesion, nombrePila } from "@/lib/session";

// Recorta y colapsa espacios internos («Diego   Paz» → «Diego Paz»).
const texto = () => z.string().transform((s) => s.trim().replace(/\s+/g, " "));

const esquema = z.object({
  nombre: texto().pipe(z.string().max(120)).optional(),
  rol: texto().pipe(z.string().min(2).max(120)),
  descripcion: z.string().trim().max(300).nullish(),
});

// POST { nombre?, rol, descripcion? } → { ok: true, nombre_pila }. Para un
// asistente `nuevo` (sin nombre) el nombre es obligatorio.
export async function POST(request: NextRequest) {
  try {
    const actual = await leerSesion(request);
    if (!actual) return noAutenticado();

    const datos = esquema.safeParse(await leerJson(request));
    if (!datos.success) {
      return respuestaError(
        400,
        "perfil_invalido",
        "Revisa tu perfil: el rol debe tener entre 2 y 120 caracteres y la descripción hasta 300.",
      );
    }
    const { nombre, rol, descripcion } = datos.data;
    if (estadoDe(actual.asistente) === "nuevo" && !nombre) {
      return respuestaError(400, "nombre_requerido", "Cuéntanos tu nombre para continuar.");
    }

    const actualizado = await asistentes.actualizarPerfil(actual.asistente.id, {
      rol,
      ...(nombre ? { nombre } : {}),
      ...(descripcion !== undefined ? { descripcion: descripcion || null } : {}),
    });
    if (!actualizado) return noAutenticado();
    return NextResponse.json({ ok: true, nombre_pila: nombrePila(actualizado.nombre) ?? "" });
  } catch (error) {
    return errorInterno("perfil", error);
  }
}
