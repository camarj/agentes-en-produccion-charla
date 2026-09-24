-- «Jev · la sala en vivo»: un análisis de Jev (System One de TypeSafe) por
-- turno del agente, identificado por su traceId. Nunca se analiza dos veces.
-- Solo guarda un extracto corto y redactado de la pregunta: sin asistente,
-- sin email, sin nombre y sin la respuesta del agente.
CREATE TABLE jev_analisis (
  trace_id TEXT PRIMARY KEY,
  turno_en TEXT NOT NULL,              -- ISO 8601 del inicio del turno
  analizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  pregunta TEXT NOT NULL,              -- extracto redactado
  tema TEXT NOT NULL,
  tema_confianza REAL NOT NULL,
  intencion TEXT NOT NULL,
  intencion_confianza REAL NOT NULL,
  confusion REAL NOT NULL,             -- 0 entiende y profundiza · 1 perdido
  confusion_confianza REAL NOT NULL,
  valor REAL NOT NULL,                 -- 0–1 para la sesión de preguntas
  valor_confianza REAL NOT NULL,
  respaldada REAL,                     -- probabilidad; NULL si no se preguntó
  motivo_bloqueo TEXT,
  herramienta_caida INTEGER NOT NULL DEFAULT 0,
  respaldo INTEGER NOT NULL DEFAULT 0,
  sin_modelo INTEGER NOT NULL DEFAULT 0,
  falla INTEGER NOT NULL DEFAULT 0,
  latencia_ms INTEGER NOT NULL,
  tokens_entrada INTEGER,
  modelo TEXT NOT NULL
);
CREATE INDEX jev_analisis_turno_en ON jev_analisis (turno_en);
