import type { RequestContext } from "@mastra/core/request-context";
import { interruptoresActivos } from "@/lib/chat";
import type { ClaveInterruptor, Interruptores } from "@/lib/db/interruptores";
import { crearCerrojo } from "./cerrojo";
import type { ObservacionRuta } from "./checks";
import type { Caso } from "./dataset";
import { observarError, observarResultado, type EvidenciaTraza, type Observacion, type ResultadoGenerate } from "./observacion";

// Objetivo de runEvals: el agente `charla` registrado, tal cual (mismos
// guardrails de entrada en paralelo, guardrail de salida, fallback de modelo
// y herramientas con los interruptores de caos), envuelto solo para lo que
// la ruta de chat hace alrededor de un turno y runEvals no puede hacer:
// - un hilo nuevo por caso, con recurso `eval-…` (nunca un hilo de asistente),
// - la marca de trazas de eval (metadata `origen: eval` y etiquetas),
// - los interruptores de caos del caso, solo durante su turno y sin otros
//   casos en paralelo (son globales en la base temporal),
// - registrar lo que se observó (tripwire, texto visible, herramientas,
//   modelo, tiempo) para los gates, que runEvals no les entrega.
// También oculta la instancia de Mastra a runEvals: así runEvals no guarda
// sus propias filas de puntajes; el registro en Studio es el experimento.

type InterruptoresRepo = {
  obtenerTodos(): Promise<Interruptores>;
  actualizar(clave: ClaveInterruptor, valor: string): Promise<void>;
};

export interface TrazadoCaso {
  metadata: Record<string, unknown>;
  tags: string[];
}

export interface DependenciasObjetivo {
  casos: ReadonlyMap<string, Caso>;
  observaciones: Map<string, Observacion>;
  interruptores: InterruptoresRepo;
  memoria: (casoId: string) => { thread: string; resource: string };
  trazado: (caso: Caso) => TrazadoCaso;
  // Opciones extra para agent.generate (p. ej. procesadores de una prueba de fallo).
  opcionesExtra?: Record<string, unknown>;
  // Lee intentos, modelos y respaldo de la traza guardada (resiliencia).
  leerEvidencia?: (traceId: string, caso: Caso) => Promise<EvidenciaTraza | undefined>;
  // Casos de nivel «ruta» (R04): en vez del agente, se llama a POST /api/chat.
  rutas?: Map<string, ObservacionRuta>;
  probarRuta?: (caso: Caso) => Promise<ObservacionRuta>;
}

type Opciones = Record<string, unknown> & { requestContext?: RequestContext; tracingOptions?: { metadata?: Record<string, unknown>; tags?: string[] } };

type AgenteGenerable = { generate: (...args: never[]) => unknown };

async function conInterruptores<T>(repo: InterruptoresRepo, caso: Caso, rc: RequestContext | undefined, tarea: () => Promise<T>): Promise<T> {
  const claves = Object.entries(caso.interruptores) as [ClaveInterruptor, string][];
  const previos = await repo.obtenerTodos();
  for (const [clave, valor] of claves) await repo.actualizar(clave, valor);
  rc?.set("interruptores_activos", interruptoresActivos(await repo.obtenerTodos()));
  try {
    return await tarea();
  } finally {
    for (const [clave] of claves) await repo.actualizar(clave, previos[clave]);
  }
}

export function crearObjetivo<A extends AgenteGenerable>(agente: A, deps: DependenciasObjetivo): A {
  const cerrojo = crearCerrojo();

  async function generar(input: unknown, opciones: Opciones = {}): Promise<unknown> {
    const rc = opciones.requestContext;
    const casoId = String(rc?.get("caso_id") ?? "");
    const caso = deps.casos.get(casoId);
    if (!caso) throw new Error(`caso desconocido: ${casoId}`);

    const trazado = deps.trazado(caso);
    const llamada: Opciones = {
      ...opciones,
      ...deps.opcionesExtra,
      memory: deps.memoria(casoId),
      tracingOptions: {
        ...opciones.tracingOptions,
        metadata: { ...opciones.tracingOptions?.metadata, ...trazado.metadata },
        tags: trazado.tags,
      },
    };
    const exclusivo = Object.keys(caso.interruptores).length > 0;
    if (caso.nivel === "ruta") return probarRuta(caso, rc, exclusivo);
    // La duración cuenta desde que empieza el turno, no desde que se pidió el
    // cerrojo: un caso de resiliencia puede esperar a que terminen otros.
    let inicio = performance.now();
    const turno = () =>
      conInterruptores(deps.interruptores, caso, rc, async () => {
        inicio = performance.now();
        const r = await (agente.generate as (i: unknown, o: Opciones) => Promise<ResultadoGenerate>)(input, llamada);
        return { r, ms: Math.round(performance.now() - inicio) };
      });

    try {
      const { r, ms } = exclusivo ? await cerrojo.exclusivo(turno) : await cerrojo.compartido(turno);
      const observacion = observarResultado(casoId, r, ms);
      const activos = Object.entries(caso.interruptores).filter(([, v]) => v === "on").map(([k]) => k);
      if (activos.length > 0) observacion.interruptores = activos;
      if (deps.leerEvidencia && r.traceId) {
        observacion.evidenciaTraza = await deps.leerEvidencia(r.traceId, caso).catch(() => undefined);
      }
      deps.observaciones.set(casoId, observacion);
      return r;
    } catch (error) {
      deps.observaciones.set(casoId, observarError(casoId, error, Math.round(performance.now() - inicio)));
      // runEvals se detendría entero si el objetivo lanza: el caso queda como
      // fallido (los gates valen 0) y los demás siguen.
      return { text: "", scoringData: { input: undefined, output: [] }, traceId: undefined };
    }
  }

  // R04: la ruta de chat, con los interruptores del caso (kill switch) puestos.
  async function probarRuta(caso: Caso, rc: RequestContext | undefined, exclusivo: boolean) {
    let inicio = performance.now();
    const turno = () =>
      conInterruptores(deps.interruptores, caso, rc, async (): Promise<ObservacionRuta> => {
        inicio = performance.now();
        if (!deps.probarRuta) return { status: null, mensaje: null, trazasAgente: null, omitida: "prueba de ruta omitida" };
        return deps.probarRuta(caso).catch((error: unknown) => ({
          status: null,
          mensaje: null,
          trazasAgente: null,
          error: `falló la llamada (${error instanceof Error ? error.name : "error"})`,
        }));
      });
    const r = exclusivo ? await cerrojo.exclusivo(turno) : await cerrojo.compartido(turno);
    deps.rutas?.set(caso.id, r);
    const texto = r.mensaje ?? "";
    deps.observaciones.set(caso.id, {
      casoId: caso.id,
      texto,
      bloqueado: false,
      motivo: null,
      herramientas: [],
      duracionMs: Math.round(performance.now() - inicio),
    });
    return { text: texto, scoringData: { input: undefined, output: [] }, traceId: undefined };
  }

  return new Proxy(agente, {
    get(objetivo, propiedad) {
      if (propiedad === "generate") return generar;
      if (propiedad === "getMastraInstance") return () => undefined;
      if (propiedad === "mastra") return undefined;
      const valor = Reflect.get(objetivo, propiedad, objetivo);
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  });
}
