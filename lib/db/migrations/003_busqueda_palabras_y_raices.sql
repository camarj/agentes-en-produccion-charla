-- Búsqueda de láminas, corrección de la verificación independiente 2026-11-12.
-- La 002 quitaba las tildes ANTES de reducir a la raíz con `spanish`, que
-- reconoce «-ción» solo con tilde: «especificación» y «especificaciones»
-- quedaban con raíces distintas y los prefijos de laminas.ts («evaluac:*») no
-- coincidían con la raíz («evalu»). Ahora hay dos columnas:
-- * `documento`: palabras enteras sin tildes (`simple`), como hacía FTS5. La
--   usan los pasos 1-3 de laminas.ts (exactas y por prefijo), con el mismo
--   orden y resultados que tenía FTS5;
-- * `raices`: raíces en español calculadas CON tildes y sin tildes después
--   («agentes» ↔ «agente», «especificación» ↔ «especificaciones»). Solo para
--   el último intento: mezcladas con las palabras, «patron» encontraba la raíz
--   de «patrones» y cambiaba el orden de los pasos 1-3.
-- translate() sobre el texto del tsvector es IMMUTABLE (vale en una columna
-- generada) y funciona igual en Cloud SQL y en PGlite. El título pesa más (A).
DROP INDEX IF EXISTS laminas_documento_idx;
ALTER TABLE laminas DROP COLUMN documento;
ALTER TABLE laminas ADD COLUMN documento tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple'::regconfig, translate(lower(coalesce(titulo, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')), 'A')
  || setweight(to_tsvector('simple'::regconfig, translate(lower(coalesce(contenido, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')), 'B')
  || setweight(to_tsvector('simple'::regconfig, translate(lower(coalesce(notas, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')), 'B')
) STORED;
ALTER TABLE laminas ADD COLUMN raices tsvector GENERATED ALWAYS AS (
  setweight(translate(to_tsvector('spanish'::regconfig, lower(coalesce(titulo, '')))::text, 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')::tsvector, 'A')
  || setweight(translate(to_tsvector('spanish'::regconfig, lower(coalesce(contenido, '')))::text, 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')::tsvector, 'B')
  || setweight(translate(to_tsvector('spanish'::regconfig, lower(coalesce(notas, '')))::text, 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')::tsvector, 'B')
) STORED;

CREATE INDEX laminas_documento_idx ON laminas USING GIN (documento);
CREATE INDEX laminas_raices_idx ON laminas USING GIN (raices);
