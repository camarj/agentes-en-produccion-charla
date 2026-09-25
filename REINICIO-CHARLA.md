# Reinicio para el día de la charla

**Cuándo:** después del último ensayo (viernes) y antes de la charla (sábado).
**Quién:** Raúl o Hermes, desde la terminal del servicio `web` en Dokploy.
**Cuánto tarda:** menos de 1 minuto.

## Qué hace

Deja en cero lo que muestran el **panel del speaker** y **Jev**, para que la charla empiece limpia. No toca lo que hace funcionar la app ni el material que se muestra en Studio.

| Se borra o reinicia | Se conserva |
| --- | --- |
| Sesiones abiertas: quien probó en el ensayo vuelve a ver la pantalla de entrada | Los 25 inscritos con su perfil (nombre, rol, qué construye) |
| Mensajes, votos y la cola de escalamientos | Las 40 láminas y su búsqueda |
| Análisis de Jev | Datasets, experimentos y trazas de **evals** (lo que se muestra en Studio) |
| Conversaciones del agente con asistentes (hilos `charla-*`) | Conversaciones de evals (hilos `eval-*`) |
| Trazas de asistentes en Neon, con sus puntajes y votos | Configuración, variables y migraciones |
| Coste acumulado → $0 · interruptores apagados · tramo en la lámina 1 · historial «Última activación» | |
| Asistentes «invitado», es decir, quienes entraron sin estar inscritos. Si vuelven el sábado, se registran de nuevo solos | |

Antes de borrar, guarda una **copia de respaldo** de `charla.db` y `mastra.db` en el mismo volumen (`/app/data/*.respaldo-<fecha>.db`). Las trazas de Neon no se respaldan: son del ensayo y no hacen falta.

## Antes de empezar

1. Confirma que en Dokploy está desplegado un `main` que ya incluya el script `scripts/reiniciar-charla.ts`. Si no, despliega `web` y `studio` otra vez.
2. No lo corras mientras alguien esté usando el chat en serio. Después del ensayo no hay problema.

## Pasos

Dokploy → servicio **`web`** → **Terminal**:

```bash
# 1. Simulación: solo cuenta, no cambia nada.
pnpm reiniciar:charla
```

Revisa la primera línea. Debe decir **`data/charla.db`**, **`data/mastra.db`** y un host que termine en **`neon.tech`**:

```
Bases: charla.db → file:…/data/charla.db · mastra.db → file:…/data/mastra.db · trazas → ….neon.tech
Simulación (sin --si no se cambia nada):
  Trazas: 57 de asistentes a borrar · 40 de evals conservadas · 170 en total
  Memoria: 12 conversaciones, 40 mensajes, …
  charla.db: 14 sesiones, 9 votos, 2 escalamientos, 20 análisis de Jev, …
```

Si las «de evals conservadas» son 0, o la línea `Bases` apunta a otro lado, **detente y avisa a Raúl**. Los números de este ejemplo son inventados; los tuyos serán otros.

```bash
# 2. Aplicar.
pnpm reiniciar:charla --si
```

Esperado: una línea `Respaldo: …`, las mismas cuentas y al final **`Listo: paneles en cero.`**

## Comprobar (2 minutos)

1. `https://<dominio-app>/panel`: asistentes **0 / 25**, mensajes 0, fallas 0, bloqueos 0, escalamientos 0, coste **$0,000**, votos 0 / 0, cola vacía, interruptores «Nunca activado», tramo «Láminas 1–13».
2. `https://<dominio-app>/panel/jev`: «Esperando preguntas de la sala…» y **0 análisis**.
3. Studio → Datasets → `charla-v1` → Experiments: los experimentos de evals siguen ahí.
4. **Opcional:** para probar que todo funciona, haz una pregunta desde el teléfono. Debe aparecer 1 mensaje en el panel y 1 tarjeta en Jev. Luego **vuelve a correr `pnpm reiniciar:charla --si`** para dejarlo otra vez en cero. Se puede repetir las veces que haga falta.

## Si algo sale mal

- Si el script falla a la mitad, se puede volver a correr sin problema. Cada parte es una transacción y lo ya borrado no se vuelve a contar.
- Si `pnpm reiniciar:charla` no existe, falta desplegar el `main` nuevo.
- Para volver al estado anterior, los respaldos están en `/app/data/charla.respaldo-<fecha>.db` y `/app/data/mastra.respaldo-<fecha>.db`. Para restaurar hay que detener `web` y `studio` y reemplazar los archivos en el volumen. Hazlo solo si Raúl lo pide.
- **No** uses `pnpm purgar:personales`: ese borra también a los inscritos y es para **después** de la charla.

## Cómo se probó (2026-09-24)

Se hizo un simulacro completo en local con copias de las bases y un Postgres temporal:

1. Actividad real: 3 asistentes, una pregunta normal, un intento de inyección bloqueado, una pregunta comercial escalada, votos, interruptores y análisis de Jev. Además, una corrida de evals con 2 casos.
2. Reinicio: el panel y Jev quedaron en cero. Se conservaron los 25 inscritos, las 40 láminas y su búsqueda, el experimento, las 2 trazas de evals con sus 4 jueces y los hilos `eval-*`.
3. Después del reinicio: asistentes nuevos chatearon, votaron y aparecieron en el panel y en Jev con normalidad. Una sesión abierta antes del reinicio quedó cerrada y el chat la rechazó con 401, como se esperaba.
4. Segunda corrida seguida: no encontró nada que borrar y no rompió nada.
5. El respaldo contenía los datos previos.

Pruebas automáticas en `scripts/reiniciar-charla.test.ts`.
