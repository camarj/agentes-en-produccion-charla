-- Votos 👍/👎 de los asistentes sobre las respuestas del agente. Fuente de
-- verdad del feedback: @mastra/libsql no guarda feedback de observabilidad.
-- Un voto por asistente y traza; votar de nuevo reemplaza el valor.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asistente_id TEXT NOT NULL REFERENCES asistentes(id) ON DELETE CASCADE,
  trace_id TEXT NOT NULL,
  valor INTEGER NOT NULL CHECK (valor IN (1, -1)),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (asistente_id, trace_id)
);
CREATE INDEX feedback_trace_id ON feedback (trace_id);
