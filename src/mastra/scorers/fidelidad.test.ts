import { describe, expect, it } from "vitest";
import { MENSAJES_BLOQUEO } from "../processors/mensajes";
import { modeloFalso } from "../processors/pruebas-modelo";
import { crearFidelidad, promptFidelidad, puntajeFidelidad, referenciaDeGroundTruth, type AnalisisFidelidad } from "./fidelidad";
import { busqueda, ejecucion, mensajeAgente } from "./pruebas-ejecucion";

function juez(analisis: AnalisisFidelidad) {
  return modeloFalso("openai/gpt-6-luna", () => ({ texto: JSON.stringify(analisis) }));
}

function textoPrompt(llamada: { prompt: unknown[] }): string {
  return JSON.stringify(llamada.prompt);
}

const HARNESS = [busqueda([{ lamina: 11, fragmento: "El harness es todo lo que rodea al modelo: herramientas, memoria y evals." }])];

describe("puntajeFidelidad", () => {
  it("proporción de afirmaciones sobre la charla respaldadas; ignora conocimiento general", () => {
    expect(
      puntajeFidelidad({
        afirmaciones: [
          { afirmacion: "a", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: true },
          { afirmacion: "b", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: false },
          { afirmacion: "c", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: false },
          { afirmacion: "d", sobre_la_charla: false, ejemplo_ilustrativo: false, respaldada: false },
        ],
        razon: "",
      }),
    ).toBe(0.33);
    expect(puntajeFidelidad({ afirmaciones: [{ afirmacion: "d", sobre_la_charla: false, ejemplo_ilustrativo: false, respaldada: false }], razon: "" })).toBeNull();
  });
});

describe("puntajeFidelidad con ejemplos ilustrativos (Raúl, 2026-09-23)", () => {
  it("un ejemplo aplicado al proyecto del usuario no es una afirmación sobre la charla: no se puntúa", () => {
    expect(
      puntajeFidelidad({
        afirmaciones: [
          { afirmacion: "En tu agente de ecommerce, un guardrail revisaría el reembolso", sobre_la_charla: false, ejemplo_ilustrativo: true, respaldada: false },
        ],
        razon: "",
      }),
    ).toBeNull();
  });

  it("los ejemplos no bajan la nota de las afirmaciones respaldadas", () => {
    expect(
      puntajeFidelidad({
        afirmaciones: [
          { afirmacion: "El harness rodea al modelo", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: true },
          { afirmacion: "En tu tienda, el harness revisaría cada pedido", sobre_la_charla: false, ejemplo_ilustrativo: true, respaldada: false },
        ],
        razon: "",
      }),
    ).toBe(1);
  });

  it("una cifra inventada atribuida a la charla dentro de un ejemplo sigue penalizando", () => {
    expect(
      puntajeFidelidad({
        afirmaciones: [
          { afirmacion: "El harness rodea al modelo", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: true },
          { afirmacion: "Como mostró Raúl, esto reduce 87 % las fallas", sobre_la_charla: true, ejemplo_ilustrativo: true, respaldada: false },
        ],
        razon: "",
      }),
    ).toBe(0.5);
  });
});

describe("promptFidelidad", () => {
  it("excluye los ejemplos ilustrativos pero no lo que atribuyen a la charla", () => {
    for (const huboBusqueda of [true, false]) {
      const p = promptFidelidad({ pregunta: "p", respuesta: "r", huboBusqueda, fragmentos: [] });
      expect(p).toContain("ejemplo_ilustrativo");
      expect(p).toContain("Illustrative examples");
      expect(p).toContain("Por ejemplo, en tu agente de ecommerce");
      expect(p).toContain("como mostró Raúl, esto reduce 87 % las fallas");
      expect(p).toMatch(/still sobre_la_charla = true/);
      // Calibración del 2026-09-25: aplicaciones en segunda persona sin «por ejemplo».
      expect(p).toMatch(/even without "por ejemplo"/);
      expect(p).toContain('"en tu caso…"');
    }
  });

  it("incluye fragmentos, pregunta, respuesta y el modo según haya habido búsqueda", () => {
    const con = promptFidelidad({ pregunta: "¿Qué es?", respuesta: "Es X", huboBusqueda: true, fragmentos: [{ lamina: 11, titulo: "Harness", fragmento: "El harness", notas: "nota" }] });
    expect(con).toContain("[Slide 11] Harness");
    expect(con).toContain("Speaker notes: nota");
    expect(con).toContain("searched the slides in this turn");
    const sin = promptFidelidad({ pregunta: "p", respuesta: "r", huboBusqueda: false, fragmentos: [] });
    expect(sin).toContain("did NOT search");
    expect(sin).toContain("(no slide excerpts)");
  });
});

describe("fidelidad (con juez falso)", () => {
  it("una cifra inventada queda sin respaldo: puntaje < 0,5", async () => {
    const f = juez({
      afirmaciones: [
        { afirmacion: "El harness rodea al modelo", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: true },
        { afirmacion: "El 87 % de los agentes fallan en producción", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: false },
        { afirmacion: "Hay 12 tipos de harness", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: false },
      ],
      razon: "Dos cifras no aparecen en las láminas.",
    });
    const scorer = crearFidelidad({ modelo: f.modelo as never, nombresConocidos: () => [] });
    const r = await scorer.run(
      ejecucion({
        pregunta: "¿Qué es el harness? Soy Zoraida, zora@mail.com",
        respuesta: "El harness rodea al modelo; el 87 % de los agentes falla y hay 12 tipos (lámina 11).",
        invocaciones: HARNESS,
        requestContext: { nombre_pila: "Zoraida", rol: "Contadora" },
      }),
    );
    expect(r.score).toBe(0.33);
    expect(r.score!).toBeLessThan(0.5);
    expect(r.reason).toBe("Dos cifras no aparecen en las láminas.");
    // El juez recibió los fragmentos, pero nunca el email ni el nombre.
    const prompt = textoPrompt(f.llamadas[0]);
    expect(prompt).toContain("El harness es todo lo que rodea al modelo");
    expect(prompt).not.toMatch(/zora@mail\.com|Zoraida/);
    // La fila que se guarda no lleva contexto personal.
    expect(r.requestContext).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/zora@mail\.com|Zoraida|Contadora/);
  });

  it("sin búsqueda en el turno usa como evidencia las láminas de turnos anteriores", async () => {
    const f = juez({ afirmaciones: [{ afirmacion: "x", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: true }], razon: "ok" });
    const scorer = crearFidelidad({ modelo: f.modelo as never, nombresConocidos: () => [] });
    const r = await scorer.run(
      ejecucion({ pregunta: "¿y eso?", respuesta: "Como dice la charla, el harness rodea al modelo.", recordados: [mensajeAgente("antes", HARNESS)] }),
    );
    expect(r.score).toBe(1);
    const prompt = textoPrompt(f.llamadas[0]);
    expect(prompt).toContain("did NOT search");
    expect(prompt).toContain("El harness es todo lo que rodea al modelo");
  });

  it("una respuesta con solo ejemplos aplicados a su proyecto se omite (no se penaliza)", async () => {
    const f = juez({
      afirmaciones: [
        { afirmacion: "En tu agente de WhatsApp, un eval revisaría cada respuesta", sobre_la_charla: false, ejemplo_ilustrativo: true, respaldada: false },
        { afirmacion: "Podrías medir cuántas respuestas citan el catálogo", sobre_la_charla: false, ejemplo_ilustrativo: true, respaldada: false },
      ],
      razon: "Solo hay ejemplos ilustrativos.",
    });
    const scorer = crearFidelidad({ modelo: f.modelo as never, nombresConocidos: () => [] });
    const r = await scorer.run(
      ejecucion({
        pregunta: "¿Cómo lo aplico a lo mío?",
        respuesta: "Piénsalo con tu agente de WhatsApp: un eval revisaría cada respuesta y podrías medir cuántas citan el catálogo.",
        invocaciones: HARNESS,
      }),
    );
    expect(r.score).toBeUndefined();
    expect(r.notScorable?.reason).toBe("sin afirmaciones sobre la charla");
  });

  it("una cifra inventada disfrazada de ejemplo y atribuida a la charla sigue penalizando", async () => {
    const f = juez({
      afirmaciones: [
        { afirmacion: "El harness rodea al modelo", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: true },
        { afirmacion: "Como mostró Raúl, esto reduce 87 % las fallas", sobre_la_charla: true, ejemplo_ilustrativo: true, respaldada: false },
        { afirmacion: "En tu tienda, el harness revisaría cada pedido", sobre_la_charla: false, ejemplo_ilustrativo: true, respaldada: false },
      ],
      razon: "La cifra del 87 % no aparece en las láminas.",
    });
    const scorer = crearFidelidad({ modelo: f.modelo as never, nombresConocidos: () => [] });
    const r = await scorer.run(
      ejecucion({
        pregunta: "¿Qué es el harness?",
        respuesta: "El harness rodea al modelo (lámina 11). Por ejemplo, en tu tienda revisaría cada pedido; como mostró Raúl, esto reduce 87 % las fallas.",
        invocaciones: HARNESS,
      }),
    );
    expect(r.score).toBe(0.5);
  });

  it("se omite sin afirmaciones sobre la charla, sin texto o con un guardrail", async () => {
    const f = juez({ afirmaciones: [{ afirmacion: "x", sobre_la_charla: false, ejemplo_ilustrativo: false, respaldada: false }], razon: "" });
    const scorer = crearFidelidad({ modelo: f.modelo as never, nombresConocidos: () => [] });
    expect((await scorer.run(ejecucion({ pregunta: "hola", respuesta: "¡Hola!" }))).notScorable).toBeDefined();
    const antes = f.llamadas.length;
    expect((await scorer.run(ejecucion({ pregunta: "p", respuesta: "" }))).notScorable).toBeDefined();
    expect((await scorer.run(ejecucion({ pregunta: "p", respuesta: MENSAJES_BLOQUEO.inyeccion }))).notScorable).toBeDefined();
    // Sin gastar llamadas al juez.
    expect(f.llamadas.length).toBe(antes);
  });
});

// T13: en los evals, la respuesta de referencia del dataset (groundTruth) es
// evidencia válida además de las láminas. En vivo no hay groundTruth.
describe("fidelidad con groundTruth (evals, T13)", () => {
  it("referenciaDeGroundTruth acepta texto o { respuesta_referencia } y descarta lo demás", () => {
    expect(referenciaDeGroundTruth("Observa, Decide, Actúa y Evalúa")).toBe("Observa, Decide, Actúa y Evalúa");
    expect(referenciaDeGroundTruth({ respuesta_referencia: " Lámina 8 " })).toBe("Lámina 8");
    expect(referenciaDeGroundTruth({ criterios: ["x"] })).toBeNull();
    expect(referenciaDeGroundTruth("   ")).toBeNull();
    expect(referenciaDeGroundTruth(undefined)).toBeNull();
  });

  it("el prompt incluye la respuesta de referencia como evidencia", () => {
    const p = promptFidelidad({ pregunta: "p", respuesta: "r", huboBusqueda: true, fragmentos: [], referencia: "Observa, Decide, Actúa y Evalúa (lámina 10)." });
    expect(p).toContain("Reference answer");
    expect(p).toContain("Observa, Decide, Actúa y Evalúa (lámina 10).");
    expect(promptFidelidad({ pregunta: "p", respuesta: "r", huboBusqueda: true, fragmentos: [] })).not.toContain("Reference answer");
  });

  it("el juez recibe la referencia del groundTruth del caso", async () => {
    const f = juez({
      afirmaciones: [{ afirmacion: "El loop es Observa, Decide, Actúa y Evalúa", sobre_la_charla: true, ejemplo_ilustrativo: false, respaldada: true }],
      razon: "Respaldada por la referencia.",
    });
    const scorer = crearFidelidad({ modelo: f.modelo as never, nombresConocidos: () => [] });
    const run = { ...ejecucion({ pregunta: "¿Etapas del loop?", respuesta: "Observa, Decide, Actúa y Evalúa (lámina 10).", invocaciones: HARNESS }), groundTruth: { respuesta_referencia: "Observa, Decide, Actúa y Evalúa, orientado por un objetivo (lámina 10)." } };
    const r = await scorer.run(run);
    expect(r.score).toBe(1);
    expect(textoPrompt(f.llamadas[0])).toContain("orientado por un objetivo (lámina 10).");
  });
});

