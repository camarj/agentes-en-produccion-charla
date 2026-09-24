# T02 · Base de datos SQLite

**Objetivo:** Crear `data/charla.db` con su esquema, migraciones idempotentes y repositorios tipados para asistentes, sesiones, escalamientos, interruptores y láminas.

**Cubre:** RF-01, RF-02, RF-10, RF-11, RF-12.

## Archivos
- `lib/db/client.ts` — cliente `@libsql/client` con `url: 'file:' + DATABASE_PATH`; al abrir ejecuta `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;`
- `lib/db/migrations/001_init.sql`
- `lib/db/migrate.ts` — aplica migraciones pendientes (tabla `_migraciones`)
- `lib/db/asistentes.ts`, `sesiones.ts`, `escalamientos.ts`, `interruptores.ts`, `laminas.ts`
- `lib/db/*.test.ts`

## Esquema (`001_init.sql`)
```sql
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
```

## Lógica de repositorios
1. `asistentes.buscarPorEmail(email)`: normaliza (`trim().toLowerCase()`) antes de consultar.
2. `asistentes.crearInvitado({ email, nombre })` con `origen='invitado'` e id `crypto.randomUUID()`.
3. `asistentes.actualizarPerfil(id, { nombre?, rol, descripcion? })`.
4. `sesiones.crear(asistenteId)`: token = 32 bytes aleatorios en base64url, `thread_id = 'charla-' + asistenteId`. Si ya existe sesión del asistente, se crea otra con el mismo `thread_id` (misma conversación en varios dispositivos).
5. `sesiones.obtener(token)`, `sesiones.incrementarMensajes(token)` que devuelve el total del asistente (suma de todas sus sesiones).
6. `escalamientos.crear(...)` con deduplicación: si el mismo asistente tiene una pregunta idéntica (normalizada) pendiente, devuelve la existente. `contarPorAsistente`, `listar({ estado })`, `actualizarEstado`.
7. `interruptores.obtenerTodos()` con caché en memoria de 2 s; `actualizar(clave, valor)` invalida la caché e inserta en `eventos_interruptor`.
8. `laminas.buscar(consulta, limite)`: usa `bm25(laminas_fts, 2.0, 1.0, 1.0)` y un `snippet(...)` por columna; devuelve `{ lamina, titulo, fragmento, notas, puntaje }`, donde `fragmento` sale de `contenido` y `notas` sale de `notas` (o `null` si la lámina no tiene notas). Escapa comillas de la consulta; tokens unidos con espacio (AND implícito). Si no hay resultados, reintenta con `OR`.

## Checklist
- [x] `pnpm db:migrate` crea `data/charla.db` y es idempotente (correrlo dos veces no falla)
- [x] `buscarPorEmail(' Ana@Ejemplo.com ')` encuentra `ana@ejemplo.com`
- [x] Buscar "resiliencia" y "resiliéncia" devuelve la misma lámina (remove_diacritics)
- [x] Escalamiento duplicado del mismo asistente no crea una fila nueva
- [x] Cambiar un interruptor queda en `eventos_interruptor`
- [x] Tests de repositorios pasan con una base temporal

## Comandos
`"db:migrate": "tsx lib/db/migrate.ts"`
