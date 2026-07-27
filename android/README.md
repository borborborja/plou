# Plou para Android

Aplicación nativa (Kotlin + Jetpack Compose) que **no necesita el servidor de
Plou**: habla directamente con los proveedores de datos y hace todo el análisis
en el propio móvil.

## Por qué nativa y no la PWA envuelta

Una alarma de lluvia sólo sirve si suena con la pantalla apagada. Eso exige un
servicio en primer plano que despierte cada pocos minutos, y una pantalla de
aviso capaz de aparecer sobre la pantalla de bloqueo. Un WebView no puede
garantizar ninguna de las dos cosas.

## Qué hace en el dispositivo

1. Descarga el índice de fotogramas de RainViewer y las teselas PNG del radar.
2. **Decodifica cada píxel** a reflectividad (dBZ) y tipo de precipitación con
   la tabla de colores del proveedor, generada desde el mismo CSV que usa el
   servidor (`scripts/gen-color-table-kotlin.mjs`).
3. Proyecta a una **rejilla local en kilómetros** centrada en cada ubicación.
4. Estima el **desplazamiento** del sistema por correlación cruzada entre
   fotogramas, con refinado subcelda.
5. **Extrapola** con persistencia lagrangiana para saber cuándo llega la lluvia.
6. Decide si avisar con el mismo motor de alarmas del servidor: modos, horas de
   silencio, franjas de vigilancia, repetición y aplazamiento.

No hay cuenta de usuario, ni servidor propio, ni telemetría. Las ubicaciones y
las preferencias viven en el almacenamiento local del móvil.

## Compilar

```bash
cd android
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest    # 44 pruebas del motor de radar y de alarmas
```

Requisitos: JDK 17 y el SDK de Android con la plataforma 35. La ruta del SDK va
en `local.properties` (`sdk.dir=...`), que no se versiona.

## Estructura

```
app/src/main/java/cat/plou/
  radar/     ColorTable, Frames, Tiles, Field, Motion, Analysis, Geo
  alarm/     Engine (decisión de aviso), Window (franjas), WatchService, AlarmActivity
  forecast/  Open-Meteo: previsión y búsqueda de localidades
  data/      almacenamiento local (DataStore)
  ui/        pantallas en Compose y sistema de diseño
app/src/test/  pruebas unitarias del motor
```

## Permisos y por qué

| Permiso | Para qué |
| --- | --- |
| `INTERNET` | descargar teselas de radar y previsión |
| `POST_NOTIFICATIONS` | mostrar los avisos |
| `FOREGROUND_SERVICE` + `..._SPECIAL_USE` | vigilar el radar de forma continua |
| `VIBRATE`, `WAKE_LOCK` | que la alarma se note y despierte la pantalla |

## Estado

Compila y las 44 pruebas del motor pasan. **No se ha ejecutado todavía en un
dispositivo ni en un emulador**: no hay ninguno disponible en el entorno donde
se ha desarrollado, así que el comportamiento en pantalla, los permisos en
tiempo de ejecución y el aviso sobre la pantalla de bloqueo están sin verificar
en vivo.
