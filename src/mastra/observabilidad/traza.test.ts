import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rolAnonimo } from "@/lib/rol-anonimo";
import { VERSION_INSTRUCCIONES, construirInstrucciones } from "../agents/instructions";
import { modeloFalso } from "../processors/pruebas-modelo";
import { crearAlmacenamientoDePrueba } from "../pruebas/almacenamiento";
import { crearCitaLamina, crearFidelidad, crearPersonalizacion, crearSinErroresHerramienta } from "../scorers";
import { crearBuscarLaminas } from "../tools/buscar-laminas";
import { crearObservabilidad } from "./config";
import { terminosDeNombres } from "./redaccion";

// Prueba de punta a punta sin proveedor: un agente con modelo falso, la
// observabilidad real del proyecto y el almacenamiento Postgres de producción
// (sobre PGlite, en un esquema propio). Se buscan los
// datos personales en TODAS las filas guardadas (trazas y puntajes).
const PERSONALES = [/zoraida/i, /paredes/i, /correo\.ec/i, /@/, /contadora/i, /facturas/i, /asistente-secreto/];

const prueba = crearAlmacenamientoDePrueba("obs");
let mastra: Mastra;
let traceId: string;
let respuesta: string;

async function esperar<T>(fn: () => Promise<T | null>, ms = 8000): Promise<T> {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > fin) throw new Error("tiempo agotado");
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  const store = prueba.almacenamiento;
  const modelo = modeloFalso("openai/gpt-6-luna", (_l, n) =>
    n === 1
      ? { herramienta: "buscar_laminas", entrada: { consulta: "harness" } }
      : { texto: "Zoraida, el harness es todo lo que rodea al modelo, y el 87 % falla (lámina 11)." },
  );
  // Juez falso que responde según el scorer que lo llama.
  const juez = modeloFalso("openai/gpt-6-luna", (llamada) =>
    JSON.stringify(llamada.prompt).includes("Occupation")
      ? { texto: JSON.stringify({ explica_concepto: true, ejemplo_aplicado: true, menciona_rol: false, recita_datos: false, razon: "Encaja con el perfil." }) }
      : {
          texto: JSON.stringify({
            afirmaciones: [
              { afirmacion: "El harness rodea al modelo", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: true },
              { afirmacion: "El 87 % falla", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: false },
              { afirmacion: "Hay 5 capas", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: false },
            ],
            razon: "La cifra del 87 % no está en las láminas.",
          }),
        },
  );
  const nombresConocidos = () => terminosDeNombres(["Zoraida Paredes"]);
  const buscar = crearBuscarLaminas({
    laminas: { buscar: async () => [{ lamina: 11, titulo: "Harness", fragmento: "El harness es todo lo que rodea al modelo.", notas: null, puntaje: 1 }] },
    interruptores: { obtenerTodos: async () => ({ herramienta_caida: "off", latencia_alta: "off" }) },
  });
  const siempre = { type: "ratio", rate: 1 } as const;
  const opciones = { modelo: juez.modelo as never, nombresConocidos };
  const agente = new Agent({
    id: "charla",
    name: "Asistente de la charla",
    instructions: ({ requestContext }) => construirInstrucciones(requestContext),
    model: modelo.modelo as never,
    tools: { buscar_laminas: buscar },
    scorers: {
      fidelidad: { scorer: crearFidelidad(opciones), sampling: siempre },
      personalizacion: { scorer: crearPersonalizacion(opciones), sampling: siempre },
      cita_lamina: { scorer: crearCitaLamina({ nombresConocidos }), sampling: siempre },
      sin_errores_herramienta: { scorer: crearSinErroresHerramienta({ nombresConocidos }), sampling: siempre },
    },
    defaultOptions: { tracingOptions: { metadata: { version_instrucciones: VERSION_INSTRUCCIONES } } },
  });
  mastra = new Mastra({ storage: store, agents: { charla: agente }, observability: crearObservabilidad({ nombresConocidos }) });

  const rc = new RequestContext();
  const rol = "Contadora pública";
  for (const [k, v] of Object.entries({
    asistente_id: "asistente-secreto",
    nombre_pila: "Zoraida",
    rol,
    descripcion: "un bot de facturas",
    email: "zoraida.p@correo.ec",
    rol_anonimo: rolAnonimo(rol),
    lamina_actual: "11",
    interruptores_activos: [],
    version_instrucciones: VERSION_INSTRUCCIONES,
  })) rc.set(k, v);

  const r = await mastra.getAgent("charla").generate("Soy Zoraida Paredes, mi correo es zoraida.p@correo.ec. ¿Qué es el harness?", {
    requestContext: rc,
  });
  traceId = r.traceId!;
  respuesta = r.text;
  // Los scorers corren en segundo plano después de responder.
  const scores = await store.getStore("scores");
  await esperar(async () => {
    const ids = ["fidelidad", "personalizacion", "cita_lamina", "sin_errores_herramienta"];
    const listas = await Promise.all(
      ids.map((scorerId) => scores!.listScoresByScorerId({ scorerId, pagination: { page: 0, perPage: 5 } })),
    );
    return listas.every((l) => l.scores.length > 0) ? true : null;
  });
  await mastra.observability.getDefaultInstance()?.flush();
}, 30_000);

afterAll(async () => {
  await mastra?.observability.shutdown?.();
});

describe("traza real en storage (modelo falso)", () => {
  it("el agente respondió y la traza tiene modelo, herramienta, latencia, tokens y rol_anonimo", async () => {
    expect(respuesta).toContain("lámina 11");
    const obs = await mastra.getStorage()!.getStore("observability");
    const traza = await esperar(async () => {
      const t = await obs!.getTrace({ traceId });
      return t && t.spans.some((s) => s.spanType === "agent_run" && s.endedAt) ? t : null;
    });
    const raiz = traza.spans.find((s) => s.spanType === "agent_run")!;
    expect(raiz.metadata).toMatchObject({ rol_anonimo: "negocio", version_instrucciones: VERSION_INSTRUCCIONES, lamina_actual: "11" });
    expect(raiz.requestContext).toEqual({
      rol_anonimo: "negocio",
      lamina_actual: "11",
      interruptores_activos: [],
      version_instrucciones: VERSION_INSTRUCCIONES,
    });
    expect(new Date(raiz.endedAt!).getTime()).toBeGreaterThanOrEqual(new Date(raiz.startedAt).getTime());
    const llm = traza.spans.find((s) => s.spanType === "model_generation")!;
    expect(llm.attributes).toMatchObject({ model: "gpt-6-luna", provider: "openai" });
    expect((llm.attributes as { usage?: { inputTokens?: number } }).usage?.inputTokens).toBeGreaterThan(0);
    expect(traza.spans.some((s) => s.spanType === "tool_call" && s.name.includes("buscar_laminas"))).toBe(true);
  });

  it("no guarda un span por cada trozo del stream (model_chunk), pero sí la generación completa", async () => {
    const obs = await mastra.getStorage()!.getStore("observability");
    const traza = await obs!.getTrace({ traceId });
    expect(traza!.spans.some((s) => s.spanType === "model_generation")).toBe(true);
    expect(traza!.spans.filter((s) => s.spanType === "model_chunk")).toEqual([]);
  });

  it("los puntajes quedan guardados: fidelidad < 0,5 por la cifra inventada", async () => {
    const scores = await mastra.getStorage()!.getStore("scores");
    const leer = async (scorerId: string) =>
      (await scores!.listScoresByScorerId({ scorerId, pagination: { page: 0, perPage: 5 } })).scores[0];
    const fidelidad = await leer("fidelidad");
    expect(fidelidad.score).toBeLessThan(0.5);
    expect(fidelidad.traceId).toBe(traceId);
    expect((await leer("cita_lamina")).score).toBe(1);
    expect((await leer("sin_errores_herramienta")).score).toBe(1);
    expect((await leer("personalizacion")).score).toBe(1);
  });

  it("ninguna fila guardada contiene email, nombre, rol, descripción ni asistente_id", async () => {
    const { pool, esquema } = prueba;
    // Tablas del esquema (sin las particiones diarias: sus filas ya salen al leer la tabla madre).
    const tablas = await pool.query(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND NOT c.relispartition`,
      [esquema],
    );
    let filas = 0;
    for (const t of tablas.rows.map((r) => String(r.name))) {
      const r = await pool.query(`SELECT to_jsonb(t) AS fila FROM "${esquema}"."${t}" t`);
      for (const { fila } of r.rows as { fila: Record<string, unknown> }[]) {
        filas++;
        const texto = JSON.stringify(fila);
        // Única excepción aceptada: el puntaje de personalización guarda el rol
        // y la descripción (redactada; su juez los necesita) en el prompt y el
        // contexto; nunca nombre ni email.
        const esPersonalizacion =
          (t === "mastra_scorers" && fila.scorerId === "personalizacion") ||
          (t === "mastra_score_events" && texto.includes('"personalizacion"'));
        const excepcion = ["contadora", "facturas"];
        for (const patron of PERSONALES.filter((p) => !(esPersonalizacion && excepcion.includes(p.source)))) {
          expect(texto, `tabla ${t}`).not.toMatch(patron);
        }
      }
    }
    expect(filas).toBeGreaterThan(10);
  });
});
