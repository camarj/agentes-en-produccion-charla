import { describe, expect, it } from "vitest";
import { MENSAJES_BLOQUEO } from "../processors/mensajes";
import { modeloFalso } from "../processors/pruebas-modelo";
import {
  crearPersonalizacion,
  promptPersonalizacion,
  puntajePersonalizacion,
  razonSinPerfil,
  sinConceptoQueExplicar,
  type AnalisisPersonalizacion,
} from "./personalizacion";
import { busqueda, ejecucion } from "./pruebas-ejecucion";

function juez(a: AnalisisPersonalizacion) {
  return modeloFalso("openai/gpt-6-luna", () => ({ texto: JSON.stringify(a) }));
}

const CONTEXTO = { nombre_pila: "Zoraida", rol: "Contadora pública", descripcion: "bot de facturas", rol_anonimo: "negocio" };
// Una búsqueda en el turno: hubo un concepto que explicar.
const EVALS = [busqueda([{ lamina: 34, fragmento: "Las evals miden si el agente hace lo que debe." }])];
const EXPLICACION =
  "Zoraida, las evals son pruebas que miden si tu agente hace lo que debe (lámina 34). Piénsalo con tu bot de facturas: un eval revisaría que cada factura quede bien leída antes del cierre.";

describe("puntajePersonalizacion", () => {
  const a = (ejemplo_aplicado: boolean, menciona_rol: boolean, recita_datos: boolean): AnalisisPersonalizacion => ({
    explica_concepto: true,
    ejemplo_aplicado,
    menciona_rol,
    recita_datos,
    razon: "",
  });

  it("1 si el ejemplo se aplica a su trabajo o proyecto, aunque lo nombre con naturalidad", () => {
    expect(puntajePersonalizacion(a(true, false, false))).toBe(1);
    expect(puntajePersonalizacion(a(true, true, false))).toBe(1);
  });

  it("0,5 si menciona el rol o el perfil sin aplicarlo de verdad", () => {
    expect(puntajePersonalizacion(a(false, true, false))).toBe(0.5);
  });

  it("0 si es genérico o si recita los datos guardados", () => {
    expect(puntajePersonalizacion(a(false, false, false))).toBe(0);
    expect(puntajePersonalizacion(a(true, true, true))).toBe(0);
    expect(puntajePersonalizacion(a(false, true, true))).toBe(0);
    expect(puntajePersonalizacion(a(true, false, true))).toBe(0);
  });
});

describe("razonSinPerfil", () => {
  it("reemplaza el rol si el juez lo escribió (sin importar tildes ni mayúsculas)", () => {
    expect(razonSinPerfil("El ejemplo sirve a una CONTADORA PUBLICA.", ["Contadora pública"])).toBe("El ejemplo sirve a una [redactado].");
    expect(razonSinPerfil("Encaja con el perfil. Escribe a a@b.co", ["Docente"])).toBe("Encaja con el perfil. Escribe a [email]");
  });

  it("también reemplaza la descripción; ignora valores vacíos", () => {
    expect(razonSinPerfil("Aplica el ejemplo a su Bot de Facturas.", [null, "bot de facturas"])).toBe("Aplica el ejemplo a su [redactado].");
  });
});

describe("sinConceptoQueExplicar (omisión determinista, sin juez)", () => {
  it("agradecimientos, saludos y despedidas cortas sin herramientas: no hay concepto que explicar", () => {
    for (const r of ["¡Con gusto, Zoraida! Que disfrutes el resto de la charla.", "¡Hola! ¿Qué te gustaría saber de la charla?", "¡Hasta luego! 👋"]) {
      expect(sinConceptoQueExplicar(ejecucion({ pregunta: "gracias", respuesta: r }).output, r)).toBe(true);
    }
  });

  it("si el turno buscó en las láminas o la respuesta es larga, sí se puntúa", () => {
    const corta = "Las evals miden si el agente cumple (lámina 34).";
    expect(sinConceptoQueExplicar(ejecucion({ pregunta: "p", respuesta: corta, invocaciones: EVALS }).output, corta)).toBe(false);
    expect(sinConceptoQueExplicar(ejecucion({ pregunta: "p", respuesta: EXPLICACION }).output, EXPLICACION)).toBe(false);
  });
});

describe("personalizacion (con juez falso)", () => {
  it("el juez recibe el rol y la descripción, pero no el nombre ni emails; la razón no lleva el perfil", async () => {
    const f = juez({
      explica_concepto: true,
      ejemplo_aplicado: false,
      menciona_rol: true,
      recita_datos: false,
      razon: "Menciona que es contadora pública, sin aplicarlo a su bot de facturas.",
    });
    const scorer = crearPersonalizacion({ modelo: f.modelo as never, nombresConocidos: () => ["andrea"] });
    const r = await scorer.run(
      ejecucion({
        pregunta: "Soy Zoraida (zora@mail.com). ¿Para qué sirven los evals?",
        respuesta: "Como contadora pública, piensa en conciliar facturas: un eval revisa cada cierre.",
        invocaciones: EVALS,
        requestContext: { ...CONTEXTO, descripcion: "bot de facturas para Andrea (andrea@x.ec)" },
      }),
    );
    expect(r.score).toBe(0.5);
    expect(r.reason).toBe("Menciona que es [redactado], sin aplicarlo a su bot de facturas.");
    const prompt = JSON.stringify(f.llamadas[0].prompt);
    expect(prompt).toContain("Contadora pública");
    expect(prompt).toContain("bot de facturas para [redactado] ([email])");
    expect(prompt).not.toMatch(/Zoraida|zora@mail\.com|Andrea|andrea@x/);
    // Excepción aceptada: rol y descripción (redactada) en la fila; nunca nombre ni email.
    expect(r.requestContext).toEqual({
      rol: "Contadora pública",
      descripcion: "bot de facturas para [redactado] ([email])",
      rol_anonimo: "negocio",
    });
    expect(JSON.stringify(r)).not.toMatch(/Zoraida|zora@mail|Andrea|andrea@x/);
  });

  it("un ejemplo aplicado a su proyecto (descripción) puntúa 1", async () => {
    const f = juez({ explica_concepto: true, ejemplo_aplicado: true, menciona_rol: false, recita_datos: false, razon: "Aplica el ejemplo a su proyecto." });
    const scorer = crearPersonalizacion({ modelo: f.modelo as never, nombresConocidos: () => [] });
    const r = await scorer.run(ejecucion({ pregunta: "¿Qué son las evals?", respuesta: EXPLICACION, invocaciones: EVALS, requestContext: CONTEXTO }));
    expect(r.score).toBe(1);
    const prompt = JSON.stringify(f.llamadas[0].prompt);
    expect(prompt).toContain("bot de facturas");
  });

  it("con solo la descripción (sin rol) también se puntúa", async () => {
    const f = juez({ explica_concepto: true, ejemplo_aplicado: true, menciona_rol: false, recita_datos: false, razon: "ok" });
    const scorer = crearPersonalizacion({ modelo: f.modelo as never, nombresConocidos: () => [] });
    const r = await scorer.run(
      ejecucion({ pregunta: "¿Qué son las evals?", respuesta: EXPLICACION, invocaciones: EVALS, requestContext: { descripcion: "bot de facturas", rol_anonimo: "otro" } }),
    );
    expect(r.score).toBe(1);
  });

  it("un «gracias» se omite sin llamar al juez", async () => {
    const f = juez({ explica_concepto: false, ejemplo_aplicado: false, menciona_rol: false, recita_datos: false, razon: "" });
    const scorer = crearPersonalizacion({ modelo: f.modelo as never, nombresConocidos: () => [] });
    const r = await scorer.run(
      ejecucion({ pregunta: "¡Gracias!", respuesta: "¡Con gusto, Zoraida! Que disfrutes el resto de la charla.", requestContext: CONTEXTO }),
    );
    expect(r.score).toBeUndefined();
    expect(r.notScorable?.reason).toBe("sin concepto que explicar");
    expect(f.llamadas).toHaveLength(0);
  });

  it("si el juez dice que no hay concepto que explicar, se omite (no cuenta como 0)", async () => {
    const f = juez({ explica_concepto: false, ejemplo_aplicado: false, menciona_rol: false, recita_datos: false, razon: "Es una despedida." });
    const scorer = crearPersonalizacion({ modelo: f.modelo as never, nombresConocidos: () => [] });
    const larga =
      "¡Qué bueno que te sirvió, Zoraida! Fue un gusto acompañarte durante la charla. Si más tarde te surge otra duda sobre lo que vimos, aquí estaré para ayudarte. Que tengas un excelente resto de jornada.";
    const r = await scorer.run(ejecucion({ pregunta: "Gracias por todo, me voy", respuesta: larga, requestContext: CONTEXTO }));
    expect(f.llamadas).toHaveLength(1);
    expect(r.score).toBeUndefined();
    expect(r.notScorable?.reason).toBe("sin concepto que explicar");
  });

  it("se omite sin rol ni descripción, sin texto o con un guardrail, sin llamar al juez", async () => {
    const f = juez({ explica_concepto: true, ejemplo_aplicado: false, menciona_rol: false, recita_datos: false, razon: "" });
    const scorer = crearPersonalizacion({ modelo: f.modelo as never, nombresConocidos: () => [] });
    for (const c of [
      ejecucion({ pregunta: "p", respuesta: "r", requestContext: { rol_anonimo: "otro" } }),
      ejecucion({ pregunta: "p", respuesta: "", requestContext: CONTEXTO }),
      ejecucion({ pregunta: "p", respuesta: MENSAJES_BLOQUEO.fuera_de_alcance, requestContext: CONTEXTO }),
    ]) {
      expect((await scorer.run(c)).notScorable).toBeDefined();
    }
    expect(f.llamadas).toHaveLength(0);
  });

  it("recitar los datos guardados puntúa 0 aunque el ejemplo esté aplicado", async () => {
    const f = juez({ explica_concepto: true, ejemplo_aplicado: true, menciona_rol: true, recita_datos: true, razon: "Recita el perfil guardado." });
    const scorer = crearPersonalizacion({ modelo: f.modelo as never, nombresConocidos: () => [] });
    const r = await scorer.run(
      ejecucion({ pregunta: "¿Qué es un eval?", respuesta: "Tu rol registrado es contadora pública. Un eval…", invocaciones: EVALS, requestContext: CONTEXTO }),
    );
    expect(r.score).toBe(0);
  });

  it("el prompt pide no citar el rol y describe la rúbrica nueva", () => {
    const p = promptPersonalizacion({ rol: "Docente", descripcion: "Herramientas para mis clases", pregunta: "p", respuesta: "r" });
    expect(p).toContain('"Docente"');
    expect(p).toContain('"Herramientas para mis clases"');
    expect(p).toContain("explica_concepto");
    expect(p).toContain("never write the occupation");
    expect(p).toContain("ejemplo_aplicado");
    expect(p).toContain("recita_datos");
    expect(p).toContain("tu rol registrado es");
    expect(p).not.toContain("ejemplo_adaptado");
  });

  it("sin descripción o sin rol, el prompt lo dice sin inventar", () => {
    expect(promptPersonalizacion({ rol: "Docente", descripcion: null, pregunta: "p", respuesta: "r" })).toContain("(not provided)");
    expect(promptPersonalizacion({ rol: null, descripcion: "x", pregunta: "p", respuesta: "r" })).toContain("(not provided)");
  });
});
