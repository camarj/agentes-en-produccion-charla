-- Eventos de salud del sistema para el panel del speaker (PRD §15 G7):
-- semáforos por servicio y registro en vivo. Los eventos repetidos del mismo
-- tipo en un minuto se agrupan en una fila (`cantidad`). Solo datos técnicos:
-- nunca emails, nombres, texto de preguntas ni el texto de errores técnicos.
CREATE TABLE IF NOT EXISTS eventos_salud (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,
  servicio TEXT NOT NULL,
  nivel TEXT NOT NULL CHECK (nivel IN ('ok','aviso','falla')),
  cantidad INTEGER NOT NULL DEFAULT 1,
  primero_ms INTEGER NOT NULL,
  ultimo_ms INTEGER NOT NULL,
  trace_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_eventos_salud_ultimo ON eventos_salud (ultimo_ms);
CREATE INDEX IF NOT EXISTS idx_eventos_salud_tipo ON eventos_salud (tipo, primero_ms);
