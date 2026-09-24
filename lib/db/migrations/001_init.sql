CREATE TABLE asistentes (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT,
  descripcion TEXT,               -- qué construye o quiere construir con IA
  origen TEXT NOT NULL CHECK (origen IN ('inscrito','invitado')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sesiones (
  token TEXT PRIMARY KEY,
  asistente_id TEXT NOT NULL REFERENCES asistentes(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  mensajes INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE escalamientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asistente_id TEXT NOT NULL REFERENCES asistentes(id) ON DELETE CASCADE,
  pregunta TEXT NOT NULL,
  motivo TEXT NOT NULL CHECK (motivo IN ('experiencia_personal','comercial','fuera_de_charla','desacuerdo','falla_tecnica')),
  trace_id TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','respondida','descartada')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE interruptores (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE eventos_interruptor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT NOT NULL, valor TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE laminas (
  numero INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL,
  notas TEXT
);
CREATE VIRTUAL TABLE laminas_fts USING fts5(
  titulo, contenido, notas, content='laminas', content_rowid='numero',
  tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO interruptores (clave, valor) VALUES
 ('herramienta_caida','off'),('latencia_alta','off'),('modelo_caido','off'),('kill_switch','off'),('lamina_actual','1');
