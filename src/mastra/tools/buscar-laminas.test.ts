import fs from "node:fs";
import path from "node:path";
import { RequestContext } from "@mastra/core/request-context";
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { crearInterruptores } from "@/lib/db/interruptores";
import { crearLaminas } from "@/lib/db/laminas";
import { crearDbTemporal } from "@/lib/db/prueba";
import { extraerLaminas, importarLaminas } from "@/scripts/importar-laminas";
import { crearBuscarLaminas, type salidaBuscarLaminas } from "./buscar-laminas";
import type { z } from "zod";

type Db = Awaited<ReturnType<typeof crearDbTemporal>>;

function spanFalso() {
  const agentRun = { update: vi.fn() };
  return {
    isValid: true,
    traceId: "trace-1",
    update: vi.fn(),
    agentRun,
    findParent: vi.fn((tipo: string) => (tipo === "agent_run" ? agentRun : undefined)),
  };
}

function contexto(span?: ReturnType<typeof spanFalso>) {
  const base = { requestContext: new RequestContext() };
  return (span ? { ...base, tracingContext: { currentSpan: span } } : base) as never;
}

type Salida = z.infer<typeof salidaBuscarLaminas>;

// Entrada cruda, como la manda el modelo (max_resultados opcional).
async function ejecutar(
  herramienta: ReturnType<typeof crearBuscarLaminas>,
  entrada: { consulta: string; max_resultados?: number },
  ctx: never,
): Promise<Salida> {
  return (await herramienta.execute!(entrada as never, ctx)) as Salida;
}

describe("buscar_laminas", () => {
  it("expone id, descripción y esquemas", async () => {
    const herramienta = crearBuscarLaminas({
      laminas: { buscar: async () => [] },
      interruptores: { obtenerTodos: async () => ({ herramienta_caida: "off", latencia_alta: "off" }) },
    });
    expect(herramienta.id).toBe("buscar_laminas");
    expect(herramienta.description).toBe(
      "Busca en las láminas de la charla. Úsala antes de responder sobre el contenido de la presentación.",
    );
    const invalida = await ejecutar(herramienta, { consulta: "x" }, contexto());
    expect(invalida).toMatchObject({ error: true });
  });

  describe("con la presentación real", () => {
    let db: Db;
    beforeAll(async () => {
      db = await crearDbTemporal();
      const html = fs.readFileSync(
        path.join(process.cwd(), "agentes-produccion-taller-v43-before-slide14-v2.html"),
        "utf8",
      );
      await importarLaminas(db.fuente, extraerLaminas(html));
    });
    afterAll(() => db.cerrar());

    it("sin interruptores, «loop agéntico» devuelve primero la lámina 10", async () => {
      const herramienta = crearBuscarLaminas({
        laminas: crearLaminas(db.fuente),
        interruptores: crearInterruptores(db.fuente),
      });
      const span = spanFalso();
      const r = await ejecutar(herramienta, { consulta: "loop agéntico" }, contexto(span));
      if (!("resultados" in r)) throw new Error(`respuesta inesperada: ${JSON.stringify(r)}`);
      expect(r.sin_resultados).toBe(false);
      expect(r.resultados[0].lamina).toBe(10);
      expect(r.resultados.length).toBeLessThanOrEqual(3);
      for (const res of r.resultados) {
        expect(res.fragmento.length).toBeLessThanOrEqual(800);
        if (res.notas !== null) expect(res.notas.length).toBeLessThanOrEqual(1200);
      }
      expect(span.update).toHaveBeenCalledWith({
        metadata: { intentos: 1, interruptores_activos: [], cantidad_resultados: r.resultados.length },
      });
      expect(span.agentRun.update).not.toHaveBeenCalled();
    });

    it("sin coincidencias marca sin_resultados", async () => {
      const herramienta = crearBuscarLaminas({
        laminas: crearLaminas(db.fuente),
        interruptores: crearInterruptores(db.fuente),
      });
      const r = await ejecutar(herramienta, { consulta: "zzqxw inexistente", max_resultados: 5 }, contexto());
      expect(r).toEqual({ resultados: [], sin_resultados: true });
    });
  });

  it("recorta fragmento a 800 y notas a 1200 caracteres", async () => {
    const herramienta = crearBuscarLaminas({
      laminas: {
        buscar: async () => [
          { lamina: 1, titulo: "T", fragmento: "a".repeat(2000), notas: "b".repeat(3000), puntaje: 1 },
          { lamina: 2, titulo: "U", fragmento: "corto", notas: null, puntaje: 0.5 },
        ],
      },
      interruptores: { obtenerTodos: async () => ({ herramienta_caida: "off", latencia_alta: "off" }) },
    });
    const r = await ejecutar(herramienta, { consulta: "algo" }, contexto());
    if (!("resultados" in r)) throw new Error("respuesta inesperada");
    expect(r.resultados[0].fragmento.length).toBe(800);
    expect(r.resultados[0].notas?.length).toBe(1200);
    expect(r.resultados[1]).toMatchObject({ fragmento: "corto", notas: null });
  });

  describe("con interruptores de caos", () => {
    let db: Db;
    let interruptores: ReturnType<typeof crearInterruptores>;
    const buscar = vi.fn(async () => []);

    beforeEach(async () => {
      db = await crearDbTemporal();
      interruptores = crearInterruptores(db.fuente);
      buscar.mockClear();
    });
    afterEach(() => {
      vi.useRealTimers();
      db.cerrar();
    });

    // Lee los interruptores antes de simular el tiempo: la caché deja la lectura sin E/S.
    async function preparar(clave: "herramienta_caida" | "latencia_alta") {
      await interruptores.actualizar(clave, "on");
      await interruptores.obtenerTodos();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      return crearBuscarLaminas({ laminas: { buscar }, interruptores });
    }

    it("con herramienta_caida hace 3 intentos y devuelve no_disponible", async () => {
      const herramienta = await preparar("herramienta_caida");
      const span = spanFalso();
      const promesa = ejecutar(herramienta, { consulta: "resiliencia" }, contexto(span));
      await vi.advanceTimersByTimeAsync(300 + 900);
      await expect(promesa).resolves.toEqual({ error: "no_disponible" });
      expect(buscar).not.toHaveBeenCalled();
      expect(span.update).toHaveBeenCalledWith({
        metadata: { intentos: 3, interruptores_activos: ["herramienta_caida"], cantidad_resultados: 0, falla_herramienta: true },
      });
      // La falla queda también en la raíz del turno: el panel la cuenta aunque el agente responda.
      expect(span.agentRun.update).toHaveBeenCalledWith({ metadata: { falla_herramienta: true } });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("con latencia_alta cada intento se corta a los 5 s", async () => {
      const herramienta = await preparar("latencia_alta");
      const span = spanFalso();
      let resuelta = false;
      const promesa = ejecutar(herramienta, { consulta: "resiliencia" }, contexto(span)).then((r) => {
        resuelta = true;
        return r;
      });
      // 3 intentos de 5 s más esperas de 300 y 900 ms.
      await vi.advanceTimersByTimeAsync(16199);
      expect(resuelta).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(promesa).resolves.toEqual({ error: "no_disponible" });
      expect(buscar).not.toHaveBeenCalled();
      expect(span.update).toHaveBeenCalledWith({
        metadata: { intentos: 3, interruptores_activos: ["latencia_alta"], cantidad_resultados: 0, falla_herramienta: true },
      });
      expect(span.agentRun.update).toHaveBeenCalledWith({ metadata: { falla_herramienta: true } });
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
