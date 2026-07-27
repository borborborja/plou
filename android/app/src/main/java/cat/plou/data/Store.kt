package cat.plou.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import cat.plou.alarm.AlarmConfig
import cat.plou.alarm.AlarmKind
import cat.plou.alarm.AlarmMode
import cat.plou.alarm.AlarmState
import cat.plou.alarm.TimeWindow
import cat.plou.radar.Intensity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** Una ubicación vigilada, con su alarma y su estado. */
@Serializable
data class WatchedLocation(
    val id: Long,
    val name: String,
    val lat: Double,
    val lon: Double,
    val alarm: AlarmConfigDto = AlarmConfigDto(),
    val state: AlarmStateDto = AlarmStateDto(),
    /**
     * Si es cierto, la ubicación no es un punto fijo sino tu posición: antes de
     * cada comprobación se actualiza con la última lectura del dispositivo, de
     * modo que el aviso depende de dónde estés en cada momento.
     */
    val followDevice: Boolean = false,
)

/** Identificador reservado para la alarma que sigue tu posición. */
const val FOLLOW_DEVICE_ID = 1L

/** Copia serializable de la configuración de alarma. */
@Serializable
data class AlarmConfigDto(
    val enabled: Boolean = true,
    val radiusKm: Double = 20.0,
    val intensity: String = "LIGHT",
    val detectRain: Boolean = true,
    val detectSnow: Boolean = false,
    val mode: String = "IN_RADIUS",
    val leadMinutes: Int = 30,
    val minSpeedKmh: Double = 5.0,
    val repeat: Boolean = false,
    val repeatMinutes: Int = 30,
    val minIntervalMinutes: Int = 60,
    val notifyOnClear: Boolean = false,
    val snoozeMinutes: Int = 30,
    val quietEnabled: Boolean = false,
    val quietFrom: String = "22:00",
    val quietTo: String = "07:00",
    val quietDays: List<Int> = emptyList(),
    val scheduleEnabled: Boolean = false,
    val scheduleFrom: String = "08:00",
    val scheduleTo: String = "20:00",
    val scheduleDays: List<Int> = emptyList(),
    /** Tono de la alarma: uno de los ocho sintetizados. */
    val tone: String = "CLASSIC",
    val volume: Float = 0.8f,
    val vibrate: Boolean = true,
    /** Repetir el sonido hasta descartar el aviso. */
    val loopSound: Boolean = false,
    val soundSeconds: Int = 10,
    val fadeIn: Boolean = false,
) {
    fun toConfig(): AlarmConfig = AlarmConfig(
        enabled = enabled,
        radiusKm = radiusKm,
        intensity = runCatching { Intensity.valueOf(intensity) }.getOrDefault(Intensity.LIGHT),
        detectRain = detectRain,
        detectSnow = detectSnow,
        mode = runCatching { AlarmMode.valueOf(mode) }.getOrDefault(AlarmMode.IN_RADIUS),
        leadMinutes = leadMinutes,
        minSpeedKmh = minSpeedKmh,
        repeat = repeat,
        repeatMinutes = repeatMinutes,
        minIntervalMinutes = minIntervalMinutes,
        notifyOnClear = notifyOnClear,
        snoozeMinutes = snoozeMinutes,
        quietHours = TimeWindow(quietEnabled, quietFrom, quietTo, quietDays),
        schedule = TimeWindow(scheduleEnabled, scheduleFrom, scheduleTo, scheduleDays),
    )
}

@Serializable
data class AlarmStateDto(
    val active: Boolean = false,
    val activeKind: String? = null,
    val lastFiredAt: Long? = null,
    val lastClearedAt: Long? = null,
    val lastCheckedAt: Long? = null,
    val snoozedUntil: Long? = null,
) {
    fun toState(): AlarmState = AlarmState(
        active = active,
        activeKind = activeKind?.let { runCatching { AlarmKind.valueOf(it) }.getOrNull() },
        lastFiredAt = lastFiredAt,
        lastClearedAt = lastClearedAt,
        lastCheckedAt = lastCheckedAt,
        snoozedUntil = snoozedUntil,
    )

    companion object {
        fun from(state: AlarmState) = AlarmStateDto(
            active = state.active,
            activeKind = state.activeKind?.name,
            lastFiredAt = state.lastFiredAt,
            lastClearedAt = state.lastClearedAt,
            lastCheckedAt = state.lastCheckedAt,
            snoozedUntil = state.snoozedUntil,
        )
    }
}

/** Un aviso emitido, para el historial. */
@Serializable
data class AlarmEvent(
    val at: Long,
    val locationName: String,
    val title: String,
    val body: String,
)

/** Preferencias de la aplicación. */
@Serializable
data class Settings(
    val colorScheme: Int = 2,
    val smooth: Boolean = true,
    val showSnow: Boolean = true,
    val opacity: Float = 0.85f,
    /** `auto`, `light` o `dark`. */
    val theme: String = "auto",
    /** Minutos de historia que se animan. */
    val historyMinutes: Int = 120,
    /** Milisegundos por fotograma. */
    val frameDurationMs: Int = 420,
    /** Minutos entre comprobaciones del vigilante. */
    val checkIntervalMinutes: Int = 5,
    val watching: Boolean = false,
    /** `auto`, `light`, `dark`, `streets` o `terrain`. */
    val baseMap: String = "auto",
    /** `C` o `F`. */
    val temperatureUnit: String = "C",
    /** `km` o `mi`. */
    val distanceUnit: String = "km",
    /** Círculo del radio de vigilancia sobre el mapa. */
    val showRadius: Boolean = true,
    /** Flecha con el desplazamiento del sistema precipitante. */
    val showMotionArrow: Boolean = true,
    /** Capa que marca las zonas sin cobertura de radar. */
    val showCoverage: Boolean = false,
    /**
     * `plain` dibuja la capa con los colores exactos de la paleta; `blend` la
     * integra en el mapa base, más bonito pero menos visible.
     */
    val blend: String = "plain",
)

/** Temperatura en la unidad elegida. */
fun Settings.temperature(celsius: Double?): String {
    if (celsius == null) return "—"
    return if (temperatureUnit == "F") "${(celsius * 9 / 5 + 32).toInt()}°F" else "${celsius.toInt()}°"
}

/** Distancia en la unidad elegida. */
fun Settings.distance(km: Double): String =
    if (distanceUnit == "mi") "%.1f mi".format(km * 0.621371) else "%.1f km".format(km)

private val Context.dataStore by preferencesDataStore(name = "plou")

private val KEY_LOCATIONS = stringPreferencesKey("locations")
private val KEY_SETTINGS = stringPreferencesKey("settings")
private val KEY_EVENTS = stringPreferencesKey("events")

/**
 * Almacén local. Todo vive en el dispositivo: no hay cuenta ni servidor.
 */
class PlouStore(private val context: Context) {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    val locations: Flow<List<WatchedLocation>> =
        context.dataStore.data.map { decodeLocations(it) }

    val settings: Flow<Settings> = context.dataStore.data.map { prefs ->
        prefs[KEY_SETTINGS]?.let { runCatching { json.decodeFromString<Settings>(it) }.getOrNull() }
            ?: Settings()
    }

    val events: Flow<List<AlarmEvent>> = context.dataStore.data.map { prefs ->
        prefs[KEY_EVENTS]?.let {
            runCatching { json.decodeFromString<List<AlarmEvent>>(it) }.getOrNull()
        } ?: emptyList()
    }

    private fun decodeLocations(prefs: Preferences): List<WatchedLocation> =
        prefs[KEY_LOCATIONS]?.let {
            runCatching { json.decodeFromString<List<WatchedLocation>>(it) }.getOrNull()
        } ?: emptyList()

    /**
     * Lectura puntual. Se usa `data.first()` y no `edit`: `edit` abre una
     * transacción de escritura, reescribe el fichero aunque no cambie nada y
     * hace que el flujo vuelva a emitir, lo que provocaba escrituras y
     * recomposiciones en cada ciclo del vigilante.
     */
    suspend fun currentLocations(): List<WatchedLocation> =
        decodeLocations(context.dataStore.data.first())

    suspend fun saveLocations(list: List<WatchedLocation>) {
        context.dataStore.edit { it[KEY_LOCATIONS] = json.encodeToString(list) }
    }

    suspend fun upsert(location: WatchedLocation) {
        context.dataStore.edit { prefs ->
            val list = decodeLocations(prefs).toMutableList()
            val i = list.indexOfFirst { it.id == location.id }
            if (i >= 0) list[i] = location else list.add(location)
            prefs[KEY_LOCATIONS] = json.encodeToString(list.toList())
        }
    }

    suspend fun remove(id: Long) {
        context.dataStore.edit { prefs ->
            val list = decodeLocations(prefs).filterNot { it.id == id }
            prefs[KEY_LOCATIONS] = json.encodeToString(list)
        }
    }

    suspend fun currentSettings(): Settings =
        context.dataStore.data.first()[KEY_SETTINGS]?.let {
            runCatching { json.decodeFromString<Settings>(it) }.getOrNull()
        } ?: Settings()

    suspend fun saveSettings(settings: Settings) {
        context.dataStore.edit { it[KEY_SETTINGS] = json.encodeToString(settings) }
    }

    /** Guarda un aviso en el historial, conservando los 50 últimos. */
    suspend fun addEvent(event: AlarmEvent) {
        context.dataStore.edit { prefs ->
            val list = prefs[KEY_EVENTS]?.let {
                runCatching { json.decodeFromString<List<AlarmEvent>>(it) }.getOrNull()
            } ?: emptyList()
            prefs[KEY_EVENTS] = json.encodeToString((listOf(event) + list).take(50))
        }
    }
}
