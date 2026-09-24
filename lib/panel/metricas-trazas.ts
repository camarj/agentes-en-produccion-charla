// Métricas del panel del speaker (T12) que salen de la observabilidad de
// Mastra: latencia, errores y bloqueos de guardrails. Se leen con la API del
// store (`listTracesLight`), así funcionan igual con Postgres (Neon) y LibSQL.
// Si el store no está listo o no responde, el panel muestra «—»: nunca lanza.
// Las trazas del runner de evals (T13, `metadata.origen = "eval"`) no cuentan.

import { esTrazaDeEval } from "@/lib/origen-eval";

export const AGENTE = "charla";
export const VENTANA_LATENCIA_MS = 60 * 60 * 1000;
// Errores y bloqueos cuentan desde hace 12 h (dura la sesión de un asistente):
// cubre toda la charla sin mezclar pruebas de otros días.
export const VENTANA_TOTALES_MS = 12 * 60 * 60 * 1000;
export const TIEMPO_MAXIMO_LECTURA_MS = 4000;
// Mastra valida `perPage` ≤ 100 en listTraces/listTracesLight.
const POR_PAGINA = 100;
// 20 páginas = 2.000 turnos (26 asistentes × 30 preguntas ≈ 780).
const PAGINAS_MAXIMAS = 20;

type Fecha = Date | string;

// Lo que usamos de la raíz de cada traza (span `agent_run`).
export interface RaizTraza {
  traceId: string;
  startedAt: Fecha;
  endedAt?: Fecha | null;
  status?: string | null; // "success" | "error" | "running"
  error?: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface MetricasTrazas {
  latencia: { p50Ms: number | null; p95Ms: number | null; muestras: number };
  errores: number;
  bloqueos: { total: number; porMotivo: Record<string, number> };
  // Turnos del agente en la ventana de 12 h (incluye bloqueados).
  turnos: number;
}

interface PaginaTrazas {
  pagination?: { total: number; hasMore: boolean } | null;
  spans: RaizTraza[];
}

// Span de un procesador (guardrail) con su metadata.
export interface RamaProcesador {
  traceId: string;
  metadata?: Record<string, unknown> | null;
}

export interface StoreTrazas {
  listTracesLight(args: {
    filters: { entityId: string; startedAt: { start: Date }; hasChildError?: boolean };
    pagination: { page: number; perPage: number };
  }): Promise<PaginaTrazas>;
  // Opcional: Postgres lo implementa; LibSQL no.
  listBranches?(args: {
    filters: { spanType: "processor_run"; status: "error"; startedAt: { start: Date } };
    pagination: { page: number; perPage: number };
  }): Promise<{ pagination?: { total: number; hasMore: boolean } | null; branches: RamaProcesador[] }>;
}

// Percentil por rango más cercano: el valor en la posición ⌈p/100 · n⌉.
export function percentil(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const i = Math.min(orden.length, Math.max(1, Math.ceil((p / 100) * orden.length)));
  return orden[i - 1];
}

// Motivo del bloqueo registrado por los guardrails (T06) en `agent_run`, o null.
export function motivoDeBloqueo(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const motivo = typeof metadata.motivo === "string" && metadata.motivo ? metadata.motivo : null;
  if (typeof metadata.guardrail === "string" && metadata.guardrail) return motivo ?? "otro";
  if (metadata.guardrails_entrada === "bloqueado") return motivo ?? "otro";
  return null;
}

const ms = (f: Fecha | null | undefined) => (f == null ? Number.NaN : new Date(f).getTime());

export function calcularMetricasTrazas(
  raices: readonly RaizTraza[],
  {
    ahora,
    trazasConErrorHijo = new Set<string>(),
    bloqueosEnHijos = new Map<string, string>(),
  }: {
    ahora: number;
    trazasConErrorHijo?: ReadonlySet<string>;
    // traceId → motivo de un bloqueo registrado en un span hijo (procesador).
    bloqueosEnHijos?: ReadonlyMap<string, string>;
  },
): MetricasTrazas {
  const duraciones: number[] = [];
  const porMotivo: Record<string, number> = {};
  let bloqueos = 0;
  let errores = 0;
  let turnos = 0;

  for (const r of raices) {
    const inicio = ms(r.startedAt);
    if (!(inicio >= ahora - VENTANA_TOTALES_MS)) continue;
    // Turnos del runner de evals: no son tráfico de asistentes.
    if (esTrazaDeEval(r.metadata)) continue;
    turnos++;

    // Un bloqueo es un turno terminado para el asistente aunque la traza haya
    // quedado abierta o con error (bloqueo a mitad de una herramienta, T09).
    // En Neon, la raíz de un turno bloqueado queda abierta y sin la metadata
    // del bloqueo: el motivo está solo en el span del procesador.
    const motivo = motivoDeBloqueo(r.metadata) ?? bloqueosEnHijos.get(r.traceId) ?? null;
    if (motivo) {
      bloqueos++;
      porMotivo[motivo] = (porMotivo[motivo] ?? 0) + 1;
      continue;
    }

    const conError = r.status === "error" || (r.error != null && r.error !== false) || trazasConErrorHijo.has(r.traceId);
    if (conError) {
      errores++;
      continue;
    }

    const fin = ms(r.endedAt);
    if (Number.isFinite(fin) && fin >= inicio && inicio >= ahora - VENTANA_LATENCIA_MS) duraciones.push(fin - inicio);
  }

  return {
    latencia: { p50Ms: percentil(duraciones, 50), p95Ms: percentil(duraciones, 95), muestras: duraciones.length },
    errores,
    bloqueos: { total: bloqueos, porMotivo },
    turnos,
  };
}

// La primera página trae el total; las demás se piden en paralelo (desde
// Ecuador, cada consulta a Neon tarda ~0,6 s).
async function todasLasPaginas(
  store: StoreTrazas,
  filtros: Parameters<StoreTrazas["listTracesLight"]>[0]["filters"],
  porPagina: number,
): Promise<RaizTraza[]> {
  const pedir = (page: number) => store.listTracesLight({ filters: filtros, pagination: { page, perPage: porPagina } });
  const primera = await pedir(0);
  if (!primera.pagination?.hasMore) return primera.spans;
  const paginas = Math.min(PAGINAS_MAXIMAS, Math.ceil(primera.pagination.total / porPagina));
  const resto = await Promise.all(Array.from({ length: paginas - 1 }, (_, i) => pedir(i + 1)));
  return [primera, ...resto].flatMap((r) => r.spans);
}

// traceId → motivo, a partir de los spans de procesador con error (un
// guardrail que aborta deja su span con error y la metadata del bloqueo). Si
// el backend no lo soporta (LibSQL) o falla, se sigue sin esta información.
async function bloqueosEnProcesadores(store: StoreTrazas, desde: Date, porPagina: number): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  if (typeof store.listBranches !== "function") return salida;
  try {
    const filters = { spanType: "processor_run" as const, status: "error" as const, startedAt: { start: desde } };
    const pedir = (page: number) => store.listBranches!({ filters, pagination: { page, perPage: porPagina } });
    const primera = await pedir(0);
    const paginas = primera.pagination?.hasMore
      ? Math.min(PAGINAS_MAXIMAS, Math.ceil(primera.pagination.total / porPagina))
      : 1;
    const resto = await Promise.all(Array.from({ length: paginas - 1 }, (_, i) => pedir(i + 1)));
    for (const rama of [primera, ...resto].flatMap((r) => r.branches)) {
      const m = rama.metadata;
      if (typeof m?.guardrail === "string" && typeof m.motivo === "string" && m.motivo && !salida.has(rama.traceId)) {
        salida.set(rama.traceId, m.motivo);
      }
    }
  } catch (error) {
    console.error("[panel] no se pudieron leer los spans de guardrails", {
      tipo: error instanceof Error ? error.name : typeof error,
    });
  }
  return salida;
}

function conTope<T>(promesa: Promise<T>, tiempoMs: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error("tiempo_agotado")), tiempoMs);
  });
  return Promise.race([promesa, tope]).finally(() => clearTimeout(temporizador));
}

export interface OpcionesLectura {
  ahora?: () => number;
  timeoutMs?: number;
  porPagina?: number;
}

// Lee y calcula. Devuelve null (modo degradado) si el store falta, falla o
// tarda más que `timeoutMs`. Solo registra el tipo de error: el mensaje de pg
// puede traer el host.
export async function leerMetricasTrazas(
  obtenerStore: () => Promise<StoreTrazas | null | undefined>,
  { ahora = Date.now, timeoutMs = TIEMPO_MAXIMO_LECTURA_MS, porPagina = POR_PAGINA }: OpcionesLectura = {},
): Promise<MetricasTrazas | null> {
  const momento = ahora();
  try {
    return await conTope(
      (async () => {
        const store = await obtenerStore();
        if (!store) return null;
        const base = { entityId: AGENTE, startedAt: { start: new Date(momento - VENTANA_TOTALES_MS) } };
        const [raices, conErrorHijo, bloqueosEnHijos] = await Promise.all([
          todasLasPaginas(store, base, porPagina),
          todasLasPaginas(store, { ...base, hasChildError: true }, porPagina),
          bloqueosEnProcesadores(store, base.startedAt.start, porPagina),
        ]);
        return calcularMetricasTrazas(raices, {
          ahora: momento,
          trazasConErrorHijo: new Set(conErrorHijo.map((r) => r.traceId)),
          bloqueosEnHijos,
        });
      })(),
      timeoutMs,
    );
  } catch (error) {
    console.error("[panel] métricas de observabilidad no disponibles", {
      tipo: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

// Con varias pestañas del panel abiertas (refresco cada 5 s), comparte la
// consulta en curso y reutiliza el último resultado durante `ttlMs`.
export function crearLectorMetricasTrazas({
  obtenerStore,
  ttlMs = 4000,
  ahora = Date.now,
  ...opciones
}: OpcionesLectura & { obtenerStore: () => Promise<StoreTrazas | null | undefined>; ttlMs?: number }) {
  let ultimo: { valor: MetricasTrazas | null; en: number } | null = null;
  let enCurso: Promise<MetricasTrazas | null> | null = null;

  return function leer(): Promise<MetricasTrazas | null> {
    if (ultimo && ahora() - ultimo.en < ttlMs) return Promise.resolve(ultimo.valor);
    enCurso ??= leerMetricasTrazas(obtenerStore, { ahora, ...opciones })
      .then((valor) => {
        ultimo = { valor, en: ahora() };
        return valor;
      })
      .finally(() => {
        enCurso = null;
      });
    return enCurso;
  };
}
