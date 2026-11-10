// Catálogo de la salud del sistema (PRD §15 G7): servicios con su semáforo y
// tipos de evento con su texto en español. Sin imports de servidor: también
// lo usa la UI del panel. Los textos nunca incluyen errores técnicos.

export const SERVICIOS = [
  "gemini",
  "openai",
  "base_datos",
  "trazas",
  "busqueda",
  "guardrails",
  "entrada",
  "presupuesto",
] as const;
export type Servicio = (typeof SERVICIOS)[number];

export type NivelEvento = "ok" | "aviso" | "falla";
export type Semaforo = "verde" | "ambar" | "rojo";

// Nombre y texto de cada color del semáforo.
export const NOMBRES_SERVICIO: Record<Servicio, { nombre: string; verde: string; ambar: string; rojo: string }> = {
  gemini: { nombre: "Gemini (principal)", verde: "Responde", ambar: "Alta demanda → respaldo activo", rojo: "No disponible" },
  openai: { nombre: "OpenAI (respaldo)", verde: "En espera o respondiendo", ambar: "Errores aislados", rojo: "Tampoco disponible → falla técnica y escalamiento" },
  base_datos: { nombre: "Base de datos", verde: "OK", ambar: "Consultas lentas", rojo: "Errores: hay rutas que responden 500" },
  trazas: { nombre: "Trazas / observabilidad", verde: "OK", ambar: "Una traza o un voto no se pudo guardar", rojo: "Sin conexión" },
  busqueda: { nombre: "Búsqueda de láminas", verde: "OK", ambar: "Con reintentos", rojo: "Agotó los 3 intentos" },
  guardrails: { nombre: "Guardrails", verde: "OK", ambar: "Alcance no respondió: dejó pasar (falla abierta)", rojo: "Detector de inyección falló: bloqueó (falla cerrada)" },
  entrada: { nombre: "Entrada y límites", verde: "OK", ambar: "Personas frenadas por límites", rojo: "Personas frenadas por límites" },
  presupuesto: { nombre: "Presupuesto", verde: "Menos del 70 %", ambar: "Entre 70 % y 90 % o más", rojo: "Agotado → chat en pausa" },
};

export const TIPOS_EVENTO = {
  gemini_limite_uso: { servicio: "gemini", nivel: "aviso", texto: "Límite de uso del proyecto alcanzado (429) → respaldo activo" },
  gemini_sobrecarga: { servicio: "gemini", nivel: "aviso", texto: "Gemini con alta demanda (503) → respaldo activo" },
  gemini_fallo: { servicio: "gemini", nivel: "aviso", texto: "Cambio al respaldo: respondió OpenAI" },
  gemini_recuperado: { servicio: "gemini", nivel: "ok", texto: "Gemini responde de nuevo" },
  modelos_caidos: { servicio: "openai", nivel: "falla", texto: "Ningún modelo disponible → falla técnica y escalamiento" },
  openai_recuperado: { servicio: "openai", nivel: "ok", texto: "Los modelos volvieron a responder" },
  db_lenta: { servicio: "base_datos", nivel: "aviso", texto: "Base de datos lenta (consulta de más de 1 s)" },
  db_error: { servicio: "base_datos", nivel: "falla", texto: "Error interno: una ruta respondió 500" },
  traza_no_guardada: { servicio: "trazas", nivel: "aviso", texto: "Un voto no se pudo guardar en la observabilidad" },
  observabilidad_sin_conexion: { servicio: "trazas", nivel: "falla", texto: "Sin conexión con la observabilidad" },
  busqueda_reintentos: { servicio: "busqueda", nivel: "aviso", texto: "buscar_laminas necesitó reintentos" },
  busqueda_agotada: { servicio: "busqueda", nivel: "falla", texto: "buscar_laminas agotó 3 intentos" },
  alcance_falla_abierta: { servicio: "guardrails", nivel: "aviso", texto: "El clasificador de alcance no respondió: dejó pasar la pregunta" },
  detector_falla_cerrada: { servicio: "guardrails", nivel: "falla", texto: "El detector de inyección falló: bloqueó la pregunta" },
  limite_entrada: { servicio: "entrada", nivel: "aviso", texto: "Límite de entradas: alguien tuvo que esperar" },
  limite_chat: { servicio: "entrada", nivel: "aviso", texto: "Límite de mensajes por minuto: alguien tuvo que esperar" },
  limite_dictado: { servicio: "entrada", nivel: "aviso", texto: "Límite de dictado: alguien tuvo que esperar" },
  presupuesto_agotado: { servicio: "presupuesto", nivel: "falla", texto: "Presupuesto agotado → chat en pausa" },
} as const satisfies Record<string, { servicio: Servicio; nivel: NivelEvento; texto: string }>;
export type TipoEvento = keyof typeof TIPOS_EVENTO;

export function esTipoEvento(valor: string): valor is TipoEvento {
  return Object.hasOwn(TIPOS_EVENTO, valor);
}

// Los semáforos miran los eventos de los últimos 5 minutos: vuelven a verde
// solos cuando dejan de llegar eventos.
export const VENTANA_SALUD_MS = 5 * 60_000;
// Eventos del mismo tipo dentro de 1 minuto se agrupan (×N) en una sola línea.
export const VENTANA_AGRUPAR_MS = 60_000;

export interface EstadoServicio {
  id: Servicio;
  nombre: string;
  semaforo: Semaforo;
  detalle: string;
}

export interface EventoPanel {
  id: number;
  hora: string; // ISO del último evento del grupo
  nivel: NivelEvento;
  texto: string;
  trace_id: string | null;
}

export interface SaludPanel {
  servicios: EstadoServicio[];
  eventos: EventoPanel[];
}

// «Gemini con alta demanda (503) → respaldo activo ×12 en 1 min»
export function textoEvento(tipo: TipoEvento, cantidad: number, primeroMs: number, ultimoMs: number): string {
  const base = TIPOS_EVENTO[tipo].texto;
  if (cantidad <= 1) return base;
  const minutos = Math.max(1, Math.ceil((ultimoMs - primeroMs) / 60_000));
  return `${base} ×${cantidad} en ${minutos} min`;
}

const SEMAFORO: Record<NivelEvento, Semaforo> = { ok: "verde", aviso: "ambar", falla: "rojo" };
const PESO: Record<Semaforo, number> = { verde: 0, ambar: 1, rojo: 2 };

export interface EventoReciente {
  tipo: TipoEvento;
  ultimoMs: number;
}

// Semáforo de un servicio a partir de sus eventos de la ventana: manda el peor
// evento posterior a la última recuperación (evento «ok»).
export function semaforoDeServicio(servicio: Servicio, eventos: readonly EventoReciente[]): EstadoServicio {
  const propios = eventos
    .filter((e) => TIPOS_EVENTO[e.tipo].servicio === servicio)
    .sort((a, b) => a.ultimoMs - b.ultimoMs);
  const ultimaRecuperacion = propios.findLastIndex((e) => TIPOS_EVENTO[e.tipo].nivel === "ok");
  const vigentes = propios.slice(ultimaRecuperacion + 1);
  const textos = NOMBRES_SERVICIO[servicio];
  let semaforo: Semaforo = "verde";
  let detalle: string = textos.verde;
  for (const e of vigentes) {
    const s = SEMAFORO[TIPOS_EVENTO[e.tipo].nivel];
    if (PESO[s] >= PESO[semaforo]) {
      semaforo = s;
      detalle = TIPOS_EVENTO[e.tipo].texto;
    }
  }
  return { id: servicio, nombre: textos.nombre, semaforo, detalle };
}

// Semáforo del presupuesto: < 70 % verde, desde 70 % ámbar, agotado rojo.
export function semaforoPresupuesto(acumuladoUsd: number, maximoUsd: number | null): EstadoServicio {
  const textos = NOMBRES_SERVICIO.presupuesto;
  const base = { id: "presupuesto" as const, nombre: textos.nombre };
  if (maximoUsd === null || maximoUsd <= 0) return { ...base, semaforo: "verde", detalle: "Sin tope" };
  const porcentaje = Math.floor((acumuladoUsd / maximoUsd) * 100);
  if (acumuladoUsd >= maximoUsd) return { ...base, semaforo: "rojo", detalle: textos.rojo };
  if (porcentaje >= 70) return { ...base, semaforo: "ambar", detalle: `${porcentaje} % usado` };
  return { ...base, semaforo: "verde", detalle: `${porcentaje} % usado` };
}
