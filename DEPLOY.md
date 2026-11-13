# DEPLOY · Agente de la charla en Google Cloud

Guía para publicar, operar y apagar la demo. Todo corre en Google Cloud: el modelo (Gemini en Vertex AI), los servidores (Cloud Run) y los datos (Cloud SQL para PostgreSQL). Si algo no está aquí, pregunta a Raúl antes de improvisar.

- **Repo:** https://github.com/camarj/agentes-en-produccion-charla
- **Proyecto de Google Cloud:** `eng-particle-514416-q3`, región `us-east1`.
- **Charlas:** ESPOL (2026-11-25) y Google DevFest Guayaquil (2026-12-05, ~1000 personas). Las dos usan **la misma presentación**, la del DevFest: `agentes-produccion-devfest-60min.html`, 25 láminas.
- **Entrada abierta:** cualquier persona que escanee el QR entra con su cuenta de Google. No hay lista de inscritos: la app crea a cada asistente la primera vez que entra.
- **Una sola imagen** (`Dockerfile`), usada por dos servicios: `charla-web` (la app de los asistentes y el panel del speaker) y `charla-studio` (Mastra Studio y la API de Mastra).
- Neon, Dokploy, SQLite (`charla.db`) y `mastra.db` ya **no** se usan.

---

## 1. Qué hay en Google

| Recurso | Nombre | Detalle |
| --- | --- | --- |
| App pública | Cloud Run `charla-web` | `https://charla.codetrain.cloud`. Comando `web`, puerto 8080. 2 CPU, 2 GiB, CPU siempre asignada. **Mínimo 1 y máximo 6 copias, 25 pedidos simultáneos por copia** (ver §7) |
| Studio | Cloud Run `charla-studio` | `https://charla-studio-20032347418.us-east1.run.app`. Comando `studio`. 1 CPU, 1 GiB. Protegido con **IAP**: solo entran las cuentas de Google autorizadas (la lista está en la consola, no en el repo). Se agregan personas en la consola: Seguridad → Identity-Aware Proxy → `charla-studio` → Agregar principal con el rol «Usuario de aplicación web protegida con IAP» |
| Base de datos | Cloud SQL `charla-db` | PostgreSQL 17, `db-custom-1-3840`, `us-east1`, flag `max_connections=200`. Base `charla`, usuario `charla`. Conexión `eng-particle-514416-q3:us-east1:charla-db`. Las tablas de la app van en `public` y las de Mastra (memoria, puntajes, experimentos, trazas) en el esquema `mastra` |
| Imágenes | Artifact Registry `charla` | `us-east1-docker.pkg.dev/eng-particle-514416-q3/charla/app:<sha>` |
| Secretos | Secret Manager | `database-url`, `openai-api-key`, `anthropic-api-key`, `typesafe-api-key`, `panel-password`, `session-secret` |
| Cuenta de servicio | `charla-run@eng-particle-514416-q3.iam.gserviceaccount.com` | La usan ambos servicios: Vertex AI (sin clave, con las credenciales del servicio), Cloud SQL y lectura de secretos |
| Dominio | `charla.codetrain.cloud` | Mapeo de dominio de Cloud Run. En Cloudflare, registro **CNAME** `charla` → `ghs.googlehosted.com`, **sin proxy** (nube gris). El certificado lo gestiona Google |
| Inicio con Google | Cliente OAuth `20032347418-fqc8…apps.googleusercontent.com` | Orígenes autorizados: `https://charla.codetrain.cloud` y `http://localhost:3001` |

Conexiones a la base: cada copia usa hasta 10 (app) + 10 (Mastra). Con 6 copias de `web` y Studio son 140 como máximo, debajo de las 200 de Cloud SQL. Si subes el máximo de copias, revisa esta cuenta.

---

## 2. Variables de entorno

Los secretos viven en Secret Manager. **Nunca** los pongas en el repo, en logs ni en el chat.

| Variable | Servicio | Para qué | Valor |
| --- | --- | --- | --- |
| `DATABASE_URL` | ambos | Base de la app y de Mastra. Las migraciones se aplican al arrancar, con un cerrojo consultivo: varias copias a la vez no chocan | secreto `database-url`: `postgres://charla:<clave>@/charla?host=/cloudsql/eng-particle-514416-q3:us-east1:charla-db` |
| `GOOGLE_VERTEX_PROJECT` | ambos | Gemini `gemini-3.8-flash` en Vertex AI | `eng-particle-514416-q3` |
| `GOOGLE_VERTEX_LOCATION` | ambos | Región de Vertex | `global` |
| `OPENAI_API_KEY` | ambos | Modelo de respaldo, guardia, jueces y dictado por voz | secreto `openai-api-key` |
| `ANTHROPIC_API_KEY` | ambos | Respaldo del guardia y de los jueces | secreto `anthropic-api-key` |
| `TYPESAFE_API_KEY` | `web` | Análisis de la sala (Jev) | secreto `typesafe-api-key` |
| `PANEL_PASSWORD` | `web` | Contraseña de `/panel` | secreto `panel-password` |
| `SESSION_SECRET` | `web` | Firma de la cookie de sesión. Cambiarlo cierra todas las sesiones | secreto `session-secret` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | `web` | Botón «Entrar con Google». Va como **argumento de build** (lo pone `cloudbuild.yaml`) y como variable | el ID de cliente OAuth |
| `NEXT_PUBLIC_PRESENTACION` | build | Presentación activa (partes de la charla y preguntas sugeridas, `lib/tramos.ts`): `devfest` (por defecto, la de las dos charlas) o `espol` (presentación anterior). Solo es **argumento de build** | `cloudbuild.yaml` → `_PRESENTACION` |
| `STUDIO_URL` | `web` | Enlace «Abrir Mastra Studio» y «ver traza» del panel | la URL de Studio |
| `PRESUPUESTO_MAX_USD` | `web` | Tope de gasto. Al alcanzarlo el chat se pausa solo | `120` |
| `MAX_MENSAJES_ASISTENTE` | `web` | Tope de preguntas por persona | `15` |
| `ESPERA_PRIMER_TROZO_MS` | `web` | Plan B por tiempo: si Gemini no empieza a responder en este plazo, se reintenta y luego responde el respaldo. Opcional | por defecto `15000` |
| `MASTRA_ESQUEMA`, `EVALS_MASTRA_ESQUEMA`, `EVALS_LAMINAS_HTML` | — | **No ponerlas**: solo pruebas locales | — |

Cambiar una variable no exige construir la imagen otra vez:

```bash
gcloud run services update charla-web --region=us-east1 --project=eng-particle-514416-q3 \
  --update-env-vars=PRESUPUESTO_MAX_USD=150
```

---

## 3. Publicar una versión nueva

1. Corre las pruebas en local: `pnpm test`, `pnpm lint`, `pnpm exec next typegen && pnpm exec tsc --noEmit`.
2. Construye la imagen en Cloud Build (tarda unos 4 minutos). La etiqueta es el commit:
   ```bash
   T=$(git rev-parse --short HEAD)
   gcloud builds submit --config cloudbuild.yaml \
     --substitutions=_TAG=$T \
     --project=eng-particle-514416-q3 .
   ```
   Sin `_PRESENTACION` se construye con la presentación del DevFest (ver §5).
3. Publica la misma imagen en los dos servicios:
   ```bash
   I=us-east1-docker.pkg.dev/eng-particle-514416-q3/charla/app:$T
   gcloud run deploy charla-web    --image=$I --region=us-east1 --project=eng-particle-514416-q3 --quiet
   gcloud run deploy charla-studio --image=$I --region=us-east1 --project=eng-particle-514416-q3 --quiet
   ```
   `gcloud run deploy` conserva las variables, secretos, la conexión a Cloud SQL y la escala del servicio.
4. Comprueba:
   - `https://charla.codetrain.cloud/` → 200.
   - `https://charla.codetrain.cloud/api/sesion` → `{"autenticado":false,...}`.
   - `https://charla.codetrain.cloud/panel` sin contraseña → 401.
   - Studio en el navegador → pide la cuenta de Google y luego muestra el agente `charla`.
   - Una pregunta real: responde y en el panel aparece «Gemini 3.8 Flash».

Recrear un servicio desde cero, solo si se borró. Los valores son los de §1 y §2:

```bash
gcloud run deploy charla-web --image=$I --region=us-east1 --project=eng-particle-514416-q3 \
  --service-account=charla-run@eng-particle-514416-q3.iam.gserviceaccount.com \
  --add-cloudsql-instances=eng-particle-514416-q3:us-east1:charla-db \
  --args=web --port=8080 --cpu=2 --memory=2Gi --no-cpu-throttling \
  --min-instances=1 --max-instances=6 --concurrency=25 --allow-unauthenticated \
  --set-env-vars=GOOGLE_VERTEX_PROJECT=eng-particle-514416-q3,GOOGLE_VERTEX_LOCATION=global,MAX_MENSAJES_ASISTENTE=15,PRESUPUESTO_MAX_USD=120,NEXT_PUBLIC_GOOGLE_CLIENT_ID=<id>,STUDIO_URL=<url-studio> \
  --set-secrets=DATABASE_URL=database-url:latest,OPENAI_API_KEY=openai-api-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,TYPESAFE_API_KEY=typesafe-api-key:latest,PANEL_PASSWORD=panel-password:latest,SESSION_SECRET=session-secret:latest
```

---

## 4. Trabajar con la base desde tu computadora

Los scripts (`importar:*`, `reiniciar:charla`, `carga`, `purgar:personales`, `evals`) corren en local contra Cloud SQL a través del proxy oficial.

1. Abre el túnel y déjalo abierto en otra terminal:
   ```bash
   cloud-sql-proxy --gcloud-auth --port 54329 eng-particle-514416-q3:us-east1:charla-db
   ```
   Si la terminal dice `command not found`, el programa viene con `gcloud` pero no está en el PATH: usa `/opt/homebrew/share/google-cloud-sdk/bin/cloud-sql-proxy` (o instálalo con `gcloud components install cloud-sql-proxy`).
2. En la terminal de trabajo, carga la URL de la base y la clave de sesión **sin imprimirlas**:
   ```bash
   U=$(gcloud secrets versions access latest --secret=database-url --project=eng-particle-514416-q3)
   export DATABASE_URL=$(printf '%s' "$U" | sed -E 's#@/charla\?host=.*$#@127.0.0.1:54329/charla#')
   export SESSION_SECRET=$(gcloud secrets versions access latest --secret=session-secret --project=eng-particle-514416-q3)
   ```
3. Antes de cualquier cambio de datos que no se pueda deshacer, haz un respaldo:
   ```bash
   gcloud sql backups create --instance=charla-db --project=eng-particle-514416-q3
   ```

**Láminas.** Las presentaciones están en la raíz del repo:

```bash
pnpm importar:laminas agentes-produccion-devfest-60min.html   # esperado: 25 láminas
```

Importar agrega o actualiza láminas, pero **no borra** las que sobran. Si la presentación nueva tiene menos láminas, borra primero las sobrantes (`DELETE FROM laminas WHERE numero > N`) y luego importa.

**Poner el panel en cero antes de la charla:** `pnpm reiniciar:charla` simula y muestra qué borraría; `pnpm reiniciar:charla --si` lo aplica. Detalle en `REINICIO-CHARLA.md`.

---

## 5. Presentación de las charlas

Decisión del 2026-11-13: **la presentación del DevFest se usa también en ESPOL**. Es la que va por defecto en la imagen (`_PRESENTACION=devfest`) y la que está cargada en la base: 25 láminas, partes «Conceptos» (1–8), «Decisión y diseño» (9–17) y «En producción» (18–25).

Para comprobarlo:

1. En el panel, la tarjeta «Tramo de la presentación» muestra «Láminas 1–8 · Conceptos», «Láminas 9–17 · Decisión y diseño» y «Láminas 18–25 · En producción».
2. Con el túnel abierto (§4): `SELECT count(*), max(numero) FROM laminas;` → `25 | 25`.

Si cambias la presentación otra vez:

1. Construye con `_PRESENTACION=<devfest|espol>` y publica en ambos servicios (§3).
2. Con el túnel abierto, haz un respaldo, borra las láminas que sobren (`DELETE FROM laminas WHERE numero > N`, con N = láminas de la presentación nueva) e importa su HTML con `pnpm importar:laminas`.
3. Ajusta los números de lámina del dataset de evals (`evals/`) antes de correr evals: hoy usan su propia copia de una presentación anterior de 40 láminas, en un esquema temporal, y no dependen de la que está cargada.

---

## 6. Evals

Corren en local con el túnel abierto (§4). Cada corrida tarda unos 3 a 4 minutos y cuesta unos USD 0.20.

```bash
pnpm evals
```

- Usan un esquema temporal propio (`evals_*`) dentro de la misma base, que se borra al terminar: no tocan asistentes, interruptores ni el gasto real. Sus trazas llevan `origen: eval` y el panel no las cuenta.
- **La demo muestra el veredicto tal como salga, aunque sea `failed`** (PRD §11). No ajustes instrucciones, umbrales ni guardrails para que pase.
- En Studio → Datasets → `charla-v1` → Experiments aparecen las corridas. Marca dos y usa Compare.
- Experimentos de la iteración del 2026-09-25: `pnpm importar:experimentos evals/experimentos/iteracion-2026-09-25.json` simula, y `--si` aplica (con respaldo previo). Si la simulación muestra conflictos mayores que 0, no apliques.

---

## 7. Prueba de carga y escala

Resultados del 2026-11-12 (detalle en `odd/tasks/google-cloud-todo.md`, entradas L6 a L10):

- **Sin IA** (interruptor `kill_switch` encendido, el chat responde «mantenimiento»): 1000 personas a la vez → 0 errores con hasta 3 o más copias. Con una sola copia, Google rechazaba entre el 10 y el 30 % de los pedidos en picos de 300 o más.
- **Con IA**, 100 preguntas en el mismo segundo: primer texto p50 10 s y p95 32 s; respuesta completa p95 38 s; 0 cortes por tiempo. Una pregunta sola tarda unos 4 s. La espera bajo carga es de Gemini (capacidad compartida de Google), no de la app ni de la base.

Cómo repetirla con el túnel abierto (§4). Cada 100 preguntas con IA cuestan unos USD 0.50:

```bash
pnpm carga --url https://charla.codetrain.cloud --asistentes 100 --preguntas 1 --limpiar
```

El script crea las sesiones directo en la base. Con más de unas 100 personas, tu computadora no alcanza a crearlas todas a la vez; prepara las sesiones por grupos antes de medir. Después de la prueba, `pnpm reiniciar:charla --si` deja el panel en cero.

---

## 8. Volver a una versión anterior

Cada publicación crea una revisión. Para volver a una anterior sin construir nada:

```bash
gcloud run revisions list --service=charla-web --region=us-east1 --project=eng-particle-514416-q3
gcloud run services update-traffic charla-web --to-revisions=<revision>=100 --region=us-east1 --project=eng-particle-514416-q3
```

Haz lo mismo con `charla-studio` si hace falta. Los datos viven en Cloud SQL, así que no se pierden al cambiar de revisión. Para recuperar datos, restaura un respaldo de Cloud SQL (consola → SQL → `charla-db` → Respaldos).

---

## 9. Apagar todo después del DevFest

Hoy cuesta unos USD 70 al mes, sobre todo Cloud SQL y la copia mínima de `charla-web`. Después del 2026-12-05:

1. `pnpm purgar:personales` con el túnel abierto, para cumplir la política de privacidad (nombres y correos fuera en ≤ 30 días).
2. Exporta lo que quieras conservar (trazas o experimentos) y haz un respaldo final.
3. Baja los servicios a cero copias o bórralos:
   ```bash
   gcloud run services update charla-web --min-instances=0 --region=us-east1 --project=eng-particle-514416-q3
   ```
4. Detén la base (deja de cobrar CPU, pero sigue cobrando el disco) o bórrala:
   ```bash
   gcloud sql instances patch charla-db --activation-policy=NEVER --project=eng-particle-514416-q3
   ```

---

## 10. Lo que NO hay que hacer

- No subir `.env` ni ningún dato personal al repo.
- No subir el máximo de copias de `charla-web` por encima de 6 sin revisar las conexiones de la base (§1).
- No conectarse a la base de producción para pruebas automáticas: los tests usan PGlite y las sondas usan un Postgres local.
- No correr `pnpm purgar:personales` antes de la charla. Para dejar el panel en cero usa `pnpm reiniciar:charla`.
- No cambiar instrucciones, umbrales ni guardrails para que los evals pasen.
- No activar el proxy de Cloudflare (nube naranja) en `charla.codetrain.cloud`: rompe el certificado de Google.
