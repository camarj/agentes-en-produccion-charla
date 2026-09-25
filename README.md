# Agente demo · «Cómo lograr que tus agentes sobrevivan a producción»

Este repositorio es el **agente de chat que el público usa durante la charla** de Raúl Camacho ([Inteliside](https://inteliside.com)). También es la **demo en vivo** del final.

La idea es simple: en lugar de explicar con ejemplos inventados cómo se lleva un agente de IA a producción, la charla lo muestra con un agente real, que usa la gente que está en la sala. Cada pregunta que hace el público queda trazada, evaluada y protegida, y al final se abren esos datos frente a todos.

> **En una frase:** la charla enseña un método, y este demo es ese método aplicado de punta a punta, con tráfico real de la sala.

---

## La charla en 1 minuto

La presentación tiene 40 láminas en tres tramos:

| Tramo | Láminas | De qué trata |
| --- | --- | --- |
| **Conceptos** | 1–13 | Qué es un agente (y qué no), qué es un LLM, el *loop* agéntico y el *harness* que lo controla |
| **Decisión y diseño** | 14–32 | ¿De verdad necesito un agente? Del PRD al comportamiento, factores de arquitectura, patrones (ReAct, planificador, reflexión, varios agentes…) e implementación |
| **En producción** | 33–40 | Resiliencia, salvaguardas (*guardrails*), evaluaciones («¿lo hizo bien?»), observabilidad («¿qué ocurrió y por qué?»), el lanzamiento, la demo y las preguntas |

La tesis: **un agente sobrevive a producción cuando se diseña, se evalúa, se observa y se protege con método**, no cuando «funciona en mi computadora».

---

## Cómo el demo prueba lo que dice la charla

Cada idea de la charla tiene algo concreto en el demo que se puede señalar en la pantalla.

| Lo que dice la charla | Lámina | Cómo lo demuestra el demo | Dónde se ve |
| --- | --- | --- | --- |
| Usa un agente solo si el camino es variable | 15–16 | Las preguntas del público son abiertas, así que decide un agente. Lo que tiene pasos fijos (entrar con el email, límites, pausa) es código normal, sin IA | [PRD §2](<PRD · Agente demo «Cómo lograr que tus agentes sobrevivan a producción».md>) |
| Del PRD al comportamiento | 17 | Primero se escribió un PRD. De él salió un **contrato** (qué hace, qué no hace, cuándo termina y cuándo escala) y de ese contrato, las instrucciones del agente | [PRD §9](<PRD · Agente demo «Cómo lograr que tus agentes sobrevivan a producción».md>) |
| Elige un patrón y un marco con *harness* | 19–32 | Es **un solo agente con herramientas** (patrón ReAct), construido con [Mastra](https://mastra.ai), que ya trae memoria, trazas y evaluaciones | `src/mastra/` |
| Resiliencia | 33 | Si la búsqueda en las láminas falla, reintenta y luego escala. Si el modelo principal cae, responde el de respaldo. Si caen los dos, muestra un aviso amable. Y hay un botón para pausar todo | Panel del speaker → interruptores de caos |
| Salvaguardas | 34 | Cada pregunta pasa por detectores de inyección y de temas fuera de la charla, que la cortan si hace falta. Las respuestas nunca muestran emails ni datos de otros asistentes | Panel → «Bloqueos de guardrails» |
| ¿Lo hizo bien? (evals) | 35 | Un dataset de **40 casos**, uno por cada línea del contrato y cada salvaguarda. El veredicto se muestra **tal como sale, aunque sea `failed`**: en Studio se ve cómo el agente mejoró al iterar (de 27/40 a 32/40 el día antes de la charla) sin bajar la vara. Mientras dura la charla, además, unos jueces automáticos califican las respuestas reales | Mastra Studio → Datasets / Experiments |
| ¿Qué ocurrió y por qué? (observabilidad) | 36 | Cada pregunta deja una **traza** con el modelo, las herramientas que usó, la latencia, el coste y los bloqueos | Mastra Studio → Traces |
| Antes, durante y después | 37 | Antes, las evals. Durante, métricas en vivo y la pantalla **Jev**, que lee lo que pregunta la sala. Después, el plan del PRD es convertir las respuestas con voto negativo en casos nuevos del dataset | Panel y `/panel/jev` |

---

## Si eres asistente: cómo se usa

1. **Escanea el QR** que aparece en la presentación. Se abre el chat en tu teléfono.
2. **Escribe tu email**, el mismo con el que te inscribiste. Si no estás inscrito, también puedes entrar: te pedirá tu nombre.
3. **Cuéntale a qué te dedicas** y qué construyes o quieres construir con IA. El agente usa eso para darte ejemplos a tu medida. Por ejemplo, a una contadora le habla de conciliaciones y a un desarrollador, de APIs.
4. **Pregunta lo que quieras sobre la charla.** Arriba verás 3 preguntas sugeridas según la parte de la charla en la que vamos. También puedes **dictar** tu pregunta con el micrófono.
5. **Vota** las respuestas con 👍 o 👎. Esos votos se ven en la demo final.

**Preguntas frecuentes**

- **¿Qué puede responder?** Todo lo de la presentación y los conceptos de IA necesarios para entenderla. Cita la lámina de donde saca cada respuesta. Si algo no está en la charla, te lo dice.
- **¿Y si pregunto algo personal o comercial?** Por ejemplo, «¿cuánto cobra Inteliside?». El agente no lo inventa: pasa la pregunta a Raúl para la sesión de preguntas y te avisa.
- **¿Qué pasa con mis datos?** Tu email y tu nombre **nunca** aparecen en las trazas ni en la pantalla. Las métricas solo ven tu rol de forma anónima. Después de la charla, los datos personales se borran.
- **¿Hay límite?** Sí: 30 preguntas por persona, para cuidar el presupuesto.
- **Dice «el asistente está en pausa».** Raúl lo pausó a propósito, quizá para mostrar el *kill switch*. Tu pregunta queda guardada y se envía sola cuando vuelva.

---

## Si eres el speaker: las pantallas de la demo

| Pantalla | Dirección | Para qué |
| --- | --- | --- |
| **Chat** | `/` | Lo que usa el público |
| **Panel del speaker** | `/panel` (con contraseña) | Métricas en vivo, tramo de la charla, interruptores de caos, kill switch y cola de preguntas escaladas |
| **Jev · la sala en vivo** | `/panel/jev` | Un segundo modelo ([TypeSafe](https://typesafe.ai) System One) que **juzga** cada pregunta: de qué tema es, qué tan confundida está la sala y cuáles vale la pena responder en vivo. Explicación en [JEV.md](.claude/sessions/JEV.md) |
| **Página del QR** | `/qr` | El QR en grande, con ayuda para quien no logra entrar |
| **Mastra Studio** | servicio aparte | Trazas, evals y experimentos: el «detrás de escena» |

**Interruptores de caos** (en el panel, todos apagados por defecto):

- **Herramienta caída:** la búsqueda en las láminas falla, y se ven los reintentos y el escalamiento.
- **Latencia alta:** cada búsqueda tarda 8 s más, para mostrar el tiempo límite.
- **Modelo caído:** falla el modelo principal y responde el de respaldo.
- **Modelos caídos:** fallan los dos, y se ve el aviso amable y la falla registrada.
- **Kill switch:** pausa el chat para todos.

> Truco para la demo: activa «Modelo caído», haz una pregunta desde tu teléfono y apágalo. La tarjeta «Modelo en uso» y Jev muestran el cambio.

---

## Cómo correrlo en tu computadora

### Lo que necesitas

- **Node.js 22** o superior
- **pnpm**: se activa con `corepack enable`, porque el proyecto fija su versión
- Una clave de **OpenAI** (modelo principal) y otra de **Anthropic** (modelo de respaldo)
- Opcional: una clave de **TypeSafe**, para la pantalla Jev

### Paso a paso

```bash
# 1. Instalar dependencias
pnpm install

# 2. Crear el archivo .env (ver la tabla de abajo)

# 3. Preparar la base de datos local (data/charla.db)
pnpm db:migrate

# 4. Cargar las láminas de la presentación
pnpm importar:laminas agentes-produccion-taller-v43-before-slide14-v2.html

# 5. (Opcional) Cargar inscritos desde un Excel o CSV.
#    Sin este paso igual puedes entrar como invitado.
pnpm importar:inscritos ruta/a/inscritos.xlsx

# 6. Arrancar la app
pnpm dev
```

Luego abre:

- **http://localhost:3000**: el chat. Entra con cualquier email; si no está inscrito, entras como invitado.
- **http://localhost:3000/panel**: el panel. Cualquier usuario sirve; la contraseña es `PANEL_PASSWORD`.
- **http://localhost:3000/panel/jev**: Jev.
- Para ver trazas y evals, en otra terminal corre `pnpm mastra:studio` y abre **http://localhost:4111**.

### Variables del `.env` para trabajar en local

| Variable | ¿Obligatoria? | Para qué |
| --- | --- | --- |
| `OPENAI_API_KEY` | Sí | Modelo principal, guardrails, jueces y dictado por voz |
| `ANTHROPIC_API_KEY` | Sí | Modelo de respaldo |
| `SESSION_SECRET` | Sí | Firma la cookie de sesión (16 caracteres o más) |
| `PANEL_PASSWORD` | Sí | Contraseña del panel del speaker |
| `TYPESAFE_API_KEY` | No | Pantalla Jev. Sin ella, Jev muestra «no disponible» y lo demás funciona |
| `OBSERVABILIDAD_DATABASE_URL` | No | Postgres (Neon) para las trazas. Sin ella, todo se guarda en `data/mastra.db` |
| `PRESUPUESTO_MAX_USD` | No | Tope de gasto: al alcanzarlo, el chat se pausa solo |
| `STUDIO_URL` | No | Enlace «Abrir Mastra Studio» del panel |

La lista completa para producción está en [DEPLOY.md §3](DEPLOY.md#3-variables-de-entorno). **Nunca subas el `.env` al repositorio.**

### Comandos útiles

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Arranca la app en `http://localhost:3000` |
| `pnpm mastra:studio` | Arranca Mastra Studio en `http://localhost:4111` |
| `pnpm test` | Corre las pruebas automáticas (más de 900) |
| `pnpm evals` | Corre el dataset de 40 casos contra el agente y da un veredicto (`passed` o `failed`); sale con error si no pasa los mínimos. Detalle en [evals/README.md](evals/README.md) |
| `pnpm reiniciar:charla` | Deja el panel y Jev en cero antes de la charla, sin borrar inscritos, láminas ni evals. Ver [REINICIO-CHARLA.md](REINICIO-CHARLA.md) |
| `pnpm purgar:personales` | **Después** de la charla: borra todos los datos personales |

---

## Documentos importantes

Así se pasó de la idea al agente en producción, en el mismo orden que enseña la charla:

| Documento | Qué contiene |
| --- | --- |
| [PRD del agente demo](<PRD · Agente demo «Cómo lograr que tus agentes sobrevivan a producción».md>) | **El punto de partida** (versión 2.0, al día). Problema, usuarios, objetivos, decisión «agente o workflow», requerimientos, **contrato de comportamiento** (§9), resiliencia y salvaguardas (§10), evals y observabilidad (§11), el guion de la demo (§12) y el **registro de cambios de requisitos** (§15): qué cambió durante la implementación y por qué |
| [Tareas de implementación T01–T14](.claude/tasks/) | Los requerimientos del PRD convertidos en 14 tareas pequeñas, cada una con su checklist. Van de la base de datos (T02) al agente (T05), los guardrails (T06), las evals (T13) y el despliegue (T14) |
| [Notas de cada tarea](.claude/sessions/) | Qué se hizo en cada tarea y en qué se desvió del plan, con el motivo |
| [Dataset de evals](evals/README.md) | Los 40 casos, cómo se califican y cómo leer los resultados |
| [Instrucciones del agente](src/mastra/agents/instructions.ts) | El «prompt» que resulta del contrato |
| [Guía de despliegue](DEPLOY.md) | Cómo se publica en Dokploy: servicios, variables, dominios, evals en producción y prueba de carga |
| [Reinicio para la charla](REINICIO-CHARLA.md) | Cómo dejar los paneles en cero después del ensayo, sin romper nada |
| [Jev · la sala en vivo](.claude/sessions/JEV.md) | Qué muestra la pantalla Jev, cómo funciona y un guion de 1 minuto |
| [La presentación](agentes-produccion-taller-v43-before-slide14-v2.html) | Las 40 láminas; ábrela en el navegador |

---

## Cómo está hecho (para curiosos)

| Pieza | Tecnología |
| --- | --- |
| Aplicación web | Next.js 16, TypeScript, Tailwind CSS, shadcn/ui |
| Agente, memoria, evals y trazas | [Mastra](https://mastra.ai) |
| Modelos | Principal `openai/gpt-6-luna` y respaldo `anthropic/claude-sonnet-5` |
| Datos | SQLite (`data/charla.db` y `data/mastra.db`) y búsqueda en las láminas con SQLite FTS5, sin embeddings |
| Trazas en producción | Postgres en Neon |
| Despliegue | Dokploy: un servicio para la app y otro para Studio, con un volumen compartido |

**Dónde está cada cosa:**

```
app/              pantallas y API (chat, panel, Jev, QR)
components/       piezas visuales (chat, panel, Jev)
src/mastra/       el agente: instrucciones, herramientas, guardrails, jueces y trazas
lib/              base de datos, sesión, métricas del panel, Jev
evals/            dataset de 40 casos y el programa que los corre
scripts/          importar láminas e inscritos, reiniciar y purgar datos
```

---

## Privacidad

- Los emails y nombres de los asistentes **nunca** se guardan en trazas ni en logs. Un filtro los quita antes de guardar cualquier cosa.
- El agente solo usa el nombre de pila para saludar, y el rol para adaptar los ejemplos.
- Nada de los datos personales está en este repositorio.
- Después de la charla, `pnpm purgar:personales` borra a los asistentes, sus sesiones, votos y preguntas.

---

Hecho por **Raúl Camacho** · [Inteliside](https://inteliside.com) · Guayaquil, Ecuador.
