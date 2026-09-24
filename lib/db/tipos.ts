import type { Row } from "@libsql/client";

export function texto(fila: Row, columna: string): string {
  return String(fila[columna]);
}

export function textoONulo(fila: Row, columna: string): string | null {
  const v = fila[columna];
  return v === null || v === undefined ? null : String(v);
}

export function numero(fila: Row, columna: string): number {
  return Number(fila[columna]);
}

// `datetime('now')` de SQLite ("2026-09-26 18:10:00", UTC) → ISO 8601 con Z.
export function isoDeSqlite(valor: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(valor) ? `${valor.replace(" ", "T")}Z` : valor;
}
