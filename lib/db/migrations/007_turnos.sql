-- Un turno de chat terminado (PRD §15 G7): el panel del speaker cuenta turnos,
-- latencia, fallas, bloqueos y respaldo con SQL, sin releer las trazas ni tope.
-- Solo datos técnicos: nunca emails, nombres ni el texto de la pregunta.
-- Tiempos en milisegundos epoch (INTEGER) para que el SQL sea portable a Postgres.
CREATE TABLE IF NOT EXISTS turnos (
  id INTEGER PRIMARY KEY,
  iniciado_ms INTEGER NOT NULL,
  duracion_ms INTEGER,                -- null: el turno no terminó con respuesta
  resultado TEXT NOT NULL CHECK (resultado IN ('ok','bloqueo','falla')),
  tipo_falla TEXT CHECK (tipo_falla IN ('tiempo','herramienta','modelo','otro')),
  motivo_bloqueo TEXT,
  modelo TEXT,                        -- modelo que respondió (null si ninguno)
  respaldo INTEGER NOT NULL DEFAULT 0 CHECK (respaldo IN (0,1)),
  trace_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_turnos_iniciado ON turnos (iniciado_ms);
