import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { asistentes, type Asistente } from "@/lib/db/asistentes";
import { sesiones } from "@/lib/db/sesiones";
import { verificarCredencialGoogle, type IdentidadGoogle } from "@/lib/google";
import { ipDe, limitadorIdentificar, limitadorIdentificarCuenta } from "@/lib/rate-limit";
import { errorInterno, leerJson, respuestaError } from "@/lib/respuestas";
import { establecerCookieSesion, estadoDe, nombrePila } from "@/lib/session";

// Un ID token de Google mide ~1-2 KB; el tope evita verificar cuerpos enormes.
const esquema = z.object({ credencial: z.string().min(1).max(4096) });
const LARGO_MAXIMO_NOMBRE = 120;

const MENSAJE_CREDENCIAL = "No pudimos confirmar tu cuenta de Google. Intenta de nuevo.";

function demasiadosIntentos(reintentarEnS: number) {
  return respuestaError(429, "demasiados_intentos", "Demasiados intentos. Espera un minuto y vuelve a intentarlo.", {
    "Retry-After": String(reintentarEnS),
  });
}

// Busca por email; si no existe crea un invitado con el nombre de su cuenta de
// Google (o vacío). Si otra petición lo creó al mismo tiempo (email único), lo
// vuelve a buscar.
async function buscarOCrear(identidad: IdentidadGoogle): Promise<Asistente> {
  const existente = await asistentes.buscarPorEmail(identidad.email);
  if (existente) return existente;
  try {
    return await asistentes.crearInvitado({ email: identidad.email, nombre: (identidad.nombre ?? "").slice(0, LARGO_MAXIMO_NOMBRE) });
  } catch (error) {
    const creado = await asistentes.buscarPorEmail(identidad.email);
    if (creado) return creado;
    throw error;
  }
}

// POST { credencial } (ID token de Google) → { estado, nombre_pila? } + cookie.
// Revoca las sesiones anteriores del asistente: una sola sesión activa.
// Nunca devuelve rol, descripción ni email.
export async function POST(request: NextRequest) {
  const limite = limitadorIdentificar.consumir(`identificar:${ipDe(request)}`);
  if (!limite.permitido) return demasiadosIntentos(limite.reintentarEnS);

  const datos = esquema.safeParse(await leerJson(request));
  if (!datos.success) return respuestaError(401, "credencial_invalida", MENSAJE_CREDENCIAL);

  try {
    const identidad = await verificarCredencialGoogle(datos.data.credencial);
    if (!identidad) return respuestaError(401, "credencial_invalida", MENSAJE_CREDENCIAL);

    const porCuenta = limitadorIdentificarCuenta.consumir(`cuenta:${identidad.cuenta}`);
    if (!porCuenta.permitido) return demasiadosIntentos(porCuenta.reintentarEnS);

    const asistente = await buscarOCrear(identidad);
    const sesion = await sesiones.reemplazar(asistente.id);
    const pila = nombrePila(asistente.nombre);
    const respuesta = NextResponse.json({ estado: estadoDe(asistente), ...(pila ? { nombre_pila: pila } : {}) });
    return establecerCookieSesion(respuesta, sesion.token);
  } catch (error) {
    return errorInterno("identificar", error);
  }
}
