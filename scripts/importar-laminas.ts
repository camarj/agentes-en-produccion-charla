import fs from "node:fs";
import { HTMLElement, TextNode, parse, type Node } from "node-html-parser";
import type { FuenteDb } from "../lib/db/client";
import { crearLaminas, type Lamina } from "../lib/db/laminas";
import { abrirBaseMigrada, ejecutarCli } from "./comun";

const EXCLUIDOS = "aside.notes, span.page, img, style, script, svg title, svg desc";
const EN_LINEA = new Set([
  "a", "abbr", "b", "cite", "code", "em", "i", "kbd", "mark", "q", "s", "small",
  "span", "strong", "sub", "sup", "time", "u",
]);
const ETIQUETA = /^Diapositiva\s+(\d+)\s*:\s*(.+)$/;

function colapsar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

// Texto visible: los elementos de bloque separan palabras; los de línea no.
function textoPlano(nodo: Node): string {
  if (nodo instanceof TextNode) return nodo.text;
  if (!(nodo instanceof HTMLElement)) return "";
  const interior = nodo.childNodes.map(textoPlano).join("");
  const etiqueta = nodo.rawTagName?.toLowerCase();
  return etiqueta && EN_LINEA.has(etiqueta) ? interior : ` ${interior} `;
}

function extraerNotas(seccion: HTMLElement): string | null {
  const aside = seccion.querySelector("aside.notes");
  if (!aside) return null;
  const bloques = aside.querySelectorAll("p, li");
  const parrafos = bloques.length
    ? bloques.map((b) => colapsar(textoPlano(b)))
    : textoPlano(aside).split(/\n\s*\n/).map(colapsar);
  const notas = parrafos.filter(Boolean).join("\n\n");
  return notas || null;
}

export function extraerLaminas(html: string): Lamina[] {
  // closeAllByClosing: una sección con <div> sin cerrar se cierra en </section>, como en el navegador.
  const raiz = parse(html, { closeAllByClosing: true, comment: false });
  const laminas: Lamina[] = [];
  const vistos = new Set<number>();
  for (const seccion of raiz.querySelectorAll("section.slide")) {
    const coincide = ETIQUETA.exec(seccion.getAttribute("aria-label")?.trim() ?? "");
    if (!coincide) continue;
    const numero = Number(coincide[1]);
    if (vistos.has(numero)) throw new Error(`La lámina ${numero} aparece dos veces en el HTML`);
    vistos.add(numero);
    const notas = extraerNotas(seccion);
    const copia = seccion.clone() as HTMLElement;
    for (const n of copia.querySelectorAll(EXCLUIDOS)) n.remove();
    laminas.push({ numero, titulo: colapsar(coincide[2]), contenido: colapsar(textoPlano(copia)), notas });
  }
  return laminas.sort((a, b) => a.numero - b.numero);
}

export async function importarLaminas(fuente: FuenteDb, laminas: Lamina[]): Promise<void> {
  const repo = crearLaminas(fuente);
  for (const lamina of laminas) await repo.upsert(lamina);
  await repo.reconstruirIndice();
}

async function principal() {
  const ruta = process.argv[2];
  if (!ruta) throw new Error("Uso: pnpm importar:laminas <archivo.html>");
  const laminas = extraerLaminas(fs.readFileSync(ruta, "utf8"));
  if (laminas.length === 0) throw new Error("No se encontraron láminas (section.slide con aria-label)");
  const cliente = await abrirBaseMigrada();
  try {
    await importarLaminas(async () => cliente, laminas);
  } finally {
    cliente.close();
  }
  console.table(
    laminas.map((l) => ({
      número: l.numero,
      título: l.titulo,
      caracteres: l.contenido.length,
      notas: l.notas?.length ?? 0,
    })),
  );
  console.log(`Láminas importadas: ${laminas.length}. Índice de búsqueda reconstruido.`);
}

ejecutarCli(import.meta.url, principal, "No se pudieron importar las láminas");
