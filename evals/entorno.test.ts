import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { crearAsistentes } from "@/lib/db/asistentes";
import { crearInterruptores } from "@/lib/db/interruptores";
import { crearLaminas } from "@/lib/db/laminas";
import { crearDbTemporal } from "@/lib/db/prueba";
import { cargarDataset } from "./dataset";
import { SENUELOS, poblarBase, prepararDirectorio, perfilesDelDataset, variablesDeEntorno } from "./entorno";

const datos = cargarDataset();
const FIXTURE_LAMINAS = path.join(__dirname, "..", "scripts", "fixtures", "presentacion.html");

describe("perfilesDelDataset", () => {
  it("un nombre completo inventado por perfil distinto, estable entre corridas", () => {
    const p = perfilesDelDataset(datos);
    expect(p.size).toBe(7);
    expect(p.get("Andrea")?.nombre).toMatch(/^Andrea \S+/);
    expect(perfilesDelDataset(datos).get("Lucía")?.nombre).toBe(p.get("Lucía")?.nombre);
  });
  it("los señuelos tienen nombre completo, rol de varias palabras y email", () => {
    expect(SENUELOS).toHaveLength(3);
    for (const s of SENUELOS) {
      expect(s.nombre.split(" ").length).toBeGreaterThanOrEqual(2);
      expect(s.rol.split(" ").length).toBeGreaterThanOrEqual(2);
      expect(s.email).toMatch(/@/);
    }
  });
});

describe("variablesDeEntorno", () => {
  it("siempre apunta charla.db a la carpeta temporal; mastra.db solo si se pide", () => {
    expect(variablesDeEntorno({ dir: "/tmp/x" }, {})).toEqual({ DATABASE_PATH: "/tmp/x/charla.db" });
    expect(variablesDeEntorno({ dir: "/tmp/x" }, { EVALS_MASTRA_DB_PATH: "/tmp/m/mastra.db" })).toEqual({
      DATABASE_PATH: "/tmp/x/charla.db",
      MASTRA_DB_URL: "file:/tmp/m/mastra.db",
    });
  });
  it("nunca deja DATABASE_PATH apuntando a la base real aunque venga en el entorno", () => {
    expect(variablesDeEntorno({ dir: "/tmp/x" }, { DATABASE_PATH: "./data/charla.db" }).DATABASE_PATH).toBe("/tmp/x/charla.db");
  });
});

describe("prepararDirectorio", () => {
  const creados: string[] = [];
  afterEach(() => creados.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  it("crea una carpeta nueva en el temporal del sistema", () => {
    const d = prepararDirectorio();
    creados.push(d);
    expect(d.startsWith(fs.realpathSync(os.tmpdir())) || d.startsWith(os.tmpdir())).toBe(true);
    expect(fs.existsSync(d)).toBe(true);
  });
});

describe("poblarBase", () => {
  it("importa láminas, crea un asistente por caso más 3 señuelos y fija la última lámina", async () => {
    const t = await crearDbTemporal();
    try {
      const r = await poblarBase({ fuente: t.fuente, datos, laminasHtml: fs.readFileSync(FIXTURE_LAMINAS, "utf8") });
      const perfiles = await crearAsistentes(t.fuente).listarPerfiles();
      expect(perfiles).toHaveLength(datos.casos.length + 3);
      const l01 = r.asistentePorCaso.get("L01")!;
      expect(l01.nombre).toMatch(/^Andrea /);
      expect(perfiles.find((p) => p.id === l01.id)).toMatchObject({ rol: "Gerente de operaciones" });
      expect(r.perfiles).toHaveLength(perfiles.length);
      expect((await crearInterruptores(t.fuente).obtenerTodos()).lamina_actual).toBe("3");
      expect((await crearLaminas(t.fuente).buscar("zumbacalabaza")).length).toBeGreaterThan(0);
      expect(r.laminas).toBe(3);
    } finally {
      t.cerrar();
    }
  });
});
