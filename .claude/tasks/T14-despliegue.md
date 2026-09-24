# T14 · Despliegue en Dokploy y prueba de carga

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
5. Correr `pnpm evals` contra la imagen desplegada; solo con `passed` se etiqueta la imagen como `v1-estable`.
6. **Prueba de carga** (`scripts/carga.ts`): crea 30 asistentes de prueba, identifica a cada uno y envía 3 preguntas por asistente con 30 sesiones en paralelo. Reporta primer token p50/p95, duración total p95 y errores. Al final borra los asistentes de prueba.
7. Verificar desde un teléfono con datos móviles (no Wi-Fi) el flujo completo.
8. Documentar en `DEPLOY.md` cómo volver a `v1-estable` desde Dokploy.

## Checklist
- [ ] `https://<dominio>` carga en móvil con datos en < 2 s
- [ ] Studio accesible solo con contraseña
- [ ] Reiniciar el contenedor conserva conversaciones, trazas y escalamientos
- [ ] Prueba de carga: primer token p95 < 3 s, 0 errores 5xx
- [ ] `v1-estable` etiquetada y rollback probado una vez
- [ ] Inscritos reales importados y verificado un email de ejemplo
- [ ] Versión final de la presentación (con notas del speaker) importada y `pnpm evals` en `passed` después de importarla
