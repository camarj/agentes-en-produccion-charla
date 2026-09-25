# T07 · Observabilidad y scorers

> **Actualización 2026-09-25 — requisitos vigentes:**
> - **Jueces:** `openai/gpt-6-luna` (razonamiento `none`), respaldo `anthropic/claude-haiku-4-5`. No Haiku como principal.
> - **Trazas en Neon:** con `OBSERVABILIDAD_DATABASE_URL` las trazas y puntajes van a Postgres (Neon, EE. UU.); sin ella, a `data/mastra.db`.
> - **Fidelidad:** solo revisa lo que se atribuye a la charla; los ejemplos ilustrativos (también en segunda persona: «en tu caso…», «podrías…») no son afirmaciones sobre la charla. Una cifra inventada atribuida a la charla sigue penalizando.
> - **Relevancia:** el prearmado recibe al final de sus instrucciones el contrato (`CONTRATO_RELEVANCIA`): el ejemplo corto que el contrato exige cuenta como respuesta. Umbral 0,90 sin cambios.
> - **Personalización:** recibe rol **y descripción** (sin nombres ni emails). Rúbrica: 1 = ejemplo aplicado a su trabajo o proyecto (nombrarlo con naturalidad está bien); 0,5 = menciona el rol sin aplicarlo; 0 = genérico o recita los datos guardados. Los turnos sin concepto que explicar se omiten.
> - **Feedback:** el voto se guarda en la tabla `feedback` de `charla.db` (fuente de verdad) y se copia a Studio solo con Neon.
> - El nombre del speaker puede aparecer en las trazas (no es asistente).
>
> Fuente de verdad de los cambios: PRD §15 «Registro de cambios de requisitos». El texto de abajo es el plan original y se conserva como historial; donde choca con esta lista, gana esta lista.

**Objetivo:** Trazar el 100 % de los turnos en `mastra.db` sin datos personales y evaluar el tráfico real con scorers en vivo visibles en Mastra Studio.

**Cubre:** evals y observabilidad (PRD §11), RF-13.

## Archivos
- `src/mastra/index.ts`
- `src/mastra/scorers/fidelidad.ts`, `personalizacion.ts`, `cita-lamina.ts`
- `src/mastra/agents/charla.ts` (sección `scorers`)
- `lib/rol-anonimo.ts`

## Lógica
1. En `Mastra`: `observability: new Observability({ configs: { default: { serviceName: 'agente-charla', sampling: { type: 'always' }, exporters: [new MastraStorageExporter()], spanOutputProcessors: [new SensitiveDataFilter()], requestContextKeys: ['rol_anonimo','lamina_actual','interruptores_activos','version_instrucciones'] } } })`. Logger `PinoLogger` nivel `info`.
2. `rolAnonimo(rol)`: mapea por palabras clave a `tecnico | negocio | educacion | salud | otro`. Determinista, sin LLM. Palabras clave mínimas: técnico ← desarrollador, developer, sistemas, analista, ia, ai, cyber, seguridad, tecnología, datos, ingenier; negocio ← ceo, gerente, consultor, marketing, market, proyectos, contador, emprend, ventas; educacion ← docente, docencia, teacher, profesor, maestr, educa; salud ← terapeuta, médic, salud, clínic. Tests con estos 12 roles reales, sin nombres: 'Ai specialist', 'Analista de IA', 'Cybersecurity', 'Desarrollador /Consultor', 'Tecnología', 'Ceo', 'Marketera', 'Contador', 'Gestión de proyectos', 'Docencia de Matemáticas', 'teacher', 'Terapeuta Holistica'. Con varias coincidencias gana técnico.
3. **fidelidad** (personalizado, juez Haiku 4.5): compara la respuesta con los fragmentos devueltos por `buscar_laminas` en la misma ejecución. Puntaje 0–1 = proporción de afirmaciones sobre la charla respaldadas. Si no hubo búsqueda, puntúa solo afirmaciones atribuidas a la charla. Devuelve razón breve.
4. **relevancia**: `createAnswerRelevancyScorer({ model: 'anthropic/claude-haiku-4-5' })`.
5. **personalizacion** (personalizado, juez Haiku 4.5): recibe `rol` del contexto; 1 si el ejemplo encaja con el rol **y** no lo menciona; 0,5 si encaja pero lo menciona; 0 si es genérico.
6. **sin_errores_herramienta**: `checks.noToolErrors()`.
7. **cita_lamina** (determinista): 1 si la respuesta contiene `/l[aá]mina \d+/i` cuando se llamó `buscar_laminas` con resultados; se omite en otros casos.
8. Sampling en el agente: fidelidad, relevancia, sin_errores y cita al 100 %; personalización al 50 %.
9. Registrar todos los scorers también en la instancia `Mastra` para usarlos en T13.

## Checklist
- [x] Una pregunta en el chat genera una traza visible en Studio con modelo, herramientas, latencia y tokens
- [x] La traza tiene `rol_anonimo` y **no** contiene email ni nombre (excepción vigente: el nombre del speaker)
- [x] Los 5 scorers aparecen en Studio sobre tráfico real
- [ ] ~~Una respuesta que inventa una cifra obtiene fidelidad < 0,5~~ → **Vigente:** una cifra inventada como afirmación principal da 0; dentro de una respuesta correcta da 0,5 (juez real, 2026-09-25). Endurecer ese segundo caso quedó diferido (PRD §14)
- [x] Tests de `rolAnonimo` pasan
