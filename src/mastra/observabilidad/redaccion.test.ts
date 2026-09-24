import { RequestContext } from "@mastra/core/request-context";
import type { AnySpan } from "@mastra/core/observability";
import { describe, expect, it } from "vitest";
import { construirInstrucciones } from "../agents/instructions";
import {
  CLAVES_CONTEXTO_TRAZA,
  RedaccionTrazas,
  crearNombresConocidos,
  filtrarContexto,
  prepararEjecucion,
  redactarTexto,
  redactarValor,
  terminosDeNombres,
} from "./redaccion";

const PERFIL = `Hola\n\n<perfil_asistente uso="solo interno">\nNombre de pila: Zoraida\nA qué se dedica: Contadora pública\nQué construye o quiere construir con IA: un bot de facturas\nUsa este perfil…\n</perfil_asistente>\n\n<como_responder>…`;

describe("redactarTexto", () => {
  it("quita emails", () => {
    expect(redactarTexto("escríbeme a juan.perez@empresa.com.ec o a ANA@x.io")).toBe(
      "escríbeme a [email] o a [email]",
    );
  });

  it("vacía el bloque de perfil de las instrucciones", () => {
    const r = redactarTexto(PERFIL);
    expect(r).toContain("<perfil_asistente>[redactado]</perfil_asistente>");
    expect(r).not.toMatch(/Zoraida|Contadora|facturas/);
    expect(r).toContain("<como_responder>");
    // Idempotente.
    expect(redactarTexto(r)).toBe(r);
  });

  it("vacía el perfil aunque venga cortado o escapado en JSON", () => {
    const cortado = PERFIL.slice(0, PERFIL.indexOf("Usa este"));
    expect(redactarTexto(cortado)).not.toMatch(/Zoraida|Contadora/);
    const json = JSON.stringify({ system: PERFIL });
    expect(redactarTexto(json)).not.toMatch(/Zoraida|Contadora|facturas/);
    expect(redactarTexto("Nombre de pila: Zoraida\\nA qué se dedica: Contadora")).not.toMatch(/Zoraida|Contadora/);
  });

  it("quita términos sin importar tildes ni mayúsculas, solo como palabra completa", () => {
    const t = ["jose perez", "jose"];
    expect(redactarTexto("Soy JOSÉ Pérez y José vino", t)).toBe("Soy [redactado] y [redactado] vino");
    expect(redactarTexto("Josefina no cambia", t)).toBe("Josefina no cambia");
  });

  it("no toca texto sin datos", () => {
    expect(redactarTexto("¿Qué es el harness? (lámina 11)", ["zoraida"])).toBe("¿Qué es el harness? (lámina 11)");
  });
});

describe("instrucciones 1.1.0 (nombre en su propio bloque)", () => {
  const instrucciones = () => {
    const rc = new RequestContext();
    for (const [k, v] of Object.entries({ nombre_pila: "Zoraida", rol: "Contadora pública", descripcion: "un bot de facturas" })) rc.set(k, v);
    return construirInstrucciones(rc);
  };

  it("el texto de las instrucciones queda sin nombre, rol ni descripción aun sin términos", () => {
    const r = redactarTexto(instrucciones());
    expect(r).toContain("<nombre_asistente>");
    expect(r).toContain("Nombre de pila: [redactado]");
    expect(r).not.toMatch(/Zoraida|Contadora|facturas/);
    expect(redactarTexto(JSON.stringify({ system: instrucciones() }))).not.toMatch(/Zoraida|Contadora|facturas/);
  });

  it("una respuesta que saluda por el nombre se redacta en la traza", () => {
    const p = new RedaccionTrazas({ nombresConocidos: () => [] });
    const span = spanFalso({ attributes: { instructions: instrucciones() }, output: { text: "¡Hola, Zoraida! Piénsalo con tu bot de facturas (lámina 11)." } });
    p.process(span);
    const hijo = spanFalso({ requestContext: undefined, attributes: {}, output: { text: "Claro, ZORAIDA 🙂" } });
    p.process(hijo);
    expect(JSON.stringify([span, hijo])).not.toMatch(/Zoraida|ZORAIDA/);
    // Una alusión parafraseada al proyecto (no es nombre ni email) se conserva.
    expect(span.output).toEqual({ text: "¡Hola, [redactado]! Piénsalo con tu bot de facturas (lámina 11)." });
  });
});

describe("redactarValor", () => {
  it("recorre objetos y arreglos, quita claves personales y no muta el original", () => {
    const original = {
      mensajes: [{ role: "user", content: "Soy Zoraida, z@x.com" }],
      contexto: { nombre_pila: "Zoraida", rol: "Contadora", descripcion: "bot", email: "z@x.com", nombre: "Zoraida P", lamina_actual: "3" },
      nombrePila: "Zoraida",
      n: 3,
      ok: true,
      nada: null,
    };
    const r = redactarValor(original, ["zoraida"]);
    expect(r).toEqual({
      mensajes: [{ role: "user", content: "Soy [redactado], [email]" }],
      contexto: { lamina_actual: "3" },
      n: 3,
      ok: true,
      nada: null,
    });
    expect(original.contexto.nombre_pila).toBe("Zoraida");
  });

  it("soporta referencias circulares", () => {
    const a: Record<string, unknown> = { texto: "a@b.co" };
    a.yo = a;
    const r = redactarValor(a) as Record<string, unknown>;
    expect(r.texto).toBe("[email]");
  });
});

describe("filtrarContexto", () => {
  it("deja solo las claves permitidas (objeto o RequestContext)", () => {
    const rc = new RequestContext();
    for (const [k, v] of Object.entries({ asistente_id: "a1", nombre_pila: "Zoraida", rol: "Contadora", descripcion: "x", rol_anonimo: "negocio", lamina_actual: "11", interruptores_activos: ["latencia_alta"], version_instrucciones: "1.0.0" })) rc.set(k, v);
    const esperado = { rol_anonimo: "negocio", lamina_actual: "11", interruptores_activos: ["latencia_alta"], version_instrucciones: "1.0.0" };
    expect(filtrarContexto(rc)).toEqual(esperado);
    expect(filtrarContexto(Object.fromEntries(rc.entries()))).toEqual(esperado);
    expect(filtrarContexto(rc, ["rol"])).toEqual({ ...esperado, rol: "Contadora" });
    expect(filtrarContexto(undefined)).toBeUndefined();
    expect(filtrarContexto({ nombre_pila: "x" })).toBeUndefined();
    expect([...CLAVES_CONTEXTO_TRAZA]).toEqual(["rol_anonimo", "lamina_actual", "interruptores_activos", "version_instrucciones"]);
  });
});

describe("terminosDeNombres", () => {
  it("nombre completo y cada palabra de 3+ letras, sin conectores ni palabras cortas", () => {
    expect(terminosDeNombres(["María de los Ángeles Pérez", "Al Li"]).sort()).toEqual(
      ["al li", "angeles", "maria", "maria de los angeles perez", "perez"].sort(),
    );
  });
});

describe("speaker (Raúl Camacho) permitido en trazas", () => {
  it("su nombre no genera términos a redactar aunque su fila esté en asistentes", () => {
    const t = terminosDeNombres(["Raúl Camacho", "RAUL CAMACHO", "Ana Pérez"]);
    expect(t).not.toContain("raul");
    expect(t).not.toContain("camacho");
    expect(t).not.toContain("raul camacho");
    expect(t).toContain("ana perez");
  });

  it("su nombre completo se conserva aunque otro término coincida con una parte (otro asistente Raúl)", () => {
    const terminos = terminosDeNombres(["Raúl Pérez"]);
    expect(redactarTexto("RAÚL camacho habló con Raúl Pérez y con Raúl", terminos)).toBe(
      "RAÚL camacho habló con [redactado] y con [redactado]",
    );
  });

  it("emails del speaker se siguen quitando", () => {
    expect(redactarTexto("Raúl Camacho: raulj.camacho@gmail.com")).toBe("Raúl Camacho: [email]");
  });
});

describe("crearNombresConocidos", () => {
  it("carga en segundo plano, cachea y refresca al vencer", async () => {
    let ahora = 0;
    let llamadas = 0;
    const nombres = crearNombresConocidos(async () => {
      llamadas++;
      return [{ nombre: llamadas === 1 ? "Ana Ruiz" : "Luis Mora" }];
    }, { ttlMs: 1000, ahora: () => ahora });
    expect(nombres.obtener()).toEqual([]);
    await nombres.cargar();
    expect(nombres.obtener()).toContain("ana ruiz");
    ahora = 500;
    nombres.obtener();
    expect(llamadas).toBe(1);
    ahora = 1500;
    nombres.obtener();
    await nombres.cargar();
    expect(nombres.obtener()).toContain("luis mora");
    expect(llamadas).toBe(2);
  });

  it("si la base falla conserva lo último que tenía", async () => {
    let ahora = 0;
    let falla = false;
    const nombres = crearNombresConocidos(async () => {
      if (falla) throw new Error("db");
      return [{ nombre: "Ana Ruiz" }];
    }, { ttlMs: 10, ahora: () => ahora });
    await nombres.cargar();
    falla = true;
    ahora = 100;
    await nombres.cargar();
    expect(nombres.obtener()).toContain("ana ruiz");
  });
});

function spanFalso(extra: Partial<Record<string, unknown>> = {}): AnySpan {
  return {
    traceId: "t1",
    name: "agent run",
    attributes: { instructions: PERFIL },
    metadata: { rol_anonimo: "negocio", version_instrucciones: "1.0.0" },
    input: { messages: [{ role: "user", content: "Soy Zoraida (zora@mail.com). Trabajo como Contadora pública" }] },
    output: { text: "Hola Zoraida" },
    errorInfo: { message: "fallo con z@x.com" },
    requestContext: {
      asistente_id: "a1",
      nombre_pila: "Zoraida",
      rol: "Contadora pública",
      descripcion: "un bot de facturas",
      rol_anonimo: "negocio",
      lamina_actual: "11",
    },
    ...extra,
  } as unknown as AnySpan;
}

describe("RedaccionTrazas (procesador de spans)", () => {
  it("devuelve la misma instancia sin emails, nombre, rol ni descripción", () => {
    const p = new RedaccionTrazas({ nombresConocidos: () => [] });
    const span = spanFalso();
    expect(p.process(span)).toBe(span);
    const json = JSON.stringify(span);
    expect(json).not.toMatch(/Zoraida|zora@mail\.com|z@x\.com|Contadora|facturas|asistente_id/);
    expect(span.requestContext).toEqual({ rol_anonimo: "negocio", lamina_actual: "11" });
    expect(span.metadata).toMatchObject({ rol_anonimo: "negocio", version_instrucciones: "1.0.0" });
    expect(p.name).toBe("redaccion-trazas");
  });

  it("recuerda los términos de la traza para spans hijos sin requestContext", () => {
    const p = new RedaccionTrazas({ nombresConocidos: () => [] });
    p.process(spanFalso());
    const hijo = spanFalso({ requestContext: undefined, name: "llm", attributes: {}, output: { text: "Claro, Zoraida" } });
    p.process(hijo);
    expect(JSON.stringify(hijo)).not.toContain("Zoraida");
    // Otra traza no hereda los términos.
    const otro = spanFalso({ traceId: "t2", requestContext: undefined, attributes: {}, output: { text: "Zoraida" } });
    p.process(otro);
    expect((otro.output as { text: string }).text).toBe("Zoraida");
  });

  it("quita nombres de asistentes conocidos", () => {
    const p = new RedaccionTrazas({ nombresConocidos: () => terminosDeNombres(["Juan Pérez"]) });
    const span = spanFalso({ requestContext: undefined, input: "le pregunto a juan perez" });
    p.process(span);
    expect(span.input).toBe("le pregunto a [redactado]");
  });

  it("acepta undefined y nunca rompe", () => {
    const p = new RedaccionTrazas({
      nombresConocidos: () => {
        throw new Error("x");
      },
    });
    expect(p.process(undefined)).toBeUndefined();
    const span = spanFalso();
    expect(p.process(span)).toBe(span);
    expect(JSON.stringify(span)).not.toMatch(/zora@mail\.com|Zoraida/);
  });
});

describe("RedaccionTrazas y la marca de evals (T13)", () => {
  it("conserva origen, caso y versión en la metadata y las etiquetas del span raíz", () => {
    const p = new RedaccionTrazas({ nombresConocidos: () => [] });
    const span = spanFalso({
      metadata: { origen: "eval", caso_id: "L01", categoria: "laminas", version_instrucciones: "1.0.0" },
      tags: ["eval", "charla-v1"],
    });
    p.process(span);
    expect(span.metadata).toMatchObject({ origen: "eval", caso_id: "L01", categoria: "laminas", version_instrucciones: "1.0.0" });
    expect((span as unknown as { tags: string[] }).tags).toEqual(["eval", "charla-v1"]);
    expect(JSON.stringify(span)).not.toMatch(/Zoraida|zora@mail\.com/);
  });
});

describe("prepararEjecucion (prepareRun de los scorers)", () => {
  const run = {
    input: {
      inputMessages: [{ role: "user", content: "Soy Zoraida, zora@mail.com, contadora pública" }],
      systemMessages: [{ role: "system", content: PERFIL }],
    },
    output: [{ role: "assistant", content: "Como Contadora pública, Zoraida…" }],
    requestContext: { nombre_pila: "Zoraida", rol: "Contadora pública", descripcion: "bot de facturas", rol_anonimo: "negocio", asistente_id: "a1" },
    runId: "r1",
  };

  it("quita emails, nombre y perfil; el contexto queda solo con claves permitidas", async () => {
    const r = await prepararEjecucion({ nombresConocidos: () => [] })(run);
    expect(JSON.stringify(r)).not.toMatch(/Zoraida|zora@mail|facturas|Contadora|contadora|a1/);
    expect(r.requestContext).toEqual({ rol_anonimo: "negocio" });
    expect(r.runId).toBe("r1");
  });

  it("puede conservar el rol (personalización): sigue visible en el contexto y en el texto", async () => {
    const r = await prepararEjecucion({ conservar: ["rol"], nombresConocidos: () => [] })(run);
    expect(r.requestContext).toEqual({ rol_anonimo: "negocio", rol: "Contadora pública" });
    expect(JSON.stringify(r.output)).toContain("Contadora pública");
    expect(JSON.stringify(r)).not.toMatch(/Zoraida|zora@mail|facturas/);
  });

  it("los valores conservados (descripción) pasan por la misma redacción: sin emails ni nombres conocidos", async () => {
    const r = await prepararEjecucion({ conservar: ["rol", "descripcion"], nombresConocidos: () => ["andrea", "paredes"] })({
      ...run,
      requestContext: {
        ...run.requestContext,
        descripcion: "Bot de cobros para la tienda de Andrea Paredes (andrea@tienda.ec) y de Zoraida",
      },
    });
    expect(r.requestContext).toEqual({
      rol_anonimo: "negocio",
      rol: "Contadora pública",
      descripcion: "Bot de cobros para la tienda de [redactado] [redactado] ([email]) y de [redactado]",
    });
    expect(JSON.stringify(r)).not.toMatch(/Zoraida|Andrea|Paredes|andrea@tienda/);
  });
});

describe("RedaccionTrazas y trazas de scorers", () => {
  it("la traza de un scorer hereda los términos de la traza del agente (metadata.targetTraceId)", () => {
    const p = new RedaccionTrazas({ nombresConocidos: () => [] });
    p.process(spanFalso());
    const juez = spanFalso({
      traceId: "t-scorer",
      requestContext: undefined,
      attributes: { prompt: 'Occupation: "Contadora pública"' },
      metadata: { targetTraceId: "t1" },
    });
    p.process(juez);
    expect(JSON.stringify(juez)).not.toMatch(/Contadora|Zoraida/);
    // Hijos del span del scorer (misma traza) también.
    const hijo = spanFalso({ traceId: "t-scorer", requestContext: undefined, metadata: {}, attributes: {}, output: "contadora pública" });
    p.process(hijo);
    expect(hijo.output).toBe("[redactado]");
  });
});
