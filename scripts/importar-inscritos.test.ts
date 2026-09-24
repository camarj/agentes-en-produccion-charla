import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearAsistentes } from "../lib/db/asistentes";
import { crearDbTemporal } from "../lib/db/prueba";
import { importarInscritos, leerFilas, mapearColumnas, normalizarEncabezado } from "./importar-inscritos";

const luma = path.join(__dirname, "fixtures/inscritos-luma.csv");
const generico = path.join(__dirname, "fixtures/inscritos-generico.csv");

describe("mapearColumnas", () => {
  it("normaliza encabezados: minúsculas, sin tildes, sin signos, espacios colapsados", () => {
    expect(normalizarEncabezado("¿A qué te dedicas?  (cargo o profesión)")).toBe(
      "a que te dedicas cargo o profesion",
    );
  });

  it("mapea el export de Luma", () => {
    const mapa = mapearColumnas([
      "guest_id",
      "first_name",
      "last_name",
      "email",
      "¿A qué te dedicas?  (cargo o profesión)",
      "¿Qué construyes o quieres construir con IA?",
    ]);
    expect(mapa).toEqual({
      email: "email",
      nombre: ["first_name", "last_name"],
      rol: "¿A qué te dedicas?  (cargo o profesión)",
      descripcion: "¿Qué construyes o quieres construir con IA?",
    });
  });

  it("mapea un CSV genérico con Correo, Nombre completo y Cargo", () => {
    expect(mapearColumnas(["Correo", "Nombre completo", "Cargo"])).toEqual({
      email: "Correo",
      nombre: ["Nombre completo"],
      rol: "Cargo",
      descripcion: null,
    });
  });

  it("no confunde 'rol' dentro de otra palabra y exige una columna de email", () => {
    expect(mapearColumnas(["correo", "nombre", "Área de desarrollo"]).rol).toBeNull();
    expect(() => mapearColumnas(["nombre", "cargo"])).toThrow(/email/i);
  });
});

describe("leerFilas", () => {
  it("lee CSV con número de fila de hoja (encabezado = fila 1)", async () => {
    const filas = await leerFilas(luma);
    expect(filas).toHaveLength(4);
    expect(filas[0].numero).toBe(2);
    expect(filas[2].valores.email).toBe("esto-no-es-un-email");
  });

  it("lee la primera hoja de un .xlsx", async () => {
    const ruta = path.join(os.tmpdir(), `inscritos-test-${process.pid}-${Date.now()}.xlsx`);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      libro,
      XLSX.utils.aoa_to_sheet([
        ["Correo", "Nombre completo", "Cargo"],
        ["gina@ejemplo.test", "Gina Hoja", "QA"],
        [],
        ["hugo@ejemplo.test", "Hugo Hoja", ""],
      ]),
      "Primera",
    );
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([["otra"], ["x"]]), "Segunda");
    fs.writeFileSync(ruta, XLSX.write(libro, { type: "buffer", bookType: "xlsx" }));
    try {
      const filas = await leerFilas(ruta);
      expect(filas.map((f) => f.numero)).toEqual([2, 4]);
      expect(filas[1].valores).toMatchObject({ Correo: "hugo@ejemplo.test", Cargo: "" });
    } finally {
      fs.rmSync(ruta, { force: true });
    }
  });

  it("rechaza otras extensiones", async () => {
    await expect(leerFilas("inscritos.txt")).rejects.toThrow(/csv|xlsx/i);
  });
});

describe("importarInscritos", () => {
  let db: Awaited<ReturnType<typeof crearDbTemporal>>;
  beforeEach(async () => {
    db = await crearDbTemporal();
  });
  afterEach(() => db.cerrar());

  it("importa el export de Luma: nombre completo, rol, descripción, vacíos en null e inválidos reportados", async () => {
    const r = await importarInscritos(db.fuente, await leerFilas(luma));
    expect(r).toEqual({ insertados: 3, actualizados: 0, omitidosSpeaker: 0, invalidos: [{ fila: 4, motivo: "email inválido" }] });
    const repo = crearAsistentes(db.fuente);
    expect(await repo.buscarPorEmail("ana.pruebas@ejemplo.test")).toMatchObject({
      nombre: "Ana Pruebas",
      rol: "Desarrolladora backend",
      descripcion: "Un agente de soporte",
      origen: "inscrito",
    });
    expect(await repo.buscarPorEmail("beto@ejemplo.test")).toMatchObject({ rol: null });
    expect(await repo.buscarPorEmail("dani@ejemplo.test")).toMatchObject({ descripcion: null });
  });

  it("importar dos veces el mismo CSV no duplica filas", async () => {
    await importarInscritos(db.fuente, await leerFilas(luma));
    const segunda = await importarInscritos(db.fuente, await leerFilas(luma));
    expect(segunda).toMatchObject({ insertados: 0, actualizados: 3 });
    const n = await db.cliente.execute("SELECT count(*) AS n FROM asistentes");
    expect(Number(n.rows[0].n)).toBe(3);
  });

  it("omite al speaker (por email, sin importar mayúsculas) y lo cuenta aparte", async () => {
    const filas = [
      { numero: 2, valores: { Correo: " RaulJ.Camacho@gmail.com ", "Nombre completo": "Raúl Camacho", Cargo: "Fundador" } },
      { numero: 3, valores: { Correo: "eva@ejemplo.test", "Nombre completo": "Eva Genérica", Cargo: "Product manager" } },
    ];
    const r = await importarInscritos(db.fuente, filas);
    expect(r).toEqual({ insertados: 1, actualizados: 0, omitidosSpeaker: 1, invalidos: [] });
    expect(await crearAsistentes(db.fuente).buscarPorEmail("raulj.camacho@gmail.com")).toBeNull();
  });

  it("importa un CSV genérico", async () => {
    const r = await importarInscritos(db.fuente, await leerFilas(generico));
    expect(r).toEqual({ insertados: 2, actualizados: 0, omitidosSpeaker: 0, invalidos: [] });
    expect(await crearAsistentes(db.fuente).buscarPorEmail("eva@ejemplo.test")).toMatchObject({
      nombre: "Eva Genérica",
      rol: "Product manager",
      descripcion: null,
    });
  });
});
