// Tipos y constantes del panel compartidos por la API y la UI (sin imports de
// servidor: este módulo también va al navegador).

export const LAMINA_MIN = 1;
export const LAMINA_MAX = 39;

export const CLAVES_CAOS = ["herramienta_caida", "latencia_alta", "modelo_caido"] as const;
export type ClaveCaos = (typeof CLAVES_CAOS)[number];
export type ClaveActivable = ClaveCaos | "kill_switch";
export type ValorOnOff = "on" | "off";

// Número de lámina válido (1–39) o null.
export function laminaValida(valor: unknown): number | null {
  const n = typeof valor === "string" && /^\s*\d{1,3}\s*$/.test(valor) ? Number(valor) : valor;
  return typeof n === "number" && Number.isInteger(n) && n >= LAMINA_MIN && n <= LAMINA_MAX ? n : null;
}

// Lleva cualquier número al rango 1–39 (para el stepper).
export function acotarLamina(n: number): number {
  if (!Number.isFinite(n)) return LAMINA_MIN;
  return Math.min(LAMINA_MAX, Math.max(LAMINA_MIN, Math.round(n)));
}

export interface EstadoInterruptores {
  valores: Record<ClaveActivable, ValorOnOff> & { lamina_actual: number };
  ultimas_activaciones: Record<ClaveActivable, string | null>;
}

export interface MetricasPanel {
  asistentes: { con_mensajes: number; registrados: number; inscritos: number };
  mensajes: number;
  escalamientos_pendientes: number;
  votos: { positivos: number; negativos: number };
  presupuesto: { acumulado_usd: number; maximo_usd: number | null };
  observabilidad:
    | { disponible: false }
    | {
        disponible: true;
        latencia_p50_ms: number | null;
        latencia_p95_ms: number | null;
        muestras_latencia: number;
        errores: number;
        bloqueos: { total: number; por_motivo: Record<string, number> };
        turnos: number;
      };
  actualizado_en: string;
}

export type MotivoEscalamientoPanel =
  | "experiencia_personal"
  | "comercial"
  | "fuera_de_charla"
  | "desacuerdo"
  | "falla_tecnica";

export interface FilaEscalamiento {
  id: number;
  pregunta: string;
  motivo: MotivoEscalamientoPanel;
  rol_anonimo: "tecnico" | "negocio" | "educacion" | "salud" | "otro";
  estado: "pendiente" | "respondida" | "descartada";
  creado_en: string;
}

// El panel pide datos nuevos cada 5 s.
export const REFRESCO_MS = 5000;
