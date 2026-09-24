import { describe, expect, it } from "vitest";
import { rolAnonimo } from "./rol-anonimo";

describe("rolAnonimo", () => {
  it.each([
    ["Ai specialist", "tecnico"],
    ["Analista de IA", "tecnico"],
    ["Cybersecurity", "tecnico"],
    ["Desarrollador /Consultor", "tecnico"],
    ["Tecnología", "tecnico"],
    ["Ceo", "negocio"],
    ["Marketera", "negocio"],
    ["Contador", "negocio"],
    ["Gestión de proyectos", "negocio"],
    ["Docencia de Matemáticas", "educacion"],
    ["teacher", "educacion"],
    ["Terapeuta Holistica", "salud"],
  ])("%s → %s", (rol, esperado) => {
    expect(rolAnonimo(rol)).toBe(esperado);
  });

  it("sin rol o con un rol sin coincidencias → otro", () => {
    expect(rolAnonimo(null)).toBe("otro");
    expect(rolAnonimo(undefined)).toBe("otro");
    expect(rolAnonimo("")).toBe("otro");
    expect(rolAnonimo("   ")).toBe("otro");
    expect(rolAnonimo("Estudiante")).toBe("otro");
  });

  it("ignora tildes y mayúsculas", () => {
    expect(rolAnonimo("MÉDICA general")).toBe("salud");
    expect(rolAnonimo("tecnologia")).toBe("tecnico");
    expect(rolAnonimo("INGENIERA civil")).toBe("tecnico");
    expect(rolAnonimo("Clínica dental")).toBe("salud");
  });

  it("con varias coincidencias gana técnico", () => {
    expect(rolAnonimo("Gerente de sistemas")).toBe("tecnico");
    expect(rolAnonimo("Profesor de ciencia de datos")).toBe("tecnico");
  });

  it("'ia' y 'ai' solo cuentan como palabra completa", () => {
    // "docencia", "farmacia" y "maine" contienen ia/ai pero no son IA.
    expect(rolAnonimo("Farmacia")).toBe("otro");
    expect(rolAnonimo("Docencia")).toBe("educacion");
    expect(rolAnonimo("IA/ML engineer")).toBe("tecnico");
  });

  it("es determinista", () => {
    expect(rolAnonimo("Emprendedora")).toBe("negocio");
    expect(rolAnonimo("Emprendedora")).toBe("negocio");
  });
});
