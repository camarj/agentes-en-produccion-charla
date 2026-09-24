import { describe, expect, it } from "vitest";
import {
  MENSAJES_BLOQUEO,
  TIPO_PARTE_GUARDRAIL,
  esMotivoBloqueo,
  mensajeDeBloqueo,
  motivoDeTripwire,
} from "./mensajes";

describe("mensajes de bloqueo", () => {
  it("textos fijos en español de la tarea", () => {
    expect(MENSAJES_BLOQUEO.inyeccion).toBe(
      "Solo puedo ayudarte con temas de la charla. ¿Qué te gustaría entender mejor?",
    );
    expect(MENSAJES_BLOQUEO.fuera_de_alcance).toBe(
      "Eso queda fuera de lo que puedo responder aquí. Puedo ayudarte con cualquier tema de la charla: agentes, patrones, evals u observabilidad.",
    );
    expect(MENSAJES_BLOQUEO.datos_personales).toBe(
      "No puedo compartir información sobre otros asistentes ni sobre tus datos de registro.",
    );
  });

  it("mensajeDeBloqueo devuelve el texto del motivo y, si no lo conoce, el genérico", () => {
    expect(mensajeDeBloqueo("fuera_de_alcance")).toBe(MENSAJES_BLOQUEO.fuera_de_alcance);
    expect(mensajeDeBloqueo("datos_personales")).toBe(MENSAJES_BLOQUEO.datos_personales);
    expect(mensajeDeBloqueo("otro")).toBe(MENSAJES_BLOQUEO.inyeccion);
    expect(mensajeDeBloqueo(undefined)).toBe(MENSAJES_BLOQUEO.inyeccion);
  });

  it("esMotivoBloqueo reconoce solo los tres motivos", () => {
    expect(esMotivoBloqueo("inyeccion")).toBe(true);
    expect(esMotivoBloqueo("fuera_de_alcance")).toBe(true);
    expect(esMotivoBloqueo("datos_personales")).toBe(true);
    expect(esMotivoBloqueo("x")).toBe(false);
    expect(esMotivoBloqueo(3)).toBe(false);
  });

  it("motivoDeTripwire lee metadata.motivo (del tripwire o del data-tripwire de AI SDK)", () => {
    expect(motivoDeTripwire({ metadata: { motivo: "fuera_de_alcance" } })).toBe("fuera_de_alcance");
    expect(motivoDeTripwire({ reason: "x", metadata: { guardrail: "a", motivo: "inyeccion" } })).toBe("inyeccion");
    // Un tripwire de otro procesador sin motivo conocido se trata como bloqueo genérico.
    expect(motivoDeTripwire({ reason: "Blocked", metadata: undefined })).toBe("inyeccion");
    expect(motivoDeTripwire(undefined)).toBeNull();
    expect(motivoDeTripwire(null)).toBeNull();
  });

  it("tipo de la parte de datos que emite la guardia de salida", () => {
    expect(TIPO_PARTE_GUARDRAIL).toBe("data-guardrail");
  });
});
