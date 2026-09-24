# Jev · la sala en vivo (extra para la demo)

## Qué es

Es una pantalla nueva para el proyector que muestra, en tiempo real, **qué está preguntando la sala** y **qué tan bien responde el agente**. La dirección es `/panel/jev` y usa la misma contraseña del panel del speaker.

La lectura la hace **Jev**, el modelo «System One» de TypeSafe. Jev no escribe respuestas: lee cada pregunta y cada respuesta del agente y devuelve juicios cortos con su probabilidad. Por ejemplo, ante «¿Cómo aplico guardrails a mi agente de soporte?» devuelve: tema = *Guardrails*, intención = *Aplicarlo a su caso*, confusión = baja, respaldada por las láminas = sí (80 %), valor para la sesión de preguntas = alto.

La pantalla tiene cuatro partes:

| Parte | Qué muestra | Ejemplo |
| --- | --- | --- |
| **Últimas preguntas** (izquierda) | Las 6 preguntas más recientes, con tema, intención, un emoji de confusión y una línea de estado | «¿Qué es un eval?» · Evals · Entender un concepto · 🙂 · ✅ respaldada por las láminas · Jev · 250 ms |
| **De qué habla la sala** | Barras con cuántas preguntas hubo por tema en los **últimos 30 minutos** | Guardrails ▇▇▇ 3 · Evals ▇▇ 2 |
| **Termómetro de confusión** | Promedio de confusión de las últimas 20 preguntas reales y el tema que más confunde | 33 % · Lo que más confunde: Conceptos básicos |
| **Para la sesión de preguntas** | Las 3 preguntas más valiosas para responder en vivo y cuántas parecidas hubo | «¿Cuándo conviene separar en varios agentes?» · Arquitectura · 2 preguntas parecidas |

Líneas de estado de cada tarjeta:

- ✅ **respaldada por las láminas**: lo que dijo el agente sobre la charla está en las láminas que consultó.
- ⚠️ **dijo algo que no está en la charla** (con el porcentaje): Jev cree que la respuesta agregó algo que no aparece en las láminas.
- 📄 **respondió sin consultar las láminas**: ese turno no buscó en las láminas, así que no hay contra qué comparar.
- 🛡 **bloqueada: motivo**: un guardrail detuvo la pregunta (por ejemplo, intento de inyección o fuera de alcance).
- 🔧 **herramienta caída** · 🔁 **respondió el respaldo** · ⛔ **sin modelo**: las mismas fallas que se simulan con los interruptores de caos.

## Cómo funciona (en simple)

1. La página pide datos al servidor cada 3 segundos.
2. En cada pedido, el servidor busca en las trazas del agente los turnos nuevos de las últimas 2 horas (sin las trazas de evals).
3. Por cada turno nuevo hace **una sola llamada a Jev** con cinco preguntas en paralelo, y guarda el resultado en `charla.db` (tabla nueva `jev_analisis`). Un turno nunca se analiza dos veces.
4. Si TypeSafe falla o tarda, la página sigue mostrando lo guardado y avisa «Jev no disponible por ahora». Deja de llamar a TypeSafe 30 segundos y vuelve a intentar.

**No toca el chat.** El análisis corre solo cuando alguien tiene abierta la página de Jev, nunca dentro de la respuesta a un asistente. Si Jev se cae, el chat ni se entera.

**Privacidad.** A TypeSafe solo se envía el texto ya redactado de las trazas (pregunta, respuesta y fragmentos de láminas). Nunca se envían nombres, emails ni quién preguntó. En la base se guarda solo un extracto corto de la pregunta (180 caracteres), sin la respuesta y sin datos del asistente. Los logs nunca incluyen el texto de las preguntas.

## Guion sugerido (1 minuto)

> «Todo lo que ustedes preguntaron hoy quedó trazado. Ahora les muestro algo más: un segundo modelo, Jev, que no conversa, solo **juzga**. Lee cada pregunta y cada respuesta de mi agente y en unos 250 milisegundos me dice de qué tema era, si alguien está confundido y si la respuesta está respaldada por mis láminas.
>
> *(Señalar la izquierda)* Aquí están sus preguntas en vivo. Esta la bloqueó un guardrail; esta la respondió el modelo de respaldo cuando tumbé el principal.
>
> *(Señalar el termómetro)* Este es el termómetro de confusión de la sala: hoy lo que más confunde es *[tema]*.
>
> *(Señalar abajo a la derecha)* Y estas son las tres preguntas que Jev cree que vale la pena responder ahora. Vamos con la primera.»

Truco: para mostrar el ⚠️ o el 🔁 en vivo, activa «Modelo caído» en el panel, haz una pregunta desde tu teléfono y apágalo.

## Para desplegar en Dokploy

- Variable nueva en el servicio **`web`**: `TYPESAFE_API_KEY` (la misma de `.env`). El servicio `studio` no la necesita.
- La migración `005_jev.sql` se aplica sola al arrancar el contenedor (como las anteriores).
- Sin la variable, la página abre igual y muestra «Jev no disponible por ahora».

## Costo y latencia medidos

- **Latencia de Jev:** 250 ms típico por turno (mediana de 258 ms en 30 turnos reales de producción; el primero tardó 680 ms por abrir la conexión). En la prueba local con la app completa, el promedio fue ~590 ms.
- **Tokens:** ~2.400 de entrada por turno (Jev solo cobra la entrada).
- **Costo:** con el precio publicado (USD 0,042 por millón de tokens), cada turno cuesta ~USD 0,0001. Toda la charla (26 asistentes × 30 preguntas ≈ 780 turnos) costaría ~USD 0,08.

## Calidad (prueba con 30 turnos reales de producción)

- **Tema e intención:** acertó en todos los casos revisados (por ejemplo, «Explícame mejor el patrón reflexión» → Patrones agénticos; «Hola» → Otro / Fuera de tema; el intento de inyección → Otro / Fuera de tema).
- **Confusión:** sube donde debe: «Explícame mejor…» ≈ 42 %, «Recuérdamelo…» ≈ 47 %, «No entiendo nada…» ≈ 93 %; preguntas claras ≈ 25 %.
- **Respaldada:** es estricta. Marca ⚠️ cuando la respuesta explica más de lo que dicen los fragmentos de láminas que se consultaron (los fragmentos son cortos). En la prueba, 6 de 19 respuestas quedaron por debajo del 50 %; al revisarlas, sí agregaban explicaciones que no estaban en esos fragmentos. Se ajustó una vez la pregunta para que ignore lo que el propio agente aclara como «esto no está en la charla» (misma regla que el juez de fidelidad).

## Limitaciones

- Jev funciona mejor en inglés; las preguntas y criterios están en inglés y el contenido va en español tal cual. En la prueba funcionó bien, pero conviene revisarlo con el tráfico real de la charla.
- El ⚠️ compara contra los fragmentos que devolvió `buscar_laminas` en ese turno, no contra la lámina completa. Puede marcar como «no está en la charla» algo que sí está en otra parte de la lámina.
- Si nadie tiene abierta la página, no se analiza nada; al abrirla, se analizan hasta 20 turnos por pedido (se pone al día en pocos segundos).
- Los temas cuentan los últimos 30 minutos; las tarjetas, el termómetro y las destacadas usan las últimas 2 horas.
- `pnpm purgar:personales` no borra `jev_analisis` (solo guarda extractos ya redactados, sin datos del asistente).
- No se probó en vivo el modo degradado con TypeSafe caído (sí está cubierto por pruebas automáticas).

## Archivos

- Nuevos: `lib/jev/` (preguntas, turnos, resultado, vista, analizador, servicio + pruebas), `lib/db/jev.ts`, `lib/db/migrations/005_jev.sql`, `app/api/panel/jev/route.ts` (+ prueba), `app/panel/jev/page.tsx`, `components/jev/sala-en-vivo.tsx` (+ prueba).
- Cambios mínimos: enlace «Jev · la sala en vivo» en el encabezado del panel; la prueba de migraciones ahora espera también `005_jev.sql`; dependencia `@typesafe-ai/sdk` 0.6.0.
- Sin cambios: chat, agente, instrucciones, guardrails, scorers, evals, métricas del panel, tablas existentes y `proxy.ts` (ya protegía `/panel/*` y `/api/panel/*`).
