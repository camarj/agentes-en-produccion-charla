import { db, type Fila, type FuenteDb } from "./client";
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

// Sin tildes ni diéresis (como `remove_diacritics` de FTS5): «resiliéncia» = «resiliencia».
const CON_TILDE = "áàäâãéèëêíìïîóòöôõúùüûñç";
const SIN_TILDE = "aaaaaeeeeiiiiooooouuuunc";
const sinTilde = (columna: string) => `translate(lower(coalesce(${columna}, '')), '${CON_TILDE}', '${SIN_TILDE}')`;

function quitarTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

// Consulta FTS5 de `consultasBusqueda` → tsquery de Postgres:
// `"x"` → `x`, `"x"*` → `x:*`, espacio → `&` (AND), ` OR ` → `|`.
export function aTsquery(fts: string): string {
  const termino = (t: string) => {
    const m = /^"([^"]*)"(\*?)$/.exec(t.trim());
    const palabra = quitarTildes(m ? m[1] : t).replace(/[^\p{L}\p{N}]/gu, "");
    return palabra ? `${palabra}${m?.[2] ? ":*" : ""}` : null;
  };
  const unir = (partes: (string | null)[], op: string) => partes.filter((p): p is string => p !== null).join(op);
  return fts.includes(" OR ") ? unir(fts.split(" OR ").map(termino), " | ") : unir(fts.split(/\s+/).map(termino), " & ");
}

// Devuelve el texto completo de la lámina y de sus notas (2026-09-25): las
// láminas son cortas (≤ ~650 caracteres) y un snippet de 32 palabras cortaba
// sus listas. buscar_laminas igual recorta a MAX_FRAGMENTO y MAX_NOTAS.
// Provisional hasta T2 (S3): el tsvector se arma al vuelo con el diccionario
// `simple` (son ~40 láminas) y el título pesa más que el contenido y las notas.
const DOCUMENTO = `setweight(to_tsvector('simple', ${sinTilde("l.titulo")}), 'A')
    || setweight(to_tsvector('simple', ${sinTilde("l.contenido")}), 'B')
    || setweight(to_tsvector('simple', ${sinTilde("l.notas")}), 'B')`;
const SQL_BUSCAR = `SELECT l.numero AS lamina, l.titulo AS titulo,
    l.contenido AS fragmento,
    CASE WHEN l.notas IS NULL OR trim(l.notas) = '' THEN NULL ELSE l.notas END AS notas,
    ts_rank(${DOCUMENTO}, q) AS puntaje
  FROM laminas l, to_tsquery('simple', ?) AS q
  WHERE (${DOCUMENTO}) @@ q
  ORDER BY puntaje DESC, l.numero
  LIMIT ?`;

function aResultado(f: Fila): ResultadoBusqueda {
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

  // Con el tsvector al vuelo no hay índice que reconstruir (T2 decide si lo habrá).
  async function reconstruirIndice(): Promise<void> {}

  async function buscar(consulta: string, limite = 5): Promise<ResultadoBusqueda[]> {
    const consultas = consultasBusqueda(consulta);
    if (consultas.length === 0) return [];
    const tope = Math.min(Math.max(Math.trunc(limite) || 1, 1), 20);
    const c = await fuente();
    for (const fts of consultas) {
      const tsquery = aTsquery(fts);
      if (!tsquery) continue;
      const r = await c.execute({ sql: SQL_BUSCAR, args: [tsquery, tope] });
      if (r.rows.length > 0) return r.rows.map(aResultado);
    }
    return [];
  }

  return { upsert, reconstruirIndice, buscar };
}

export const laminas = crearLaminas();
