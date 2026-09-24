import { Agent } from "@mastra/core/agent";
import { runEvals } from "@mastra/core/evals";
import type { Processor } from "@mastra/core/processors";
import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it } from "vitest";
import type { Interruptores } from "@/lib/db/interruptores";
import { MENSAJES_BLOQUEO } from "@/src/mastra/processors/mensajes";
import { modeloFalso } from "@/src/mastra/processors/pruebas-modelo";
import { construirTerminos } from "@/src/mastra/processors/sin-datos-personales";
import { crearCitaLamina, crearFidelidad, crearPersonalizacion } from "@/src/mastra/scorers";
import { Bitacora, type ContextoEvals, type ObservacionRuta } from "./checks";
import { cargarDataset, GATES } from "./dataset";
import { crearObjetivo } from "./objetivo";
import type { Observacion } from "./observacion";
import { crearScorersEvals } from "./scorers";

// runEvals de punta a punta con modelos falsos (sin red): gates con
// notScorable, umbrales solo donde aplican, veredicto y bitácora con razones.

const datos = cargarDataset();
const casos = new Map(datos.casos.map((c) => [c.id, c]));

// Un juez falso que sirve para todos los scorers: devuelve un JSON con las
// claves de cada esquema (fidelidad, relevancia, personalización, criterios).
function juezFalso(criteriosCumplidos: boolean) {
  return modeloFalso("openai/gpt-6-luna", (llamada) => {
    const prompt = JSON.stringify(llamada.prompt);
    const criterios = [...prompt.matchAll(/\\n(\d+)\. ([^\\]+)/g)].map((m) => ({ criterio: m[2], cumplido: criteriosCumplidos, razon: "Revisado." }));
    return {
      texto: JSON.stringify({
        statements: ["Un agente decide y actúa"],
        results: [{ result: "yes", reason: "Responde la pregunta." }],
        afirmaciones: [{ afirmacion: "Un agente decide y actúa", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: true }],
        razon: "Todo respaldado.",
        explica_concepto: true,
        ejemplo_aplicado: true,
        menciona_rol: false,
        recita_datos: false,
        criterios,
        resumen: "Listo.",
      }),
    };
  });
}

// Bloquea como el guardrail de alcance (tripwire con motivo) si la pregunta
// habla de acciones de bolsa.
const alcanceFalso: Processor<"alcance-falso"> = {
  id: "alcance-falso",
  async processInput({ messages, abort }) {
    if (JSON.stringify(messages).includes("acciones")) abort(MENSAJES_BLOQUEO.fuera_de_alcance, { metadata: { guardrail: "alcance_charla", motivo: "fuera_de_alcance" } });
    return messages;
  },
};

function montar({ criteriosCumplidos = true, responder = "Andrea, un agente decide y actúa con herramientas (lámina 8)." } = {}) {
  const modeloAgente = modeloFalso("openai/gpt-6-luna", () => ({ texto: responder }));
  const agente = new Agent({ id: "charla", name: "Asistente de la charla", instructions: "x", model: modeloAgente.modelo as never, inputProcessors: [alcanceFalso as never] });
  const juez = juezFalso(criteriosCumplidos);
  const observaciones = new Map<string, Observacion>();
  const rutas = new Map<string, ObservacionRuta>();
  const bitacora = new Bitacora();
  const perfiles = [
    { id: "yo", nombre: "Andrea Salvatierra", rol: "Gerente de operaciones", descripcion: null },
    { id: "s1", nombre: "Leonor Villamar", rol: "Directora de riesgos", descripcion: null },
  ];
  const ctx: ContextoEvals = { casos, observaciones, rutas, bitacora, terminosPrivacidad: () => construirTerminos(perfiles, { asistenteId: "yo" }) };
  const registrados = new Map<string, unknown>([
    ["fidelidad", crearFidelidad({ modelo: juez.modelo as never, nombresConocidos: () => [] })],
    ["personalizacion", crearPersonalizacion({ modelo: juez.modelo as never, nombresConocidos: () => [] })],
    ["cita_lamina", crearCitaLamina({ nombresConocidos: () => [] })],
  ]);
  const { gates, scorers } = crearScorersEvals(datos, ctx, {
    registrados: (id) => registrados.get(id) as never,
    modelo: juez.modelo as never,
    modeloRespaldo: juez.modelo as never,
    mensajeMantenimiento: "pausa",
  });
  const valores: Interruptores = { herramienta_caida: "off", latencia_alta: "off", modelo_caido: "off", kill_switch: "off", lamina_actual: "39" };
  const objetivo = crearObjetivo(agente, {
    casos,
    observaciones,
    rutas,
    interruptores: { obtenerTodos: async () => ({ ...valores }), actualizar: async (k, v) => void (valores[k] = v) },
    memoria: (id) => ({ thread: `eval-${id}`, resource: `eval-${id}` }),
    trazado: (caso) => ({ metadata: { origen: "eval", caso_id: caso.id }, tags: ["eval"] }),
    probarRuta: async () => ({ status: 423, mensaje: "pausa", trazasAgente: 0 }),
  });
  const item = (id: string) => {
    const rc = new RequestContext();
    const c = casos.get(id)!;
    rc.set("caso_id", id);
    rc.set("asistente_id", "yo");
    rc.set("rol", c.perfil.rol);
    rc.set("descripcion", c.perfil.descripcion);
    return { input: c.input, groundTruth: { criterios: c.esperado.criterios, respuesta_referencia: c.groundTruth }, requestContext: rc };
  };
  return { objetivo, gates, scorers, bitacora, observaciones, item, valores };
}

describe("runEvals con el objetivo y los scorers del runner", () => {
  it("casos que cumplen: veredicto passed; gates y umbrales solo donde aplican; razones en la bitácora", async () => {
    const m = montar();
    const r = await runEvals({ target: m.objetivo, data: [m.item("L01"), m.item("F01"), m.item("R04")], gates: m.gates, scorers: m.scorers, concurrency: 2 });
    expect(r.verdict).toBe("passed");
    expect(r.gateResults?.map((g) => g.id).sort()).toEqual([GATES.bloqueo, GATES.noDebeLlamar, GATES.privacidad, GATES.ruta].sort());
    expect(r.thresholdResults?.find((t) => t.id === "fidelidad")).toMatchObject({ passed: true, averageScore: 1 });
    // personalización no aplica a estos casos: no hay promedio ni cuenta en el veredicto.
    expect(r.thresholdResults?.find((t) => t.id === "personalizacion")).toBeUndefined();
    expect(m.observaciones.get("F01")).toMatchObject({ bloqueado: true, motivo: "fuera_de_alcance" });
    const f01 = m.bitacora.de("F01");
    expect(f01.find((x) => x.id === GATES.bloqueo)).toMatchObject({ estado: "puntuado", score: 1, razon: expect.stringMatching(/fuera de alcance/) });
    expect(f01.find((x) => x.id === GATES.escalamiento)).toMatchObject({ estado: "no_aplica" });
    expect(f01.find((x) => x.id === "fidelidad")).toMatchObject({ estado: "no_aplica" });
    const l01 = m.bitacora.de("L01");
    expect(l01.find((x) => x.id === "criterios")).toMatchObject({ estado: "puntuado", score: 1, razon: expect.stringContaining("[cumple]") });
    expect(l01.find((x) => x.id === "herramientas_esperadas")).toMatchObject({ score: 0 });
    expect(m.bitacora.de("R04").find((x) => x.id === GATES.ruta)).toMatchObject({ score: 1 });
    // El kill switch solo estuvo encendido durante R04.
    expect(m.valores.kill_switch).toBe("off");
  }, 30_000);

  it("un gate que falla da veredicto failed", async () => {
    const m = montar({ criteriosCumplidos: false });
    const r = await runEvals({ target: m.objetivo, data: [m.item("S04")], gates: m.gates, scorers: m.scorers });
    expect(r.verdict).toBe("failed");
    expect(r.gateResults?.find((g) => g.id === GATES.criterios)).toMatchObject({ passed: false, score: 0 });
    expect(m.bitacora.de("S04").find((x) => x.id === GATES.criterios)?.razon).toContain("[no cumple]");
  }, 30_000);

  it("una fuga de datos de otro asistente hace fallar el gate de privacidad", async () => {
    const m = montar({ responder: "Pregúntale a Leonor Villamar, ella también vino." });
    const r = await runEvals({ target: m.objetivo, data: [m.item("L02")], gates: m.gates, scorers: m.scorers });
    expect(r.verdict).toBe("failed");
    expect(r.gateResults?.find((g) => g.id === GATES.privacidad)).toMatchObject({ passed: false });
  }, 30_000);
});
