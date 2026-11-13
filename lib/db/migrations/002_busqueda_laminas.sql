-- Búsqueda de texto completo de las láminas (T2, S3): reemplaza al FTS5 de SQLite.
-- * Diccionario `spanish`: reduce a la raíz («agentes» ↔ «agente»).
-- * Sin tildes ni diéresis con translate(), igual que `quitarTildes` en
--   laminas.ts. No usamos la extensión `unaccent`: es STABLE y una columna
--   generada exige una expresión IMMUTABLE (haría falta una función envoltorio
--   atada al esquema de la extensión); translate() es IMMUTABLE, no requiere
--   extensiones y se comporta igual en Cloud SQL y en PGlite (tests).
-- * El título pesa más (A) que el contenido y las notas (B).
-- La columna es generada: se recalcula sola en cada INSERT/UPDATE, así que no
-- hay índice que reconstruir después de importar.
ALTER TABLE laminas ADD COLUMN documento tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('spanish'::regconfig, translate(lower(coalesce(titulo, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')), 'A')
  || setweight(to_tsvector('spanish'::regconfig, translate(lower(coalesce(contenido, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')), 'B')
  || setweight(to_tsvector('spanish'::regconfig, translate(lower(coalesce(notas, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')), 'B')
) STORED;

CREATE INDEX laminas_documento_idx ON laminas USING GIN (documento);
