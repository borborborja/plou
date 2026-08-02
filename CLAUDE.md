# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Plou avisa de lluvia leyendo directamente los mosaicos de radar. Hay dos clientes
—una PWA servida por un servidor Node y una app Android nativa que funciona sin
él— que implementan **el mismo algoritmo en dos lenguajes**.

## Comandos

```bash
npm install                                  # workspaces: server + web
npm run dev                                  # API en :8787 y Vite en :5173
npm run build && npm start                   # producción en :8787
npm test                                     # pruebas del servidor y la PWA (vitest)
npm run keys                                 # claves VAPID en server/data/

npm run test --workspace=server -- motion    # un solo fichero de pruebas
npm run test:watch --workspace=server
npm run typecheck --workspace=server
npx tsc -p web/tsconfig.json --noEmit        # typecheck de la PWA

npx tsx server/scripts/check-radar.mts       # diagnóstico sobre datos reales
npx tsx server/scripts/verify-motion.mts     # verifica el vector de movimiento
```

```bash
cd android
./gradlew assembleDebug                      # APK en app/build/outputs/apk/debug/
./gradlew testDebugUnitTest                  # pruebas del motor portado
./gradlew testDebugUnitTest --tests '*MotionTest*'
```

Requiere `local.properties` con `sdk.dir` (no versionado), JDK 17 y plataforma
Android 35.

## El algoritmo, que vive por duplicado

El servidor no consulta una API de «¿va a llover?»: **decodifica los píxeles de
las teselas PNG del radar**. La cadena es la misma en `server/src/radar/` y en
`android/app/src/main/java/cat/plou/radar/`:

`frames` (índice del proveedor) → `tiles` (PNG → dBZ + tipo) → `field` (rejilla
local en km) → `motion` (correlación cruzada) → `analysis` (qué hay, cuándo
llega, cuándo escampa) → `alarm/engine` (decidir si avisar).

Al tocar cualquiera de esas piezas, **cámbialas en los dos lados**. Las pruebas
de ambos fijan los mismos invariantes y son la red que detecta la divergencia.

### Convenios que ya han causado fallos

- **Rejilla**: índice `(i, j)` = `j * width + i`; `i` crece al **este** y `j` al
  **norte**, con el centro en `(half, half)`. El signo del vector de movimiento
  se derivó mal una vez y las ETA salían del lado contrario; `MotionTest` /
  `motion.test.ts` lo fijan desplazando campos sintéticos en cinco direcciones.
- **Capa de cobertura**: es una **máscara de zonas SIN radar** (alpha 0 = sí hay
  cobertura) y sólo se publica hasta el zoom 5.
- **Teselas de 512 px**: en Leaflet exigen `zoomOffset: -1`, y Leaflet aplica ese
  desfase **después** de recortar con `min/maxNativeZoom`, así que esos límites
  van en la escala del mapa (ver `zoomOptions` en `RadarMap`/`RadarScreen`).
- **Colores repetidos** en las rampas: al construir el mapa color → dBZ se
  conserva la primera aparición, es decir el valor más bajo. Criterio
  conservador para una alarma.

### Ficheros generados: no editar a mano

`server/src/radar/colorTable.generated.ts` y
`android/.../radar/ColorTableData.kt` salen ambos de `scripts/rainviewer_colors.csv`:

```bash
node scripts/gen-color-table.mjs          # servidor
node scripts/gen-color-table-kotlin.mjs   # Android
```

El CSV tiene 256 filas: 128 de lluvia (dBZ −32..95) seguidas de 128 de nieve,
por cada uno de los nueve esquemas. El esquema de análisis es *Universal Blue*
porque es el único del acceso gratuito cuyas rampas de lluvia y nieve no se
solapan, lo que permite clasificar el tipo de precipitación.

## Motor de alarmas

`evaluateAlarm` es una **función pura**: recibe análisis + configuración +
estado previo y devuelve el estado nuevo y, si procede, la notificación. Toda la
lógica delicada vive ahí y está muy probada (`alarmEngine.test.ts`, `EngineTest`).

Precedencia: desactivada → fuera de la franja de vigilancia → detección
(«llueve encima» gana sobre el modo elegido) → aplazamiento → situación ya
activa → horas de silencio → intervalo mínimo → avisar.

Las horas de silencio marcan el episodio como activo pero no como anunciado. Si
la precipitación continúa al terminar la franja, se emite entonces el primer
aviso; si ya terminó, no se genera ningún aviso tardío.
Las franjas que cruzan medianoche atribuyen la madrugada al día de **inicio**.

## Servidor

Fastify sirve la API y la PWA compilada en el mismo puerto. SQLite con
migraciones por `user_version` en `db.ts`: para cambiar el esquema, **añade** una
entrada a `MIGRATIONS`, nunca edites las existentes. Identidad por cabecera
`x-device-id`; no hay cuentas ni datos personales.

El vigilante (`alarm/watcher.ts`) recorre las ubicaciones en lotes y se salta la
evaluación si el fotograma más reciente es más viejo que `PLOU_ALARM_MAX_FRAME_AGE`.

## PWA

Un único `styles.css` con el sistema de diseño en variables CSS; los nombres
antiguos (`--bg`, `--text`…) están ligados a los tokens nuevos (`--ink`,
`--card-bg`…), de modo que cambiar un token afecta a todo.

Regla del diseño: **un solo elemento con el degradado de marca por vista** —la
acción primaria o el estado activo—; el resto, superficies neutras.

En `RadarMap`, todos los fotogramas se mantienen como capas cargadas y la
animación sólo cambia su opacidad. El fotograma visible se pide primero y el
resto de uno en uno: el navegador abre unas seis conexiones por servidor y
pedirlo todo a la vez retrasa justo lo que se está mirando.

## Android

Sin servidor propio: habla con RainViewer y Open-Meteo directamente y guarda
todo en DataStore. La vigilancia es un **servicio en primer plano**, no
WorkManager, porque una alarma de lluvia tiene que sonar con la pantalla apagada;
el aviso es una `Activity` a pantalla completa sobre la pantalla de bloqueo.

Trampas de osmdroid ya pisadas:

- `MapView.setTileSource()` **vacía la caché de teselas**. Nunca lo llames desde
  el bloque `update` de `AndroidView` sin comprobar antes que la fuente cambió:
  se ejecuta en cada recomposición y recargaba el mapa entero en cada fotograma.
- Una capa **deshabilitada no dibuja y por tanto no pide teselas**. Para animar
  sin parpadeo, las capas se dejan activas y se cambia su filtro de opacidad.
- Las teselas de dibujo son de 256 px (el mismo tamaño que el mapa base); las de
  análisis siguen siendo de 512, donde sí importa la resolución.

## Publicar

Releases y APK los construye GitHub Actions
(`.github/workflows/android-release.yml`, `docker.yml`). El APK va **firmado con
la clave del proyecto**, sin la cual una actualización no se instala encima:
vive fuera del repositorio en `~/.android-keystores/` y en CI se restaura desde
los secretos. El workflow compara la huella con la variable
`ANDROID_SIGNING_SHA256` y falla si no coincide.

```bash
gh release create v1.2.0 --title "Plou 1.2.0" --notes "..."
```

El nombre de versión sale de la etiqueta y el `versionCode` de sus tres números.
Al comprobar que una release terminó, **busca la ejecución por su etiqueta**: la
lista por fecha devuelve la de la versión anterior si la nueva aún no ha
arrancado (ya ha inducido a error dos veces).

## Fuentes de datos

RainViewer (radar, uso personal citando la fuente), Open-Meteo (previsión y
geocodificación, CC BY 4.0 no comercial), BigDataCloud (nombre de la posición),
OpenStreetMap/CARTO/OpenTopoMap (mapas base). Foreca está integrado como
proveedor opcional pero **desactivado sin credenciales**: es comercial.

El proveedor no siempre publica fotogramas extrapolados ni la capa de satélite;
cuando llegan vacíos la interfaz lo dice, en vez de ofrecer controles inertes.
