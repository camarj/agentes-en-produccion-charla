import { describe, expect, it } from "vitest";
import { construirContextoTurno } from "./contexto-turno";
import type { Asistente } from "./db/asistentes";
import type { Interruptores } from "./db/interruptores";

const asistente: Asistente = {
  id: "a-1",
  email: "zoraida@correo.ec",
  nombre: "Zoraida Paredes",
  rol: "Contadora pública",
  descripcion: "Un bot de conciliaciones",
  origen: "inscrito",
  creadoEn: "2026-09-23 10:00:00",
};

const valores: Interruptores = {
  herramienta_caida: "on",
  latencia_alta: "off",
  modelo_caido: "on",
  modelos_caidos: "off",
  kill_switch: "off",
  lamina_actual: "21",
};

describe("construirContextoTurno", () => {
  it("arma el requestContext de un turno igual que la ruta de chat", () => {
    const rc = construirContextoTurno(asistente, valores, "1.1.0");
    expect(rc.get("asistente_id")).toBe("a-1");
    expect(rc.get("nombre_pila")).toBe("Zoraida");
    expect(rc.get("rol")).toBe("Contadora pública");
    expect(rc.get("descripcion")).toBe("Un bot de conciliaciones");
    expect(rc.get("rol_anonimo")).toBe("negocio");
    expect(rc.get("lamina_actual")).toBe(21);
    expect(rc.get("interruptores_activos")).toEqual(["herramienta_caida", "modelo_caido"]);
    expect(rc.get("version_instrucciones")).toBe("1.1.0");
    // Nunca el email.
    expect(JSON.stringify(Object.fromEntries(rc.entries()))).not.toContain("@");
  });

  it("omite rol y descripción vacíos y conserva una lámina no numérica tal cual", () => {
    const rc = construirContextoTurno({ ...asistente, rol: null, descripcion: null }, { ...valores, lamina_actual: "x" }, "1.0.0");
    expect(rc.has("rol")).toBe(false);
    expect(rc.has("descripcion")).toBe(false);
    expect(rc.get("rol_anonimo")).toBe("otro");
    expect(rc.get("lamina_actual")).toBe("x");
    expect(rc.get("version_instrucciones")).toBe("1.0.0");
  });
});
