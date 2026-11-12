import { PostgresStore, ObservabilityStoragePostgresVNext } from "@mastra/pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ESQUEMA_MASTRA,
  MAX_CONEXIONES_MASTRA,
  ObservabilidadPostgresTolerante,
  crearAlmacenamiento,
  crearPoolMastra,
  esquemaMastra,
} from "./storage";
import { crearAlmacenamientoDePrueba } from "./pruebas/almacenamiento";

// Ninguna prueba necesita un Postgres real: el pool de pg es perezoso (no se
// conecta al construirlo), la memoria corre en PGlite y la prueba de
// tolerancia usa un puerto local cerrado.
afterEach(() => {
  vi.restoreAllMocks();
});

const URL_FALSA = "postgresql://usuario:clave-secreta@127.0.0.1:1/charla?sslmode=disable";

describe("crearAlmacenamiento", () => {
  it("todo Mastra va a Postgres (DATABASE_URL) en el esquema `mastra`: memoria, workflows, puntajes y trazas", async () => {
    const store = crearAlmacenamiento({ entorno: { DATABASE_URL: URL_FALSA } });
    expect(ESQUEMA_MASTRA).toBe("mastra");
    for (const dominio of ["memory", "workflows", "scores", "datasets", "experiments"] as const) {
      const actual = await store.getStore(dominio);
      expect(actual?.constructor.name, dominio).toMatch(/PG$/);
    }
    expect(await store.getStore("observability")).toBeInstanceOf(ObservabilityStoragePostgresVNext);
    await store.close();
  });

  it("el esquema se puede cambiar con MASTRA_ESQUEMA y se valida", () => {
    expect(esquemaMastra({})).toBe("mastra");
    expect(esquemaMastra({ MASTRA_ESQUEMA: " evals_x " })).toBe("evals_x");
    expect(() => esquemaMastra({ MASTRA_ESQUEMA: 'mal"; drop' })).toThrow(/MASTRA_ESQUEMA/);
  });

  it("guarda la memoria en Postgres, en el esquema configurado", async () => {
    const { almacenamiento, esquema, pool } = crearAlmacenamientoDePrueba("storage");
    await almacenamiento.init();
    const memoria = (await almacenamiento.getStore("memory"))!;
    const ahora = new Date();
    await memoria.saveThread({ thread: { id: "hilo-0", resourceId: "recurso-0", title: "", createdAt: ahora, updatedAt: ahora } });

    const filas = await pool.query(`SELECT id FROM "${esquema}".mastra_threads`);
    expect(filas.rows).toEqual([{ id: "hilo-0" }]);
    const enPublic = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'mastra_%'`,
    );
    expect(enPublic.rows[0]).toEqual({ n: 0 });
  });

  it("si Postgres no responde, iniciar la observabilidad no bloquea y no registra la URL ni la clave", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const obs = new ObservabilidadPostgresTolerante({ pool: crearPoolMastra(URL_FALSA), schemaName: "mastra" });

    await expect(obs.init()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(errores).toHaveBeenCalled(), { timeout: 15_000 });
    const registrado = JSON.stringify(errores.mock.calls);
    expect(registrado).not.toContain("clave-secreta");
    expect(registrado).not.toContain("127.0.0.1");
  });
});

describe("preparación de la observabilidad en segundo plano", () => {
  // La preparación de la observabilidad (tablas e índices particionados) es
  // lenta; el chat no puede esperarla.
  it("init() no espera a la observabilidad: responde y la memoria funciona", async () => {
    vi.spyOn(ObservabilityStoragePostgresVNext.prototype, "init").mockImplementation(() => new Promise(() => {}));
    const { almacenamiento } = crearAlmacenamientoDePrueba("storage");

    await almacenamiento.init();

    const memoria = (await almacenamiento.getStore("memory"))!;
    const ahora = new Date();
    await memoria.saveThread({ thread: { id: "hilo-2", resourceId: "recurso-2", title: "", createdAt: ahora, updatedAt: ahora } });
    expect((await memoria.getThreadById({ threadId: "hilo-2" }))?.id).toBe("hilo-2");
  });

  it("las escrituras esperan a la preparación y, si falló, la reintentan una vez antes de escribir", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const preparar = vi
      .spyOn(ObservabilityStoragePostgresVNext.prototype, "init")
      .mockRejectedValueOnce(new Error("sin red"))
      .mockResolvedValue(undefined);
    const escribir = vi.spyOn(ObservabilityStoragePostgresVNext.prototype, "batchCreateFeedback").mockResolvedValue(undefined);
    vi.spyOn(PostgresStore.prototype, "init").mockResolvedValue(undefined);
    const store = crearAlmacenamiento({ entorno: { DATABASE_URL: URL_FALSA } });
    const obs = (await store.getStore("observability"))!;

    await store.init();
    await vi.waitFor(() => expect(preparar).toHaveBeenCalledTimes(1));
    await obs.batchCreateFeedback({ feedbacks: [] });

    expect(preparar).toHaveBeenCalledTimes(2);
    expect(escribir).toHaveBeenCalledTimes(1);
    expect(preparar.mock.invocationCallOrder[1]).toBeLessThan(escribir.mock.invocationCallOrder[0]);

    // Ya preparada: la siguiente escritura no repite la preparación.
    await obs.batchCreateFeedback({ feedbacks: [] });
    expect(preparar).toHaveBeenCalledTimes(2);
    await store.close();
  });
});

describe("crearPoolMastra", () => {
  it("usa un pool pequeño (Cloud SQL limita las conexiones) y no se cae si una conexión inactiva muere", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = crearPoolMastra(URL_FALSA);
    // Cloud SQL (db-custom-1-3840) admite 100 conexiones: hasta 3 copias de
    // web + Studio, cada una con 10 de la app + las de Mastra, deben caber con margen.
    expect(4 * (10 + MAX_CONEXIONES_MASTRA)).toBeLessThanOrEqual(85);
    expect(pool.options.max).toBe(MAX_CONEXIONES_MASTRA);
    expect(pool.options.connectionTimeoutMillis).toBeGreaterThan(0);

    // Sin un manejador, un 'error' de una conexión inactiva tumbaría el proceso.
    expect(() => pool.emit("error", new Error("conexión cerrada por el servidor"))).not.toThrow();
    expect(JSON.stringify(errores.mock.calls)).not.toContain("clave-secreta");
    await pool.end();
  });
});
