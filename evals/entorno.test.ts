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
  const BASE = "postgres://u:p@db:5432/charla";
  it("siempre apunta la base de la app a un esquema temporal propio; el esquema de Mastra solo si se pide", () => {
    const esquema = encodeURIComponent("-c search_path=evals_charla_evals_x");
    expect(variablesDeEntorno({ dir: "/tmp/charla-evals-x" }, { DATABASE_URL: BASE })).toEqual({ DATABASE_URL: `${BASE}?options=${esquema}` });
    expect(variablesDeEntorno({ dir: "/tmp/charla-evals-x" }, { DATABASE_URL: BASE, EVALS_MASTRA_ESQUEMA: "mastra_local" })).toEqual({
      DATABASE_URL: `${BASE}?options=${esquema}`,
      MASTRA_ESQUEMA: "mastra_local",
    });
  });
  it("con el socket de Cloud SQL agrega el esquema a los parámetros que ya trae", () => {
    const url = "postgres://u:p@/charla?host=/cloudsql/p:r:i";
    expect(variablesDeEntorno({ dir: "/tmp/y" }, { DATABASE_URL: url }).DATABASE_URL).toBe(
      `${url}&options=${encodeURIComponent("-c search_path=evals_y")}`,
    );
  });
  it("sin DATABASE_URL falla con un mensaje claro en vez de tocar otra base", () => {
    expect(() => variablesDeEntorno({ dir: "/tmp/x" }, {})).toThrow(/DATABASE_URL/);
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
      await t.cerrar();
    }
  });
});
