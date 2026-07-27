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

## Publicar una versión

Las releases las compila GitHub Actions
([`.github/workflows/android-release.yml`](../.github/workflows/android-release.yml)):
al publicar una release, el workflow ejecuta las pruebas, compila el APK y el
AAB **firmados con la clave del proyecto** y los adjunta a la release junto con
sus `sha256`.

```bash
gh release create v1.1.0 --title "Plou 1.1.0" --notes "..."
```

El nombre de versión sale de la etiqueta (`v1.1.0` → `1.1.0`) y el `versionCode`
de sus tres números (`1·10000 + 1·100 + 0` = `10100`), de modo que siempre crece.

### La clave de firma

Android exige que **todas las versiones vayan firmadas con la misma clave**: si
cambia, la actualización no se instala encima y hay que desinstalar la anterior
perdiendo los datos. Por eso:

- La clave vive fuera del repositorio, en `~/.android-keystores/plou-release.jks`
  (RSA 4096, válida hasta 2056), junto a sus credenciales en un fichero `600`.
- En CI se restaura desde los secretos del repositorio
  (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`).
- El workflow **comprueba la huella** del APK contra la variable
  `ANDROID_SIGNING_SHA256` del repositorio y falla si no coincide, para que un
  cambio accidental de clave se detecte antes de publicar y no en el móvil.

> **Haz una copia de seguridad de `~/.android-keystores/`.** Si pierdes ese
> fichero no podrás volver a publicar actualizaciones de esta app nunca más.

En local, `./gradlew assembleRelease` firma automáticamente si existe
`~/.android-keystores/plou-release.properties`; si no existe, compila sin firmar
en vez de fallar.

## Estado

Compila y las 44 pruebas del motor pasan. **No se ha ejecutado todavía en un
dispositivo ni en un emulador**: no hay ninguno disponible en el entorno donde
se ha desarrollado, así que el comportamiento en pantalla, los permisos en
tiempo de ejecución y el aviso sobre la pantalla de bloqueo están sin verificar
en vivo.
