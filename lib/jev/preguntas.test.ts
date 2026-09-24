import { describe, expect, it } from "vitest";
import { estadoDelTurno, preguntasDelTurno, type EntradaTurno } from "./preguntas";

const FRAG = { lamina: 34, titulo: "Evals", fragmento: "¿Lo hizo bien?" };
const turno = (extra: Partial<EntradaTurno> = {}): EntradaTurno => ({
  pregunta: "¿Qué es un eval?",
  respuesta: "Un eval comprueba si el agente lo hizo bien.",
  evidencia: [FRAG],
  bloqueado: false,
  ...extra,
});

describe("preguntasDelTurno", () => {
  it("una sola petición con las cinco preguntas cuando hay evidencia", () => {
    expect(Object.keys(preguntasDelTurno(turno())).sort()).toEqual([
      "confusion",
      "intencion",
      "respaldada",
      "tema",
      "valor_para_preguntas",
    ]);
  });

  it("sin evidencia, bloqueado o sin respuesta: no pregunta `respaldada`", () => {
    for (const t of [turno({ evidencia: [] }), turno({ bloqueado: true }), turno({ respuesta: null })]) {
      expect(preguntasDelTurno(t)).not.toHaveProperty("respaldada");
    }
  });

  it("los temas y las intenciones incluyen una opción de no coincidencia", () => {
    const q = preguntasDelTurno(turno());
    expect(q.tema.criteria).toHaveProperty("other");
    expect(q.intencion.criteria).toHaveProperty("off_topic");
  });
});

describe("estadoDelTurno", () => {
  it("campos con nombre; láminas solo cuando se pregunta el respaldo", () => {
    expect(estadoDelTurno(turno())).toMatchObject({
      attendee_question: "¿Qué es un eval?",
      assistant_answer: expect.any(String),
      slide_evidence: [{ slide: 34, title: "Evals", excerpt: "¿Lo hizo bien?" }],
    });
    const bloqueado = estadoDelTurno(turno({ bloqueado: true })) as Record<string, unknown>;
    expect(bloqueado).not.toHaveProperty("assistant_answer");
    expect(bloqueado).not.toHaveProperty("slide_evidence");
  });
});
