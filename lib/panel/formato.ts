// Formato de números, horas y etiquetas del panel (español neutro).

import { MODELO_PRINCIPAL, MODELO_RESPALDO } from "@/src/mastra/modelos";

export const SIN_DATO = "—";

export function latencia(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return SIN_DATO;
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

export function usd(valor: number): string {
  const decimales = Math.abs(valor) >= 1 ? 2 : 3;
  return `$${valor.toFixed(decimales).replace(".", ",")}`;
}

export function horaCorta(iso: string | null | undefined, zonaHoraria?: string): string {
  if (!iso) return SIN_DATO;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return SIN_DATO;
  return fecha.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zonaHoraria });
}

const MOTIVOS_ESCALAMIENTO: Record<string, string> = {
  experiencia_personal: "Experiencia personal",
  comercial: "Comercial",
  fuera_de_charla: "Fuera de la charla",
  desacuerdo: "Desacuerdo",
  falla_tecnica: "Falla técnica",
};

const MOTIVOS_BLOQUEO: Record<string, string> = {
  inyeccion: "Inyección",
  fuera_de_alcance: "Fuera de alcance",
  datos_personales: "Datos personales",
  otro: "Otro",
};

const ROLES: Record<string, string> = {
  tecnico: "Técnico",
  negocio: "Negocio",
  educacion: "Educación",
  salud: "Salud",
  otro: "Otro",
};

const legible = (clave: string) => clave.replaceAll("_", " ");

export const etiquetaMotivoEscalamiento = (m: string) => MOTIVOS_ESCALAMIENTO[m] ?? legible(m);
export const etiquetaMotivoBloqueo = (m: string) => MOTIVOS_BLOQUEO[m] ?? legible(m);
export const etiquetaRol = (r: string) => ROLES[r] ?? legible(r);

// Tipos de falla técnica, en el orden en que se muestran.
const TIPOS_FALLA: [string, string][] = [
  ["herramienta", "herramienta"],
  ["modelo", "modelo"],
  ["tiempo", "tiempo agotado"],
  ["otro", "otro"],
];

// «1 herramienta · 1 modelo · 2 tiempo agotado», o null si no hay fallas.
export function desgloseFallas(porTipo: Partial<Record<string, number>>): string | null {
  const partes = TIPOS_FALLA.filter(([t]) => (porTipo[t] ?? 0) > 0).map(([t, etiqueta]) => `${porTipo[t]} ${etiqueta}`);
  return partes.length > 0 ? partes.join(" · ") : null;
}

// «openai/gpt-6-luna» → «gpt-6-luna». null si no hay nombre.
export function nombreModelo(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.slice(id.lastIndexOf("/") + 1) || null;
}

// Valor grande de «Modelo en uso»: el modelo que va a responder AHORA, según
// los interruptores (no el de la última respuesta). «Modelos caídos» manda.
export type EstadoModelo = "principal" | "respaldo" | "sin_modelo";

export function modeloActual(
  valores: { modelo_caido: string; modelos_caidos: string } | null | undefined,
): { texto: string; estado: EstadoModelo | null } {
  if (!valores) return { texto: SIN_DATO, estado: null };
  if (valores.modelos_caidos === "on") return { texto: "Sin modelo · falla técnica", estado: "sin_modelo" };
  if (valores.modelo_caido === "on") return { texto: `${nombreModelo(MODELO_RESPALDO)} · respaldo`, estado: "respaldo" };
  return { texto: nombreModelo(MODELO_PRINCIPAL) ?? SIN_DATO, estado: "principal" };
}

// «última respuesta: gpt-6-luna a las 18:05» (de las trazas), o «—».
export function ultimaRespuesta(
  m: { estado: EstadoModelo; modelo: string | null; en: string } | null | undefined,
  zonaHoraria?: string,
): string {
  const nombre = m ? (m.estado === "sin_modelo" ? "sin modelo" : nombreModelo(m.modelo)) : null;
  if (!m || !nombre) return `última respuesta: ${SIN_DATO}`;
  return `última respuesta: ${nombre} a las ${horaCorta(m.en, zonaHoraria)}`;
}

// «respaldo: 2 en la última hora»
export function respaldoUltimaHora(n: number): string {
  return `respaldo: ${n} en la última hora`;
}
