// Ciclo de análisis de «Jev · la sala en vivo». Lo dispara la página (cada
// ~3 s pide GET /api/panel/jev): nunca corre en el camino del chat.
// - Lee las trazas nuevas del agente (últimas 2 h, sin evals) con la API del
//   store de observabilidad (Neon o LibSQL; solo lectura).
// - Analiza con Jev las que no tienen análisis (máx. 20 por ciclo, 4 a la vez).
// - Guarda cada análisis por traceId (idempotente).
// - Un solo ciclo a la vez por proceso: los polls concurrentes comparten el que
//   está en curso.
// - Si TypeSafe falla, deja de llamarlo un rato y la página muestra lo guardado.
// Nunca registra el texto de las preguntas; solo el tipo de error.

import { AGENTE } from "@/lib/panel/metricas-trazas";
import type { RepoJev } from "@/lib/db/jev";
import { interpretarResultado, type ResultadoJev } from "./resultado";
import { esCandidata, turnoDeTraza, type RaizListada, type SpanTraza, type TurnoJev } from "./turnos";

export const VENTANA_TRAZAS_MS = 2 * 60 * 60 * 1000;
export const MAXIMO_POR_CICLO = 20;
export const CONCURRENCIA = 4;
export const PAUSA_TRAS_FALLA_MS = 30_000;
const POR_PAGINA = 100;
const DESCARTADAS_MAXIMAS = 5000;

export interface StoreJev {
  listTracesLight(args: {
    filters: { entityId: string; startedAt: { start: Date } };
    pagination: { page: number; perPage: number };
  }): Promise<{ spans: RaizListada[] }>;
  getTrace(args: { traceId: string }): Promise<{ spans: SpanTraza[] } | null>;
}

// Una llamada a Jev por turno. Devuelve el resultado y cuánto tardó.
export type EvaluarTurno = (turno: TurnoJev) => Promise<{ resultado: ResultadoJev; latenciaMs: number }>;

export interface EstadoJev {
  jevDisponible: boolean;
  trazasDisponibles: boolean;
  analizadosEnCiclo: number;
}

type Repo = Pick<RepoJev, "guardar" | "analizados">;

const tipoDeError = (e: unknown) => (e instanceof Error ? e.name : typeof e);

async function enParalelo<T>(items: readonly T[], limite: number, tarea: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const trabajador = async () => {
    while (i < items.length) await tarea(items[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
}

export function crearAnalizadorJev({
  obtenerStore,
  evaluar,
  repo,
  ahora = Date.now,
  pausaTrasFallaMs = PAUSA_TRAS_FALLA_MS,
  maximoPorCiclo = MAXIMO_POR_CICLO,
  concurrencia = CONCURRENCIA,
}: {
  obtenerStore: () => Promise<StoreJev | null | undefined>;
  // null = TypeSafe sin configurar (sin TYPESAFE_API_KEY).
  evaluar: EvaluarTurno | null;
  repo: Repo;
  ahora?: () => number;
  pausaTrasFallaMs?: number;
  maximoPorCiclo?: number;
  concurrencia?: number;
}) {
  let enCurso: Promise<EstadoJev> | null = null;
  let ultimaFallaJev = Number.NEGATIVE_INFINITY;
  let trazasDisponibles = true;
  // Trazas que nunca serán un turno (abandonadas, sin pregunta): no se vuelven a pedir.
  const descartadas = new Set<string>();

  const jevDisponible = () => evaluar !== null && ahora() - ultimaFallaJev >= pausaTrasFallaMs;

  async function ciclo(): Promise<EstadoJev> {
    let analizados = 0;
    if (!jevDisponible()) return { jevDisponible: false, trazasDisponibles, analizadosEnCiclo: 0 };

    let store: StoreJev | null | undefined;
    let raices: RaizListada[];
    try {
      store = await obtenerStore();
      if (!store) throw new Error("sin_store");
      const pagina = await store.listTracesLight({
        filters: { entityId: AGENTE, startedAt: { start: new Date(ahora() - VENTANA_TRAZAS_MS) } },
        pagination: { page: 0, perPage: POR_PAGINA },
      });
      raices = pagina.spans;
      trazasDisponibles = true;
    } catch (error) {
      trazasDisponibles = false;
      console.error("[jev] no se pudieron leer las trazas", { tipo: tipoDeError(error) });
      return { jevDisponible: jevDisponible(), trazasDisponibles, analizadosEnCiclo: 0 };
    }

    const momento = ahora();
    const candidatas = raices.filter((r) => !descartadas.has(r.traceId) && esCandidata(r, momento));
    const hechas = await repo.analizados(candidatas.map((r) => r.traceId));
    const pendientes = candidatas
      .filter((r) => !hechas.has(r.traceId))
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, maximoPorCiclo);

    let fallo = false;
    await enParalelo(pendientes, concurrencia, async (raiz) => {
      if (fallo) return;
      let spans: SpanTraza[];
      try {
        spans = (await store!.getTrace({ traceId: raiz.traceId }))?.spans ?? [];
      } catch (error) {
        console.error("[jev] no se pudo leer una traza", { tipo: tipoDeError(error) });
        return;
      }
      const r = turnoDeTraza(raiz, spans, ahora());
      if (r.tipo === "descartar") {
        if (descartadas.size >= DESCARTADAS_MAXIMAS) descartadas.clear();
        descartadas.add(raiz.traceId);
        return;
      }
      if (r.tipo === "pendiente") return;
      try {
        const { resultado, latenciaMs } = await evaluar!(r.turno);
        if (await repo.guardar(interpretarResultado(r.turno, resultado, latenciaMs))) analizados++;
      } catch (error) {
        fallo = true;
        ultimaFallaJev = ahora();
        console.error("[jev] TypeSafe no respondió", { tipo: tipoDeError(error) });
      }
    });

    return { jevDisponible: jevDisponible(), trazasDisponibles, analizadosEnCiclo: analizados };
  }

  // Ciclo compartido: si ya hay uno en curso, se espera ese mismo.
  function analizar(): Promise<EstadoJev> {
    enCurso ??= ciclo()
      .catch((error: unknown): EstadoJev => {
        console.error("[jev] el ciclo de análisis falló", { tipo: tipoDeError(error) });
        return { jevDisponible: jevDisponible(), trazasDisponibles, analizadosEnCiclo: 0 };
      })
      .finally(() => {
        enCurso = null;
      });
    return enCurso;
  }

  // Estado sin esperar a un ciclo (para responder rápido si el ciclo tarda).
  function estado(): EstadoJev {
    return { jevDisponible: jevDisponible(), trazasDisponibles, analizadosEnCiclo: 0 };
  }

  return { analizar, estado };
}

export type AnalizadorJev = ReturnType<typeof crearAnalizadorJev>;
