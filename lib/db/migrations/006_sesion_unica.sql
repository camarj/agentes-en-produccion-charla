-- Una sola sesión activa por asistente (DevFest 2026-12-05): al entrar de nuevo
-- se revocan las anteriores. Se marcan en vez de borrarlas porque el tope de
-- mensajes suma las sesiones del asistente.
ALTER TABLE sesiones ADD COLUMN revocada_en TEXT;
CREATE INDEX IF NOT EXISTS idx_sesiones_asistente ON sesiones (asistente_id);
