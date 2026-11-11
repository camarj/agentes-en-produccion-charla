import { MastraCompositeStore } from "@mastra/core/storage";
import { ObservabilityStoragePostgresVNext, PostgresStore } from "@mastra/pg";
import { Pool } from "pg";

// Todo Mastra (memoria, hilos y mensajes, memoria observacional, puntajes,
// workflows, datasets y experimentos, trazas) vive en la misma base Postgres
// de la app (Cloud SQL, DATABASE_URL), en su propio esquema para no chocar con
// las tablas de la app.
export const ESQUEMA_MASTRA = "mastra";

// Conexiones máximas a Postgres por proceso para Mastra (aparte del pool de la
// app, lib/db/client.ts, que usa hasta 10). Lo comparten la memoria y la
// observabilidad. Cuentan web y Studio: cada proceso suma 4 + 10.
export const MAX_CONEXIONES_MASTRA = 4;

type Entorno = { DATABASE_URL?: string; MASTRA_ESQUEMA?: string; [clave: string]: string | undefined };

// MASTRA_ESQUEMA permite aislar Mastra en otro esquema (p. ej. pruebas locales de evals).
export function esquemaMastra(entorno: Entorno = process.env): string {
  const esquema = entorno.MASTRA_ESQUEMA?.trim() || ESQUEMA_MASTRA;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(esquema)) {
    throw new Error("MASTRA_ESQUEMA no es válido: usa solo minúsculas, números y guion bajo");
  }
  return esquema;
}

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

// Sin URL, pg usa las variables estándar PGHOST, PGUSER, etc. La conexión se
// abre al primer uso, nunca al importar.
export function crearPoolMastra(connectionString: string | undefined = process.env.DATABASE_URL?.trim() || undefined): Pool {
  const pool = new Pool({
    connectionString,
    max: MAX_CONEXIONES_MASTRA,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Sin este manejador, una conexión inactiva que el servidor cierra (p. ej.
  // un reinicio de Cloud SQL) lanzaría un 'error' sin capturar.
  pool.on("error", (error) => {
    console.error("[mastra] se perdió una conexión inactiva con Postgres", describirError(error));
  });
  return pool;
}

type Args<M extends keyof ObservabilityStoragePostgresVNext> = Parameters<
  Extract<ObservabilityStoragePostgresVNext[M], (...a: never[]) => unknown>
>[0];

// Observabilidad en Postgres que nunca bloquea el chat.
// - La preparación (tablas, índices, particiones diarias) corre en segundo
//   plano: es lenta (con Neon desde Ecuador tardaba ~72 s en cada arranque), y
//   el almacenamiento compuesto espera a todos sus dominios antes de dejar usar
//   la memoria.
// - Solo las escrituras de trazas, feedback, puntajes, logs y métricas (que
//   Mastra hace en segundo plano, fuera del turno) esperan a que termine. Si
//   falló, la reintentan; si vuelve a fallar, igual intentan escribir (las
//   tablas pueden existir ya) y el error queda solo en el log del exportador.
export class ObservabilidadPostgresTolerante extends ObservabilityStoragePostgresVNext {
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

// Almacenamiento de Mastra: PostgresStore para todos los dominios, salvo la
// observabilidad, que usa el dominio v-next (el que lee Studio) en modo
// tolerante. Los dos comparten un solo pool pequeño.
export function crearAlmacenamiento({
  entorno = process.env,
  pool,
  esquema = esquemaMastra(entorno),
}: { entorno?: Entorno; pool?: Pool; esquema?: string } = {}): MastraCompositeStore {
  const conexiones = pool ?? crearPoolMastra(entorno.DATABASE_URL?.trim() || undefined);
  return new MastraCompositeStore({
    id: "mastra-storage",
    default: new PostgresStore({ id: "mastra-storage-pg", pool: conexiones, schemaName: esquema }),
    domains: {
      observability: new ObservabilidadPostgresTolerante({ pool: conexiones, schemaName: esquema }),
    },
  });
}

// Un solo almacenamiento para la instancia de Mastra y la memoria del agente.
export const almacenamiento = crearAlmacenamiento();
