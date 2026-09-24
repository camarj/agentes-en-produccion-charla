# T04 · Herramientas del agente

**Objetivo:** Implementar `buscar_laminas` y `escalar_pregunta` con `createTool`, esquemas zod, tiempo límite, reintentos acotados y los efectos de los interruptores de caos.

**Cubre:** RF-05, RF-06, RF-11, resiliencia (PRD §10).

## Archivos
- `src/mastra/tools/buscar-laminas.ts`
- `src/mastra/tools/escalar-pregunta.ts`
- `src/mastra/tools/resiliencia.ts` — helper `conReintentos(fn, { intentos: 3, timeoutMs: 5000, esperas: [300, 900] })`
- `src/mastra/tools/*.test.ts`

## buscar_laminas
- `id: 'buscar_laminas'`. Descripción para el modelo: "Busca en las láminas de la charla. Úsala antes de responder sobre el contenido de la presentación."
- Entrada: `{ consulta: string (2–200), max_resultados?: number (1–5, por defecto 3) }`.
- Salida: `{ resultados: { lamina, titulo, fragmento (≤ 800 car.), notas (≤ 1.200 car. o null), puntaje }[], sin_resultados: boolean } | { error: 'no_disponible' }`. Las notas del speaker explican lo que Raúl dice en esa lámina; el agente las usa como fuente de la charla igual que el texto visible.
- Lógica:
  1. Leer interruptores.
  2. Envolver la búsqueda en `conReintentos`.
  3. Dentro de cada intento: si `herramienta_caida = on`, lanzar `ToolUnavailableError`; si `latencia_alta = on`, esperar 8 s antes de consultar (el timeout de 5 s lo corta).
  4. Llamar `laminas.buscar`.
  5. Si se agotan los intentos, **devolver** `{ error: 'no_disponible' }` (no lanzar).
  6. Registrar en el span de la herramienta: intentos, interruptores activos, cantidad de resultados.

## escalar_pregunta
- `id: 'escalar_pregunta'`. Descripción: "Envía una pregunta a la cola que Raúl responderá en la sesión de preguntas."
- Entrada: `{ pregunta: string (5–500), motivo: enum('experiencia_personal','comercial','fuera_de_charla','desacuerdo','falla_tecnica') }`.
- Salida: `{ registrado: true, posicion: number } | { registrado: false, motivo: 'limite' }`.
- Lógica:
  1. Tomar `asistente_id` del `requestContext` (nunca de la entrada del modelo). Si falta, devolver `{ registrado: false, motivo: 'sin_contexto' }`.
  2. Si el asistente ya tiene 3 escalamientos, devolver `limite`.
  3. Crear el escalamiento (deduplicado) con el `traceId` actual si está disponible.
  4. `posicion` = cantidad de pendientes creados antes, más uno.

## Checklist
- [x] Con `herramienta_caida = on`, `buscar_laminas` hace 3 intentos y devuelve `{ error: 'no_disponible' }`
- [x] Con `latencia_alta = on`, cada intento se corta a los 5 s
- [x] Sin interruptores, "loop agéntico" devuelve la lámina 10
- [x] `escalar_pregunta` ignora cualquier `asistente_id` enviado por el modelo
- [x] El cuarto escalamiento del mismo asistente devuelve `limite`
- [x] Tests unitarios con base temporal y temporizadores simulados

## Notas
- Las herramientas no leen ni devuelven datos de la tabla `asistentes`.
