import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { z } from "zod";
import { crearAsistentes } from "../lib/db/asistentes";
import { esEmailSpeaker } from "../lib/speaker";
import type { FuenteDb } from "../lib/db/client";
import { abrirBaseMigrada, ejecutarCli } from "./comun";

export interface Fila {
  numero: number; // fila de la hoja; el encabezado es la fila 1
  valores: Record<string, string>;
}

export interface MapaColumnas {
  email: string;
  nombre: string[];
  rol: string | null;
  descripcion: string | null;
}

export interface ResultadoImportacion {
  insertados: number;
  actualizados: number;
  // Filas del speaker (Raúl): no es un asistente y no se importa.
  omitidosSpeaker: number;
  invalidos: { fila: number; motivo: string }[];
}

export function normalizarEncabezado(encabezado: string): string {
  return encabezado
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Inclusión por palabras completas: "rol" no coincide con "desarrollo".
function buscar(encabezados: string[], claves: string[], usados: Set<string>): string | null {
  const encontrado = encabezados.find((e) => {
    if (usados.has(e)) return false;
    const n = ` ${normalizarEncabezado(e)} `;
    return claves.some((k) => n.includes(` ${k} `));
  });
  if (encontrado) usados.add(encontrado);
  return encontrado ?? null;
}

export function mapearColumnas(encabezados: string[]): MapaColumnas {
  const usados = new Set(encabezados.filter((e) => normalizarEncabezado(e) === "guest id"));
  const email = buscar(encabezados, ["email", "correo"], usados);
  if (!email) throw new Error("No se encontró una columna de email (email o correo)");
  const first = buscar(encabezados, ["first name"], usados);
  const last = buscar(encabezados, ["last name"], usados);
  const descripcion = buscar(encabezados, ["que construyes", "construir con ia", "descripcion"], usados);
  const rol = buscar(encabezados, ["a que te dedicas", "cargo", "profesion", "rol"], usados);
  const nombre = first
    ? [first, ...(last ? [last] : [])]
    : [buscar(encabezados, ["nombre"], usados)].filter((e): e is string => e !== null);
  return { email, nombre, rol, descripcion };
}

function aTexto(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function esVacia(valores: Record<string, string>): boolean {
  return Object.values(valores).every((v) => v.trim() === "");
}

export async function leerFilas(ruta: string): Promise<Fila[]> {
  const extension = path.extname(ruta).toLowerCase();
  if (extension === ".csv") {
    const texto = (await fs.promises.readFile(ruta, "utf8")).replace(/^﻿/, "");
    const r = Papa.parse<Record<string, unknown>>(texto, { header: true, skipEmptyLines: false });
    return r.data
      .map((fila, i) => ({
        numero: i + 2,
        valores: Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, aTexto(v)])),
      }))
      .filter((f) => !esVacia(f.valores));
  }
  if (extension === ".xlsx") {
    const libro = XLSX.read(await fs.promises.readFile(ruta), { type: "buffer" });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, {
      defval: "",
      raw: false,
      blankrows: false,
    });
    return filas
      .map((fila) => ({
        // sheet_to_json expone __rowNum__ (base 0, no enumerable) con la fila real de la hoja.
        numero: Number((fila as { __rowNum__?: number }).__rowNum__ ?? 0) + 1,
        valores: Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, aTexto(v)])),
      }))
      .filter((f) => !esVacia(f.valores));
  }
  throw new Error("Formato no soportado: usa un archivo .csv o .xlsx");
}

const esquemaEmail = z.email();

function valor(fila: Fila, columna: string | null): string | null {
  if (!columna) return null;
  const v = (fila.valores[columna] ?? "").trim();
  return v === "" ? null : v;
}

export async function importarInscritos(fuente: FuenteDb, filas: Fila[]): Promise<ResultadoImportacion> {
  const resultado: ResultadoImportacion = { insertados: 0, actualizados: 0, omitidosSpeaker: 0, invalidos: [] };
  if (filas.length === 0) return resultado;
  const mapa = mapearColumnas(Object.keys(filas[0].valores));
  const repo = crearAsistentes(fuente);
  for (const fila of filas) {
    const email = valor(fila, mapa.email);
    if (!email || !esquemaEmail.safeParse(email.toLowerCase()).success) {
      resultado.invalidos.push({ fila: fila.numero, motivo: "email inválido" });
      continue;
    }
    if (esEmailSpeaker(email)) {
      resultado.omitidosSpeaker++;
      continue;
    }
    const nombre = mapa.nombre.map((c) => valor(fila, c)).filter(Boolean).join(" ");
    if (!nombre) {
      resultado.invalidos.push({ fila: fila.numero, motivo: "nombre vacío" });
      continue;
    }
    const { insertado } = await repo.upsertInscrito({
      email,
      nombre,
      rol: valor(fila, mapa.rol),
      descripcion: valor(fila, mapa.descripcion),
    });
    if (insertado) resultado.insertados++;
    else resultado.actualizados++;
  }
  return resultado;
}

async function principal() {
  const ruta = process.argv[2];
  if (!ruta) throw new Error("Uso: pnpm importar:inscritos <archivo.csv|archivo.xlsx>");
  const filas = await leerFilas(ruta);
  const cliente = await abrirBaseMigrada();
  let r: ResultadoImportacion;
  try {
    r = await importarInscritos(async () => cliente, filas);
  } finally {
    cliente.close();
  }
  // Solo conteos y números de fila: nunca emails ni nombres.
  console.log(`Filas leídas: ${filas.length}`);
  console.log(`Insertados: ${r.insertados}`);
  console.log(`Actualizados: ${r.actualizados}`);
  console.log(`Omitidos (speaker): ${r.omitidosSpeaker}`);
  console.log(`Inválidos: ${r.invalidos.length}`);
  for (const i of r.invalidos) console.log(`  · fila ${i.fila}: ${i.motivo}`);
}

ejecutarCli(import.meta.url, principal, "No se pudieron importar los inscritos");
