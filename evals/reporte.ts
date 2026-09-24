import fs from "node:fs";
import path from "node:path";
import type { RunEvalsResult } from "@mastra/core/evals";
import { costeEstimadoTurno, precioDe } from "@/lib/presupuesto";
import { MODELO_LIGERO } from "@/src/mastra/modelos";
import type { ResultadoScorer } from "./checks";
import { CATEGORIAS, type Caso } from "./dataset";
import type { Observacion } from "./observacion";

// Reporte de una corrida: tabla por categoría, casos fallidos con su motivo,
// promedios frente a umbrales, veredicto de runEvals y coste estimado.

export interface ResumenCaso {
  id: string;
  categoria: string;
  estado: "pasa" | "falla";
  fallos: string[];
  alertas: string[];
}

// Un caso pasa si cumple todos sus gates y sus criterios de aceptación (gate o
// no). Los demás scorers de seguimiento en 0 quedan como alertas.
export function resumirCaso(caso: Caso, resultados: ResultadoScorer[], obs: Observacion | undefined): ResumenCaso {
  const fallos: string[] = [];
  const alertas: string[] = [];
  if (obs?.error) fallos.push(`El turno del agente falló (${obs.error}).`);
  for (const r of resultados) {
    const texto = `${r.nombre}: ${r.razon.split("\n")[0]}`;
    const esAceptacion = r.tipo === "gate" || r.id === "criterios";
    if (r.estado === "puntuado" && (r.score ?? 0) < 1) {
      if (esAceptacion) fallos.push(texto);
      else if (r.tipo === "seguimiento") alertas.push(texto);
    } else if ((r.estado === "omitido" || r.estado === "error") && r.tipo === "gate") {
      alertas.push(`${r.nombre} (${r.estado}): ${r.razon}`);
    } else if (r.estado === "error") {
      alertas.push(`${r.nombre} (error): ${r.razon}`);
    }
  }
  return { id: caso.id, categoria: caso.categoria, estado: fallos.length > 0 ? "falla" : "pasa", fallos, alertas };
}

export function tablaPorCategoria(resumenes: ResumenCaso[]): { categoria: string; pasados: number; total: number }[] {
  return CATEGORIAS.map((categoria) => {
    const de = resumenes.filter((r) => r.categoria === categoria);
    return { categoria, pasados: de.filter((r) => r.estado === "pasa").length, total: de.length };
  }).filter((f) => f.total > 0);
}

const num = (n: number, d = 2) => n.toFixed(d).replace(".", ",");
const umbralTexto = (t: unknown) => (typeof t === "number" ? num(t) : JSON.stringify(t));

export function explicarVeredicto(r: RunEvalsResult): string {
  const v = r.verdict ?? "sin veredicto";
  if (r.verdict === "failed") {
    const gates = (r.gateResults ?? []).filter((g) => !g.passed).map((g) => `${g.id} (${num(g.score)})`);
    return `Veredicto: failed — gates por debajo de 1,0: ${gates.join(", ")}.`;
  }
  if (r.verdict === "scored") {
    const umbrales = (r.thresholdResults ?? []).filter((t) => !t.passed).map((t) => `${t.id} ${num(t.averageScore)} < ${umbralTexto(t.threshold)}`);
    return `Veredicto: scored — todos los gates pasan, pero no se alcanzan estos umbrales: ${umbrales.join(", ")}.`;
  }
  if (r.verdict === "passed") return "Veredicto: passed — todos los gates y umbrales se cumplen.";
  return `Veredicto: ${v}.`;
}

// El despliegue se bloquea si no es `passed` (T13: también cuentan los umbrales).
export function codigoSalida(verdict: RunEvalsResult["verdict"]): number {
  return verdict === "passed" ? 0 : 1;
}

// Llamadas al juez por scorer (relevancia de @mastra/evals hace 3).
const LLAMADAS_POR_SCORER: Record<string, number> = { fidelidad: 1, relevancia: 3, personalizacion: 1, criterios: 1, gate_criterios: 1 };
// Tokens estimados por llamada de juez (prompt con láminas + JSON de salida).
export const TOKENS_POR_JUICIO = { inputTokens: 3000, outputTokens: 400 };

export function llamadasDeJuez(resultados: ResultadoScorer[]): number {
  return resultados
    .filter((r) => r.estado === "puntuado" || r.estado === "omitido")
    .reduce((n, r) => n + (LLAMADAS_POR_SCORER[r.id] ?? 0), 0);
}

export interface Coste {
  agenteUsd: number;
  juecesUsd: number;
  totalUsd: number;
  turnos: number;
  llamadasJuez: number;
}

// Agente + guardrails con costeEstimadoTurno (T09) y los jueces de los evals
// estimados con TOKENS_POR_JUICIO a precio de MODELO_LIGERO.
export function costeCorrida(observaciones: Observacion[], llamadasJuez: number): Coste {
  const deTurnos = observaciones.filter((o) => o.modelo || o.uso);
  const agenteUsd = deTurnos.reduce((s, o) => s + costeEstimadoTurno(o.modelo, o.uso), 0);
  const juecesUsd = llamadasJuez * precioDe(MODELO_LIGERO, TOKENS_POR_JUICIO);
  return { agenteUsd, juecesUsd, totalUsd: agenteUsd + juecesUsd, turnos: deTurnos.length, llamadasJuez };
}

function duracion(segundos: number): string {
  const s = Math.round(segundos);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

export interface DatosReporte {
  titulo: string;
  resumenes: ResumenCaso[];
  resultado: RunEvalsResult;
  coste: Coste;
  duracionS: number;
  urlStudio?: string;
  notas?: string[];
}

export function formatearReporte(d: DatosReporte): string {
  const lineas: string[] = [];
  lineas.push("", `Evals · ${d.titulo}`, "");
  lineas.push("Categoría            Pasados");
  for (const f of tablaPorCategoria(d.resumenes)) lineas.push(`${f.categoria.padEnd(20)} ${f.pasados}/${f.total}`);
  const pasan = d.resumenes.filter((r) => r.estado === "pasa").length;
  lineas.push(`${"total".padEnd(20)} ${pasan}/${d.resumenes.length}`, "");

  const fallidos = d.resumenes.filter((r) => r.estado === "falla");
  lineas.push(fallidos.length === 0 ? "Casos fallidos: ninguno" : "Casos fallidos:");
  for (const f of fallidos) for (const m of f.fallos) lineas.push(`  ${f.id} · ${m}`);
  const conAlertas = d.resumenes.filter((r) => r.alertas.length > 0);
  if (conAlertas.length > 0) {
    lineas.push("", "Alertas (no bloquean):");
    for (const a of conAlertas) for (const m of a.alertas) lineas.push(`  ${a.id} · ${m}`);
  }

  lineas.push("", "Scorer                     Promedio  Umbral    Estado");
  const conUmbral = new Map((d.resultado.thresholdResults ?? []).map((t) => [t.id, t]));
  for (const [id, valor] of Object.entries(d.resultado.scores)) {
    if (typeof valor !== "number") continue;
    const t = conUmbral.get(id);
    const umbral = t ? `≥ ${umbralTexto(t.threshold)}` : "—";
    const estado = t ? (t.passed ? "cumple" : "no cumple") : "seguimiento";
    lineas.push(`${id.padEnd(26)} ${num(valor).padEnd(9)} ${umbral.padEnd(9)} ${estado}`);
  }
  for (const g of d.resultado.gateResults ?? []) {
    lineas.push(`${g.id.padEnd(26)} ${num(g.score).padEnd(9)} ${"= 1,00".padEnd(9)} ${g.passed ? "cumple" : "no cumple"}`);
  }

  lineas.push("", explicarVeredicto(d.resultado));
  lineas.push(
    `Coste estimado: ${num(d.coste.totalUsd, 2)} USD (agente y guardrails ${num(d.coste.agenteUsd, 3)} USD en ${d.coste.turnos} turnos; jueces ≈ ${num(d.coste.juecesUsd, 3)} USD en ${d.coste.llamadasJuez} llamadas).`,
  );
  lineas.push(`Duración: ${duracion(d.duracionS)}.`);
  for (const n of d.notas ?? []) lineas.push(n);
  if (d.urlStudio) lineas.push(`Studio: ${d.urlStudio}`);
  return lineas.join("\n");
}

export const CARPETA_RESULTADOS = path.join(__dirname, "resultados");

// evals/resultados/<fecha>.json (la carpeta está en .gitignore salvo .gitkeep).
export function guardarResultados(datos: Record<string, unknown>, fecha: Date, carpeta = CARPETA_RESULTADOS): string {
  fs.mkdirSync(carpeta, { recursive: true });
  const nombre = `${fecha.toISOString().replace(/[:.]/g, "-")}.json`;
  const ruta = path.join(carpeta, nombre);
  fs.writeFileSync(ruta, `${JSON.stringify(datos, null, 2)}\n`);
  return ruta;
}
