import { describe, expect, it } from "vitest";
import type { Escalamiento } from "@/lib/db/escalamientos";
import { colaDelPanel } from "./escalamientos";

const PERFILES = [
  { id: "a", nombre: "Zoraida Paredes", rol: "Gerente de marketing", descripcion: "Un bot de ventas" },
  { id: "b", nombre: "Marco Villacrés", rol: "Desarrollador backend", descripcion: null },
  { id: "c", nombre: "", rol: null, descripcion: null },
  { id: "s", nombre: "Raúl Camacho", rol: "Speaker", descripcion: null },
];

function esc(p: Partial<Escalamiento> & { id: number }): Escalamiento {
  return {
    asistenteId: "a",
    pregunta: "¿Pregunta?",
    motivo: "comercial",
    traceId: null,
    estado: "pendiente",
    creadoEn: "2026-09-26 18:00:00",
    ...p,
  };
}

describe("colaDelPanel", () => {
  it("pendientes primero y del más antiguo al más nuevo; luego los atendidos, el más reciente primero", () => {
    const cola = colaDelPanel(
      [
        esc({ id: 5, estado: "pendiente" }),
        esc({ id: 4, estado: "respondida" }),
        esc({ id: 3, estado: "pendiente" }),
        esc({ id: 2, estado: "descartada" }),
        esc({ id: 1, estado: "pendiente" }),
      ],
      PERFILES,
    );
    expect(cola.map((f) => [f.id, f.estado])).toEqual([
      [1, "pendiente"],
      [3, "pendiente"],
      [5, "pendiente"],
      [4, "respondida"],
      [2, "descartada"],
    ]);
  });

  it("limita los atendidos que se muestran, nunca los pendientes", () => {
    const lista = [
      ...Array.from({ length: 30 }, (_, i) => esc({ id: i + 1, estado: "respondida" })),
      ...Array.from({ length: 25 }, (_, i) => esc({ id: 100 + i })),
    ];
    const cola = colaDelPanel(lista, PERFILES, { maxAtendidos: 10 });
    expect(cola.filter((f) => f.estado === "pendiente")).toHaveLength(25);
    expect(cola.filter((f) => f.estado !== "pendiente").map((f) => f.id)).toEqual([30, 29, 28, 27, 26, 25, 24, 23, 22, 21]);
  });

  it("redacta emails y nombres de asistentes en la pregunta; conserva el nombre del speaker", () => {
    const [fila] = colaDelPanel(
      [
        esc({
          id: 1,
          pregunta: "Soy Zoraida Paredes (zoraida.p@correo.ec). ¿Marco puede escribirme? Quiero hablar con Raúl Camacho.",
        }),
      ],
      PERFILES,
    );
    expect(fila.pregunta).toBe("Soy [redactado] ([email]). ¿[redactado] puede escribirme? Quiero hablar con Raúl Camacho.");
  });

  it("muestra el rol anónimo y nunca nombre, email, rol ni descripción", () => {
    const cola = colaDelPanel(
      [
        esc({ id: 1, asistenteId: "a", motivo: "falla_tecnica", traceId: "t-1", creadoEn: "2026-09-26 18:10:05" }),
        esc({ id: 2, asistenteId: "b" }),
        esc({ id: 3, asistenteId: "c" }),
        esc({ id: 4, asistenteId: "borrado" }),
      ],
      PERFILES,
    );
    expect(cola[0]).toEqual({
      id: 1,
      pregunta: "¿Pregunta?",
      motivo: "falla_tecnica",
      rol_anonimo: "negocio",
      estado: "pendiente",
      creado_en: "2026-09-26T18:10:05Z",
    });
    expect(cola.map((f) => f.rol_anonimo)).toEqual(["negocio", "tecnico", "otro", "otro"]);
    const json = JSON.stringify(cola);
    for (const prohibido of ["Zoraida", "Marco", "Gerente", "Desarrollador", "bot de ventas", "asistenteId", "t-1"]) {
      expect(json).not.toContain(prohibido);
    }
  });
});
