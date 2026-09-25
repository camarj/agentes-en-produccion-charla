import type { Row } from "@libsql/client";
import { db, type FuenteDb } from "./client";
import { numero, texto, textoONulo } from "./tipos";

export interface Lamina {
  numero: number;
  titulo: string;
  contenido: string;
  notas: string | null;
}

export interface ResultadoBusqueda {
  lamina: number;
  titulo: string;
  fragmento: string;
  notas: string | null;
  puntaje: number;
}

// Palabras vacías que no aportan a la búsqueda por prefijos (sí van en el AND exacto).
const PALABRAS_VACIAS = new Set(
  (
    "a al algo como cómo con cual cuál cuales cuáles cuando cuándo de del donde dónde e el ella ellas ellos en entre era es esa ese eso esta este esto estos fue ha hay la las le les lo los me mi mis muy más no nos o para pero por porque qué que quien quién quienes quiénes se según ser si sí sin sobre son su sus también te tu tus un una unas uno unos y ya yo"
  ).split(" "),
);

// Prefijo para que las conjugaciones coincidan («patrocinó» ↔ «patrocinada»,
// «organizó» ↔ «organizada»): solo en palabras de 7 o más letras, sin las tres
// últimas y con un mínimo de 5.
function conPrefijo(palabra: string): string {
  const letras = [...palabra];
  if (letras.length < 7) return `"${palabra}"`;
  return `"${letras.slice(0, Math.max(5, letras.length - 3)).join("")}"*`;
}

// Consultas FTS5 en orden, de la más estricta a la más amplia (sin repetir):
// 1. AND exacto de todas las palabras (lo de siempre);
// 2. AND con prefijos de las palabras de contenido (sin palabras vacías);
// 3. OR exacto de todas las palabras (lo de siempre). Un OR con prefijos
//    empeoraba el orden en las consultas reales del agente (evals 2026-09-25).
// Solo cambia la consulta: el índice (unicode61, sin tildes) es el mismo.
export function consultasBusqueda(consulta: string): string[] {
  const palabras = (consulta.match(/[\p{L}\p{N}]+/gu) ?? []).map((t) => t.toLowerCase());
  if (palabras.length === 0) return [];
  const contenido = palabras.filter((p) => !PALABRAS_VACIAS.has(p));
  const base = contenido.length > 0 ? contenido : palabras;
  const prefijos = base.map(conPrefijo);
  const exactas = palabras.map((p) => `"${p}"`);
  const consultas = [exactas.join(" "), prefijos.join(" "), exactas.join(" OR ")];
  return consultas.filter((c, i) => consultas.indexOf(c) === i);
}

// Devuelve el texto completo de la lámina y de sus notas (2026-09-25): las
// láminas son cortas (≤ ~650 caracteres) y un snippet de 32 palabras cortaba
// sus listas. buscar_laminas igual recorta a MAX_FRAGMENTO y MAX_NOTAS.
const SQL_BUSCAR = `SELECT l.numero AS lamina, l.titulo AS titulo,
    l.contenido AS fragmento,
    CASE WHEN l.notas IS NULL OR trim(l.notas) = '' THEN NULL ELSE l.notas END AS notas,
    -bm25(laminas_fts, 2.0, 1.0, 1.0) AS puntaje
  FROM laminas_fts JOIN laminas l ON l.numero = laminas_fts.rowid
  WHERE laminas_fts MATCH ?
  ORDER BY bm25(laminas_fts, 2.0, 1.0, 1.0)
  LIMIT ?`;

function aResultado(f: Row): ResultadoBusqueda {
  return {
    lamina: numero(f, "lamina"),
    titulo: texto(f, "titulo"),
    fragmento: texto(f, "fragmento"),
    notas: textoONulo(f, "notas"),
    puntaje: numero(f, "puntaje"),
  };
}

export function crearLaminas(fuente: FuenteDb = db) {
  async function upsert(lamina: Lamina): Promise<void> {
    const c = await fuente();
    await c.execute({
      sql: `INSERT INTO laminas (numero, titulo, contenido, notas) VALUES (?, ?, ?, ?)
        ON CONFLICT(numero) DO UPDATE SET titulo = excluded.titulo,
          contenido = excluded.contenido, notas = excluded.notas`,
      args: [lamina.numero, lamina.titulo, lamina.contenido, lamina.notas],
    });
  }

  // El índice es de contenido externo: se reconstruye tras importar láminas.
  async function reconstruirIndice(): Promise<void> {
    const c = await fuente();
    await c.execute("INSERT INTO laminas_fts(laminas_fts) VALUES('rebuild')");
  }

  async function buscar(consulta: string, limite = 5): Promise<ResultadoBusqueda[]> {
    const consultas = consultasBusqueda(consulta);
    if (consultas.length === 0) return [];
    const tope = Math.min(Math.max(Math.trunc(limite) || 1, 1), 20);
    const c = await fuente();
    for (const fts of consultas) {
      const r = await c.execute({ sql: SQL_BUSCAR, args: [fts, tope] });
      if (r.rows.length > 0) return r.rows.map(aResultado);
    }
    return [];
  }

  return { upsert, reconstruirIndice, buscar };
}

export const laminas = crearLaminas();
