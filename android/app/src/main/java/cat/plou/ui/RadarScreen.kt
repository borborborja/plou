package cat.plou.ui

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color as AndroidColor
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import cat.plou.data.PlouStore
import cat.plou.data.Settings
import cat.plou.data.distance
import cat.plou.data.WatchedLocation
import cat.plou.radar.AnalyzeOptions
import cat.plou.radar.AndroidTileSource
import cat.plou.radar.ColorScheme
import cat.plou.radar.Intensity
import cat.plou.radar.LatLon
import cat.plou.radar.KM_PER_LAT_DEGREE
import cat.plou.radar.LocationAnalysis
import cat.plou.radar.MotionVector
import cat.plou.radar.offsetKm
import cat.plou.radar.RadarIndex
import cat.plou.radar.RadarIndexClient
import cat.plou.radar.TileOptions
import cat.plou.radar.analyzeLocation
import cat.plou.radar.legendFor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.osmdroid.tileprovider.MapTileProviderBasic
import org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase
import org.osmdroid.tileprovider.tilesource.TileSourcePolicy
import org.osmdroid.tileprovider.tilesource.XYTileSource
import org.osmdroid.util.GeoPoint
import org.osmdroid.util.MapTileIndex
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.FolderOverlay
import org.osmdroid.views.overlay.Overlay
import org.osmdroid.views.overlay.TilesOverlay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Mapa base sin topónimos; las etiquetas van en una capa por encima del radar. */
private fun cartoSource(name: String, path: String) = XYTileSource(
    name, 0, 19, 256, ".png",
    arrayOf(
        "https://a.basemaps.cartocdn.com/$path/",
        "https://b.basemaps.cartocdn.com/$path/",
        "https://c.basemaps.cartocdn.com/$path/",
    ),
    "© OpenStreetMap, © CARTO",
)

/**
 * Fuente de teselas de un fotograma concreto, identificada por su ruta y no por
 * su posición en el índice: al llegar un fotograma nuevo, los demás conservan su
 * URL y por tanto sus teselas ya descargadas.
 */
private class RadarTileSource(
    private val host: String,
    private val path: String,
    private val options: TileOptions,
) : OnlineTileSourceBase(
    "radar-${path.substringAfterLast('/')}", 0, 7, options.size, ".png", arrayOf(""),
    "© RainViewer",
    // Un solo hilo por fotograma: con trece capas, dos hilos cada una son
    // veintiséis descargas compitiendo entre sí y con el mapa base.
    TileSourcePolicy(1, TileSourcePolicy.FLAG_NO_BULK or TileSourcePolicy.FLAG_NO_PREVENTIVE),
) {
    override fun getTileURLString(pMapTileIndex: Long): String {
        val z = MapTileIndex.getZoom(pMapTileIndex)
        val x = MapTileIndex.getX(pMapTileIndex)
        val y = MapTileIndex.getY(pMapTileIndex)
        val smooth = if (options.smooth) 1 else 0
        val snow = if (options.snow) 1 else 0
        return "$host$path/${options.size}/$z/$x/$y/${options.color}/${smooth}_$snow.png"
    }
}

/**
 * Pantalla de radar: mapa a sangre con la animación de los últimos fotogramas,
 * la leyenda de intensidad y el estado del punto vigilado.
 */
@Composable
fun RadarScreen(
    store: PlouStore,
    settings: Settings,
    active: WatchedLocation?,
    locations: List<WatchedLocation>,
    topInset: Dp,
    onSelect: (WatchedLocation) -> Unit,
) {
    val context = LocalContext.current
    var index by remember { mutableStateOf<RadarIndex?>(null) }
    var frame by remember { mutableIntStateOf(0) }
    var playing by remember { mutableStateOf(true) }
    var analysis by remember { mutableStateOf<LocationAnalysis?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    var mapRef by remember { mutableStateOf<MapView?>(null) }
    var locating by remember { mutableStateOf(false) }
    var myPosition by remember { mutableStateOf<GeoPoint?>(null) }
    val scope = rememberCoroutineScope()

    // Permiso de ubicación: se pide sólo cuando se pulsa el botón.
    val askLocation = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            scope.launch {
                centerOnUser(context, mapRef, { locating = it }, { myPosition = it })
            }
        }
    }

    fun locate() {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            scope.launch { centerOnUser(context, mapRef, { locating = it }, { myPosition = it }) }
        } else {
            askLocation.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
    }

    val client = remember { RadarIndexClient() }
    val scheme = remember(settings.colorScheme) { ColorScheme.byId(settings.colorScheme) }
    val tileOptions = remember(settings) {
        TileOptions(
            // 256 px para dibujar: cuatro veces menos datos que 512 y el mismo
            // tamaño de tesela que el mapa base, así no hay desajustes. El
            // análisis sigue usando 512, donde sí interesa la resolución.
            size = 256,
            color = settings.colorScheme,
            smooth = settings.smooth,
            snow = settings.showSnow,
        )
    }

    // Índice de fotogramas: se pide al abrir y se refresca cada cinco minutos.
    LaunchedEffect(settings.colorScheme, settings.smooth, settings.showSnow) {
        while (true) {
            runCatching { withContext(Dispatchers.IO) { client.get() } }
                .onSuccess {
                    index = it
                    frame = (it.past.size - 1).coerceAtLeast(0)
                    error = null
                }
                .onFailure { error = "No se ha podido leer el radar" }
            delay(5 * 60_000L)
        }
    }

    // Análisis del punto activo, en el dispositivo.
    LaunchedEffect(active?.id, index) {
        val current = index ?: return@LaunchedEffect
        val point = active ?: return@LaunchedEffect
        analysis = runCatching {
            analyzeLocation(
                index = current,
                center = LatLon(point.lat, point.lon),
                options = AnalyzeOptions(
                    radiusKm = point.alarm.radiusKm,
                    thresholdDbz = Intensity.valueOf(point.alarm.intensity).dbz,
                ),
                tiles = AndroidTileSource(index = { current }),
            )
        }.getOrNull()
    }

    // Sólo se animan los fotogramas dentro de la historia elegida.
    val frames = remember(index, settings.historyMinutes) {
        val all = index?.all ?: return@remember emptyList()
        val newest = index?.past?.lastOrNull()?.time ?: return@remember all
        val desde = newest - settings.historyMinutes * 60L
        all.filter { it.nowcast || it.time >= desde }.ifEmpty { all.takeLast(1) }
    }

    // Carga progresiva: al abrir sólo se pide el fotograma que se está viendo,
    // y los demás se van sumando de uno en uno. Pedir las trece capas a la vez
    // son varios megas de golpe y el mapa tarda en aparecer.
    var loadedFrames by remember(frames.size) { mutableIntStateOf(if (frames.isEmpty()) 0 else 1) }
    LaunchedEffect(frames.size) {
        if (frames.isEmpty()) return@LaunchedEffect
        loadedFrames = 1
        while (loadedFrames < frames.size) {
            delay(700)
            loadedFrames++
        }
    }

    // La animación no empieza hasta que están todos los fotogramas: así no se
    // ven huecos en los primeros ciclos.
    LaunchedEffect(playing, frames.size, loadedFrames, settings.frameDurationMs) {
        if (!playing || frames.size < 2 || loadedFrames < frames.size) return@LaunchedEffect
        while (true) {
            delay(settings.frameDurationMs.toLong())
            frame = (frame + 1) % frames.size
        }
    }

    Box(Modifier.fillMaxSize()) {
        if (frames.isEmpty()) {
            EmptyHint(error ?: "Cargando el radar…")
        } else {
            RadarMap(
                index = index!!,
                frameIndex = frame,
                loadedFrames = loadedFrames,
                options = tileOptions,
                opacity = settings.opacity,
                center = active?.let { GeoPoint(it.lat, it.lon) },
                baseMap = settings.baseMap,
                myPosition = myPosition,
                watched = active?.let { GeoPoint(it.lat, it.lon) },
                radiusKm = active?.alarm?.radiusKm ?: 0.0,
                motion = analysis?.motion,
                showRadius = settings.showRadius,
                showMotion = settings.showMotionArrow,
                blend = settings.blend,
                showCoverage = settings.showCoverage,
                coverageHost = index!!.host,
                onMapReady = { mapRef = it },
            )
        }

        LocationMenu(
            locations = locations,
            active = active,
            onSelect = onSelect,
            onWatchHere = {
                val centro = mapRef?.mapCenter ?: return@LocationMenu
                scope.launch {
                    val nueva = WatchedLocation(
                        id = System.currentTimeMillis(),
                        name = "%.3f, %.3f".format(centro.latitude, centro.longitude),
                        lat = centro.latitude,
                        lon = centro.longitude,
                    )
                    store.upsert(nueva)
                    onSelect(nueva)
                }
            },
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(start = 12.dp, top = topInset)
                .padding(top = 4.dp),
        )

        // Estado del radar: cuántos fotogramas hay listos y si hay ecos. Sin
        // esto, un radar en calma y una capa que no ha cargado se ven igual.
        RadarStatus(
            frames = frames.size,
            loaded = loadedFrames,
            analysis = analysis,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = topInset)
                .padding(top = 52.dp),
        )

        MapControls(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(end = 12.dp, top = topInset)
                .padding(top = 4.dp),
            onZoomIn = { mapRef?.controller?.zoomIn() },
            onZoomOut = { mapRef?.controller?.zoomOut() },
            onLocate = { locate() },
            locating = locating,
        )

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            analysis?.let { SummaryCard(active?.name.orEmpty(), it, settings) }
            Legend(scheme, settings.showSnow)
            if (frames.isNotEmpty()) {
                Timeline(
                    frames = frames.size,
                    current = frame,
                    playing = playing,
                    label = frames.getOrNull(frame)?.let {
                        SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(it.time * 1000))
                    } ?: "--:--",
                    onTogglePlay = { playing = !playing },
                    onSeek = { playing = false; frame = it },
                )
            }
        }
    }
}

@Composable
private fun RadarMap(
    index: RadarIndex,
    frameIndex: Int,
    loadedFrames: Int,
    options: TileOptions,
    opacity: Float,
    center: GeoPoint?,
    baseMap: String,
    myPosition: GeoPoint?,
    watched: GeoPoint?,
    radiusKm: Double,
    motion: MotionVector?,
    showRadius: Boolean,
    showMotion: Boolean,
    blend: String,
    showCoverage: Boolean,
    coverageHost: String,
    onMapReady: (MapView) -> Unit,
) {
    val context = LocalContext.current
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f

    val baseSource = remember(baseMap, dark) {
        when (baseMap) {
            "light" -> cartoSource("carto-light", "light_all")
            "dark" -> cartoSource("carto-dark", "dark_all")
            "streets" -> XYTileSource(
                "osm", 0, 19, 256, ".png",
                arrayOf("https://tile.openstreetmap.org/"),
                "© Colaboradores de OpenStreetMap",
            )
            "terrain" -> XYTileSource(
                "topo", 0, 17, 256, ".png",
                arrayOf("https://a.tile.opentopomap.org/", "https://b.tile.opentopomap.org/"),
                "© OpenTopoMap (CC-BY-SA)",
            )
            else -> if (dark) cartoSource("carto-dark", "dark_all") else cartoSource("carto-light", "light_all")
        }
    }

    val map = remember {
        org.osmdroid.config.Configuration.getInstance().userAgentValue = "Plou/1.0"
        MapView(context).apply {
            setMultiTouchControls(true)
            controller.setZoom(8.0)
            minZoomLevel = 3.0
        }
    }

    DisposableEffect(Unit) {
        onMapReady(map)
        onDispose { map.onDetach() }
    }

    // Una capa por fotograma, indexadas por la ruta del fotograma. Al refrescar
    // el índice cada cinco minutos sólo cambia uno de los trece: si se
    // recrearan todas, cada refresco vaciaría las teselas ya descargadas y el
    // mapa parpadearía. Así sólo se crea la capa nueva y se descarta la vieja.
    val cache = remember(options) { mutableMapOf<String, TilesOverlay>() }
    val overlays = remember(index, options) {
        val vigentes = index.all.map { it.path }.toSet()
        cache.keys.filterNot { it in vigentes }.forEach { cache.remove(it)?.onDetach(null) }
        index.all.map { frame ->
            cache.getOrPut(frame.path) {
                val provider = MapTileProviderBasic(context, RadarTileSource(index.host, frame.path, options))
                // Sitio de sobra para las teselas visibles de este fotograma:
                // si se evictaran, al volver a mostrarlo habría que pedirlas y
                // el mapa parpadearía en ese paso de la animación.
                provider.tileCache.ensureCapacity(64)
                TilesOverlay(provider, context).apply {
                    loadingBackgroundColor = AndroidColor.TRANSPARENT
                    loadingLineColor = AndroidColor.TRANSPARENT
                }
            }
        }
    }

    // Dos únicos filtros, reutilizados: el visible con la opacidad elegida y el
    // oculto totalmente transparente.
    fun alphaFilter(alpha: Float) = android.graphics.ColorMatrixColorFilter(
        android.graphics.ColorMatrix(
            floatArrayOf(
                1f, 0f, 0f, 0f, 0f,
                0f, 1f, 0f, 0f, 0f,
                0f, 0f, 1f, 0f, 0f,
                0f, 0f, 0f, alpha, 0f,
            ),
        ),
    )
    // En modo «integrado» la capa se funde con el mapa base bajando su opacidad
    // efectiva; en «nítido» se dibuja con los colores exactos de la paleta.
    val visibleFilter = remember(opacity, blend) {
        alphaFilter(if (blend == "blend") opacity * 0.75f else opacity)
    }
    val hiddenFilter = remember { alphaFilter(0f) }
    val marcadores = remember { FolderOverlay() }

    // Capa de zonas sin cobertura de radar. El proveedor sólo la publica hasta
    // el zoom 5; por encima llega vacía.
    val coverage = remember(coverageHost) {
        val fuente = object : OnlineTileSourceBase(
            "cobertura", 0, 5, 512, ".png", arrayOf(""), "© RainViewer",
            TileSourcePolicy(1, TileSourcePolicy.FLAG_NO_BULK),
        ) {
            override fun getTileURLString(pMapTileIndex: Long): String {
                val z = MapTileIndex.getZoom(pMapTileIndex)
                val x = MapTileIndex.getX(pMapTileIndex)
                val y = MapTileIndex.getY(pMapTileIndex)
                return "$coverageHost/v2/coverage/0/512/$z/$x/$y/0/0_0.png"
            }
        }
        TilesOverlay(MapTileProviderBasic(context, fuente), context).apply {
            loadingBackgroundColor = AndroidColor.TRANSPARENT
            loadingLineColor = AndroidColor.TRANSPARENT
        }
    }

    AndroidView(
        factory = { map },
        modifier = Modifier.fillMaxSize(),
        update = { view ->
            // `setTileSource` vacía la caché de teselas y las vuelve a pedir
            // todas, así que sólo puede llamarse cuando el mapa base cambia de
            // verdad: hacerlo en cada recomposición recargaba el mapa entero en
            // cada fotograma de la animación.
            if (view.tileProvider.tileSource !== baseSource) view.setTileSource(baseSource)
            // Sólo se toca la lista de capas cuando cambia el conjunto: rehacerla
            // en cada fotograma reiniciaría el dibujado y volvería a parpadear.
            if (view.overlays.size != overlays.size || !view.overlays.containsAll(overlays)) {
                view.overlays.clear()
                view.overlays.addAll(overlays)
            }
            // Todas las capas quedan activas y dibujando, para que sus teselas se
            // descarguen y permanezcan en caché; entre fotograma y fotograma
            // sólo cambia la opacidad. Si se activaran y desactivaran, cada paso
            // de la animación tendría que pedir sus teselas y el mapa
            // parpadearía en cada salto.
            overlays.forEachIndexed { i, overlay ->
                // Una capa deshabilitada no dibuja ni pide teselas: así la carga
                // se reparte en el tiempo en vez de pedirlo todo a la vez.
                overlay.isEnabled = i < loadedFrames || i == frameIndex
                overlay.setColorFilter(if (i == frameIndex) visibleFilter else hiddenFilter)
            }
            center?.let { if (view.mapCenter.latitude == 0.0) view.controller.setCenter(it) }

            // Marcadores y ayudas: dónde estás, qué se vigila, el radio y hacia
            // dónde se mueve la precipitación.
            marcadores.items.apply {
                clear()
                if (showRadius && watched != null && radiusKm > 0) {
                    add(circulo(watched, radiusKm, BrandPink.toArgb()))
                }
                if (showMotion && watched != null && motion != null) {
                    add(flecha(watched, motion, BrandPink.toArgb()))
                }
                myPosition?.let { add(punto(it, BrandBlue.toArgb())) }
                watched?.let { add(punto(it, BrandPink.toArgb())) }
            }
            // La cobertura va bajo los marcadores y sobre el radar.
            if (showCoverage && !view.overlays.contains(coverage)) {
                view.overlays.add(coverage)
            } else if (!showCoverage) {
                view.overlays.remove(coverage)
            }
            if (!view.overlays.contains(marcadores)) view.overlays.add(marcadores)

            view.invalidate()
        },
    )
}

/** Estado del radar sobre el punto vigilado. */
@Composable
private fun SummaryCard(place: String, analysis: LocationAnalysis, settings: Settings) {
    val overhead = analysis.overhead
    val estado = when {
        overhead != null && overhead.snow -> "Está nevando"
        overhead != null -> "Está lloviendo"
        analysis.nearest != null -> "Precipitación cerca"
        else -> "Sin precipitación cerca"
    }
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            SectionLabel("Datos de hace ${analysis.ageMinutes.toInt()} min")
            Text(estado, style = MaterialTheme.typography.headlineSmall)
            if (place.isNotBlank()) {
                Text(place, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            analysis.nearest?.let {
                DataRow("Más cercano", "${settings.distance(it.distanceKm)} ${it.compass}")
            }
            analysis.motion?.takeIf { it.speedKmh > 2 }?.let {
                DataRow("Se desplaza a", "${it.speedKmh.toInt()} km/h")
            }
            analysis.etaMinutes?.let { DataRow("Llega en", "$it min") }
        }
    }
}

/**
 * Leyenda de intensidad. Plegada es una tira de color; desplegada muestra los
 * valores en mm/h y los umbrales que usan las alarmas. Los colores salen de la
 * misma rampa que las teselas, así que no pueden desajustarse del mapa.
 */
@Composable
private fun Legend(scheme: ColorScheme, showSnow: Boolean) {
    val stops = remember(scheme) { legendFor(scheme) }
    var open by remember { mutableStateOf(false) }
    if (stops.isEmpty()) return

    Column(
        Modifier
            .clip(RoundedCornerShape(if (open) 20.dp else 100.dp))
            .background(Color(0xB314161E))
            .clickable { open = !open }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "Lluvia",
                color = Color.White.copy(alpha = 0.75f),
                style = MaterialTheme.typography.labelSmall,
            )
            stops.forEach { stop ->
                Box(
                    Modifier
                        .size(width = 14.dp, height = 10.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(Color(stop.rain)),
                )
            }
            Text(if (open) "▾" else "▸", color = Color.White.copy(alpha = 0.75f))
        }

        if (open) {
            if (showSnow && stops.any { it.snow != null }) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        "Nieve",
                        color = Color.White.copy(alpha = 0.75f),
                        style = MaterialTheme.typography.labelSmall,
                    )
                    stops.forEach { stop ->
                        Box(
                            Modifier
                                .size(width = 14.dp, height = 10.dp)
                                .clip(RoundedCornerShape(3.dp))
                                .background(stop.snow?.let { Color(it) } ?: Color.Transparent),
                        )
                    }
                }
            }
            // Sólo se rotulan los escalones que coinciden con un umbral de alarma.
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                stops.filter { it.label != null }.forEach { stop ->
                    Column {
                        Text(
                            "%.1f mm/h".format(stop.mmPerHour),
                            color = Color.White,
                            style = MaterialTheme.typography.labelSmall,
                        )
                        Text(
                            stop.label.orEmpty(),
                            color = Color.White.copy(alpha = 0.7f),
                            fontSize = 10.sp,
                        )
                    }
                }
            }
        }
    }
}

/** Barra de reproducción de la animación. */
@Composable
private fun Timeline(
    frames: Int,
    current: Int,
    playing: Boolean,
    label: String,
    onTogglePlay: () -> Unit,
    onSeek: (Int) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(100.dp))
            .background(Color(0x8C14161E))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .size(38.dp)
                .clip(CircleShape)
                .background(BrandGradient)
                .clickable(onClick = onTogglePlay),
            contentAlignment = Alignment.Center,
        ) {
            Text(if (playing) "❚❚" else "▶", color = Color.White, fontWeight = FontWeight.Bold)
        }
        Slider(
            value = current.toFloat(),
            onValueChange = { onSeek(it.toInt()) },
            valueRange = 0f..(frames - 1).coerceAtLeast(1).toFloat(),
            modifier = Modifier.weight(1f),
        )
        Text(label, color = Color.White, fontWeight = FontWeight.Black)
    }
}


/** Botones flotantes del mapa: acercar, alejar y centrar en mi ubicación. */
@Composable
private fun MapControls(
    modifier: Modifier = Modifier,
    onZoomIn: () -> Unit,
    onZoomOut: () -> Unit,
    onLocate: () -> Unit,
    locating: Boolean,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        MapButton("＋", onZoomIn)
        MapButton("−", onZoomOut)
        MapButton(if (locating) "…" else "⌖", onLocate, highlighted = true)
    }
}

@Composable
private fun MapButton(label: String, onClick: () -> Unit, highlighted: Boolean = false) {
    Box(
        Modifier
            .size(44.dp)
            .clip(CircleShape)
            .then(
                if (highlighted) {
                    Modifier.background(BrandGradient)
                } else {
                    Modifier.background(Color(0x8C14161E))
                },
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Color.White, fontWeight = FontWeight.Bold)
    }
}

/**
 * Centra el mapa en la posición del dispositivo y la señala con un punto, para
 * que se vea dónde estás y no sólo que el mapa se ha movido. Se usa el
 * `LocationManager` del sistema, sin depender de los servicios de Google.
 */
private suspend fun centerOnUser(
    context: android.content.Context,
    map: MapView?,
    onBusy: (Boolean) -> Unit,
    onFound: (GeoPoint) -> Unit,
) {
    onBusy(true)
    try {
        val punto = deviceLocation(context) ?: return
        onFound(punto)
        if (map != null) {
            withContext(Dispatchers.Main) {
                map.controller.animateTo(punto)
                map.controller.setZoom(9.0)
            }
        }
    } finally {
        onBusy(false)
    }
}

/** Última posición conocida del dispositivo, o `null` si no hay ninguna. */
internal fun deviceLocation(context: android.content.Context): GeoPoint? {
    val manager = context.getSystemService(android.location.LocationManager::class.java)
        ?: return null
    val proveedores = listOf(
        android.location.LocationManager.GPS_PROVIDER,
        android.location.LocationManager.NETWORK_PROVIDER,
        android.location.LocationManager.PASSIVE_PROVIDER,
    )
    // Se queda con la lectura más reciente de entre los proveedores activos.
    val mejor = proveedores
        .filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }
        .mapNotNull {
            runCatching {
                @Suppress("MissingPermission")
                manager.getLastKnownLocation(it)
            }.getOrNull()
        }
        .maxByOrNull { it.time }
    return mejor?.let { GeoPoint(it.latitude, it.longitude) }
}


/** Punto de color sobre el mapa: dónde estás o qué se está vigilando. */
private fun punto(at: GeoPoint, color: Int): Overlay = object : Overlay() {
    private val relleno = android.graphics.Paint().apply {
        isAntiAlias = true
        this.color = color
        style = android.graphics.Paint.Style.FILL
    }
    private val borde = android.graphics.Paint().apply {
        isAntiAlias = true
        this.color = android.graphics.Color.WHITE
        style = android.graphics.Paint.Style.STROKE
        strokeWidth = 4f
    }

    override fun draw(canvas: android.graphics.Canvas, map: MapView?, shadow: Boolean) {
        if (shadow || map == null) return
        val p = map.projection.toPixels(at, null)
        canvas.drawCircle(p.x.toFloat(), p.y.toFloat(), 11f, relleno)
        canvas.drawCircle(p.x.toFloat(), p.y.toFloat(), 11f, borde)
    }
}


/** Círculo de vigilancia alrededor del punto, en trazo discontinuo. */
private fun circulo(center: GeoPoint, radiusKm: Double, color: Int): Overlay = object : Overlay() {
    private val trazo = android.graphics.Paint().apply {
        isAntiAlias = true
        this.color = color
        style = android.graphics.Paint.Style.STROKE
        strokeWidth = 3f
        pathEffect = android.graphics.DashPathEffect(floatArrayOf(14f, 12f), 0f)
    }

    override fun draw(canvas: android.graphics.Canvas, map: MapView?, shadow: Boolean) {
        if (shadow || map == null) return
        val centro = map.projection.toPixels(center, null)
        // El radio en píxeles se mide proyectando un punto al norte del centro.
        val borde = map.projection.toPixels(
            GeoPoint(center.latitude + radiusKm / KM_PER_LAT_DEGREE, center.longitude),
            null,
        )
        val radio = kotlin.math.hypot(
            (borde.x - centro.x).toDouble(),
            (borde.y - centro.y).toDouble(),
        ).toFloat()
        if (radio > 2f) canvas.drawCircle(centro.x.toFloat(), centro.y.toFloat(), radio, trazo)
    }
}

/** Flecha con el desplazamiento del sistema: una hora de recorrido. */
private fun flecha(from: GeoPoint, motion: MotionVector, color: Int): Overlay = object : Overlay() {
    private val trazo = android.graphics.Paint().apply {
        isAntiAlias = true
        this.color = color
        style = android.graphics.Paint.Style.STROKE
        strokeWidth = 6f
        strokeCap = android.graphics.Paint.Cap.ROUND
    }

    override fun draw(canvas: android.graphics.Canvas, map: MapView?, shadow: Boolean) {
        if (shadow || map == null || motion.speedKmh < 2) return
        val destino = offsetKm(
            LatLon(from.latitude, from.longitude),
            motion.east,
            motion.north,
        )
        val a = map.projection.toPixels(from, null)
        val b = map.projection.toPixels(GeoPoint(destino.lat, destino.lon), null)
        canvas.drawLine(a.x.toFloat(), a.y.toFloat(), b.x.toFloat(), b.y.toFloat(), trazo)

        // Punta de flecha.
        val ang = kotlin.math.atan2((b.y - a.y).toDouble(), (b.x - a.x).toDouble())
        val largo = 22.0
        for (giro in listOf(2.6, -2.6)) {
            canvas.drawLine(
                b.x.toFloat(),
                b.y.toFloat(),
                (b.x + largo * kotlin.math.cos(ang + giro)).toFloat(),
                (b.y + largo * kotlin.math.sin(ang + giro)).toFloat(),
                trazo,
            )
        }
    }
}


/** Aviso corto sobre el estado de la capa de radar. */
@Composable
private fun RadarStatus(
    frames: Int,
    loaded: Int,
    analysis: LocationAnalysis?,
    modifier: Modifier = Modifier,
) {
    val texto = when {
        frames == 0 -> "Cargando el radar…"
        loaded < frames -> "Cargando fotogramas $loaded/$frames"
        analysis == null -> null
        analysis.overhead == null && analysis.nearest == null -> "Sin ecos de precipitación cerca"
        else -> null
    } ?: return

    Text(
        texto,
        color = Color.White,
        style = MaterialTheme.typography.labelSmall,
        modifier = modifier
            .clip(RoundedCornerShape(100.dp))
            .background(Color(0xB314161E))
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}
