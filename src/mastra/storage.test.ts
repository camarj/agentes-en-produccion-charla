import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LibSQLStore } from "@mastra/libsql";
import { ObservabilityStoragePostgresVNext } from "@mastra/pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_CONEXIONES_OBSERVABILIDAD, crearAlmacenamiento, crearPoolObservabilidad } from "./storage";

// Ninguna prueba necesita Neon: con URL se construye el almacenamiento sin
// conectarse (el pool de pg es perezoso) y la prueba de tolerancia usa un
// puerto local cerrado.
const archivos: string[] = [];
function mastraDbTemporal() {
  const ruta = path.join(os.tmpdir(), `mastra-storage-${crypto.randomUUID()}.db`);
  archivos.push(ruta);
  return `file:${ruta}`;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const ruta of archivos.splice(0)) {
    for (const extra of ["", "-wal", "-shm"]) fs.rmSync(`${ruta}${extra}`, { force: true });
  }
});

const URL_FALSA = "postgresql://usuario:clave-secreta@127.0.0.1:1/observabilidad?sslmode=disable";

describe("crearAlmacenamiento", () => {
  it("sin OBSERVABILIDAD_DATABASE_URL todo sigue en LibSQL (mastra.db)", async () => {
    const store = crearAlmacenamiento({ MASTRA_DB_URL: mastraDbTemporal() });
    expect(store).toBeInstanceOf(LibSQLStore);
    const obs = await store.getStore("observability");
    expect(obs).toBeDefined();
    expect(obs).not.toBeInstanceOf(ObservabilityStoragePostgresVNext);
  });

  it("una URL vacía o con solo espacios también usa LibSQL", () => {
    expect(crearAlmacenamiento({ MASTRA_DB_URL: mastraDbTemporal(), OBSERVABILIDAD_DATABASE_URL: "" })).toBeInstanceOf(
      LibSQLStore,
    );
    expect(
      crearAlmacenamiento({ MASTRA_DB_URL: mastraDbTemporal(), OBSERVABILIDAD_DATABASE_URL: "   " }),
    ).toBeInstanceOf(LibSQLStore);
  });

  it("con URL solo la observabilidad va a Postgres; memoria, workflows y puntajes siguen en LibSQL", async () => {
    const url = mastraDbTemporal();
    const store = crearAlmacenamiento({ MASTRA_DB_URL: url, OBSERVABILIDAD_DATABASE_URL: URL_FALSA });
    const soloLibsql = new LibSQLStore({ id: "referencia", url });

    expect(store).not.toBeInstanceOf(LibSQLStore);
    expect(await store.getStore("observability")).toBeInstanceOf(ObservabilityStoragePostgresVNext);
    for (const dominio of ["memory", "workflows", "scores"] as const) {
      const actual = await store.getStore(dominio);
      const esperado = await soloLibsql.getStore(dominio);
      expect(actual?.constructor.name, dominio).toBe(esperado?.constructor.name);
    }
    await store.close();
  });

  it("si Postgres no responde, iniciar no falla y la memoria en LibSQL sigue funcionando", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = crearAlmacenamiento({ MASTRA_DB_URL: mastraDbTemporal(), OBSERVABILIDAD_DATABASE_URL: URL_FALSA });

    await expect(store.init()).resolves.toBeUndefined();

    const memoria = (await store.getStore("memory"))!;
    const ahora = new Date();
    await memoria.saveThread({
      thread: { id: "hilo-1", resourceId: "recurso-1", title: "", createdAt: ahora, updatedAt: ahora },
    });
    expect((await memoria.getThreadById({ threadId: "hilo-1" }))?.id).toBe("hilo-1");

    // Se registra el fallo (en segundo plano), pero nunca la URL ni la clave.
    await vi.waitFor(() => expect(errores).toHaveBeenCalled(), { timeout: 5000 });
    const registrado = JSON.stringify(errores.mock.calls);
    expect(registrado).not.toContain("clave-secreta");
    expect(registrado).not.toContain("127.0.0.1");
    await store.close();
  });
});

describe("preparación de Postgres en segundo plano", () => {
  // Desde Ecuador, init() de Postgres tarda ~72 s aunque las tablas existan;
  // el chat no puede esperarla.
  it("init() no espera a Postgres: responde al instante y la memoria funciona", async () => {
    vi.spyOn(ObservabilityStoragePostgresVNext.prototype, "init").mockImplementation(() => new Promise(() => {}));
    const store = crearAlmacenamiento({ MASTRA_DB_URL: mastraDbTemporal(), OBSERVABILIDAD_DATABASE_URL: URL_FALSA });

    const t0 = Date.now();
    await store.init();
    expect(Date.now() - t0).toBeLessThan(2000);

    const memoria = (await store.getStore("memory"))!;
    const ahora = new Date();
    await memoria.saveThread({
      thread: { id: "hilo-2", resourceId: "recurso-2", title: "", createdAt: ahora, updatedAt: ahora },
    });
    expect((await memoria.getThreadById({ threadId: "hilo-2" }))?.id).toBe("hilo-2");
    await store.close();
  });

  it("las escrituras esperan a la preparación y, si falló, la reintentan una vez antes de escribir", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const preparar = vi
      .spyOn(ObservabilityStoragePostgresVNext.prototype, "init")
      .mockRejectedValueOnce(new Error("sin red"))
      .mockResolvedValue(undefined);
    const escribir = vi
      .spyOn(ObservabilityStoragePostgresVNext.prototype, "batchCreateFeedback")
      .mockResolvedValue(undefined);
    const store = crearAlmacenamiento({ MASTRA_DB_URL: mastraDbTemporal(), OBSERVABILIDAD_DATABASE_URL: URL_FALSA });
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

describe("crearPoolObservabilidad", () => {
  it("usa un pool pequeño (lo comparten web y Studio) y no se cae si una conexión inactiva muere", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = crearPoolObservabilidad(URL_FALSA);
    expect(MAX_CONEXIONES_OBSERVABILIDAD).toBeLessThanOrEqual(5);
    expect(pool.options.max).toBe(MAX_CONEXIONES_OBSERVABILIDAD);
    expect(pool.options.connectionTimeoutMillis).toBeGreaterThan(0);

    // Sin un manejador, un 'error' de una conexión inactiva tumbaría el proceso.
    expect(() => pool.emit("error", new Error("conexión cerrada por el servidor"))).not.toThrow();
    expect(JSON.stringify(errores.mock.calls)).not.toContain("clave-secreta");
    await pool.end();
  });
});
