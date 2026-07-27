package cat.plou.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
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
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                Tab.entries.forEach { entry ->
                    NavigationBarItem(
                        selected = tab == entry,
                        onClick = { tab = entry },
                        icon = { TabIcon(entry, selected = tab == entry) },
                        label = { Text(entry.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.onPrimary,
                            indicatorColor = Color.Transparent,
                        ),
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (tab) {
                Tab.RADAR -> RadarScreen(store, settings, active)
                Tab.FORECAST -> ForecastScreen(active)
                Tab.ALARMS -> AlarmsScreen(store, locations) { point = it }
                Tab.SETTINGS -> SettingsScreen(store, settings)
            }
        }
    }
}

/** Icono de pestaña; la activa lleva el degradado de marca. */
@Composable
private fun TabIcon(tab: Tab, selected: Boolean) {
    val icon = when (tab) {
        Tab.RADAR -> R.drawable.ic_tab_radar
        Tab.FORECAST -> R.drawable.ic_tab_cloud
        Tab.ALARMS -> R.drawable.ic_tab_bell
        Tab.SETTINGS -> R.drawable.ic_tab_gear
    }
    if (selected) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(BrandGradient),
            contentAlignment = Alignment.Center,
        ) {
            Icon(painterResource(icon), contentDescription = tab.label, tint = Color.White)
        }
    } else {
        Icon(
            painterResource(icon),
            contentDescription = tab.label,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
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
