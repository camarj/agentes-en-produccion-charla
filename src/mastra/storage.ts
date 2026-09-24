import { MastraCompositeStore } from "@mastra/core/storage";
import { LibSQLStore } from "@mastra/libsql";
import { ObservabilityStoragePostgresVNext } from "@mastra/pg";
import { Pool } from "pg";
import { urlArchivo } from "../../lib/rutas";

// Conexiones máximas a Postgres por proceso. Se conectan dos procesos (la app
// web y Studio), así que el total queda en el doble.
export const MAX_CONEXIONES_OBSERVABILIDAD = 3;

type Entorno = { MASTRA_DB_URL?: string; OBSERVABILIDAD_DATABASE_URL?: string; [clave: string]: string | undefined };

// Solo el tipo y los códigos del error (p. ej. ECONNREFUSED, ENOTFOUND): el
// mensaje de pg puede traer el host.
function describirError(error: unknown) {
  const codigo = (e: unknown) => (e as { code?: unknown } | null | undefined)?.code;
  return {
    tipo: error instanceof Error ? error.name : typeof error,
    codigo: codigo(error),
    causa: codigo((error as { cause?: unknown } | null)?.cause),
  };
}

export function crearPoolObservabilidad(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: MAX_CONEXIONES_OBSERVABILIDAD,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Sin este manejador, una conexión inactiva que el servidor cierra (Neon
  // suspende la base cuando está ociosa) lanzaría un 'error' sin capturar.
  pool.on("error", (error) => {
    console.error("[observabilidad] se perdió una conexión inactiva con Postgres", describirError(error));
  });
  return pool;
}

type Args<M extends keyof ObservabilityStoragePostgresVNext> = Parameters<
  Extract<ObservabilityStoragePostgresVNext[M], (...a: never[]) => unknown>
>[0];

// Observabilidad en Postgres que nunca bloquea el chat.
// - La preparación (tablas, índices, particiones diarias) corre en segundo
//   plano: desde Ecuador tarda ~72 s en cada arranque, y el almacenamiento
//   compuesto espera a todos sus dominios antes de dejar usar la memoria.
// - Solo las escrituras de trazas, feedback, puntajes, logs y métricas (que
//   Mastra hace en segundo plano, fuera del turno) esperan a que termine. Si
//   falló, la reintentan; si vuelve a fallar, igual intentan escribir (las
//   tablas pueden existir ya) y el error queda solo en el log del exportador.
class ObservabilidadPostgresTolerante extends ObservabilityStoragePostgresVNext {
  #preparacion: Promise<void> | null = null;

  #preparar(): Promise<void> {
    this.#preparacion ??= super.init().catch((error: unknown) => {
      this.#preparacion = null;
      console.error("[observabilidad] no se pudo preparar Postgres; el chat sigue sin trazas", describirError(error));
    });
    return this.#preparacion;
  }

  override async init(): Promise<void> {
    void this.#preparar();
  }

  override async createSpan(args: Args<"createSpan">) {
    await this.#preparar();
    return super.createSpan(args);
  }
  override async batchCreateSpans(args: Args<"batchCreateSpans">) {
    await this.#preparar();
    return super.batchCreateSpans(args);
  }
  override async batchCreateLogs(args: Args<"batchCreateLogs">) {
    await this.#preparar();
    return super.batchCreateLogs(args);
  }
  override async batchCreateMetrics(args: Args<"batchCreateMetrics">) {
    await this.#preparar();
    return super.batchCreateMetrics(args);
  }
  override async createScore(args: Args<"createScore">) {
    await this.#preparar();
    return super.createScore(args);
  }
  override async batchCreateScores(args: Args<"batchCreateScores">) {
    await this.#preparar();
    return super.batchCreateScores(args);
  }
  override async createFeedback(args: Args<"createFeedback">) {
    await this.#preparar();
    return super.createFeedback(args);
  }
  override async batchCreateFeedback(args: Args<"batchCreateFeedback">) {
    await this.#preparar();
    return super.batchCreateFeedback(args);
  }
}

// Almacenamiento de Mastra:
// - Sin OBSERVABILIDAD_DATABASE_URL (tests, CI, desarrollo sin Neon): todo en
//   LibSQL (data/mastra.db), como antes.
// - Con la URL: solo el dominio `observability` (trazas, feedback, logs,
//   métricas) va a Postgres; memoria, workflows y puntajes siguen en mastra.db.
export function crearAlmacenamiento(entorno: Entorno = process.env): MastraCompositeStore {
  const libsql = new LibSQLStore({
    id: "mastra-storage",
    url: urlArchivo(entorno.MASTRA_DB_URL ?? "file:./data/mastra.db"),
  });
  const urlObservabilidad = entorno.OBSERVABILIDAD_DATABASE_URL?.trim();
  if (!urlObservabilidad) return libsql;

  return new MastraCompositeStore({
    id: "mastra-storage-compuesto",
    default: libsql,
    domains: {
      observability: new ObservabilidadPostgresTolerante({ pool: crearPoolObservabilidad(urlObservabilidad) }),
    },
  });
}

// Un solo almacenamiento para la instancia de Mastra y la memoria del agente.
export const almacenamiento = crearAlmacenamiento();
