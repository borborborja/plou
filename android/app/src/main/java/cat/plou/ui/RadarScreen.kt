package cat.plou.ui

import android.graphics.Color as AndroidColor
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import cat.plou.data.PlouStore
import cat.plou.data.Settings
import cat.plou.data.WatchedLocation
import cat.plou.radar.AnalyzeOptions
import cat.plou.radar.AndroidTileSource
import cat.plou.radar.ColorScheme
import cat.plou.radar.Intensity
import cat.plou.radar.LatLon
import cat.plou.radar.LocationAnalysis
import cat.plou.radar.RadarIndex
import cat.plou.radar.RadarIndexClient
import cat.plou.radar.TileOptions
import cat.plou.radar.analyzeLocation
import cat.plou.radar.legendFor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.osmdroid.tileprovider.MapTileProviderBasic
import org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase
import org.osmdroid.tileprovider.tilesource.TileSourcePolicy
import org.osmdroid.tileprovider.tilesource.XYTileSource
import org.osmdroid.util.GeoPoint
import org.osmdroid.util.MapTileIndex
import org.osmdroid.views.MapView
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

/** Fuente de teselas de un fotograma concreto del radar. */
private class RadarTileSource(
    private val index: RadarIndex,
    private val frameIndex: Int,
    private val options: TileOptions,
) : OnlineTileSourceBase(
    "radar-$frameIndex", 0, 7, options.size, ".png", arrayOf(""),
    "© RainViewer",
    TileSourcePolicy(2, TileSourcePolicy.FLAG_NO_BULK or TileSourcePolicy.FLAG_NO_PREVENTIVE),
) {
    override fun getTileURLString(pMapTileIndex: Long): String {
        val frame = index.all.getOrNull(frameIndex) ?: return ""
        val z = MapTileIndex.getZoom(pMapTileIndex)
        val x = MapTileIndex.getX(pMapTileIndex)
        val y = MapTileIndex.getY(pMapTileIndex)
        val smooth = if (options.smooth) 1 else 0
        val snow = if (options.snow) 1 else 0
        return "${index.host}${frame.path}/${options.size}/$z/$x/$y/${options.color}/${smooth}_$snow.png"
    }
}

/**
 * Pantalla de radar: mapa a sangre con la animación de los últimos fotogramas,
 * la leyenda de intensidad y el estado del punto vigilado.
 */
@Composable
fun RadarScreen(store: PlouStore, settings: Settings, active: WatchedLocation?) {
    val context = LocalContext.current
    var index by remember { mutableStateOf<RadarIndex?>(null) }
    var frame by remember { mutableIntStateOf(0) }
    var playing by remember { mutableStateOf(true) }
    var analysis by remember { mutableStateOf<LocationAnalysis?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val client = remember { RadarIndexClient() }
    val scheme = remember(settings.colorScheme) { ColorScheme.byId(settings.colorScheme) }
    val tileOptions = remember(settings) {
        TileOptions(color = settings.colorScheme, smooth = settings.smooth, snow = settings.showSnow)
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

    val frames = index?.all ?: emptyList()

    // Animación.
    LaunchedEffect(playing, frames.size, settings.frameDurationMs) {
        if (!playing || frames.size < 2) return@LaunchedEffect
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
                options = tileOptions,
                opacity = settings.opacity,
                center = active?.let { GeoPoint(it.lat, it.lon) },
            )
        }

        Column(
            Modifier.align(Alignment.BottomCenter).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            analysis?.let { SummaryCard(active?.name.orEmpty(), it) }
            Legend(scheme)
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
    options: TileOptions,
    opacity: Float,
    center: GeoPoint?,
) {
    val context = LocalContext.current
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f

    val map = remember {
        org.osmdroid.config.Configuration.getInstance().userAgentValue = "Plou/1.0"
        MapView(context).apply {
            setMultiTouchControls(true)
            controller.setZoom(8.0)
            minZoomLevel = 3.0
        }
    }

    DisposableEffect(Unit) { onDispose { map.onDetach() } }

    // Una capa por fotograma: se alternan por visibilidad para que la animación
    // no parpadee mientras se descargan las teselas.
    val overlays = remember(index, options) {
        index.all.indices.map { i ->
            val provider = MapTileProviderBasic(context, RadarTileSource(index, i, options))
            TilesOverlay(provider, context).apply {
                loadingBackgroundColor = AndroidColor.TRANSPARENT
                loadingLineColor = AndroidColor.TRANSPARENT
                isEnabled = false
            }
        }
    }

    AndroidView(
        factory = { map },
        modifier = Modifier.fillMaxSize(),
        update = { view ->
            view.setTileSource(if (dark) cartoSource("carto-dark", "dark_all") else cartoSource("carto-light", "light_all"))
            if (view.overlays.isEmpty()) overlays.forEach { view.overlays.add(it) }
            val matrix = android.graphics.ColorMatrix(
                floatArrayOf(
                    1f, 0f, 0f, 0f, 0f,
                    0f, 1f, 0f, 0f, 0f,
                    0f, 0f, 1f, 0f, 0f,
                    0f, 0f, 0f, opacity, 0f,
                ),
            )
            val filter = android.graphics.ColorMatrixColorFilter(matrix)
            overlays.forEachIndexed { i, overlay ->
                overlay.isEnabled = i == frameIndex
                overlay.setColorFilter(filter)
            }
            center?.let { if (view.mapCenter.latitude == 0.0) view.controller.setCenter(it) }
            view.invalidate()
        },
    )
}

/** Estado del radar sobre el punto vigilado. */
@Composable
private fun SummaryCard(place: String, analysis: LocationAnalysis) {
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
                DataRow("Más cercano", "${"%.1f".format(it.distanceKm)} km ${it.compass}")
            }
            analysis.motion?.takeIf { it.speedKmh > 2 }?.let {
                DataRow("Se desplaza a", "${it.speedKmh.toInt()} km/h")
            }
            analysis.etaMinutes?.let { DataRow("Llega en", "$it min") }
        }
    }
}

/** Leyenda de intensidad, con los colores de la propia paleta. */
@Composable
private fun Legend(scheme: ColorScheme) {
    val stops = remember(scheme) { legendFor(scheme) }
    Row(
        Modifier
            .clip(RoundedCornerShape(100.dp))
            .background(Color(0x8C14161E))
            .padding(horizontal = 12.dp, vertical = 6.dp)
            .horizontalScroll(rememberScrollState()),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("mm/h", color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall)
        stops.forEach { stop ->
            Box(
                Modifier
                    .size(width = 16.dp, height = 10.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(Color(stop.rain)),
            )
        }
        Text(
            "${stops.firstOrNull()?.mmPerHour?.let { "%.1f".format(it) }}–${stops.lastOrNull()?.mmPerHour?.toInt()}",
            color = Color.White,
            style = MaterialTheme.typography.labelSmall,
        )
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
