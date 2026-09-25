import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearDbTemporal } from "../lib/db/prueba";
import {
  limpiarMemoria,
  limpiarTrazas,
  reiniciarCharlaDb,
  respaldar,
  trazasABorrar,
  VALORES_INICIALES,
  type RaizLigera,
  type StoreObservabilidad,
} from "./reiniciar-charla";

describe("reiniciarCharlaDb", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  beforeEach(async () => {
    db = await crearDbTemporal();
    await db.cliente.batch(
      [
        "INSERT INTO asistentes (id, email, nombre, rol, descripcion, origen) VALUES ('a1', 'x@ejemplo.test', 'X', 'Contadora', 'Un bot', 'inscrito')",
        "INSERT INTO asistentes (id, email, nombre, origen) VALUES ('a2', 'y@ejemplo.test', '', 'invitado')",
        "INSERT INTO sesiones (token, asistente_id, thread_id, mensajes) VALUES ('t1', 'a1', 'charla-a1', 4)",
        "INSERT INTO sesiones (token, asistente_id, thread_id, mensajes) VALUES ('t2', 'a2', 'charla-a2', 2)",
        "INSERT INTO escalamientos (asistente_id, pregunta, motivo) VALUES ('a1', '¿?', 'comercial')",
        "INSERT INTO feedback (asistente_id, trace_id, valor) VALUES ('a1', 'tr1', 1)",
        "INSERT INTO laminas (numero, titulo, contenido) VALUES (1, 'T', 'C')",
        "INSERT INTO eventos_interruptor (clave, valor) VALUES ('kill_switch', 'on')",
        "UPDATE interruptores SET valor = 'on' WHERE clave IN ('kill_switch', 'modelo_caido')",
        "UPDATE interruptores SET valor = '33' WHERE clave = 'lamina_actual'",
        "UPDATE presupuesto SET coste_usd = 1.25 WHERE id = 1",
        `INSERT INTO jev_analisis (trace_id, turno_en, pregunta, tema, tema_confianza, intencion, intencion_confianza, confusion, confusion_confianza, valor, valor_confianza, latencia_ms, modelo)
         VALUES ('tr1', datetime('now'), '¿?', 'evals', 1, 'understand_concept', 1, 0, 1, 0, 1, 250, 'jev')`,
      ],
      "write",
    );
  });
  afterEach(() => db.cerrar());

  const estado = async () =>
    (
      await db.cliente.execute(`SELECT
        (SELECT count(*) FROM sesiones) AS sesiones, (SELECT count(*) FROM feedback) AS votos,
        (SELECT count(*) FROM escalamientos) AS escalamientos, (SELECT count(*) FROM jev_analisis) AS jev,
        (SELECT count(*) FROM eventos_interruptor) AS eventos, (SELECT count(*) FROM asistentes) AS asistentes,
        (SELECT rol FROM asistentes WHERE id = 'a1') AS rol, (SELECT count(*) FROM laminas) AS laminas,
        (SELECT coste_usd FROM presupuesto WHERE id = 1) AS coste`)
    ).rows[0];

  it("sin aplicar solo cuenta y no cambia nada", async () => {
    const r = await reiniciarCharlaDb(db.fuente, { aplicar: false });
    expect(r).toEqual({
      sesiones: 2,
      votos: 1,
      escalamientos: 1,
      analisisJev: 1,
      eventosInterruptor: 1,
      invitados: 1,
      costeUsd: 1.25,
      interruptoresCambiados: 3,
    });
    expect(Number((await estado()).sesiones)).toBe(2);
  });

  it("deja la actividad en cero y conserva inscritos con su perfil y láminas", async () => {
    await reiniciarCharlaDb(db.fuente, { aplicar: true });
    const e = await estado();
    expect([e.sesiones, e.votos, e.escalamientos, e.jev, e.eventos].map(Number)).toEqual([0, 0, 0, 0, 0]);
    expect(Number(e.asistentes)).toBe(1);
    expect(e.rol).toBe("Contadora");
    expect(Number(e.laminas)).toBe(1);
    expect(Number(e.coste)).toBe(0);
    const inter = await db.cliente.execute("SELECT clave, valor FROM interruptores");
    for (const f of inter.rows) expect(f.valor).toBe(VALORES_INICIALES[String(f.clave)]);
  });

  it("después del reinicio la app puede crear sesiones y votos nuevos", async () => {
    await reiniciarCharlaDb(db.fuente, { aplicar: true });
    await db.cliente.batch(
      [
        "INSERT INTO sesiones (token, asistente_id, thread_id) VALUES ('t3', 'a1', 'charla-a1')",
        "INSERT INTO feedback (asistente_id, trace_id, valor) VALUES ('a1', 'tr9', 1)",
        "UPDATE presupuesto SET coste_usd = coste_usd + 0.01 WHERE id = 1",
      ],
      "write",
    );
    expect(Number((await estado()).coste)).toBeCloseTo(0.01);
  });
});

describe("limpiarMemoria", () => {
  let c: Client;
  beforeEach(async () => {
    c = createClient({ url: ":memory:" });
    await c.batch(
      [
        "CREATE TABLE mastra_threads (id TEXT, resourceId TEXT)",
        "CREATE TABLE mastra_messages (id TEXT, thread_id TEXT)",
        "CREATE TABLE mastra_resources (id TEXT)",
        "CREATE TABLE mastra_scorers (id TEXT, threadId TEXT)",
        "INSERT INTO mastra_threads VALUES ('charla-a1', 'a1'), ('charla-a1-xyz', 'a1'), ('eval-v1-c1', 'eval-v1-c1')",
        "INSERT INTO mastra_messages VALUES ('m1', 'charla-a1'), ('m2', 'charla-a1-xyz'), ('m3', 'eval-v1-c1')",
        "INSERT INTO mastra_resources VALUES ('a1'), ('eval-v1-c1')",
        "INSERT INTO mastra_scorers VALUES ('s1', 'charla-a1'), ('s2', 'eval-v1-c1'), ('s3', NULL)",
      ],
      "write",
    );
  });
  afterEach(() => c.close());

  const cuenta = async (sql: string) => Number((await c.execute(sql)).rows[0].n);

  it("borra conversaciones de asistentes y conserva las de evals (tablas opcionales ausentes)", async () => {
    expect(await limpiarMemoria(c, { aplicar: false })).toEqual({ hilos: 2, mensajes: 2, recursos: 1, puntajes: 1 });
    expect(await cuenta("SELECT count(*) AS n FROM mastra_messages")).toBe(3);

    await limpiarMemoria(c, { aplicar: true });
    expect((await c.execute("SELECT id FROM mastra_threads")).rows.map((r) => r.id)).toEqual(["eval-v1-c1"]);
    expect((await c.execute("SELECT id FROM mastra_messages")).rows.map((r) => r.id)).toEqual(["m3"]);
    expect((await c.execute("SELECT id FROM mastra_resources")).rows.map((r) => r.id)).toEqual(["eval-v1-c1"]);
    expect(await cuenta("SELECT count(*) AS n FROM mastra_scorers")).toBe(2);
  });
});

describe("trazasABorrar", () => {
  it("borra turnos de asistentes y sus jueces; conserva evals y otras entidades", () => {
    const raices: RaizLigera[] = [
      { traceId: "t1", entityId: "charla", metadata: {} },
      { traceId: "t2", entityId: "charla", metadata: null },
      { traceId: "e1", entityId: "charla", metadata: { origen: "eval" } },
      { traceId: "j1", entityId: "juez", metadata: { targetTraceId: "t1" } },
      { traceId: "j2", entityId: "juez", metadata: { targetTraceId: "e1" } },
      { traceId: "x1", entityId: "otra", metadata: {} },
    ];
    expect(trazasABorrar(raices).sort()).toEqual(["j1", "t1", "t2"]);
  });
});

describe("limpiarTrazas", () => {
  function storeFalso(total: number) {
    const raices: RaizLigera[] = Array.from({ length: total }, (_, i) => ({
      traceId: `t${i}`,
      entityId: "charla",
      metadata: i % 10 === 0 ? { origen: "eval" } : {},
    }));
    const borradas: string[][] = [];
    const store: StoreObservabilidad = {
      async listTracesLight({ pagination: { page, perPage } }) {
        const spans = raices.slice(page * perPage, (page + 1) * perPage);
        return { spans, pagination: { hasMore: (page + 1) * perPage < raices.length } };
      },
      async batchDeleteTraces({ traceIds }) {
        borradas.push(traceIds);
      },
    };
    return { store, borradas };
  }

  it("recorre todas las páginas y borra en lotes solo al aplicar", async () => {
    const { store, borradas } = storeFalso(450);
    expect(await limpiarTrazas(store, { aplicar: false })).toEqual({ total: 450, aBorrar: 405, evals: 45 });
    expect(borradas).toHaveLength(0);

    await limpiarTrazas(store, { aplicar: true });
    expect(borradas.map((l) => l.length)).toEqual([200, 200, 5]);
    expect(borradas.flat().some((id) => Number(id.slice(1)) % 10 === 0)).toBe(false);
  });
});

describe("respaldar", () => {
  it("copia la base completa junto al original", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "respaldo-"));
    const url = `file:${path.join(dir, "charla.db")}`;
    const c = createClient({ url });
    await c.execute("CREATE TABLE t (x)");
    await c.execute("INSERT INTO t VALUES (1), (2)");
    const destino = await respaldar(c, url, "prueba");
    c.close();
    expect(destino).toBe(path.join(dir, "charla.respaldo-prueba.db"));
    const copia = createClient({ url: `file:${destino}` });
    expect(Number((await copia.execute("SELECT count(*) AS n FROM t")).rows[0].n)).toBe(2);
    copia.close();
    expect(await respaldar(c, ":memory:", "x")).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
