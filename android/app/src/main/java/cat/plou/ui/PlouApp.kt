package cat.plou.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cat.plou.R
import cat.plou.data.PlouStore
import cat.plou.data.Settings
import cat.plou.data.WatchedLocation

/** Las cuatro secciones de la aplicación. */
enum class Tab(val label: String) {
    RADAR("Radar"),
    FORECAST("Previsión"),
    ALARMS("Alarmas"),
    SETTINGS("Ajustes"),
}

@Composable
fun PlouApp(store: PlouStore, settings: Settings) {
    var tab by rememberSaveable { mutableStateOf(Tab.RADAR) }
    val locations by store.locations.collectAsState(initial = emptyList())

    // Punto activo: la primera ubicación guardada, o el centro por defecto.
    var point by remember { mutableStateOf<WatchedLocation?>(null) }
    // La ubicación que sigue al dispositivo nace en 0,0 y sólo tiene posición
    // real después de la primera comprobación: no puede ser el punto por
    // defecto, o el mapa se abriría en mitad del Atlántico.
    val active = point ?: locations.firstOrNull {
        !it.followDevice || it.lat != 0.0 || it.lon != 0.0
    } ?: locations.firstOrNull()

    // El mapa ocupa toda la pantalla y pasa por debajo de la barra superior; el
    // resto de secciones empiezan justo debajo de ella. La altura de la barra se
    // mide para no tener que suponerla.
    val density = LocalDensity.current
    var barHeight by remember { mutableStateOf(0.dp) }

    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        when (tab) {
            Tab.RADAR ->
                RadarScreen(store, settings, active, locations, barHeight) { point = it }
            Tab.FORECAST ->
                ForecastScreen(active, settings, locations, barHeight) { point = it }
            Tab.ALARMS -> AlarmsScreen(store, locations, barHeight) { point = it }
            Tab.SETTINGS -> SettingsScreen(store, settings, barHeight)
        }

        TabSwitch(
            current = tab,
            onSelect = { tab = it },
            modifier = Modifier
                .align(Alignment.TopCenter)
                .onSizeChanged { barHeight = with(density) { it.height.toDp() } },
        )
    }
}

/**
 * Conmutador de cuatro estados en cápsula: la sección activa lleva el degradado
 * de marca, que es el único elemento con degradado de cada pantalla.
 */
@Composable
private fun TabSwitch(current: Tab, onSelect: (Tab) -> Unit, modifier: Modifier = Modifier) {
    val fondo = MaterialTheme.colorScheme.background
    Row(
        modifier
            .fillMaxWidth()
            // Degradado de fondo: el mapa se ve por debajo pero los iconos y la
            // barra de estado siguen legibles sobre él.
            .background(
                Brush.verticalGradient(
                    listOf(fondo.copy(alpha = 0.92f), fondo.copy(alpha = 0.75f), Color.Transparent),
                ),
            )
            .statusBarsPadding()
            .padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 16.dp)
            .clip(RoundedCornerShape(100.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.92f))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Tab.entries.forEach { entry ->
            val selected = entry == current
            val shape = RoundedCornerShape(100.dp)
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clip(shape)
                    .then(if (selected) Modifier.background(BrandGradient, shape) else Modifier)
                    .clickable { onSelect(entry) }
                    .padding(vertical = 9.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    painterResource(iconFor(entry)),
                    contentDescription = null,
                    tint = if (selected) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(17.dp),
                )
                // En pantallas estrechas el icono basta; con sitio, se rotula.
                Text(
                    entry.label,
                    color = if (selected) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                    modifier = Modifier.padding(start = 6.dp),
                )
            }
        }
    }
}

private fun iconFor(tab: Tab): Int = when (tab) {
    Tab.RADAR -> R.drawable.ic_tab_radar
    Tab.FORECAST -> R.drawable.ic_tab_cloud
    Tab.ALARMS -> R.drawable.ic_tab_bell
    Tab.SETTINGS -> R.drawable.ic_tab_gear
}

/** Cabecera de sección reutilizable. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    )
}

/** Fila de etiqueta y valor, como en las tarjetas de datos. */
@Composable
fun DataRow(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
fun EmptyHint(text: String) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}


/**
 * Botón que despliega las ubicaciones guardadas y, en el radar, permite vigilar
 * el punto que se está mirando. Es el equivalente del que hay en la versión web.
 */
@Composable
fun LocationMenu(
    locations: List<WatchedLocation>,
    active: WatchedLocation?,
    onSelect: (WatchedLocation) -> Unit,
    onWatchHere: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(
            Modifier
                .clip(RoundedCornerShape(100.dp))
                .background(BrandGradient)
                .clickable { open = true }
                .padding(horizontal = 14.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                painterResource(R.drawable.ic_tab_radar),
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size(16.dp),
            )
            Text(
                active?.name ?: "Elegir ubicación",
                color = Color.White,
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp,
                maxLines = 1,
                modifier = Modifier.padding(start = 6.dp),
            )
        }

        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Text(
                "MIS UBICACIONES",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 12.dp, top = 8.dp, bottom = 4.dp),
            )
            if (locations.isEmpty()) {
                DropdownMenuItem(
                    text = { Text("Todavía no hay ninguna", color = MaterialTheme.colorScheme.onSurfaceVariant) },
                    onClick = { open = false },
                )
            }
            locations.forEach { location ->
                DropdownMenuItem(
                    text = {
                        Text(
                            location.name,
                            fontWeight = if (location.id == active?.id) FontWeight.Bold else FontWeight.Normal,
                        )
                    },
                    onClick = { onSelect(location); open = false },
                )
            }
            if (onWatchHere != null) {
                HorizontalDivider()
                DropdownMenuItem(
                    text = { Text("＋ Vigilar este punto", fontWeight = FontWeight.Bold) },
                    onClick = { onWatchHere(); open = false },
                )
            }
        }
    }
}
