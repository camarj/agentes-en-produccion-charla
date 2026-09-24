// Lógica de las pantallas de entrada y perfil (T10): a qué pantalla lleva
// cada estado de sesión, validaciones del formulario y el cliente de la API.
// Los errores de la API ya traen `mensaje` en español; nunca se muestra el
// texto técnico de un fallo.

export type EstadoSesion = "sin_sesion" | "nuevo" | "falta_perfil" | "listo";
export type EstadoPerfil = "nuevo" | "falta_perfil";
export type Pantalla = "entrada" | "perfil" | "chat";

export const LARGO_MAXIMO_NOMBRE = 120;
export const LARGO_MAXIMO_ROL = 120;
export const LARGO_MINIMO_ROL = 2;
export const LARGO_MAXIMO_DESCRIPCION = 300;
export const ROL_OMITIDO = "No indicado";

export const MENSAJE_EMAIL_INVALIDO = "Revisa tu correo: no parece una dirección válida.";
export const MENSAJE_DEMASIADOS_INTENTOS = "Demasiados intentos, espera un minuto";
export const MENSAJE_SIN_CONEXION = "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.";
export const MENSAJE_NOMBRE_REQUERIDO = "Cuéntanos tu nombre para continuar.";
export const MENSAJE_GENERICO = "Algo salió mal. Intenta de nuevo en un momento.";
export const TEXTO_REINTENTAR = "Reintentar";

export function pantallaPara(estado: EstadoSesion): Pantalla {
  switch (estado) {
    case "listo":
      return "chat";
    case "nuevo":
    case "falta_perfil":
      return "perfil";
    default:
      return "entrada";
  }
}

// Revisión rápida en el navegador; la API valida de nuevo (400 email_invalido).
export function emailValido(email: string): boolean {
  const limpio = email.trim();
  return limpio.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio);
}

export function puedeContinuar(rol: string): boolean {
  return rol.trim().length >= LARGO_MINIMO_ROL;
}

export type Resultado<T> =
  | { ok: true; datos: T }
  | { ok: false; tipo: "red" }
  | { ok: false; tipo: "http"; status: number; error: string; mensaje: string };

export async function pedir<T>(url: string, cuerpo?: unknown): Promise<Resultado<T>> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: cuerpo === undefined ? "GET" : "POST",
      headers: cuerpo === undefined ? undefined : { "content-type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, tipo: "red" };
  }

  let datos: unknown;
  try {
    datos = await respuesta.json();
  } catch {
    datos = undefined;
  }
  if (respuesta.ok && datos && typeof datos === "object") return { ok: true, datos: datos as T };

  const error = (datos ?? {}) as { error?: unknown; mensaje?: unknown };
  return {
    ok: false,
    tipo: "http",
    status: respuesta.status,
    error: typeof error.error === "string" ? error.error : "desconocido",
    mensaje: typeof error.mensaje === "string" ? error.mensaje : MENSAJE_GENERICO,
  };
}

export type RespuestaSesion = { autenticado: boolean; estado: EstadoSesion; nombre_pila?: string };
export type RespuestaIdentificar = { estado: Exclude<EstadoSesion, "sin_sesion">; nombre_pila?: string };
export type RespuestaPerfil = { ok: true; nombre_pila: string };

export function obtenerSesion() {
  return pedir<RespuestaSesion>("/api/sesion");
}

export function identificar(email: string) {
  return pedir<RespuestaIdentificar>("/api/identificar", { email: email.trim() });
}

// Omite la descripción vacía (así no borra la que venía de Luma) y el nombre
// cuando no se pidió.
export function guardarPerfil(perfil: { nombre?: string; rol: string; descripcion?: string }) {
  const nombre = perfil.nombre?.trim();
  const descripcion = perfil.descripcion?.trim();
  return pedir<RespuestaPerfil>("/api/perfil", {
    ...(nombre ? { nombre } : {}),
    rol: perfil.rol.trim(),
    ...(descripcion ? { descripcion } : {}),
  });
}
