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

// Tokens de letras/dígitos entre comillas: nunca se interpretan como sintaxis FTS5.
export function tokensConsulta(consulta: string): string[] {
  const tokens = consulta.match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.map((t) => `"${t.replaceAll('"', '""')}"`);
}

const SQL_BUSCAR = `SELECT l.numero AS lamina, l.titulo AS titulo,
    snippet(laminas_fts, 1, '', '', '…', 32) AS fragmento,
    CASE WHEN l.notas IS NULL OR trim(l.notas) = '' THEN NULL
      ELSE snippet(laminas_fts, 2, '', '', '…', 32) END AS notas,
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
    const tokens = tokensConsulta(consulta);
    if (tokens.length === 0) return [];
    const tope = Math.min(Math.max(Math.trunc(limite) || 1, 1), 20);
    const c = await fuente();
    const conAnd = await c.execute({ sql: SQL_BUSCAR, args: [tokens.join(" "), tope] });
    if (conAnd.rows.length > 0 || tokens.length === 1) return conAnd.rows.map(aResultado);
    const conOr = await c.execute({ sql: SQL_BUSCAR, args: [tokens.join(" OR "), tope] });
    return conOr.rows.map(aResultado);
  }

  return { upsert, reconstruirIndice, buscar };
}

export const laminas = crearLaminas();
