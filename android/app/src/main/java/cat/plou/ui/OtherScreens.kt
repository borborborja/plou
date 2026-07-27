package cat.plou.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cat.plou.alarm.WatchService
import cat.plou.data.AlarmConfigDto
import cat.plou.data.PlouStore
import cat.plou.data.Settings
import cat.plou.data.temperature
import cat.plou.data.WatchedLocation
import cat.plou.forecast.Forecast
import cat.plou.forecast.OpenMeteoClient
import cat.plou.forecast.Place
import cat.plou.forecast.weatherText
import cat.plou.radar.ColorScheme
import cat.plou.radar.Intensity
import cat.plou.radar.LatLon
import kotlinx.coroutines.launch

/** Tarjeta del sistema de diseño. */
@Composable
private fun PlouCard(content: @Composable () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(18.dp)) { content() }
    }
}

// --------------------------------------------------------------------------
// Previsión
// --------------------------------------------------------------------------

@Composable
fun ForecastScreen(active: WatchedLocation?, settings: Settings) {
    val client = remember { OpenMeteoClient() }
    var forecast by remember { mutableStateOf<Forecast?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(active?.id) {
        val point = active ?: return@LaunchedEffect
        runCatching { client.forecast(LatLon(point.lat, point.lon)) }
            .onSuccess { forecast = it; error = null }
            .onFailure { error = "No se ha podido cargar la previsión" }
    }

    if (active == null) {
        EmptyHint("Añade una ubicación para ver su previsión.")
        return
    }
    val data = forecast
    if (data == null) {
        EmptyHint(error ?: "Cargando la previsión…")
        return
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PlouCard {
                val current = data.current
                Text(
                    settings.temperature(current?.temperature),
                    style = MaterialTheme.typography.displayLarge,
                )
                Text(weatherText(current?.weatherCode), style = MaterialTheme.typography.titleMedium)
                Text(active.name, color = MaterialTheme.colorScheme.onSurfaceVariant)
                HorizontalDivider(Modifier.padding(vertical = 10.dp))
                current?.apparent?.let { DataRow("Sensación", settings.temperature(it)) }
                current?.humidity?.let { DataRow("Humedad", "$it %") }
                current?.windSpeed?.let { DataRow("Viento", "${it.toInt()} km/h") }
                current?.windGust?.let { DataRow("Rachas", "${it.toInt()} km/h") }
                current?.pressure?.let { DataRow("Presión", "${it.toInt()} hPa") }
                current?.cloudCover?.let { DataRow("Nubosidad", "$it %") }
            }
        }
        item {
            PlouCard {
                SectionLabel("Por horas")
                data.hourly.take(12).forEach { hour ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 5.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(hour.time.takeLast(5), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(settings.temperature(hour.temperature), fontWeight = FontWeight.Bold)
                        Text(
                            hour.precipitation?.takeIf { it > 0 }?.let { "%.1f mm".format(it) }
                                ?: "${hour.probability ?: 0} %",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        item {
            PlouCard {
                SectionLabel("Próximos días")
                data.daily.forEach { day ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 5.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(day.date, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(weatherText(day.weatherCode))
                        Text(
                            "${settings.temperature(day.min)} / ${settings.temperature(day.max)}",
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
}

// --------------------------------------------------------------------------
// Alarmas
// --------------------------------------------------------------------------

@Composable
fun AlarmsScreen(
    store: PlouStore,
    locations: List<WatchedLocation>,
    onSelect: (WatchedLocation) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val client = remember { OpenMeteoClient() }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Place>>(emptyList()) }
    var editing by remember { mutableStateOf<WatchedLocation?>(null) }
    val events by store.events.collectAsState(initial = emptyList())

    val target = editing
    if (target != null) {
        AlarmEditor(
            location = target,
            onSave = { updated ->
                scope.launch { store.upsert(updated) }
                editing = null
            },
            onCancel = { editing = null },
        )
        return
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PlouCard {
                SectionLabel("Añadir ubicación")
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = { Text("Buscar una localidad…") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    keyboardActions = KeyboardActions(onDone = {
                        scope.launch { results = runCatching { client.search(query) }.getOrDefault(emptyList()) }
                    }),
                )
                Button(
                    onClick = {
                        scope.launch { results = runCatching { client.search(query) }.getOrDefault(emptyList()) }
                    },
                    modifier = Modifier.padding(top = 8.dp),
                ) { Text("Buscar") }

                results.forEach { place ->
                    TextButton(onClick = {
                        scope.launch {
                            store.upsert(
                                WatchedLocation(
                                    id = System.currentTimeMillis(),
                                    name = place.name,
                                    lat = place.lat,
                                    lon = place.lon,
                                ),
                            )
                            results = emptyList()
                            query = ""
                        }
                    }) {
                        Text("${place.name}${place.region?.let { " · $it" } ?: ""}")
                    }
                }
            }
        }

        items(locations, key = { it.id }) { location ->
            PlouCard {
                Text(location.name, style = MaterialTheme.typography.titleMedium)
                Text(
                    buildString {
                        append(if (location.alarm.enabled) "Alarma activa" else "Alarma desactivada")
                        append(" · ${location.alarm.radiusKm.toInt()} km")
                        append(" · ${Intensity.valueOf(location.alarm.intensity).label}")
                    },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { onSelect(location) }) { Text("Ver en el radar") }
                    TextButton(onClick = { editing = location }) { Text("Editar") }
                    TextButton(onClick = { scope.launch { store.remove(location.id) } }) {
                        Text("Eliminar", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }

        item {
            PlouCard {
                SectionLabel("Historial de avisos")
                if (events.isEmpty()) {
                    Text(
                        "Todavía no se ha emitido ningún aviso.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    events.take(10).forEach {
                        Column(Modifier.padding(vertical = 6.dp)) {
                            Text(it.title, fontWeight = FontWeight.Bold)
                            Text(it.body, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

/** Configuración de la alarma de una ubicación. */
@Composable
private fun AlarmEditor(
    location: WatchedLocation,
    onSave: (WatchedLocation) -> Unit,
    onCancel: () -> Unit,
) {
    var alarm by remember { mutableStateOf(location.alarm) }

    LazyColumn(
        Modifier.fillMaxSize().padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PlouCard {
                Text(location.name, style = MaterialTheme.typography.titleMedium)

                Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Avisar en esta ubicación")
                    Switch(
                        checked = alarm.enabled,
                        onCheckedChange = { alarm = alarm.copy(enabled = it) },
                    )
                }

                Text("Radio de vigilancia: ${alarm.radiusKm.toInt()} km", Modifier.padding(top = 12.dp))
                Slider(
                    value = alarm.radiusKm.toFloat(),
                    onValueChange = { alarm = alarm.copy(radiusKm = it.toDouble()) },
                    valueRange = 1f..100f,
                )

                SectionLabel("Sensibilidad")
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Intensity.entries.forEach { level ->
                        TextButton(onClick = { alarm = alarm.copy(intensity = level.name) }) {
                            Text(
                                level.label,
                                fontWeight = if (alarm.intensity == level.name) {
                                    FontWeight.Bold
                                } else {
                                    FontWeight.Normal
                                },
                            )
                        }
                    }
                }

                ToggleRow("Detectar lluvia", alarm.detectRain) { alarm = alarm.copy(detectRain = it) }
                ToggleRow("Detectar nieve", alarm.detectSnow) { alarm = alarm.copy(detectSnow = it) }

                SectionLabel("Cuándo avisar")
                listOf(
                    "OVERHEAD" to "Sólo cuando llueva encima",
                    "IN_RADIUS" to "Cuando haya lluvia en el radio",
                    "APPROACHING" to "Cuando se acerque lluvia",
                ).forEach { (value, label) ->
                    TextButton(onClick = { alarm = alarm.copy(mode = value) }) {
                        Text(
                            label,
                            fontWeight = if (alarm.mode == value) FontWeight.Bold else FontWeight.Normal,
                        )
                    }
                }

                Text("Antelación máxima: ${alarm.leadMinutes} min", Modifier.padding(top = 8.dp))
                Slider(
                    value = alarm.leadMinutes.toFloat(),
                    onValueChange = { alarm = alarm.copy(leadMinutes = it.toInt()) },
                    valueRange = 5f..120f,
                )

                ToggleRow("Repetir mientras dure", alarm.repeat) { alarm = alarm.copy(repeat = it) }
                ToggleRow("Avisar cuando escampe", alarm.notifyOnClear) {
                    alarm = alarm.copy(notifyOnClear = it)
                }
                ToggleRow("Horas de silencio (22:00–07:00)", alarm.quietEnabled) {
                    alarm = alarm.copy(quietEnabled = it)
                }

                Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = onCancel) { Text("Cancelar") }
                    Button(onClick = { onSave(location.copy(alarm = alarm)) }) { Text("Guardar") }
                }
            }
        }
    }
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

// --------------------------------------------------------------------------
// Ajustes
// --------------------------------------------------------------------------

/** Fila de opciones excluyentes en cápsulas. */
@Composable
private fun <T> ChoiceRow(label: String, value: T, options: List<Pair<T, String>>, onSelect: (T) -> Unit) {
    Column(Modifier.padding(vertical = 6.dp)) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
            items(options) { (opcion, etiqueta) ->
                val selected = opcion == value
                Text(
                    etiqueta,
                    color = if (selected) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier
                        .clip(RoundedCornerShape(100.dp))
                        .then(
                            if (selected) {
                                Modifier.background(BrandGradient)
                            } else {
                                Modifier.background(MaterialTheme.colorScheme.surfaceVariant)
                            },
                        )
                        .clickable { onSelect(opcion) }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
fun SettingsScreen(store: PlouStore, settings: Settings) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    fun save(next: Settings) = scope.launch { store.saveSettings(next) }

    LazyColumn(
        Modifier.fillMaxSize().padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PlouCard {
                SectionLabel("Vigilancia")
                Text(
                    "Plou comprueba el radar en segundo plano con un servicio en primer " +
                        "plano: es lo que permite que el aviso suene con la pantalla apagada.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
                ToggleRow("Vigilar el radar", settings.watching) { on ->
                    save(settings.copy(watching = on))
                    if (on) WatchService.start(context) else WatchService.stop(context)
                }
                Text("Comprobar cada ${settings.checkIntervalMinutes} min", Modifier.padding(top = 10.dp))
                Slider(
                    value = settings.checkIntervalMinutes.toFloat(),
                    onValueChange = { save(settings.copy(checkIntervalMinutes = it.toInt())) },
                    valueRange = 2f..30f,
                )
                Text(
                    "Comprobar más a menudo detecta antes la lluvia, pero gasta más batería " +
                        "y más datos.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        item {
            PlouCard {
                SectionLabel("Capa de radar")
                ChoiceRow(
                    "Escala de color",
                    settings.colorScheme,
                    ColorScheme.entries.map { it.id to it.label },
                ) { save(settings.copy(colorScheme = it)) }

                Text("Opacidad: ${(settings.opacity * 100).toInt()} %", Modifier.padding(top = 10.dp))
                Slider(
                    value = settings.opacity,
                    onValueChange = { save(settings.copy(opacity = it)) },
                    valueRange = 0.2f..1f,
                )
                ToggleRow("Suavizado", settings.smooth) { save(settings.copy(smooth = it)) }
                ToggleRow("Distinguir nieve", settings.showSnow) { save(settings.copy(showSnow = it)) }
            }
        }

        item {
            PlouCard {
                SectionLabel("Animación")
                ChoiceRow(
                    "Historia",
                    settings.historyMinutes,
                    listOf(30 to "30 min", 60 to "1 h", 120 to "2 h"),
                ) { save(settings.copy(historyMinutes = it)) }
                ChoiceRow(
                    "Velocidad",
                    settings.frameDurationMs,
                    listOf(800 to "Lenta", 420 to "Normal", 200 to "Rápida"),
                ) { save(settings.copy(frameDurationMs = it)) }
            }
        }

        item {
            PlouCard {
                SectionLabel("Mapa base")
                ChoiceRow(
                    "Mapa",
                    settings.baseMap,
                    listOf(
                        "auto" to "Según el tema",
                        "light" to "Claro",
                        "dark" to "Oscuro",
                        "streets" to "OpenStreetMap",
                        "terrain" to "Topográfico",
                    ),
                ) { save(settings.copy(baseMap = it)) }
            }
        }

        item {
            PlouCard {
                SectionLabel("Aspecto")
                ChoiceRow(
                    "Tema",
                    settings.theme,
                    listOf("auto" to "Según el sistema", "light" to "Claro", "dark" to "Oscuro"),
                ) { save(settings.copy(theme = it)) }
            }
        }

        item {
            PlouCard {
                SectionLabel("Unidades")
                ChoiceRow(
                    "Temperatura",
                    settings.temperatureUnit,
                    listOf("C" to "°C", "F" to "°F"),
                ) { save(settings.copy(temperatureUnit = it)) }
                ChoiceRow(
                    "Distancia",
                    settings.distanceUnit,
                    listOf("km" to "km", "mi" to "mi"),
                ) { save(settings.copy(distanceUnit = it)) }
            }
        }

        item {
            PlouCard {
                SectionLabel("Fuentes de datos")
                Text(
                    "Radar: RainViewer · Previsión y búsqueda: Open-Meteo · " +
                        "Mapa base: OpenStreetMap, CARTO y OpenTopoMap",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "Todo el análisis ocurre en este dispositivo: no hay servidor propio " +
                        "ni cuenta de usuario.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}
