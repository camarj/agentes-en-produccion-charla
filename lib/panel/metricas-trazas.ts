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

// Tipo de una falla técnica (respuesta que no se pudo completar).
export type TipoFalla = "tiempo" | "herramienta" | "modelo" | "otro";

export interface MetricasTrazas {
  latencia: { p50Ms: number | null; p95Ms: number | null; muestras: number };
  // Fallas técnicas (12 h): nunca incluye bloqueos ni respuestas salvadas por el respaldo.
  errores: number;
  erroresPorTipo: Partial<Record<TipoFalla, number>>;
  bloqueos: { total: number; porMotivo: Record<string, number> };
  // Turnos del agente en la ventana de 12 h (incluye bloqueados).
  turnos: number;
  // Respuestas servidas por el modelo de respaldo (FallbackModelo marca
  // `modelo_respaldo: true` en la metadata de `agent_run`).
  respaldo: { ultimaHora: number; ultimaEn: string | null };
  // Modelo del turno más reciente con respuesta (o que falló porque ningún
  // modelo respondió). null = todavía no hay turnos.
  modeloEnUso: ModeloEnUso | null;
}

// principal: respondió el modelo principal (el nombre sale del span
// model_generation; null si no se pudo leer). respaldo: FallbackModelo marcó
// `modelo_respaldo` y `modelo_usado` en la raíz. sin_modelo: fallaron los dos.
export interface ModeloEnUso {
  estado: "principal" | "respaldo" | "sin_modelo";
  modelo: string | null;
  en: string;
  traceId: string;
}

// Span completo (getTrace): solo usamos el tipo y sus atributos.
export interface SpanCompleto {
  spanType: string;
  attributes?: Record<string, unknown> | null;
}

// Lo que usamos de cada span del detalle de una traza (getTraceLight).
export interface SpanDetalle {
  spanType: string;
  status?: string | null;
  error?: unknown;
  metadata?: Record<string, unknown> | null;
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
  // Detalle liviano de una traza (Postgres y LibSQL lo implementan).
  getTraceLight?(args: { traceId: string }): Promise<{ spans: SpanDetalle[] } | null>;
  // Traza completa (con atributos): solo para el nombre del modelo principal.
  getTrace?(args: { traceId: string }): Promise<{ spans: SpanCompleto[] } | null>;
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

const TIPOS_HERRAMIENTA = new Set(["tool_call", "mcp_tool_call", "client_tool_call", "provider_tool_call"]);
const TIPOS_MODELO = new Set(["model_generation", "model_step", "model_chunk"]);
const PISTA_TIEMPO = /timeout|timed out|tiempo_agotado|abort/i;
const PISTA_MODELO = /api_?call|overloaded|rate.?limit|provider|server_error|service unavailable|status code 5\d\d/i;

const conError = (s: SpanDetalle) => s.status === "error" || (s.error != null && s.error !== false);

// Texto del error (nombre, mensaje, id, categoría) para buscar pistas. Nunca se muestra.
function pistas(error: unknown): string {
  if (error == null || error === false) return "";
  if (typeof error === "string") return error;
  if (typeof error !== "object") return "";
  const e = error as Record<string, unknown>;
  return ["name", "message", "id", "category", "domain", "code"]
    .map((k) => (typeof e[k] === "string" ? e[k] : ""))
    .join(" ");
}

// ¿Es una falla técnica y de qué tipo? null = no es una falla. Los bloqueos de
// guardrail y los errores del modelo principal en una respuesta que salvó el
// respaldo no cuentan. `spans` = detalle de la traza (undefined si no se pudo leer).
export function tipoDeFalla(raiz: RaizTraza, spans: readonly SpanDetalle[] | undefined, conErrorHijo: boolean): TipoFalla | null {
  const errorRaiz = raiz.status === "error" || (raiz.error != null && raiz.error !== false);
  // buscar_laminas agotó sus reintentos (lo marca en la raíz), aunque el agente haya respondido.
  if (raiz.metadata?.falla_herramienta === true) return "herramienta";
  if (!errorRaiz && !conErrorHijo) return null;
  const salvada = !errorRaiz && raiz.metadata?.modelo_respaldo === true;

  if (!spans) return salvada ? null : PISTA_TIEMPO.test(pistas(raiz.error)) ? "tiempo" : PISTA_MODELO.test(pistas(raiz.error)) ? "modelo" : "otro";

  const fallidos = spans.filter(
    (s) =>
      s.spanType !== "agent_run" &&
      conError(s) &&
      !(s.spanType === "processor_run" && typeof s.metadata?.guardrail === "string") &&
      !(salvada && TIPOS_MODELO.has(s.spanType)),
  );
  if (!errorRaiz && fallidos.length === 0) return null;

  const texto = [pistas(raiz.error), ...fallidos.map((s) => pistas(s.error))].join(" ");
  if (PISTA_TIEMPO.test(texto)) return "tiempo";
  if (fallidos.some((s) => TIPOS_HERRAMIENTA.has(s.spanType))) return "herramienta";
  if (fallidos.some((s) => TIPOS_MODELO.has(s.spanType)) || PISTA_MODELO.test(texto)) return "modelo";
  return "otro";
}

// ¿Hay que pedir el detalle de esta raíz para clasificar su falla?
export function esCandidataAFalla(r: RaizTraza, conErrorHijo: ReadonlySet<string>): boolean {
  if (esTrazaDeEval(r.metadata) || motivoDeBloqueo(r.metadata) || r.metadata?.falla_herramienta === true) return false;
  return r.status === "error" || (r.error != null && r.error !== false) || conErrorHijo.has(r.traceId);
}

const ms = (f: Fecha | null | undefined) => (f == null ? Number.NaN : new Date(f).getTime());

export function calcularMetricasTrazas(
  raices: readonly RaizTraza[],
  {
    ahora,
    trazasConErrorHijo = new Set<string>(),
    bloqueosEnHijos = new Map<string, string>(),
    detalle = new Map<string, SpanDetalle[]>(),
  }: {
    ahora: number;
    trazasConErrorHijo?: ReadonlySet<string>;
    // traceId → motivo de un bloqueo registrado en un span hijo (procesador).
    bloqueosEnHijos?: ReadonlyMap<string, string>;
    // traceId → spans de la traza, para clasificar sus fallas.
    detalle?: ReadonlyMap<string, SpanDetalle[]>;
  },
): MetricasTrazas {
  const duraciones: number[] = [];
  const porMotivo: Record<string, number> = {};
  let bloqueos = 0;
  let errores = 0;
  const erroresPorTipo: Partial<Record<TipoFalla, number>> = {};
  let turnos = 0;
  let respaldoHora = 0;
  let ultimoRespaldo = Number.NEGATIVE_INFINITY;
  let modeloEnUso: ModeloEnUso | null = null;
  let inicioModelo = Number.NEGATIVE_INFINITY;
  const candidatoModelo = (r: RaizTraza, inicio: number, estado: ModeloEnUso["estado"]) => {
    if (!(inicio > inicioModelo)) return;
    inicioModelo = inicio;
    const usado = typeof r.metadata?.modelo_usado === "string" && r.metadata.modelo_usado ? r.metadata.modelo_usado : null;
    modeloEnUso = { estado, modelo: estado === "sin_modelo" ? null : usado, en: new Date(inicio).toISOString(), traceId: r.traceId };
  };

  for (const r of raices) {
    const inicio = ms(r.startedAt);
    if (!(inicio >= ahora - VENTANA_TOTALES_MS)) continue;
    // Turnos del runner de evals: no son tráfico de asistentes.
    if (esTrazaDeEval(r.metadata)) continue;
    turnos++;

    if (r.metadata?.modelo_respaldo === true) {
      if (inicio >= ahora - VENTANA_LATENCIA_MS) respaldoHora++;
      ultimoRespaldo = Math.max(ultimoRespaldo, inicio);
    }

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

    const tipo = tipoDeFalla(r, detalle.get(r.traceId), trazasConErrorHijo.has(r.traceId));
    const sinRespuesta = r.status === "error" || (r.error != null && r.error !== false) || trazasConErrorHijo.has(r.traceId);
    // Modelo en uso: turnos terminados que respondieron (o en los que ningún modelo pudo).
    if (tipo === "modelo") candidatoModelo(r, inicio, "sin_modelo");
    else if (r.status !== "running" && (tipo === null || (tipo === "herramienta" && !sinRespuesta))) {
      candidatoModelo(r, inicio, r.metadata?.modelo_respaldo === true ? "respaldo" : "principal");
    }
    if (tipo) {
      errores++;
      erroresPorTipo[tipo] = (erroresPorTipo[tipo] ?? 0) + 1;
      // Una falla de herramienta con respuesta completa sigue contando en la latencia.
      if (sinRespuesta || tipo !== "herramienta") continue;
    }

    const fin = ms(r.endedAt);
    if (Number.isFinite(fin) && fin >= inicio && inicio >= ahora - VENTANA_LATENCIA_MS) duraciones.push(fin - inicio);
  }

  return {
    latencia: { p50Ms: percentil(duraciones, 50), p95Ms: percentil(duraciones, 95), muestras: duraciones.length },
    errores,
    erroresPorTipo,
    bloqueos: { total: bloqueos, porMotivo },
    turnos,
    respaldo: {
      ultimaHora: respaldoHora,
      ultimaEn: Number.isFinite(ultimoRespaldo) ? new Date(ultimoRespaldo).toISOString() : null,
    },
    modeloEnUso,
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

// Las fallas son pocas: se pide el detalle liviano de cada una (máx. 30) para
// saber su tipo. Si una lectura falla, esa traza queda sin detalle («otro»).
const DETALLES_MAXIMOS = 30;
async function detalleDeFallas(store: StoreTrazas, traceIds: string[]): Promise<Map<string, SpanDetalle[]>> {
  const salida = new Map<string, SpanDetalle[]>();
  if (typeof store.getTraceLight !== "function") return salida;
  await Promise.all(
    traceIds.slice(0, DETALLES_MAXIMOS).map(async (traceId) => {
      try {
        const t = await store.getTraceLight!({ traceId });
        if (t && Array.isArray(t.spans)) salida.set(traceId, t.spans);
      } catch {
        // sin detalle: se clasifica con la raíz
      }
    }),
  );
  return salida;
}

// Nombre del modelo principal: atributo `model` del span model_generation de
// la traza (una sola lectura completa). null si no se puede leer.
async function modeloDeLaTraza(store: StoreTrazas, traceId: string): Promise<string | null> {
  if (typeof store.getTrace !== "function") return null;
  try {
    const t = await store.getTrace({ traceId });
    for (const s of t?.spans ?? []) {
      const modelo = s.spanType === "model_generation" ? s.attributes?.model : undefined;
      if (typeof modelo === "string" && modelo) return modelo;
    }
  } catch {
    // sin nombre: el panel muestra «—»
  }
  return null;
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
        const trazasConErrorHijo = new Set(conErrorHijo.map((r) => r.traceId));
        const candidatas = raices
          .filter((r) => !bloqueosEnHijos.has(r.traceId) && esCandidataAFalla(r, trazasConErrorHijo))
          .map((r) => r.traceId);
        const detalle = await detalleDeFallas(store, candidatas);
        const m = calcularMetricasTrazas(raices, { ahora: momento, trazasConErrorHijo, bloqueosEnHijos, detalle });
        if (m.modeloEnUso?.estado === "principal" && !m.modeloEnUso.modelo) {
          m.modeloEnUso = { ...m.modeloEnUso, modelo: await modeloDeLaTraza(store, m.modeloEnUso.traceId) };
        }
        return m;
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
