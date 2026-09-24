# DEPLOY · Agente de la charla en Dokploy

Handoff para el agente que despliega. Todo lo que hay que hacer está aquí; si algo no está, pregunta a Raúl antes de improvisar.

- **Repo:** https://github.com/camarj/agentes-en-produccion-charla (rama `main`, público)
- **Servidor:** Dokploy de Inteliside, **EE. UU.** (misma región aproximada que Neon, `us-east-2`)
- **Qué se despliega:** una sola imagen (`Dockerfile` en la raíz) usada por **dos servicios**: `web` (la app de los asistentes + panel del speaker) y `studio` (Mastra Studio + API de Mastra).
- **Cuándo:** hoy. La charla es en ~2 días; tras desplegar se corren los evals en producción y sus resultados **se quedan** para la demo.

---

## 1. Qué necesitas de Raúl antes de empezar

| Dato | Para qué |
| --- | --- |
| Dominio de la app (el del QR), p. ej. `charla.<dominio>` | Servicio `web` |
| Dominio de Studio, p. ej. `studio.<dominio>` | Servicio `studio` |
| Valores secretos de su `.env` local (ver tabla §3) | Variables de ambos servicios |
| Usuario y contraseña para el Basic Auth de Studio | Proteger Studio |
| Archivo de inscritos real: `Cómo lograr que tu agente de IA sobreviva en producción - Invitados - 2026-09-23-18-43-16.xlsx` | **No está en el repo** (datos personales). Raúl te lo pasa por un canal privado; nunca lo subas a git |

Ambos dominios deben tener un registro DNS **A** apuntando a la IP del servidor.

---

## 2. Servicios en Dokploy

Crea un proyecto (p. ej. `agente-charla`) con dos aplicaciones desde el mismo repo:

| | `web` | `studio` |
| --- | --- | --- |
| Origen | GitHub `camarj/agentes-en-produccion-charla`, rama `main` | igual |
| Build | Dockerfile, ruta `./Dockerfile`, contexto `.` | igual |
| Comando | por defecto (`web`) | **`studio`** (sobrescribir el comando/args del contenedor) |
| Puerto interno | `3000` | `4111` |
| Volumen | nombre **`agente-charla-data`** montado en **`/app/data`** | **el mismo volumen**, misma ruta |
| Health check | `GET /api/sesion` → 200 | `GET /api/agents` → 200 |
| Stop grace period | 15 s (las trazas se envían al cerrar) | 15 s |
| Réplicas | **1** (rate limit en memoria + SQLite en archivo) | **1** |
| Dominio | HTTPS con Let's Encrypt | HTTPS con Let's Encrypt + **Basic Auth** (Dokploy → Security) |

Notas:
- La imagen corre como usuario `node` (uid 1000) y el entrypoint verifica que `/app/data` sea escribible; si el volumen se crea como root, dale permisos a uid 1000.
- Al arrancar, cada contenedor corre `pnpm db:migrate` (idempotente) y luego el servicio.
- `web` sirve `node server.js` (Next standalone); `studio` sirve `node .mastra/output/index.mjs` con `MASTRA_STUDIO_PATH`, que es el modo producción documentado por Mastra (`mastra build --studio`).

---

## 3. Variables de entorno

Los valores secretos los tiene Raúl en su `.env` local. **Nunca** los pongas en el repo ni en logs.

| Variable | Obligatoria | Servicio | Para qué | Valor |
| --- | --- | --- | --- | --- |
| `OPENAI_API_KEY` | sí | ambos | modelo principal (`openai/gpt-6-luna`), guardrails, jueces | de Raúl |
| `ANTHROPIC_API_KEY` | sí | ambos | modelo de respaldo (`anthropic/claude-sonnet-5`) | de Raúl |
| `OBSERVABILIDAD_DATABASE_URL` | sí | ambos | trazas y feedback en Neon. **Conexión directa** (sin `-pooler`), `sslmode=require` | de Raúl |
| `SESSION_SECRET` | sí | ambos (`studio` lo usa en el eval R04) | firma de la cookie de sesión, ≥ 16 caracteres | de Raúl (o uno nuevo de 32+ caracteres: invalida sesiones previas, no importa hoy) |
| `PANEL_PASSWORD` | sí | `web` | Basic Auth de `/panel`. Sin ella el panel queda cerrado | de Raúl |
| `STUDIO_URL` | sí | ambos | enlace «Abrir Mastra Studio» del panel | `https://<dominio-studio>` |
| `PRESUPUESTO_MAX_USD` | sí | `web` | tope de gasto; al alcanzarlo el chat se pausa solo. Vacía = sin tope | `20` |
| `MAX_MENSAJES_ASISTENTE` | no | `web` | tope de preguntas por asistente | `30` |
| `DATABASE_PATH`, `MASTRA_DB_URL` | no | — | **no ponerlas**; los valores por defecto apuntan a `/app/data` | — |
| `APAGADO_ESPERA_MS` | no | `web` | espera al apagar (por defecto 8000) | — |
| `PORT`, `HOSTNAME`, `MASTRA_HOST`, `MASTRA_STUDIO_PATH`, `PROYECTO_RAIZ`, `NODE_ENV` | — | — | las fija la imagen; **no tocar** | — |
| `EVALS_MASTRA_DB_PATH`, `EVALS_LAMINAS_HTML` | — | — | **no poner**: solo pruebas locales | — |

`PUBLIC_URL` existe en el `.env` local pero el código no la usa.

---

## 4. Traefik / proxy

- HTTPS obligatorio en ambos dominios: la cookie de sesión es `Secure`, la PWA solo se instala con HTTPS y el panel usa Basic Auth.
- **No** activar el middleware `buffering` ni un CDN que almacene en búfer: `/api/chat` hace streaming.
- **No** cachear `/sw.js` (la app ya lo envía con `no-cache, no-store`). Si hay Cloudflare delante, excluye `/sw.js` y `/api/*` de caché.
- Studio no tiene autenticación propia: el Basic Auth de Dokploy es la protección. Comprueba que sin credenciales responde 401.

---

## 5. Primer despliegue, paso a paso

1. Crea los dos servicios (§2) con sus variables (§3) y dominios (§4). Despliega `web` y luego `studio`.
2. **Espera ~2 minutos** tras el primer arranque: Mastra prepara sus tablas en Neon en segundo plano. Los votos 👍/👎 que lleguen antes se guardan en `charla.db` pero no llegan a Studio.
3. Comprueba:
   - `https://<dominio-app>/` → 200 (pantalla negra con el logo de Inteliside).
   - `https://<dominio-app>/api/sesion` → `{"autenticado":false,...}`.
   - `https://<dominio-app>/panel` sin credenciales → 401.
   - `https://<dominio-studio>/` sin credenciales → 401; con credenciales carga Studio y en *Agents* aparece `charla`.
4. **Importar datos** (Dokploy → servicio `web` → Terminal; comparten volumen, así que basta en uno):
   ```bash
   pnpm importar:laminas agentes-produccion-taller-v43-before-slide14-v2.html
   # Esperado: 40 láminas importadas.
   # Ojo: importar solo agrega o actualiza (upsert); no borra láminas que ya no
   # existan. Si la presentación nueva tuviera MENOS láminas, borra las sobrantes
   # (DELETE FROM laminas WHERE numero > N) y vuelve a importar.
   ```
   Inscritos: copia el `.xlsx` que te pase Raúl dentro del volumen (p. ej. `scp` al servidor y `docker cp <archivo> <contenedor-web>:/app/data/inscritos.xlsx`), luego:
   ```bash
   pnpm importar:inscritos /app/data/inscritos.xlsx
   # Esperado: 26 filas leídas, 25 importadas, 1 omitida (speaker), 0 inválidas.
   rm /app/data/inscritos.xlsx   # no dejes el archivo con datos personales en el volumen
   ```
   Si Raúl tiene una versión más nueva de la presentación, debe subirla al repo y redesplegar antes de importar.
5. **Prueba funcional con un email inscrito** (pídele a Raúl uno de ejemplo, o usa el suyo si está inscrito): entrar, ver «Hola, <nombre>.», hacer una pregunta, ver la respuesta con la etiqueta de lámina, votar 👍. En Studio → Observability → Traces aparece la traza y su pestaña **Feedback** muestra el voto. En `/panel` suben «Mensajes» y «Votos».

---

## 6. Evals en producción (los resultados se quedan para la charla)

En el contenedor **`studio`** (Terminal). Cada corrida: ~3–4 min, ~0,20 USD.

```bash
pnpm evals                                   # instrucciones actuales 1.1.0
pnpm evals -- --instrucciones 1.0.0          # versión anterior, mismo dataset (para Compare)
```

- Ambos usan una `charla.db` **temporal** propia: no tocan asistentes, interruptores, cola ni gasto reales. Sus trazas llevan `origen: eval` y el panel no las cuenta.
- Si R04 falla por falta de build de Next en el contenedor, repite con `--ruta proceso`.
- **Se espera `failed`** (en local salió 24/40): es material para la demo, no un bloqueo. No ajustes nada para que pase. Reporta el resumen de consola de ambas corridas a Raúl.
- Verifica en Studio → **Datasets** → `charla-v1` → **Experiments**: deben aparecer las dos corridas; marca ambas y usa **Compare**. Guion de la demo en `.claude/sessions/T13.md` («Guion para la demo»).

---

## 7. Prueba de carga

Dentro del contenedor `web` (todo sale de una IP; 30 asistentes quedan bajo el límite de 60 identificaciones/min):

```bash
pnpm carga --url http://localhost:3000 --limpiar
```

Crea 30 asistentes `carga+N@carga.example.com`, 3 preguntas cada uno en paralelo, reporta primer token p50/p95, duración p95 y errores, y **borra los asistentes de prueba** al final. Meta: primer token p95 < 3 s y 0 errores 5xx (sale con código 1 si no se cumple; reporta los números igual). Si se corre desde fuera (`--url https://<dominio-app>`), luego limpia dentro de `web` con `pnpm carga --solo-limpiar`.

Después de la carga, en `/panel` los mensajes de carga cuentan en las métricas de la última hora; es normal.

---

## 8. Versión estable y rollback

1. Si todo lo anterior funciona, marca el despliegue actual como estable: crea el tag git `v1-estable` en el commit desplegado (`git tag v1-estable <sha> && git push origin v1-estable`) y anota el ID del despliegue en Dokploy.
2. **Prueba el rollback una vez:** en Dokploy → `web` → Deployments, vuelve al despliegue estable (o redespliega apuntando al tag `v1-estable`) y confirma que la app responde y los datos siguen (el volumen no se toca).
3. Reinicia `web` una vez y confirma que conversaciones, trazas y escalamientos se conservan.

---

## 9. Verificación final y reporte a Raúl

- [ ] App carga en un teléfono con datos móviles (no Wi-Fi) en < 2 s.
- [ ] Android: aparece «Instalar app» y se instala. iPhone (Safari): aparece la indicación «Agregar a inicio» y la app abre a pantalla completa (puede pedir el email otra vez: es normal).
- [ ] El teclado del teléfono no tapa el cuadro de texto del chat.
- [ ] Studio solo con contraseña.
- [ ] 40 láminas y 25 inscritos importados; el xlsx borrado del volumen.
- [ ] Dos experimentos de evals visibles en Studio con Compare.
- [ ] Prueba de carga: números reportados, asistentes de prueba borrados.
- [ ] `v1-estable` etiquetado y rollback probado.

Reporta a Raúl: URLs, resultados de evals (tabla por categoría y veredicto de cada versión), números de la carga, y cualquier desvío.

---

## 10. Lo que NO hay que hacer

- No subir `.env`, el xlsx ni ningún dato personal al repo.
- No escalar a más de 1 réplica.
- No borrar el volumen `agente-charla-data` (contiene inscritos, conversaciones, votos y la memoria del agente).
- No correr `pnpm purgar:personales` hasta después de la charla (borra datos personales de asistentes).
- No cambiar instrucciones, umbrales ni guardrails para que los evals pasen.
