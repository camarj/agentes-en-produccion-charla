# T14 · Despliegue en Dokploy y prueba de carga

> **Actualización 2026-09-25 — requisitos vigentes:**
> - **Una sola imagen Docker** para `web` y `studio`; cada contenedor migra al arrancar. Guía paso a paso en `DEPLOY.md`.
> - **Dominios:** `charla.codetrain.cloud` (app) y `studio-charla.codetrain.cloud` (Studio); servidor en EE. UU. Trazas en Neon (`OBSERVABILIDAD_DATABASE_URL`, región `us-east-2`).
> - **Datos:** 40 láminas; 25 inscritos (26 filas, el speaker se omite). Tras desplegar `540fe53` o posterior hay que **volver a importar las láminas** para cargar las notas; el cambio de búsqueda (lámina completa y prefijos) es del lado de la consulta y no exige reimportar.
> - **`v1-estable` no depende del veredicto:** se etiqueta el commit desplegado cuando la app, Studio, la carga y el rollback funcionan. Los evals se corren en producción y su veredicto se muestra en la demo tal como salga, aunque sea `failed`; no se bajan umbrales ni se tocan guardrails para que pase.
> - **Latencia:** la meta p95 < 3 s se mantiene y está documentada como no cumplida (PRD §4).
> - Después del ensayo: `pnpm reiniciar:charla` (ver `REINICIO-CHARLA.md`).
>
> Fuente de verdad de los cambios: PRD §15 «Registro de cambios de requisitos». El texto de abajo es el plan original y se conserva como historial; donde choca con esta lista, gana esta lista.

**Objetivo:** Publicar la app y Mastra Studio en el servidor Dokploy de Inteliside con volumen persistente, dejar una versión estable para volver atrás y validar 30 sesiones concurrentes.

**Cubre:** despliegue (PRD §13), lanzamiento (PRD §14).

## Archivos
- `Dockerfile` (ajustes finales), `docker-entrypoint.sh`
- `scripts/carga.ts` — prueba de carga
- `DEPLOY.md` — pasos exactos usados

## Lógica
1. `docker-entrypoint.sh`: corre `pnpm db:migrate` y arranca `node server.js`.
2. Servicio `web` en Dokploy: imagen del repo, puerto 3000, volumen persistente `agente-charla-data` en `/app/data`, variables de `.env.example`, dominio con HTTPS (Let's Encrypt).
3. Servicio `studio`: misma imagen, comando `pnpm mastra:studio` (o el equivalente de producción), mismo volumen, puerto 4111, subdominio con Basic Auth en Traefik.
4. Importar datos en el contenedor: `pnpm importar:laminas <html>` y `pnpm importar:inscritos <archivo>`.
5. Correr `pnpm evals` contra la imagen desplegada; ~~solo con `passed` se etiqueta la imagen como `v1-estable`~~ **vigente:** el veredicto se reporta y se muestra en la demo aunque sea `failed`; `v1-estable` no depende de él.
6. **Prueba de carga** (`scripts/carga.ts`): crea 30 asistentes de prueba, identifica a cada uno y envía 3 preguntas por asistente con 30 sesiones en paralelo. Reporta primer token p50/p95, duración total p95 y errores. Al final borra los asistentes de prueba.
7. Verificar desde un teléfono con datos móviles (no Wi-Fi) el flujo completo.
8. Documentar en `DEPLOY.md` cómo volver a `v1-estable` desde Dokploy.

## Checklist
- [ ] `https://<dominio>` carga en móvil con datos en < 2 s
- [ ] Studio accesible solo con contraseña
- [ ] Reiniciar el contenedor conserva conversaciones, trazas y escalamientos
- [ ] Prueba de carga: primer token p95 < 3 s, 0 errores 5xx (meta vigente; si no se cumple, se reportan los números: PRD §4)
- [ ] `v1-estable` etiquetada y rollback probado una vez
- [ ] Inscritos reales importados (25; el speaker se omite) y verificado un email de ejemplo
- [ ] ~~Versión final de la presentación (con notas del speaker) importada y `pnpm evals` en `passed` después de importarla~~ → **Vigente:** versión final (40 láminas, con notas) importada y `pnpm evals` corrido después; su veredicto se reporta aunque sea `failed`
