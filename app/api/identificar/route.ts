import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { asistentes, type Asistente } from "@/lib/db/asistentes";
import { sesiones } from "@/lib/db/sesiones";
import { ipDe, limitadorIdentificar } from "@/lib/rate-limit";
import { errorInterno, leerJson, respuestaError } from "@/lib/respuestas";
import { establecerCookieSesion, estadoDe, nombrePila } from "@/lib/session";

const esquema = z.object({ email: z.string().trim().max(254).pipe(z.email()) });

// Busca por email; si no existe crea un invitado sin nombre. Si otra petición
// lo creó al mismo tiempo (email único), lo vuelve a buscar.
async function buscarOCrear(email: string): Promise<Asistente> {
  const existente = await asistentes.buscarPorEmail(email);
  if (existente) return existente;
  try {
    return await asistentes.crearInvitado({ email, nombre: "" });
  } catch (error) {
    const creado = await asistentes.buscarPorEmail(email);
    if (creado) return creado;
    throw error;
  }
}

// POST { email } → { estado, nombre_pila? } + cookie. Nunca devuelve rol,
// descripción ni email.
export async function POST(request: NextRequest) {
  const limite = limitadorIdentificar.consumir(`identificar:${ipDe(request)}`);
  if (!limite.permitido) {
    return respuestaError(429, "demasiados_intentos", "Demasiados intentos. Espera un minuto y vuelve a intentarlo.", {
      "Retry-After": String(limite.reintentarEnS),
    });
  }

  const datos = esquema.safeParse(await leerJson(request));
  if (!datos.success) {
    return respuestaError(400, "email_invalido", "Revisa tu correo: no parece una dirección válida.");
  }

  try {
    const asistente = await buscarOCrear(datos.data.email);
    const sesion = await sesiones.crear(asistente.id);
    const pila = nombrePila(asistente.nombre);
    const respuesta = NextResponse.json({ estado: estadoDe(asistente), ...(pila ? { nombre_pila: pila } : {}) });
    return establecerCookieSesion(respuesta, sesion.token);
  } catch (error) {
    return errorInterno("identificar", error);
  }
}
