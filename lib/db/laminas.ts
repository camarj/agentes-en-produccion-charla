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
// Solo cambia la consulta: el índice (columna `documento`) es el mismo.
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
// La columna `documento` (migración 003) normaliza el texto de las láminas con
// el mismo translate() de áàäâãéèëêíìïîóòöôõúùüûñç; aquí se normaliza la consulta.
function quitarTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

// Consulta de `consultasBusqueda` (sintaxis FTS5) → tsquery de Postgres:
// `"x"` → `x`, `"x"*` → `x:*`, espacio → `&` (AND), ` OR ` → `|`.
// `raices`: versión para el diccionario `spanish`: conserva las tildes (las
// necesita para reducir a la raíz) y no usa prefijos (no coinciden con raíces).
export function aTsquery(fts: string, { raices = false }: { raices?: boolean } = {}): string {
  const termino = (t: string) => {
    const m = /^"([^"]*)"(\*?)$/.exec(t.trim());
    const limpia = (m ? m[1] : t).replace(/[^\p{L}\p{N}]/gu, "");
    const palabra = raices ? limpia : quitarTildes(limpia);
    return palabra ? `${palabra}${m?.[2] && !raices ? ":*" : ""}` : null;
  };
  const unir = (partes: (string | null)[], op: string) => partes.filter((p): p is string => p !== null).join(op);
  return fts.includes(" OR ") ? unir(fts.split(" OR ").map(termino), " | ") : unir(fts.split(/\s+/).map(termino), " & ");
}

// Devuelve el texto completo de la lámina y de sus notas (2026-09-25): las
// láminas son cortas (≤ ~650 caracteres) y un snippet de 32 palabras cortaba
// sus listas. buscar_laminas igual recorta a MAX_FRAGMENTO y MAX_NOTAS.
// Dos tsvector generados con índice GIN (migración 003), título con peso A y
// contenido y notas con peso B: `documento` (palabras enteras sin tildes, como
// FTS5) para los pasos 1-3 y `raices` (raíces en español sin tildes) para el 4.
function sqlBuscar(columna: "documento" | "raices", consulta: string): string {
  return `SELECT l.numero AS lamina, l.titulo AS titulo,
    l.contenido AS fragmento,
    CASE WHEN l.notas IS NULL OR trim(l.notas) = '' THEN NULL ELSE l.notas END AS notas,
    ts_rank(l.${columna}, b.q) AS puntaje
  FROM laminas l
  CROSS JOIN (SELECT ${consulta} AS q) b
  WHERE l.${columna} @@ b.q
  ORDER BY puntaje DESC, l.numero
  LIMIT ?`;
}
// Pasos 1-3: palabras enteras sin tildes, exactas o por prefijo (como FTS5).
const SQL_BUSCAR = sqlBuscar("documento", "to_tsquery('simple', ?)");
// Último intento: raíces en español (con tildes para reducir, sin tildes para
// comparar). Va al final para no cambiar el orden de los pasos 1-3: el
// diccionario ignora palabras vacías y un AND de raíces se cumple antes.
const SQL_RAICES = sqlBuscar("raices", "translate(to_tsquery('spanish', ?)::text, 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')::tsquery");

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
    // 4. Raíces: «agente» ↔ «agentes», «especificación» ↔ «especificaciones».
    const raices = aTsquery(consultas[0], { raices: true });
    if (!raices) return [];
    const r = await c.execute({ sql: SQL_RAICES, args: [raices, tope] });
    return r.rows.map(aResultado);
  }

  return { upsert, buscar };
}

export const laminas = crearLaminas();
