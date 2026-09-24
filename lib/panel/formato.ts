// Formato de números, horas y etiquetas del panel (español neutro).

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
