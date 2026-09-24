# PWA · Instalar el chat en el teléfono — sesión 2026-09-23

## En pocas palabras
Quien entra por el QR ahora puede **dejar el chat en la pantalla de inicio de su teléfono**, como si fuera una app: ícono propio, se abre a pantalla completa y sin la barra del navegador.

- **Android (Chrome, Edge, Samsung Internet):** bajo la cabecera del chat aparece una franja discreta: «Tenla a mano durante la charla.» con el botón **«Instalar app»**. Al tocarlo se abre el diálogo de instalación del propio teléfono. También está en el menú ⋮ como «Instalar app».
- **iPhone / iPad:** Apple no deja que una página abra un diálogo de instalación. Por eso la franja explica cómo hacerlo: «Para tenerla a mano: toca Compartir y luego «Agregar a inicio».», con el ícono de Compartir (el cuadrito con la flecha hacia arriba). En el menú ⋮ aparece «Agregar a inicio», que muestra la misma explicación.
  - En Chrome, Firefox o Edge para iPhone el texto dice «toca Compartir **en tu navegador**…», porque ahí el botón de Compartir está en otro lugar.
  - Dentro de Instagram, Facebook u otras apps con navegador propio no se ofrece nada: desde ahí no se puede agregar a inicio.
- **Computadora:** no se muestra nada.
- **Ya instalada** (se abrió desde el ícono): no se muestra nada.
- **«Ahora no» (la X):** la franja desaparece y no vuelve a salir en ese teléfono. La opción sigue disponible en el menú ⋮, por si la persona cambia de idea.

Ejemplo: Andrea escanea el QR en su iPhone, escribe su correo y llega al chat. Arriba ve la franja con la instrucción. Toca Compartir → «Agregar a inicio» y en su pantalla aparece el ícono negro con el círculo celeste. Durante la charla lo abre desde ahí, sin buscar la pestaña del navegador.

La franja **nunca tapa el cuadro de texto**: ocupa su propia fila debajo de la cabecera, y el ajuste del teclado del iPhone (`use-visual-viewport`) no cambió.

## Hecho
- `app/manifest.ts`: la «ficha» de la app que leen los teléfonos. Nombre «Agentes en producción · Charla», nombre corto «Agentes», abre en `/`, modo app (`standalone`), fondo y color del tema negros, idioma `es`, íconos 192, 512 y 512 «maskable» (Android lo recorta en círculo o gota sin cortar el dibujo). Next la sirve en `/manifest.webmanifest`.
- **Íconos** (no había marca): fondo negro y un «loop de agente» (flecha circular con un punto al centro) en el celeste de acento. Se generan con `pnpm iconos` (`scripts/generar-iconos.ts`, usa `ImageResponse` de `next/og`, que ya estaba instalado) y quedan en el repo:
  - `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`;
  - `app/apple-icon.png` (180 × 180, el ícono del iPhone);
  - `app/icon.svg`: reemplaza el favicon por defecto de Next (se borró `app/favicon.ico`).
- `public/sw.js` (service worker, un pequeño programa que el navegador guarda para la app). Es mínimo a propósito:
  - **Nunca toca `/api/*`** (chat, sesión, perfil, sugerencias, feedback) **ni `/panel`**: esas peticiones van directo al servidor, como si el service worker no existiera.
  - Las páginas siempre vienen del servidor. **Sin conexión**, en vez del dinosaurio del navegador se ve `public/offline.html`: «Sin conexión. Vuelve a intentarlo cuando tengas señal.» con un botón «Reintentar».
  - Solo guarda los archivos estáticos de Next con huella (`/_next/static/…`) y los íconos, que nunca cambian de contenido.
  - Para publicar un cambio del propio service worker, se sube `VERSION` en `sw.js` y la caché vieja se borra sola.
- `components/pwa/registro-pwa.tsx` (en el layout): registra el service worker **solo en producción** y guarda el aviso de instalación de Android desde que carga la página (puede llegar mientras la persona todavía escribe su correo).
- `lib/pwa.ts`: detecta la plataforma (Android con aviso, iPhone Safari, iPhone con otro navegador, ya instalada, computadora), abre el diálogo de instalación y recuerda el «Ahora no» en `localStorage` (con `try/catch`: en modo privado funciona igual y solo se oculta en esa visita).
- `components/chat/instalacion.tsx`: la franja. `cabecera.tsx`: la opción del menú y el diálogo «Agregar a inicio». `chat.tsx`: monta la franja bajo la cabecera.
- `app/layout.tsx`: nombre de la app, título bajo el ícono del iPhone («Agentes») y barra de estado negra (`apple-mobile-web-app-status-bar-style: black`). `theme-color` negro ya estaba.
- `next.config.ts`: cabeceras para `/sw.js`, como indica la guía de PWA de Next 16: sin caché (`no-cache, no-store, must-revalidate`), tipo JavaScript y política de seguridad `default-src 'self'; script-src 'self'`.
- `package.json`: nuevo comando `pnpm iconos`. Sin dependencias nuevas.
- `/panel` y `proxy.ts` no se tocaron: el panel sigue pidiendo usuario y contraseña (medido: 401 sin credenciales).

## Decisiones (y por qué)
1. **Barra de estado `black` y no `black-translucent`.** Con `black-translucent` la página se dibuja debajo de la hora y la batería, y habría que bajar la cabecera con `safe-area-inset-top` en el chat y en las pantallas de acceso. Con fondo negro, `black` se ve igual y el contenido empieza debajo de la barra. Las zonas seguras de abajo (`env(safe-area-inset-bottom)`) siguen como estaban.
2. **La franja aparece solo en el chat**, no en la pantalla del correo, para no competir con el primer paso.
3. **Tras «Ahora no», la opción sigue en el menú.** Así no molesta, pero quien cambie de idea la encuentra.
4. **En la computadora no se ofrece instalar**, aunque Chrome lo permita: el público entra desde el teléfono.
5. **Texto para iPhone con Chrome/Firefox/Edge:** desde iOS 16.4 esos navegadores también pueden agregar a inicio desde su menú Compartir (WebKit, «WebKit Features in Safari 16.4»). Por eso reciben instrucción, con «en tu navegador» porque el botón está en otro sitio que en Safari.
6. **Service worker en `public/sw.js`** (archivo JavaScript sin compilar) en vez de `lib/service-worker.js` con `new URL(..., import.meta.url)` como en el ejemplo de la guía: así la dirección es fija (`/sw.js`), coincide con las cabeceras que recomienda la guía y se puede probar leyendo el archivo real.

## Fuentes consultadas
- Next 16 (en `node_modules/next/dist/docs`): `02-guides/progressive-web-apps.md` (manifiesto, aviso para iOS, cabeceras de `sw.js`), `03-file-conventions/01-metadata/manifest.md`, `app-icons.md` (`icon`, `apple-icon`, `ImageResponse`), `generate-metadata.md` (`appleWebApp`) y `generate-viewport.md`.
- web.dev, «What does it take to be installable?» (https://web.dev/articles/install-criteria): Chrome pide `name` o `short_name`, íconos 192 y 512, `start_url`, `display` standalone, HTTPS, no estar ya instalada, y que la persona haya tocado la página y pasado unos 30 segundos en ella. **Ya no exige un service worker con `fetch`** (igual lo tenemos, para la página sin conexión).
- MDN, `beforeinstallprompt` (https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event): se guarda el evento con `preventDefault()`, se llama `prompt()` una sola vez y `appinstalled` avisa cuando se instaló. No existe en Safari ni en Firefox.
- WebKit, «WebKit Features in Safari 26.0» (https://webkit.org/blog/17333/webkit-features-in-safari-26-0/): desde iOS 26 **todo sitio agregado a inicio se abre como app** por defecto, sin requisitos; la persona puede desactivar «Abrir como app web» al agregarlo. El manifiesto sigue siendo compatible.
- WebKit, «WebKit Features in Safari 16.4» (https://webkit.org/blog/13966/webkit-features-in-safari-16-4/): otros navegadores de iOS pueden agregar a inicio desde su menú Compartir.

## Verificación
- **Pruebas primero** (se vio el rojo antes de escribir el código en la detección, la franja/menú, el manifiesto y el service worker; el registro del service worker se escribió junto con su prueba). 46 pruebas nuevas:
  - `lib/pwa.test.ts` (13): Android con aviso, iPhone Safari, iPad (se presenta como Mac pero es táctil), Mac, Chrome/Firefox en iPhone, Instagram, ya instalada, computadora;
  - `components/chat/instalacion.test.tsx` (10): la franja aparece o no según el caso; «Instalar app» llama al diálogo; `appinstalled` la oculta; «Ahora no» se recuerda; sin `localStorage` no falla; opciones del menú en Android, iPhone y computadora;
  - `app/manifest.test.ts` (4): contenido del manifiesto y que los íconos existan;
  - `lib/sw.test.ts` (15): carga el `public/sw.js` real y comprueba que **nunca intercepta `/api/*`** (6 rutas, GET y POST) ni `/panel`, que no guarda páginas, que muestra la página sin conexión, que borra cachés viejas y que no guarda respuestas con error;
  - `components/pwa/registro-pwa.test.tsx` (4): registra solo en producción, un fallo no rompe nada, guarda el aviso antes del chat.
- `pnpm test`: 66 archivos y **655 pruebas** en verde (antes 609). `pnpm exec tsc --noEmit`, `pnpm lint` y `pnpm build`: sin errores.

### Prueba en vivo
`next build && next start` en el puerto 3100 (modo producción), sobre una **copia** de `charla.db` y un `mastra.db` nuevo en la carpeta de trabajo; no se tocó `data/`. Chrome sin ventana con perfiles temporales. Asistentes ficticios: «Pablo Prueba», «Irene Prueba», «Esteban Prueba».

| Prueba | Resultado |
| --- | --- |
| Manifiesto | Se sirve en `/manifest.webmanifest`; Chrome lo lee sin errores |
| Íconos | 192, 512, maskable, `apple-icon.png` e `icon.svg`: todos 200 y del tipo correcto |
| Cabeceras de `/sw.js` | `no-cache, no-store, must-revalidate`, tipo JavaScript y la política de seguridad |
| Service worker | Registrado y activo en `/`; guardó `offline.html` y los íconos |
| ¿Chrome la considera instalable? | Sí: `Page.getInstallabilityErrors` devolvió una lista vacía, y Chrome disparó el aviso real `beforeinstallprompt` |
| Android emulado (360 × 780) | Franja con «Instalar app» y opción en el menú. Al tocar, se llamó al diálogo (1 vez) y la franja se fue. Con `appinstalled`, la opción desaparece del menú |
| Franja vs. cuadro de texto | Franja en y = 56–109 px; cuadro de texto en y = 719 px: no se tocan. Sin scroll horizontal |
| iPhone Safari emulado (390 × 844) | Franja con la instrucción, sin botón de instalar. Menú → «Agregar a inicio» abre la explicación |
| «Ahora no» | Tras recargar, la franja no volvió (`localStorage` = `1`); el menú conserva «Agregar a inicio» |
| iPhone ya instalado (`navigator.standalone`) | No se muestra nada |
| iPhone con Chrome | Texto «…toca Compartir en tu navegador…» |
| Computadora (1280 × 800) | Nada, aunque Chrome sí disparó su aviso |
| `/api/*` y el service worker | 11 respuestas de `/api` (sesión, identificar, historial, sugerencias y el chat): **ninguna** pasó por el service worker. En la caché no hay nada de `/api` ni `/panel`; la única página guardada es `offline.html` |
| El chat sigue funcionando | Pregunta real «¿Qué es un guardrail?» → respuesta completa con «lámina 33» |
| Sin conexión | Al recargar sin red se vio «Sin conexión. Vuelve a intentarlo cuando tengas señal.» |
| Log del servidor | 0 emails y 0 nombres |

Capturas (carpeta de trabajo de la sesión, `scratchpad/pwa/`): franja Android (01), menú Android (02), chat funcionando (03), página sin conexión (04), franja iPhone Safari (05), explicación «Agregar a inicio» (06), iPhone ya instalado (07), computadora (08), iPhone con Chrome (09).

## Qué no se pudo verificar
- **Teléfonos reales.** Todo se emuló en Chrome. El diálogo real de instalación de Android no se abrió (en la prueba se reemplazó por un contador para no bloquear la automatización), y Safari real no se probó: el iPhone se imitó con su identificación de navegador.
- La herramienta de navegador (Playwright MCP) se desconectó a mitad de la prueba; se terminó con un script de Playwright sobre el mismo Chrome. No afecta los resultados.

## Qué revisar en tu Android y tu iPhone (T14, ya con HTTPS)
La instalación **solo funciona con HTTPS** (en `localhost` es la excepción). Con el dominio real:

**Android (Chrome):**
1. Abre la URL, entra con tu correo y espera unos 30 segundos tocando la pantalla (Chrome lo exige antes de ofrecer instalar).
2. Debe aparecer la franja «Instalar app». Tócala: debe salir el diálogo de Chrome. Acepta.
3. Revisa el ícono en la pantalla de inicio (negro con el círculo celeste, sin cortes) y el nombre «Agentes».
4. Ábrela desde el ícono: sin barra del navegador, la franja ya no sale, la sesión sigue abierta y el chat responde.
5. Activa el modo avión y abre la app: debe verse «Sin conexión…».

**iPhone (Safari):**
1. Abre la URL, entra, y revisa la franja con la instrucción.
2. Compartir → «Agregar a inicio». Revisa ícono y nombre «Agentes». Deja activado «Abrir como app web».
3. Ábrela desde el ícono: sin barra de Safari; la hora y la batería sobre fondo negro, **la cabecera no debe quedar debajo de ellas**, y el cuadro de texto no debe quedar bajo la barra de gestos.
4. **Importante:** en iPhone, la app instalada suele guardar sus cookies aparte de Safari. Si al abrirla desde el ícono pide el correo otra vez, es normal (no se probó en un iPhone real); el tope de 30 preguntas sigue contando por persona.
5. Escribe una pregunta con el teclado abierto: el cuadro de texto debe quedar pegado al teclado (lo mismo que faltaba probar en T11).

## Notas para T14 (despliegue)
- **HTTPS obligatorio** en el dominio del chat.
- **Cabeceras de `sw.js`:** Next ya envía `Cache-Control: no-cache, no-store, must-revalidate`. Si Dokploy/Traefik o un CDN (Cloudflare) va delante, que **no** guarde `/sw.js` en caché ni cambie sus cabeceras; si no, una versión vieja del service worker podría quedarse días en los teléfonos.
- `/manifest.webmanifest` debe salir con su tipo (`application/manifest+json`); Next ya lo hace.
- El `Dockerfile` ya copia `public/` (ahí están `sw.js`, `offline.html` y los íconos). Con `output: "standalone"`, en producción se arranca con `node .next/standalone/server.js` (`next start` avisa que no es lo correcto; para esta prueba local funcionó igual).
- Si hay que invalidar lo guardado en los teléfonos, subir `VERSION` en `public/sw.js`.
- Si se cambia el diseño del ícono: editar `scripts/generar-iconos.ts` y correr `pnpm iconos`.

## Desvíos
1. Se borró `app/favicon.ico` (el logo de Next) y lo reemplaza `app/icon.svg`.
2. El texto de la franja en Android se acortó a «Tenla a mano durante la charla.» tras verla en vivo (el primer texto ocupaba tres líneas en un teléfono de 412 px).
3. Textos que no estaban fijados: «Tenla a mano durante la charla.», «Ahora no» (nombre de la X), «Entendido», «Agregar a inicio» como título del diálogo, y la página sin conexión con «Reintentar».
