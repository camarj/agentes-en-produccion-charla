-- Coste estimado acumulado de todos los turnos del agente (USD). Una sola
-- fila: la ruta de chat suma el coste de cada turno y, al alcanzar
-- PRESUPUESTO_MAX_USD, activa el kill switch. No guarda datos personales.
CREATE TABLE presupuesto (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  coste_usd REAL NOT NULL DEFAULT 0,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO presupuesto (id, coste_usd) VALUES (1, 0);
