import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it } from "vitest";
import type { Interruptores } from "@/lib/db/interruptores";
import { MENSAJES_BLOQUEO } from "@/src/mastra/processors/mensajes";
import { cargarDataset } from "./dataset";
import { crearObjetivo, type DependenciasObjetivo } from "./objetivo";
import type { Observacion } from "./observacion";

const datos = cargarDataset();
const casos = new Map(datos.casos.map((c) => [c.id, c]));

function interruptoresFalsos() {
  const valores: Interruptores = { herramienta_caida: "off", latencia_alta: "off", modelo_caido: "off", modelos_caidos: "off", kill_switch: "off", lamina_actual: "40" };
  const cambios: string[] = [];
  return {
    valores,
    cambios,
    repo: {
      obtenerTodos: async () => ({ ...valores }),
      actualizar: async (clave: keyof Interruptores, valor: string) => {
        cambios.push(`${clave}=${valor}`);
        valores[clave] = valor;
      },
    },
  };
}

function rc(casoId: string) {
  const r = new RequestContext();
  r.set("caso_id", casoId);
  r.set("interruptores_activos", []);
  return r;
}

function agenteFalso(responder: (input: unknown, opciones: Record<string, unknown>) => Promise<unknown>) {
  const llamadas: Record<string, unknown>[] = [];
  const agente = {
    id: "charla",
    name: "Asistente de la charla",
    secreto: 42,
    getMastraInstance() {
      return { soy: "mastra" };
    },
    leerSecreto() {
      return this.secreto;
    },
    async generate(input: unknown, opciones: Record<string, unknown>) {
      llamadas.push(opciones);
      return responder(input, opciones);
    },
  };
  return { agente, llamadas };
}

function deps(i: ReturnType<typeof interruptoresFalsos>, extra: Partial<DependenciasObjetivo> = {}): DependenciasObjetivo {
  return {
    casos,
    observaciones: new Map<string, Observacion>(),
    interruptores: i.repo,
    memoria: (id) => ({ thread: `eval-prueba-${id}`, resource: `eval-prueba-${id}` }),
    trazado: (caso) => ({ metadata: { origen: "eval", caso_id: caso.id }, tags: ["eval"] }),
    ...extra,
  };
}

describe("crearObjetivo (envoltorio del agente para runEvals)", () => {
  it("pasa memoria y trazado propios, registra la observación y devuelve el resultado real", async () => {
    const i = interruptoresFalsos();
    const { agente, llamadas } = agenteFalso(async () => ({
      text: "Hola Andrea (lámina 8).",
      traceId: "t-1",
      response: { modelId: "gpt-6-luna" },
      usage: { inputTokens: 10, outputTokens: 5 },
      scoringData: { output: [] },
    }));
    const d = deps(i);
    const objetivo = crearObjetivo(agente, d);
    const r = (await objetivo.generate("¿Qué es un agente?", { requestContext: rc("L01"), tracingOptions: { metadata: { otra: 1 } } })) as { text: string };
    expect(r.text).toBe("Hola Andrea (lámina 8).");
    expect(llamadas[0].memory).toEqual({ thread: "eval-prueba-L01", resource: "eval-prueba-L01" });
    expect(llamadas[0].tracingOptions).toEqual({ metadata: { otra: 1, origen: "eval", caso_id: "L01" }, tags: ["eval"] });
    const o = d.observaciones.get("L01")!;
    expect(o).toMatchObject({ casoId: "L01", texto: "Hola Andrea (lámina 8).", bloqueado: false, modelo: "gpt-6-luna", traceId: "t-1" });
    expect(o.duracionMs).toBeGreaterThanOrEqual(0);
    expect(i.cambios).toEqual([]);
  });

  it("un tripwire queda como bloqueo con el mensaje fijo", async () => {
    const i = interruptoresFalsos();
    const { agente } = agenteFalso(async () => ({ text: "", tripwire: { reason: "x", metadata: { motivo: "fuera_de_alcance" } }, scoringData: { output: [] } }));
    const d = deps(i);
    await crearObjetivo(agente, d).generate("receta", { requestContext: rc("F02") });
    expect(d.observaciones.get("F02")).toMatchObject({ bloqueado: true, motivo: "fuera_de_alcance", texto: MENSAJES_BLOQUEO.fuera_de_alcance });
  });

  it("aplica los interruptores del caso solo durante su turno y actualiza interruptores_activos", async () => {
    const i = interruptoresFalsos();
    let durante: unknown;
    let activosEnContexto: unknown;
    const { agente } = agenteFalso(async (_input, opciones) => {
      durante = { ...i.valores };
      activosEnContexto = (opciones.requestContext as RequestContext).get("interruptores_activos");
      return { text: "ok", scoringData: { output: [] } };
    });
    await crearObjetivo(agente, deps(i)).generate("¿Qué son los límites?", { requestContext: rc("R02") });
    expect(durante).toMatchObject({ latencia_alta: "on" });
    expect(activosEnContexto).toEqual(["latencia_alta"]);
    expect(i.valores.latencia_alta).toBe("off");
    expect(i.cambios).toEqual(["latencia_alta=on", "latencia_alta=off"]);
  });

  it("un caso con interruptores no corre a la vez que otros casos", async () => {
    const i = interruptoresFalsos();
    const eventos: string[] = [];
    const { agente } = agenteFalso(async (_input, opciones) => {
      const id = (opciones.requestContext as RequestContext).get("caso_id");
      eventos.push(`${id}+`);
      await new Promise((r) => setTimeout(r, 15));
      eventos.push(`${id}-`);
      return { text: "ok", scoringData: { output: [] } };
    });
    const objetivo = crearObjetivo(agente, deps(i));
    await Promise.all([
      objetivo.generate("a", { requestContext: rc("L01") }),
      objetivo.generate("b", { requestContext: rc("R01") }),
      objetivo.generate("c", { requestContext: rc("L02") }),
    ]);
    const r = eventos.indexOf("R01+");
    expect(eventos[r + 1]).toBe("R01-");
    expect(eventos.indexOf("L01-")).toBeLessThan(r);
    expect(eventos.indexOf("L02+")).toBeGreaterThan(eventos.indexOf("R01-"));
  });

  it("si el agente lanza, registra el error (sin el mensaje), restaura interruptores y devuelve un resultado vacío", async () => {
    const i = interruptoresFalsos();
    const { agente } = agenteFalso(async () => {
      throw new TypeError("clave inválida sk-123");
    });
    const d = deps(i);
    const r = (await crearObjetivo(agente, d).generate("¿Qué es MCP?", { requestContext: rc("R03") })) as { text: string; scoringData: { output: unknown[] } };
    expect(r.text).toBe("");
    expect(r.scoringData.output).toEqual([]);
    expect(d.observaciones.get("R03")).toMatchObject({ error: "TypeError", texto: "" });
    expect(JSON.stringify(d.observaciones.get("R03"))).not.toContain("sk-123");
    expect(i.valores.modelo_caido).toBe("off");
  });

  it("agrega opciones extra (p. ej. procesadores de salida de una prueba de fallo)", async () => {
    const i = interruptoresFalsos();
    const { agente, llamadas } = agenteFalso(async () => ({ text: "ok", scoringData: { output: [] } }));
    const procesadores = [{ id: "p" }];
    await crearObjetivo(agente, deps(i, { opcionesExtra: { outputProcessors: procesadores } })).generate("x", { requestContext: rc("L03") });
    expect(llamadas[0].outputProcessors).toBe(procesadores);
  });

  it("lee la evidencia de la traza cuando se pide para el caso", async () => {
    const i = interruptoresFalsos();
    const { agente } = agenteFalso(async () => ({ text: "ok", traceId: "t-9", scoringData: { output: [] } }));
    const d = deps(i, {
      leerEvidencia: async (traceId, caso) => ({ herramientas: [{ nombre: `buscar_laminas:${traceId}:${caso.id}`, intentos: 3 }], modelos: [] }),
    });
    await crearObjetivo(agente, d).generate("hook", { requestContext: rc("R01") });
    expect(d.observaciones.get("R01")?.evidenciaTraza?.herramientas[0]).toEqual({ nombre: "buscar_laminas:t-9:R01", intentos: 3 });
  });

  it("oculta la instancia de Mastra a runEvals y deja el resto del agente intacto", () => {
    const i = interruptoresFalsos();
    const { agente } = agenteFalso(async () => ({}));
    const objetivo = crearObjetivo(agente, deps(i));
    expect(objetivo.getMastraInstance()).toBeUndefined();
    expect(objetivo.id).toBe("charla");
    expect(objetivo.leerSecreto()).toBe(42);
  });

  it("un caso de ruta (R04) llama a la ruta con el kill switch puesto, no al agente", async () => {
    const i = interruptoresFalsos();
    const { agente, llamadas } = agenteFalso(async () => ({ text: "no debería" }));
    const rutas = new Map();
    let killDurante = "";
    const d = deps(i, {
      rutas,
      probarRuta: async () => {
        killDurante = i.valores.kill_switch;
        return { status: 423, mensaje: "En pausa", trazasAgente: 0 };
      },
    });
    const r = (await crearObjetivo(agente, d).generate("Hola", { requestContext: rc("R04") })) as { text: string };
    expect(llamadas).toHaveLength(0);
    expect(killDurante).toBe("on");
    expect(i.valores.kill_switch).toBe("off");
    expect(r.text).toBe("En pausa");
    expect(rutas.get("R04")).toEqual({ status: 423, mensaje: "En pausa", trazasAgente: 0 });
  });

  it("sin prueba de ruta configurada, R04 queda omitido (no falla)", async () => {
    const i = interruptoresFalsos();
    const { agente } = agenteFalso(async () => ({}));
    const rutas = new Map();
    await crearObjetivo(agente, deps(i, { rutas })).generate("Hola", { requestContext: rc("R04") });
    expect(rutas.get("R04")).toMatchObject({ omitida: expect.any(String) });
  });

  it("la duración del turno no incluye la espera por el cerrojo", async () => {
    const i = interruptoresFalsos();
    const { agente } = agenteFalso(async (_input, opciones) => {
      const id = (opciones.requestContext as RequestContext).get("caso_id");
      await new Promise((r) => setTimeout(r, id === "L01" ? 120 : 10));
      return { text: "ok", scoringData: { output: [] } };
    });
    const d = deps(i);
    const objetivo = crearObjetivo(agente, d);
    await Promise.all([objetivo.generate("a", { requestContext: rc("L01") }), objetivo.generate("b", { requestContext: rc("R01") })]);
    // R01 esperó ~120 ms a que terminara L01, pero su turno duró ~10 ms.
    expect(d.observaciones.get("R01")!.duracionMs).toBeLessThan(80);
  });
});

