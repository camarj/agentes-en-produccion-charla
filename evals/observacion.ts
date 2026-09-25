import type { UsoTokens } from "@/lib/presupuesto";
import { MENSAJES_BLOQUEO, mensajeDeTripwire, motivoDeTripwire, type MotivoBloqueo } from "@/src/mastra/processors/mensajes";
import { invocaciones } from "@/src/mastra/scorers/ejecucion";

// Lo que el runner observó de un turno del agente, sin redactar. Los gates lo
// leen de aquí (por `caso_id`) porque la ejecución que Mastra entrega a los
// scorers no trae el tripwire, el modelo usado ni la duración.

export interface HerramientaObservada {
  nombre: string;
  args: unknown;
  resultado?: unknown;
}

// Datos leídos de la traza guardada (solo resiliencia: intentos, respaldo).
export interface EvidenciaTraza {
  herramientas: { nombre: string; intentos?: number; duracionMs?: number; error?: boolean }[];
  modelos: string[];
  modeloRespaldo?: boolean;
  modeloUsado?: string;
}

export interface Observacion {
  casoId: string;
  // Lo que vería el asistente en la pantalla.
  texto: string;
  bloqueado: boolean;
  motivo: MotivoBloqueo | null;
  herramientas: HerramientaObservada[];
  modelo?: string;
  uso?: UsoTokens;
  duracionMs: number;
  traceId?: string;
  // Interruptores de caos encendidos durante el turno (resiliencia).
  interruptores?: string[];
  // El turno falló (excepción del agente); tipo de error, sin el mensaje.
  error?: string;
  evidenciaTraza?: EvidenciaTraza;
}

// Una llamada a escalar_pregunta que el guardrail de entrada neutralizó: la
// herramienta esperó el veredicto «bloqueado» y no escribió nada (T06).
export function llamadaNeutralizada(h: HerramientaObservada): boolean {
  const r = h.resultado as { registrado?: unknown; motivo?: unknown } | undefined;
  return h.nombre === "escalar_pregunta" && r?.registrado === false && r?.motivo === "bloqueado";
}

export function llamadasEfectivas(o: Pick<Observacion, "herramientas">, nombre?: string): HerramientaObservada[] {
  return o.herramientas.filter((h) => (nombre === undefined || h.nombre === nombre) && !llamadaNeutralizada(h));
}

// Resultado de `agent.generate()` de Mastra 1.69 (solo lo que se usa).
export interface ResultadoGenerate {
  text?: string;
  tripwire?: { reason?: string; metadata?: unknown } | null;
  scoringData?: { output?: unknown } | null;
  toolResults?: unknown[];
  response?: { modelId?: string } | null;
  usage?: UsoTokens | null;
  totalUsage?: UsoTokens | null;
  traceId?: string;
}

function herramientasDeToolResults(toolResults: unknown[] | undefined): HerramientaObservada[] {
  const salida: HerramientaObservada[] = [];
  for (const t of toolResults ?? []) {
    const p = ((t as { payload?: unknown }).payload ?? t) as { toolName?: unknown; args?: unknown; result?: unknown };
    if (typeof p.toolName === "string") salida.push({ nombre: p.toolName, args: p.args, resultado: p.result });
  }
  return salida;
}

export function observarResultado(casoId: string, r: ResultadoGenerate, duracionMs: number): Observacion {
  const deMensajes = invocaciones(r.scoringData?.output).map((i) => ({ nombre: i.toolName, args: i.args, resultado: i.result }));
  const herramientas = deMensajes.length > 0 ? deMensajes : herramientasDeToolResults(r.toolResults);
  const texto = (r.text ?? "").trim();
  const motivo = motivoDeTripwire(r.tripwire) ?? (texto === MENSAJES_BLOQUEO.datos_personales ? "datos_personales" : null);
  return {
    casoId,
    // Con un tripwire, el asistente ve el mensaje fijo (igual que la UI, T11).
    texto: r.tripwire ? mensajeDeTripwire(r.tripwire) : texto,
    bloqueado: motivo !== null,
    motivo,
    herramientas,
    modelo: r.response?.modelId,
    uso: r.totalUsage ?? r.usage ?? undefined,
    duracionMs,
    traceId: r.traceId,
  };
}

export function observarError(casoId: string, error: unknown, duracionMs: number): Observacion {
  return {
    casoId,
    texto: "",
    bloqueado: false,
    motivo: null,
    herramientas: [],
    duracionMs,
    error: error instanceof Error ? error.name : typeof error,
  };
}
