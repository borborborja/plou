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
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
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
    val active = point ?: locations.firstOrNull()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { TabSwitch(current = tab, onSelect = { tab = it }) },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (tab) {
                Tab.RADAR -> RadarScreen(store, settings, active)
                Tab.FORECAST -> ForecastScreen(active, settings)
                Tab.ALARMS -> AlarmsScreen(store, locations) { point = it }
                Tab.SETTINGS -> SettingsScreen(store, settings)
            }
        }
    }
}

/**
 * Conmutador de cuatro estados en cápsula: la sección activa lleva el degradado
 * de marca, que es el único elemento con degradado de cada pantalla.
 */
@Composable
private fun TabSwitch(current: Tab, onSelect: (Tab) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .clip(RoundedCornerShape(100.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
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
