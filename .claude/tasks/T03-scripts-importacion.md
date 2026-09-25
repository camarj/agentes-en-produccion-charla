# T03 · Scripts de importación y purga

> **Actualización 2026-09-25 — requisitos vigentes:**
> - **40 láminas** (no 39): la lámina 19 «Qué es un patrón agéntico» es nueva y las antiguas 19–39 pasaron a 20–40. Mastra Studio reemplaza a Arize Phoenix en las láminas de evals y observabilidad.
> - **Notas del speaker:** desde `540fe53` se leen de la lista JSON del HTML (`<script id="speaker-notes">`, 38 entradas, 30 láminas con notas); `aside.notes` sigue funcionando si existe. Tras desplegar `540fe53` o posterior hay que **volver a importar las láminas** para cargar las notas.
> - **El speaker no es asistente:** sus dos emails se excluyen al importar. El archivo real de Luma da 26 filas leídas, **25 importadas**, 1 omitida (speaker) y 0 inválidas.
> - **QR dentro de la lámina 1** (no la 2), sin crear lámina nueva.
> - La búsqueda devuelve la lámina completa con sus notas y tiene una etapa por prefijos (T04). Ese cambio es del lado de la consulta: no exige volver a importar.
>
> Fuente de verdad de los cambios: PRD §15 «Registro de cambios de requisitos». El texto de abajo es el plan original y se conserva como historial; donde choca con esta lista, gana esta lista.

**Objetivo:** Poblar `laminas` desde el HTML de la presentación, cargar inscritos desde CSV o Excel y poder purgar los datos personales.

**Cubre:** RF-01, RF-03, privacidad (PRD §8).

## Archivos
- `scripts/importar-laminas.ts`
- `scripts/importar-inscritos.ts`
- `scripts/purgar-personales.ts`
- `scripts/*.test.ts` con fixtures pequeños

## Lógica · importar-laminas
1. Leer el HTML con `node-html-parser` (instalarlo).
2. Cada lámina es `section.slide`. Número y título salen de `aria-label="Diapositiva N: Título"`.
3. Contenido: texto de la sección excluyendo `aside.notes`, `span.page`, `img`, `svg title/desc` duplicados, `style` y `script`. Colapsar espacios y saltos repetidos.
4. Notas del speaker: texto de `aside.notes`, conservando saltos de párrafo. Hoy están vacías y se guardan como `NULL`, pero Raúl las está escribiendo: el script debe funcionar igual con notas largas (varios párrafos por lámina) y re-importar sin perder nada.
5. Upsert en `laminas` y reconstruir FTS con `INSERT INTO laminas_fts(laminas_fts) VALUES('rebuild')`.
6. Imprimir un resumen: número, título y cantidad de caracteres por lámina.

## Lógica · importar-inscritos
1. Aceptar `.csv` (`papaparse`) o `.xlsx` (`xlsx`, primera hoja). El archivo real es una exportación de invitados de Luma con 26 filas y estas columnas exactas: `guest_id`, `first_name`, `last_name`, `email`, `¿A qué te dedicas?  (cargo o profesión)` (con doble espacio), `¿Qué construyes o quieres construir con IA?`.
2. Mapear columnas por nombre normalizado (minúsculas, sin tildes, sin signos, espacios colapsados), buscando por inclusión:
   - email ← contiene `email|correo`
   - nombre ← `first_name` + `' '` + `last_name`; si no existen, contiene `nombre`
   - rol ← contiene `a que te dedicas|cargo|profesion|rol`
   - descripcion ← contiene `que construyes|construir con ia|descripcion`
   - `guest_id` se ignora.
   Recortar espacios de todos los valores; cadenas vacías pasan a `NULL`.
3. Validar email con zod; filas inválidas se reportan y se saltan.
4. Upsert por email con `origen='inscrito'`. Un rol vacío queda `NULL` (el usuario lo completará en el textarea).
5. Resumen final: insertados, actualizados, inválidos (con número de fila).

## Lógica · purgar-personales
Pide confirmación (`--si` para omitirla) y borra `asistentes`, `sesiones` y `escalamientos`. No toca `data/mastra.db`.

## Checklist
- [x] ~~Importar la presentación actual carga 39 láminas con título correcto~~ → **Vigente:** carga 40 láminas con título correcto
- [x] ~~La lámina 32 contiene "Reintentos acotados" y la 33 "Salvaguardas"~~ → **Vigente:** la lámina 33 contiene "Reintentos acotados" y la 34 "Salvaguardas"
- [x] ~~Buscar "router" devuelve la lámina 24 primero~~ → **Vigente:** devuelve la lámina 25 primero
- [x] Importar dos veces el mismo CSV no duplica filas
- [x] El export de Luma se mapea bien: nombre = first_name + last_name, rol = «¿A qué te dedicas?», descripción = «¿Qué construyes…?»
- [x] ~~Importar el archivo real da 26 filas, 0 inválidas y 5 asistentes con rol `NULL`~~ → **Vigente:** 26 filas leídas, 25 importadas, 1 omitida (speaker), 0 inválidas y 4 asistentes con rol `NULL`
- [x] Columnas "Correo", "Nombre completo" y "Cargo" de un CSV genérico también se mapean
- [x] Una fila con email inválido se reporta y no detiene el proceso
- [x] Con un fixture que tiene notas en `aside.notes`, se guardan en `notas` y una búsqueda por una palabra que solo está en las notas encuentra esa lámina → **Vigente, además:** las notas de la lista JSON `script#speaker-notes` se guardan igual

## Comandos
```json
"importar:laminas": "tsx scripts/importar-laminas.ts",
"importar:inscritos": "tsx scripts/importar-inscritos.ts",
"purgar:personales": "tsx scripts/purgar-personales.ts"
```

## Notas
- El archivo de inscritos tiene datos personales reales: nunca lo agregues al repositorio ni a fixtures. Los tests usan un fixture inventado con las mismas columnas.
- Flujo cuando Raúl agregue las notas: `pnpm importar:laminas <html nuevo>` → `pnpm evals` → desplegar. No requiere cambios de código.
- ~~El QR se agrega **dentro de la lámina 2** existente,~~ **Vigente:** el QR va **dentro de la lámina 1** existente, sin crear una lámina nueva, para no desplazar la numeración que usan el dataset de evals y las citas.
