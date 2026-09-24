# T10 · UI de entrada y perfil

**Objetivo:** Construir las pantallas de entrada por email y de perfil, mobile-first, con los tokens de la charla y todos sus estados.

**Cubre:** RF-01, RF-02, usabilidad (PRD §8).

## Archivos
- `app/page.tsx` — decide pantalla con `GET /api/sesion`: entrada, perfil o chat
- `components/acceso/pantalla-entrada.tsx`
- `components/acceso/pantalla-perfil.tsx`

## Pantalla de entrada
- Layout centrado verticalmente en `100dvh`, padding lateral 20 px, ancho máx. 420 px, respeta `env(safe-area-inset-*)`.
- Eyebrow en mono y muted: "Charla · Inteliside". Título: "Cómo lograr que tus agentes sobrevivan a producción" (600, 28–32 px). Línea: "Pregúntale al asistente cualquier cosa de la charla."
- Input email: `type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}`, alto 48 px, label visible "Tu email de registro".
- Botón "Entrar" ancho completo, 48 px, color acento, texto negro. Enter envía.
- Nota muted de 13 px: "Usamos tu email solo para personalizar las respuestas durante la charla."
- Estados: enviando (spinner en el botón, input deshabilitado); email inválido (mensaje bajo el input, `aria-invalid`); 429 ("Demasiados intentos, espera un minuto"); error de red (toast con reintentar).

## Pantalla de perfil
- Se muestra con `falta_perfil` o `nuevo`.
- `nuevo`: input "¿Cómo te llamas?" (obligatorio) arriba.
- Textarea "¿A qué te dedicas?" con placeholder "Ej.: Contadora en una pyme de retail", 2 filas, autoajustable, máx. 120 caracteres. Obligatorio para continuar.
- Textarea opcional "¿Qué construyes o quieres construir con IA?" con placeholder "Ej.: Un agente que responda a mis clientes por WhatsApp", 3 filas, contador `n/300`. Son las mismas dos preguntas del registro en Luma.
- En el archivo real, 5 de 26 inscritos llegan sin ninguna de las dos respuestas: esta pantalla es la que verán.
- Botón "Continuar" (deshabilitado hasta tener rol ≥ 2 caracteres) y enlace "Saltar" que guarda rol "No indicado". Para `nuevo`, "Saltar" solo omite el rol, no el nombre.
- Transición a chat sin recargar la página.

## Checklist
- [x] Usable a 360 × 640 sin scroll horizontal
- [ ] En iOS Safari el teclado de email aparece y el botón queda visible — *pendiente en un iPhone real; solo se emuló (ver `.claude/sessions/T10.md`)*
- [x] Navegable solo con teclado; foco visible con el acento
- [x] Contraste AA en textos muted sobre negro
- [x] Recargar con sesión válida lleva directo al chat
