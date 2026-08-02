# Plou frente a Windy: inventario, límites y hoja de ruta

Revisión: 2 de agosto de 2026. Este documento separa deliberadamente la
aplicación de consumo Windy.com, sus APIs comerciales y el SDK de plugins: que
una capa exista en Windy no significa que pueda incrustarse o redistribuirse.

## Resumen ejecutivo

Plou debe conservar su mapa y su lógica de alarma. Usar Windy como mapa base no
resuelve el radar ni los rayos: la [Map Forecast API](https://api.windy.com/map-forecast/pricing)
ofrece modelos, más de 40 capas, isolíneas, controles, leyenda y picker, pero el
plan Professional cuesta actualmente **990 €/año** (ECMWF opcional: 1.000 € más)
y la tabla pública no incluye radar observado. Windy ha confirmado además que
la capa de radar no está disponible en esa API ([respuesta oficial en su
comunidad](https://community.windy.com/topic/39713/weather-radar-overlay-not-available/3)).

La primera brecha útil ya queda cubierta con fuentes independientes:

| Capacidad | Plou | Fuente y alcance | Diferencia pendiente |
| --- | --- | --- | --- |
| Radar observado/nowcast | Completa | RainViewer | Cobertura y nowcast dependen del plan del proveedor |
| Satélite | Base completa | EUMETSAT, 2 h/10 min, Geo Colour/visible/IR | Faltan más productos, ajuste de color y composición Radar+ |
| Nubes | Base completa | OpenWeather `CL`, 3 h/10 días | Faltan alta/media/baja, techo/base y niebla |
| Rayos | Parcial, informativa | AEMET, nube-tierra agregado 12 h | No son impactos en tiempo real ni cobertura global |
| Animación | Ventana residente de 4 frames | PWA y Android | Falta interpolación/crossfade avanzado y scrub táctil fino |

Los rayos de Windy proceden de Nowcast.de, tienen cobertura casi global y se
muestran con retraso de segundos sobre radar y satélite
([descripción oficial](https://www.windy.com/articles/28646)). AEMET no ofrece
un sustituto equivalente: devuelve un gráfico agregado de 12 horas. Por ello
Plou lo etiqueta como aproximado y nunca lo usa para disparar alarmas.

## Las cuatro superficies de Windy

1. **Windy.com / apps.** Producto de consumo. Incluye visualizaciones, Premium,
   alertas, comparación de modelos, radar, satélite, rayos, webcams y
   herramientas especializadas. Una suscripción de usuario no concede derechos
   de redistribución de sus datos.
2. **Map Forecast API.** Mapa Windy incrustable, con clave Testing o Professional.
   Testing es sólo desarrollo, limitado a GFS y a viento/temperatura/presión;
   Professional permite 10.000 sesiones/día, más modelos/capas e isolíneas.
3. **Point Forecast API.** Datos numéricos de previsión para coordenadas. Puede
   servir como proveedor de previsión, pero no aporta radar/satélite/rayos.
4. **Windy Plugin API.** Código que se ejecuta dentro de Windy y usa su mapa
   Leaflet, estado, picker y módulos internos. Es útil como catálogo y para crear
   extensiones de Windy, pero no es una licencia para copiar sus teselas a Plou.
   La referencia está en la [guía oficial de plugins](https://docs.windy-plugins.com/).

## Catálogo oficial completo de overlays

La lista siguiente reproduce todos los identificadores publicados actualmente
por [`@windy/rootScope.overlays`](https://docs.windy-plugins.com/api/modules/rootScope.html).
Algunos sólo funcionan con determinados productos, niveles o planes; no debe
confundirse esta lista del runtime de plugins con la lista comercial de Map
Forecast.

| Familia | Identificadores oficiales | Prioridad para Plou |
| --- | --- | --- |
| Observación y base | `radar`, `satellite`, `topoMap` | Radar y satélite hechos; base propia deliberada |
| Viento/aviación | `wind`, `gust`, `gustAccu`, `turbulence`, `icing` | Alta para partículas de viento; media para aviación |
| Precipitación/nieve/tormenta | `rain`, `rainAccu`, `snowAccu`, `snowcover`, `ptype`, `thunder`, `cape`, `ccl` | Alta: acumulados, tipo, CAPE/tormenta |
| Temperatura/humedad/energía | `temp`, `dewpoint`, `rh`, `deg0`, `wetbulbtemp`, `solarpower`, `uvindex` | Media; parte ya existe como previsión puntual |
| Nubes/visibilidad | `clouds`, `hclouds`, `mclouds`, `lclouds`, `fog`, `cloudtop`, `cbase`, `visibility` | Alta: siguiente ampliación natural |
| Mar | `waves`, `swell1`, `swell2`, `swell3`, `wwaves`, `sst`, `currents`, `currentsTide`, `wavePower` | Baja salvo que Plou amplíe su público a costa/náutica |
| Aire/química | `aqi`, `no2`, `pm2p5`, `aod550`, `gtco3`, `tcso2`, `go3`, `cosc`, `dustsm` | Media-baja; exigiría CAMS u otro proveedor |
| Presión/extremos/avisos | `pressure`, `efiTemp`, `efiWind`, `efiRain`, `capAlerts`, `avalancheDanger` | Alta para presión/avisos; EFI depende de ECMWF |
| Suelo/sequía/incendio | `soilMoisture40`, `soilMoisture100`, `moistureAnom40`, `moistureAnom100`, `drought40`, `drought100`, `fwi`, `dfm10h`, `dfm100h`, `dfm1000h` | Baja para el foco actual de lluvia |
| Productos de interfaz | `heatmaps`, `hurricanes` | Media para ciclones; `heatmaps` es infraestructura de visualización |

Isolíneas oficiales del runtime: `pressure`, `gh` (altura geopotencial), `temp`
y `deg0` (cota 0 °C). Niveles verticales: `surface`, `100m`, `975h`, `950h`,
`925h`, `900h`, `850h`, `800h`, `700h`, `600h`, `500h`, `400h`, `300h`,
`250h`, `200h`, `150h` y `10h`.

La API comercial enumera seis familias de modelos principales (GFS, ICON, NAM,
AROME, HRRR y ECMWF, además de productos GEOS5/CAMS según capa). ECMWF está
restringido a uso interno y tiene coste opcional. Windy también publica muchos
modelos regionales en su runtime; su disponibilidad depende de la zona y del
producto, no sólo del selector visual.

## Herramientas y experiencia de uso a comparar

| Herramienta Windy | Estado en Plou | Recomendación |
| --- | --- | --- |
| Timeline animada, play/pausa, picker y leyenda | Sí | Mejorar crossfade y mostrar observado/previsión con color distinto |
| Selector de modelo y comparación | Parcial en previsión | Añadir comparación sólo cuando haya proveedores equivalentes |
| Selector de nivel atmosférico | No | Necesario al incorporar viento, humedad o temperatura en altura |
| Isolíneas | No | Empezar por presión, generadas por Plou desde datos abiertos |
| Partículas de viento | No | Prioridad alta; WebGL/canvas y modo de movimiento reducido |
| Pronóstico puntual/meteograma | Sí, sin el picker de mapa | Unificar el punto tocado con la pantalla de previsión |
| Radar+ (radar + satélite) | Capas separadas | Añadir modo compuesto con opacidades coordinadas |
| Rayos en tiempo real | Sólo agregado 12 h | Mantener etiqueta aproximada o contratar datos de impactos |
| Alertas meteorológicas oficiales | No | Integrar CAP/Meteoalarm/AEMET, separadas de la alarma propia |
| Webcams y POI meteorológicos | No | Baja prioridad; API/licencia separada |
| Huracanes, incendios, sequía, nieve, avalanchas | No | Módulos posteriores, no cargar el selector principal |
| Rutas, sondeos y herramientas de aviación | No | Fuera del objetivo actual; diseñar como plugins/módulos |
| Compartir posición, capa y hora por URL | Parcial | Alta: estado reproducible y enlaces profundos |
| Favoritos y varias ubicaciones | Sí | Conservar: Plou añade alarmas individualizadas |
| Modo offline | Armazón PWA, teselas online | Permitir descarga limitada con respeto a licencias |

La lista de POI publicada por el SDK incluye `airq`, `cams`, `cities`, `favs`,
`firespots`, `kitespots`, `metars`, `pgspots`, `precip`, `radiosonde`, `stations`,
`surfspots`, `temp`, `tide` y `wind`. Son candidatos a capas de puntos, no
overlays raster/vectoriales meteorológicos.

## Arquitectura implementada en Plou

La PWA usa un contrato único (`layers`, `frames`, `tiles`, `activity`) y el
servidor conserva las claves OpenWeather/AEMET. No existe un proxy abierto: la
ruta valida capa, variante, frame y coordenadas de tesela, y AEMET sólo acepta
una URL de datos HTTPS de su propio host. Las teselas tienen caché acotada.

Android no depende del servidor: genera directamente las URLs WMS/XYZ y guarda
las claves del usuario cifradas con AES-GCM y Android Keystore. Satélite/nubes
mantienen cuatro capas residentes; AEMET se descarga cada 10 min y se convierte
a transparencia eliminando fondo, costas, texto y retícula poco saturados.

## Limitaciones y validación pendiente

- Sin claves reales no se ha validado el contrato actual de OpenWeather ni las
  dimensiones/márgenes reales del PNG de AEMET.
- Los límites AEMET (`-19,27,5,45`) y el crop (`0,0,1,1`) son una hipótesis
  explícita. El servidor permite ajustarlos por entorno; Android requerirá
  actualizar las constantes tras la calibración.
- El filtro de color puede confundir símbolos muy saturados del gráfico con
  rayos. Es apropiado para visualización exploratoria, no para seguridad.
- EUMETSAT puede tardar en publicar el fotograma redondeado más reciente. El
  cliente conserva frames vecinos, pero conviene medir el retraso real y omitir
  frames HTTP 404 persistentes.
- Hay que revisar las condiciones de cada proveedor antes de uso comercial y
  conservar atribuciones. La [nota legal de AEMET](https://www.aemet.es/es/nota_legal)
  y los términos de EUMETSAT/OpenWeather prevalecen sobre este resumen.

## Hoja de ruta recomendada

1. Validar AEMET/OpenWeather con claves reales y fijar tests con muestras
   anonimizadas; medir disponibilidad y latencia de EUMETSAT.
2. Añadir modo Radar+ propio, crossfade de 150–250 ms, manejo explícito de frame
   ausente y precarga condicionada por red/batería.
3. Incorporar viento con partículas y presión con isolíneas desde un proveedor
   abierto; son las dos mejoras que más acercan la lectura sinóptica a Windy.
4. Completar nubes alta/media/baja, niebla, techo/base, CAPE y tormentas.
5. Integrar avisos CAP oficiales y, sólo si existe licencia adecuada, un
   proveedor de impactos de rayos casi en tiempo real.
6. Dejar mar, calidad del aire, incendios, sequía y aviación como módulos para
   no convertir el selector principal en una lista inmanejable.
