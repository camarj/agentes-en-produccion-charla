# T11 · UI de chat

**Objetivo:** Construir la interfaz de chat mobile-first con las convenciones de Claude y ChatGPT: streaming, composer fijo, scroll inteligente, acciones por respuesta y todos los estados de error.

**Cubre:** RF-03, RF-08, RF-09, RF-12, RF-13, usabilidad (PRD §8).

## Archivos
- `components/chat/chat.tsx` — contenedor con `useChat` (`@ai-sdk/react`), transporte a `/api/chat`
- `components/chat/cabecera.tsx`
- `components/chat/lista-mensajes.tsx`
- `components/chat/mensaje-usuario.tsx`, `mensaje-asistente.tsx`
- `components/chat/composer.tsx`
- `components/chat/estado-vacio.tsx`
- `components/chat/indicadores.tsx` — pensando, usando herramienta
- `components/chat/banners.tsx` — sin conexión, mantenimiento, tope
- `hooks/use-auto-scroll.ts`, `hooks/use-visual-viewport.ts`

## Layout
- Contenedor `h-dvh flex flex-col`. Cabecera fija 56 px; lista con scroll propio; composer fijo abajo.
- Ancho de lectura máx. 720 px centrado en escritorio; en móvil, padding lateral 16 px.
- `padding-bottom` del composer = `env(safe-area-inset-bottom)`. Con teclado abierto, usar `visualViewport` para que el composer quede pegado al teclado sin saltos.

## Elementos
1. **Cabecera:** título corto "Agentes en producción" y menú con "Nueva conversación" (crea hilo nuevo) y "Cómo funciona" (diálogo breve: qué hace, que puede equivocarse, que usamos su email solo para personalizar).
2. **Estado vacío:** "Hola, {nombre_pila}." y 3 chips de `/api/sugerencias` que envían al tocar.
3. **Mensaje del usuario:** burbuja a la derecha, `--surface` con borde `--border`, radio 18 px, ancho máx. 85 %.
4. **Mensaje del asistente:** sin burbuja, ancho completo, Markdown con `react-markdown` + `remark-gfm` (listas, negritas, código). Los textos "lámina N" se renderizan como chip mono pequeño.
5. **Acciones por respuesta** (al terminar el stream): copiar (con confirmación "Copiado"), pulgar arriba, pulgar abajo. Envían `/api/feedback` con el `trace_id` de los metadatos; el botón elegido queda marcado.
6. **Composer:** textarea autoajustable de 1 a 6 líneas, placeholder "Pregunta sobre la charla…", contador visible desde 800/1.000. En escritorio Enter envía y Shift+Enter hace salto; en móvil Enter hace salto y se envía con el botón. Botón circular de enviar con acento; durante el stream se convierte en "detener" (`stop()`).
7. **Indicadores:** antes del primer token, tres puntos animados; si hay una llamada de herramienta en curso, "Buscando en las láminas…"; si escala, "Enviando tu pregunta a Raúl…".
8. **Scroll:** seguir el stream solo si el usuario estaba a menos de 80 px del final; si subió, mostrar botón flotante "↓" para ir al final.

## Estados
| Estado | Comportamiento |
| --- | --- |
| Stream interrumpido | Mensaje parcial + "Se interrumpió la respuesta" + botón Reintentar |
| 423 mantenimiento | Banner superior; composer deshabilitado; reintento automático cada 20 s |
| 429 tope | Mensaje del servidor; composer deshabilitado |
| 429 frecuencia | Toast "Vas muy rápido, espera unos segundos" |
| Sin conexión | Banner "Sin conexión" con `navigator.onLine`; reenviar al volver |
| 401 | Volver a la pantalla de entrada |

## Hidratación
Al montar, cargar `/api/chat/historial` y pasarlo como mensajes iniciales.

## Checklist
- [ ] En un teléfono real (iOS y Android) el composer queda sobre el teclado y no hay saltos de layout — *Sin verificar en teléfono real. Emulado en Chromium (táctil, 360 × 640, teclado simulado achicando la vista a 330 px): el composer queda abajo y visible. Falta probar en un iPhone y un Android reales.*
- [x] Streaming fluido; el botón detener corta la respuesta
- [x] Si subo durante el stream, la vista no me arrastra al final
- [x] Copiar y feedback funcionan y el feedback aparece en Studio — *Desvío (Raúl, 2026-09-23): `@mastra/libsql` no guarda feedback, así que el voto no aparece en Studio. Se guarda en la tabla `feedback` de `charla.db` (verificado en vivo) y lo muestra el panel de T12.*
- [x] Todos los estados de la tabla se pueden provocar y se ven bien — *429 frecuencia y stream interrumpido se provocaron en vivo interceptando la respuesta con la misma forma que envía el servidor; el resto, con el servidor real.*
- [x] `aria-live="polite"` en la zona de respuesta; objetivos táctiles ≥ 44 px; `prefers-reduced-motion` respeta animaciones
- [x] Recargar conserva la conversación

## Notas
- Reservar un espacio a la derecha del composer para el botón de voz de la fase 2 (no implementarlo).
