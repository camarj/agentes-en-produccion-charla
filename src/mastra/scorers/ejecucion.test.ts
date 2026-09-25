import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it } from "vitest";
import { MENSAJE_SALUD, MENSAJES_BLOQUEO } from "../processors/mensajes";
import {
  busquedasDeLaminas,
  esMensajeBloqueo,
  invocaciones,
  preguntaUsuario,
  recortarRazon,
  textoRespuesta,
  valorContexto,
} from "./ejecucion";
import { busqueda, busquedaCaida, ejecucion, mensajeAgente } from "./pruebas-ejecucion";

describe("lectura de la ejecución", () => {
  it("una llamada aparece en parts y en toolInvocations pero se cuenta una vez", () => {
    const r = ejecucion({ pregunta: "p", respuesta: "r", invocaciones: [busqueda([{ lamina: 11, fragmento: "El harness" }], "c1")] });
    expect(invocaciones(r.output)).toHaveLength(1);
  });

  it("prefiere la versión con resultado", () => {
    const llamada = { state: "call", toolCallId: "c1", toolName: "buscar_laminas", args: {} };
    const salida = [mensajeAgente("", [llamada]), mensajeAgente("r", [busqueda([{ lamina: 2, fragmento: "f" }], "c1")])];
    expect(invocaciones(salida)[0].state).toBe("result");
  });

  it("extrae los fragmentos de buscar_laminas sin repetir láminas", () => {
    const r = ejecucion({
      pregunta: "p",
      respuesta: "r",
      invocaciones: [
        busqueda([{ lamina: 11, fragmento: "El harness", notas: "Raúl explica" }]),
        busqueda([{ lamina: 11, fragmento: "El harness" }, { lamina: 12, fragmento: "Evals" }]),
        { state: "result", toolCallId: "e1", toolName: "escalar_pregunta", args: {}, result: { registrado: true } },
      ],
    });
    const b = busquedasDeLaminas(r.output);
    expect(b.llamada).toBe(true);
    expect(b.conResultados).toBe(true);
    expect(b.fragmentos.map((f) => f.lamina)).toEqual([11, 12]);
    expect(b.fragmentos[0].notas).toBe("Raúl explica");
  });

  it("búsqueda caída o sin resultados: llamada pero sin resultados", () => {
    expect(busquedasDeLaminas(ejecucion({ pregunta: "p", respuesta: "r", invocaciones: [busquedaCaida()] }).output)).toEqual({
      llamada: true,
      conResultados: false,
      fragmentos: [],
    });
    expect(busquedasDeLaminas(ejecucion({ pregunta: "p", respuesta: "r", invocaciones: [busqueda([])] }).output).conResultados).toBe(false);
    expect(busquedasDeLaminas(ejecucion({ pregunta: "p", respuesta: "r" }).output).llamada).toBe(false);
    expect(busquedasDeLaminas(undefined).llamada).toBe(false);
  });

  it("texto de la respuesta y pregunta del usuario", () => {
    const r = ejecucion({ pregunta: "¿Qué es el harness?", respuesta: "Es el arnés (lámina 11)." });
    expect(textoRespuesta(r.output)).toBe("Es el arnés (lámina 11).");
    expect(preguntaUsuario(r.input)).toBe("¿Qué es el harness?");
    expect(textoRespuesta([])).toBe("");
    expect(preguntaUsuario({})).toBe("");
  });

  it("lee el contexto como objeto o como RequestContext", () => {
    const rc = new RequestContext();
    rc.set("rol", " Contadora ");
    expect(valorContexto(rc, "rol")).toBe("Contadora");
    expect(valorContexto({ rol: "Docente" }, "rol")).toBe("Docente");
    expect(valorContexto({ rol: "  " }, "rol")).toBeNull();
    expect(valorContexto(undefined, "rol")).toBeNull();
  });

  it("reconoce los mensajes fijos de guardrails y recorta razones", () => {
    expect(esMensajeBloqueo(MENSAJES_BLOQUEO.datos_personales)).toBe(true);
    expect(esMensajeBloqueo(MENSAJE_SALUD)).toBe(true);
    expect(esMensajeBloqueo("Hola")).toBe(false);
    expect(recortarRazon("a ".repeat(400)).length).toBeLessThanOrEqual(300);
  });
});
