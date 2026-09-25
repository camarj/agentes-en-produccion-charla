import { describe, expect, it } from "vitest";
import { MENSAJE_FALLA_TECNICA } from "./chat";
import {
  CONTADOR_DESDE,
  agruparMensajes,
  alturaComposer,
  clasificarError,
  contador,
  indicadorDe,
  partirLaminas,
  textoVisible,
  type MensajeChat,
} from "./chat-ui";
import { MENSAJE_SALUD, MENSAJES_BLOQUEO } from "@/src/mastra/processors/mensajes";

function errorApi(status: number, cuerpo: unknown) {
  const responseBody = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
  return Object.assign(new Error(responseBody), { name: "AI_APICallError", statusCode: status, responseBody });
}

const msj = (id: string, role: "user" | "assistant", parts: unknown[], metadata?: unknown) =>
  ({ id, role, parts, ...(metadata ? { metadata } : {}) }) as MensajeChat;

describe("clasificarError", () => {
  it("mapea cada status y código de la API de chat", () => {
    expect(clasificarError(errorApi(401, { error: "no_autenticado", mensaje: "Tu sesión expiró." }), true)).toEqual({
      tipo: "sesion",
      mensaje: "Tu sesión expiró.",
    });
    expect(clasificarError(errorApi(403, { error: "falta_perfil", mensaje: "x" }), true).tipo).toBe("sesion");
    expect(clasificarError(errorApi(423, { error: "mantenimiento", mensaje: "En pausa." }), true)).toEqual({
      tipo: "mantenimiento",
      mensaje: "En pausa.",
    });
    expect(clasificarError(errorApi(429, { error: "tope", mensaje: "Llegaste al límite." }), true)).toEqual({
      tipo: "tope",
      mensaje: "Llegaste al límite.",
    });
    expect(clasificarError(errorApi(429, { error: "demasiados_mensajes", mensaje: "x" }), true).tipo).toBe("frecuencia");
    expect(clasificarError(errorApi(400, { error: "mensaje_invalido", mensaje: "Escribe…" }), true)).toEqual({
      tipo: "invalido",
      mensaje: "Escribe…",
    });
    expect(clasificarError(errorApi(500, { error: "error_interno", mensaje: "x" }), true).tipo).toBe("interrumpido");
  });

  it("un cuerpo que no es JSON nunca llega como texto técnico", () => {
    const r = clasificarError(errorApi(423, "<html>Bad Gateway</html>"), true);
    expect(r.tipo).toBe("mantenimiento");
    expect(r.tipo === "mantenimiento" && r.mensaje).not.toContain("html");
  });

  it("sin status: sin conexión si el navegador está offline; si no, respuesta interrumpida", () => {
    expect(clasificarError(new TypeError("Failed to fetch"), false).tipo).toBe("red");
    expect(clasificarError(new TypeError("Failed to fetch"), true).tipo).toBe("interrumpido");
    expect(clasificarError(new Error("La respuesta se interrumpió."), true).tipo).toBe("interrumpido");
  });
});

describe("agruparMensajes", () => {
  it("une respuestas seguidas del asistente (herramienta + texto) y conserva el último trace_id", () => {
    const grupos = agruparMensajes([
      msj("u1", "user", [{ type: "text", text: "hola" }]),
      msj("a1", "assistant", [{ type: "tool-buscar_laminas", toolCallId: "t", state: "output-available" }], { trace_id: "t-1" }),
      msj("a2", "assistant", [{ type: "text", text: "respuesta" }]),
      msj("u2", "user", [{ type: "text", text: "otra" }]),
    ]);
    expect(grupos.map((g) => [g.id, g.role])).toEqual([
      ["u1", "user"],
      ["a1", "assistant"],
      ["u2", "user"],
    ]);
    expect(grupos[1].parts).toHaveLength(2);
    expect(grupos[1].traceId).toBe("t-1");
    expect(grupos[1].ids).toEqual(["a1", "a2"]);
  });
});

describe("textoVisible", () => {
  it("junta las partes de texto", () => {
    expect(textoVisible([{ type: "text", text: "Uno." }, { type: "step-start" }, { type: "text", text: "Dos." }] as never)).toBe(
      "Uno.\n\nDos.",
    );
  });
  it("un bloqueo de entrada muestra el mensaje fijo de su motivo", () => {
    const partes = [{ type: "data-tripwire", data: { reason: "x", metadata: { motivo: "fuera_de_alcance" } } }];
    expect(textoVisible(partes as never)).toBe(MENSAJES_BLOQUEO.fuera_de_alcance);
    // F04 (2026-09-25): salud muestra su propio mensaje fijo.
    const salud = [{ type: "data-tripwire", data: { reason: "x", metadata: { motivo: "fuera_de_alcance", subtema: "salud" } } }];
    expect(textoVisible(salud as never)).toBe(MENSAJE_SALUD);
  });
  it("un reemplazo de salida muestra solo el mensaje de datos personales", () => {
    const partes = [
      { type: "text", text: "el correo de Ana es…" },
      { type: "data-guardrail", data: { motivo: "datos_personales" } },
    ];
    expect(textoVisible(partes as never)).toBe(MENSAJES_BLOQUEO.datos_personales);
  });
  it("la falla técnica llega como texto normal", () => {
    expect(textoVisible([{ type: "text", text: MENSAJE_FALLA_TECNICA }] as never)).toBe(MENSAJE_FALLA_TECNICA);
  });
});

describe("indicadorDe", () => {
  const asistente = (parts: unknown[]) => [msj("u", "user", [{ type: "text", text: "q" }]), msj("a", "assistant", parts)];

  it("enviado sin respuesta todavía → pensando", () => {
    expect(indicadorDe("submitted", [msj("u", "user", [{ type: "text", text: "q" }])])).toBe("pensando");
    expect(indicadorDe("streaming", asistente([{ type: "step-start" }]))).toBe("pensando");
  });
  it("herramienta en curso → buscando o escalando", () => {
    expect(indicadorDe("streaming", asistente([{ type: "tool-buscar_laminas", state: "input-streaming" }]))).toBe("buscando");
    expect(indicadorDe("streaming", asistente([{ type: "tool-buscar_laminas", state: "input-available" }]))).toBe("buscando");
    expect(indicadorDe("streaming", asistente([{ type: "tool-escalar_pregunta", state: "input-available" }]))).toBe("escalando");
    expect(indicadorDe("streaming", asistente([{ type: "dynamic-tool", toolName: "buscar_laminas", state: "input-available" }]))).toBe(
      "buscando",
    );
  });
  it("herramienta terminada y sin texto → pensando; con texto → nada", () => {
    expect(indicadorDe("streaming", asistente([{ type: "tool-buscar_laminas", state: "output-available" }]))).toBe("pensando");
    expect(indicadorDe("streaming", asistente([{ type: "text", text: "Hola" }]))).toBeNull();
  });
  it("sin stream en curso → nada", () => {
    expect(indicadorDe("ready", asistente([]))).toBeNull();
    expect(indicadorDe("error", asistente([]))).toBeNull();
  });
});

describe("composer", () => {
  it("contador visible desde 800, con separador de miles", () => {
    expect(CONTADOR_DESDE).toBe(800);
    expect(contador(799)).toBeNull();
    expect(contador(800)).toBe("800/1.000");
    expect(contador(1000)).toBe("1.000/1.000");
  });
  it("altura entre 1 y 6 líneas", () => {
    // 24 px por línea + 16 px de padding vertical.
    expect(alturaComposer(0)).toEqual({ alto: 40, conScroll: false });
    expect(alturaComposer(88)).toEqual({ alto: 88, conScroll: false });
    expect(alturaComposer(160)).toEqual({ alto: 160, conScroll: false });
    expect(alturaComposer(400)).toEqual({ alto: 160, conScroll: true });
  });
});

describe("partirLaminas", () => {
  it("separa las menciones «lámina N» del resto del texto", () => {
    expect(partirLaminas("Mira la lámina 11 y la Lámina 3.")).toEqual([
      "Mira la ",
      { lamina: "lámina 11" },
      " y la ",
      { lamina: "Lámina 3" },
      ".",
    ]);
    expect(partirLaminas("sin menciones")).toEqual(["sin menciones"]);
    expect(partirLaminas("laminado 3")).toEqual(["laminado 3"]);
  });
  it("también el plural con varias láminas", () => {
    expect(partirLaminas("(láminas 19 y 23)")).toEqual(["(", { lamina: "láminas 19 y 23" }, ")"]);
    expect(partirLaminas("láminas 3, 4 y 5.")).toEqual([{ lamina: "láminas 3, 4 y 5" }, "."]);
    expect(partirLaminas("lámina 2 y luego")).toEqual([{ lamina: "lámina 2" }, " y luego"]);
  });
});
