import { describe, expect, it } from "vitest";
import { MENSAJES_BLOQUEO } from "../processors/mensajes";
import { crearCitaLamina } from "./cita-lamina";
import { busqueda, busquedaCaida, ejecucion } from "./pruebas-ejecucion";

const cita = crearCitaLamina({ nombresConocidos: () => [] });
const conResultados = [busqueda([{ lamina: 11, fragmento: "El harness" }])];

describe("cita_lamina", () => {
  it("1 si cita una lámina cuando hubo resultados (con o sin tilde)", async () => {
    for (const respuesta of ["Es el arnés (lámina 11).", "Ver LAMINA 3"]) {
      const r = await cita.run(ejecucion({ pregunta: "p", respuesta, invocaciones: conResultados }));
      expect(r.score).toBe(1);
    }
  });

  it("0 si hubo resultados y no cita", async () => {
    const r = await cita.run(ejecucion({ pregunta: "p", respuesta: "Es el arnés.", invocaciones: conResultados }));
    expect(r.score).toBe(0);
    expect(r.reason).toContain("no cita");
  });

  it("se omite (notScorable) sin búsqueda, sin resultados, con la herramienta caída o con un guardrail", async () => {
    const casos = [
      ejecucion({ pregunta: "p", respuesta: "Hola (lámina 2)" }),
      ejecucion({ pregunta: "p", respuesta: "Hola", invocaciones: [busqueda([])] }),
      ejecucion({ pregunta: "p", respuesta: "Hola", invocaciones: [busquedaCaida()] }),
      ejecucion({ pregunta: "p", respuesta: MENSAJES_BLOQUEO.datos_personales, invocaciones: conResultados }),
    ];
    for (const c of casos) {
      const r = await cita.run(c);
      expect(r.notScorable).toBeDefined();
      expect(r.score).toBeUndefined();
    }
  });
});
