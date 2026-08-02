package cat.plou.forecast

import cat.plou.radar.LatLon
import cat.plou.radar.defaultHttpClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale

data class CurrentWeather(
    val temperature: Double?,
    val apparent: Double?,
    val humidity: Int?,
    val windSpeed: Double?,
    val windGust: Double?,
    val pressure: Double?,
    val cloudCover: Int?,
    val precipitation: Double?,
    val weatherCode: Int?,
    val isDay: Boolean,
)

data class HourPoint(
    val time: String,
    val temperature: Double?,
    val precipitation: Double?,
    val probability: Int?,
    val weatherCode: Int?,
    val windSpeed: Double?,
)

data class DayPoint(
    val date: String,
    val min: Double?,
    val max: Double?,
    val precipitation: Double?,
    val probability: Int?,
    val weatherCode: Int?,
    val sunrise: String?,
    val sunset: String?,
)

data class Forecast(
    val current: CurrentWeather?,
    val hourly: List<HourPoint>,
    val daily: List<DayPoint>,
)

data class Place(val name: String, val lat: Double, val lon: Double, val region: String?)

/**
 * Previsión numérica de Open-Meteo, consultada directamente desde el móvil.
 * Gratuita y sin clave para uso no comercial (CC BY 4.0).
 */
class OpenMeteoClient(private val http: OkHttpClient = defaultHttpClient()) {

    private val json = Json { ignoreUnknownKeys = true }

    private fun get(url: String): JsonObject {
        val request = Request.Builder().url(url).header("User-Agent", "Plou/1.0").build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("Open-Meteo: HTTP ${response.code}")
            val body = response.body?.string() ?: error("Respuesta vacía")
            return json.parseToJsonElement(body).jsonObject
        }
    }

    suspend fun forecast(at: LatLon, days: Int = 7, hours: Int = 48): Forecast =
        withContext(Dispatchers.IO) {
            val url = buildString {
                append("https://api.open-meteo.com/v1/forecast")
                append("?latitude=${apiCoordinate(at.lat)}&longitude=${apiCoordinate(at.lon)}")
                append("&timezone=auto&forecast_days=$days")
                append("&current=temperature_2m,apparent_temperature,relative_humidity_2m,")
                append("precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,")
                append("wind_gusts_10m,is_day")
                append("&hourly=temperature_2m,precipitation,precipitation_probability,")
                append("weather_code,wind_speed_10m")
                append("&daily=weather_code,temperature_2m_max,temperature_2m_min,")
                append("precipitation_sum,precipitation_probability_max,sunrise,sunset")
                append("&wind_speed_unit=kmh&precipitation_unit=mm&temperature_unit=celsius")
            }
            val root = get(url)
            val utcOffsetSeconds = root["utc_offset_seconds"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
            Forecast(
                current = parseCurrent(root["current"]?.jsonObject),
                hourly = parseHourly(root["hourly"]?.jsonObject, hours, utcOffsetSeconds),
                daily = parseDaily(root["daily"]?.jsonObject),
            )
        }

    /** Búsqueda de localidades por nombre. */
    suspend fun search(query: String, language: String = "es"): List<Place> =
        withContext(Dispatchers.IO) {
            if (query.trim().length < 2) return@withContext emptyList()
            val url = "https://geocoding-api.open-meteo.com/v1/search" +
                "?name=${java.net.URLEncoder.encode(query.trim(), "UTF-8")}" +
                "&count=8&language=$language&format=json"
            val root = get(url)
            val results = root["results"]?.jsonArray ?: return@withContext emptyList()
            results.mapNotNull { element ->
                val o = element.jsonObject
                val lat = o["latitude"]?.jsonPrimitive?.content?.toDoubleOrNull()
                val lon = o["longitude"]?.jsonPrimitive?.content?.toDoubleOrNull()
                val name = o["name"]?.jsonPrimitive?.content
                if (lat == null || lon == null || name == null) return@mapNotNull null
                Place(
                    name = name,
                    lat = lat,
                    lon = lon,
                    region = o["admin1"]?.jsonPrimitive?.content
                        ?: o["country"]?.jsonPrimitive?.content,
                )
            }
        }

    private fun num(o: JsonObject?, key: String): Double? =
        o?.get(key)?.jsonPrimitive?.content?.toDoubleOrNull()

    private fun parseCurrent(o: JsonObject?): CurrentWeather? {
        if (o == null) return null
        return CurrentWeather(
            temperature = num(o, "temperature_2m"),
            apparent = num(o, "apparent_temperature"),
            humidity = num(o, "relative_humidity_2m")?.toInt(),
            windSpeed = num(o, "wind_speed_10m"),
            windGust = num(o, "wind_gusts_10m"),
            pressure = num(o, "pressure_msl"),
            cloudCover = num(o, "cloud_cover")?.toInt(),
            precipitation = num(o, "precipitation"),
            weatherCode = num(o, "weather_code")?.toInt(),
            isDay = (num(o, "is_day") ?: 1.0) > 0,
        )
    }

    private fun list(o: JsonObject?, key: String): List<String> =
        o?.get(key)?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()

    private fun parseHourly(o: JsonObject?, limit: Int, utcOffsetSeconds: Int): List<HourPoint> {
        val times = list(o, "time")
        if (times.isEmpty()) return emptyList()
        val temps = list(o, "temperature_2m")
        val precip = list(o, "precipitation")
        val prob = list(o, "precipitation_probability")
        val codes = list(o, "weather_code")
        val wind = list(o, "wind_speed_10m")
        // Se empieza en la hora en curso: lo pasado no interesa.
        val nowIso = localHourKey(System.currentTimeMillis(), utcOffsetSeconds)
        val start = times.indexOfFirst { it >= nowIso }.coerceAtLeast(0)
        return times.drop(start).take(limit).mapIndexed { i, time ->
            val k = start + i
            HourPoint(
                time = time,
                temperature = temps.getOrNull(k)?.toDoubleOrNull(),
                precipitation = precip.getOrNull(k)?.toDoubleOrNull(),
                probability = prob.getOrNull(k)?.toDoubleOrNull()?.toInt(),
                weatherCode = codes.getOrNull(k)?.toDoubleOrNull()?.toInt(),
                windSpeed = wind.getOrNull(k)?.toDoubleOrNull(),
            )
        }
    }

    private fun parseDaily(o: JsonObject?): List<DayPoint> {
        val dates = list(o, "time")
        if (dates.isEmpty()) return emptyList()
        val min = list(o, "temperature_2m_min")
        val max = list(o, "temperature_2m_max")
        val precip = list(o, "precipitation_sum")
        val prob = list(o, "precipitation_probability_max")
        val codes = list(o, "weather_code")
        val sunrise = list(o, "sunrise")
        val sunset = list(o, "sunset")
        return dates.mapIndexed { i, date ->
            DayPoint(
                date = date,
                min = min.getOrNull(i)?.toDoubleOrNull(),
                max = max.getOrNull(i)?.toDoubleOrNull(),
                precipitation = precip.getOrNull(i)?.toDoubleOrNull(),
                probability = prob.getOrNull(i)?.toDoubleOrNull()?.toInt(),
                weatherCode = codes.getOrNull(i)?.toDoubleOrNull()?.toInt(),
                sunrise = sunrise.getOrNull(i),
                sunset = sunset.getOrNull(i),
            )
        }
    }
}

/** Las API esperan punto decimal independientemente del idioma del teléfono. */
internal fun apiCoordinate(value: Double): String = String.format(Locale.US, "%.4f", value)

/** Hora local del lugar previsto, no la zona horaria donde se encuentra el móvil. */
internal fun localHourKey(nowMillis: Long, utcOffsetSeconds: Int): String =
    Instant.ofEpochMilli(nowMillis)
        .atOffset(ZoneOffset.ofTotalSeconds(utcOffsetSeconds.coerceIn(-18 * 3600, 18 * 3600)))
        .withMinute(0)
        .withSecond(0)
        .withNano(0)
        .toLocalDateTime()
        .toString()
        .take(13)

/** Descripción en castellano del código WMO. */
fun weatherText(code: Int?): String = when (code) {
    0 -> "Despejado"
    1 -> "Poco nuboso"
    2 -> "Parcialmente nuboso"
    3 -> "Cubierto"
    45, 48 -> "Niebla"
    51, 53, 55 -> "Llovizna"
    56, 57 -> "Llovizna helada"
    61 -> "Lluvia débil"
    63 -> "Lluvia moderada"
    65 -> "Lluvia fuerte"
    66, 67 -> "Lluvia helada"
    71 -> "Nevada débil"
    73 -> "Nevada moderada"
    75 -> "Nevada fuerte"
    77 -> "Granos de nieve"
    80, 81, 82 -> "Chubascos"
    85, 86 -> "Chubascos de nieve"
    95 -> "Tormenta"
    96, 99 -> "Tormenta con granizo"
    else -> "—"
}
