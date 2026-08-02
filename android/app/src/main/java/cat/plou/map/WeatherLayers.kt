package cat.plou.map

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import cat.plou.radar.defaultHttpClient
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase
import org.osmdroid.tileprovider.tilesource.TileSourcePolicy
import org.osmdroid.util.MapTileIndex
import java.net.URI
import java.net.URLEncoder
import java.time.Instant

data class WeatherFrame(val id: String, val time: Long, val kind: String)

fun satelliteFrames(now: Long = System.currentTimeMillis()): List<WeatherFrame> {
    val step = 10 * 60_000L
    // Evita pedir el slot que acaba de empezar antes de que EUMETSAT lo publique.
    val latest = now / step * step - step
    return (12 downTo 0).map { offset ->
        val time = latest - offset * step
        WeatherFrame(time.toString(), time, "observed")
    }
}

fun cloudFrames(now: Long = System.currentTimeMillis()): List<WeatherFrame> {
    val step = 3 * 60 * 60_000L
    val first = now / step * step
    return List(81) { offset ->
        val time = first + offset * step
        WeatherFrame(time.toString(), time, "forecast")
    }
}

private val satelliteProducts = mapOf(
    "geocolour" to "mtg_fd:rgb_geocolour",
    "visible" to "mtg_fd:vis06_hrfi",
    "infra" to "mtg_fd:ir105_hrfi",
)

/** Fuente directa: las claves privadas nunca pasan por un servidor de Plou. */
class WeatherTileSource(
    private val layer: String,
    private val variant: String,
    private val frame: WeatherFrame,
    private val openWeatherKey: String,
) : OnlineTileSourceBase(
    "$layer-$variant-${frame.id}", 0, if (layer == "clouds") 10 else 12, 256, ".png", arrayOf(""),
    if (layer == "satellite") "© EUMETSAT" else "© OpenWeather",
    TileSourcePolicy(1, TileSourcePolicy.FLAG_NO_BULK or TileSourcePolicy.FLAG_NO_PREVENTIVE),
) {
    override fun getTileURLString(pMapTileIndex: Long): String {
        val z = MapTileIndex.getZoom(pMapTileIndex)
        val x = MapTileIndex.getX(pMapTileIndex)
        val y = MapTileIndex.getY(pMapTileIndex)
        if (layer == "clouds") {
            return "https://maps.openweathermap.org/maps/2.0/weather/CL/$z/$x/$y" +
                "?date=${frame.time / 1000}&opacity=1&fill_bound=true&appid=" +
                URLEncoder.encode(openWeatherKey, Charsets.UTF_8.name())
        }
        val world = 20_037_508.342789244
        val size = world * 2 / (1 shl z)
        val minX = -world + x * size
        val maxX = minX + size
        val maxY = world - y * size
        val minY = maxY - size
        val params = linkedMapOf(
            "service" to "WMS", "request" to "GetMap", "version" to "1.1.1",
            "layers" to (satelliteProducts[variant] ?: satelliteProducts.getValue("geocolour")),
            "styles" to "", "format" to "image/png", "transparent" to "true",
            "srs" to "EPSG:3857", "bbox" to "$minX,$minY,$maxX,$maxY",
            "width" to "256", "height" to "256", "time" to Instant.ofEpochMilli(frame.time).toString(),
        )
        return "https://view.eumetsat.int/geoserver/wms?" + params.entries.joinToString("&") {
            URLEncoder.encode(it.key, Charsets.UTF_8.name()) + "=" +
                URLEncoder.encode(it.value, Charsets.UTF_8.name())
        }
    }
}

data class LightningSnapshot(
    val bitmap: Bitmap,
    val updatedAt: Long,
    val hasActivity: Boolean,
)

class ProviderClient(private val http: OkHttpClient = defaultHttpClient()) {
    private val json = Json { ignoreUnknownKeys = true }

    fun loadLightning(apiKey: String): LightningSnapshot {
        require(apiKey.isNotBlank()) { "Falta la clave AEMET" }
        val envelopeUrl = "https://opendata.aemet.es/opendata/api/red/rayos/mapa?api_key=" +
            URLEncoder.encode(apiKey, Charsets.UTF_8.name())
        val envelope = get(envelopeUrl, "application/json")
        val dataUrl = json.parseToJsonElement(envelope.toString(Charsets.UTF_8)).jsonObject["datos"]
            ?.jsonPrimitive?.content ?: error("AEMET no devolvió el mapa de rayos")
        val uri = URI(dataUrl)
        require(uri.scheme == "https" && uri.host == "opendata.aemet.es") {
            "AEMET devolvió una URL de datos no autorizada"
        }
        val bytes = get(dataUrl, "image/png")
        val source = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: error("El mapa AEMET no tiene el formato esperado")
        require(source.width >= 200 && source.height >= 200) { "Mapa AEMET con dimensiones inesperadas" }
        val output = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
        val pixels = IntArray(source.width * source.height)
        source.getPixels(pixels, 0, source.width, 0, 0, source.width, source.height)
        var activity = false
        for (i in pixels.indices) {
            val pixel = pixels[i]
            val r = Color.red(pixel)
            val g = Color.green(pixel)
            val b = Color.blue(pixel)
            val max = maxOf(r, g, b)
            val min = minOf(r, g, b)
            val saturation = if (max == 0) 0f else (max - min).toFloat() / max
            pixels[i] = if (Color.alpha(pixel) > 0 && max > 70 && saturation > 0.32f) {
                activity = true
                Color.argb(235, r, g, b)
            } else Color.TRANSPARENT
        }
        output.setPixels(pixels, 0, source.width, 0, 0, source.width, source.height)
        source.recycle()
        return LightningSnapshot(output, System.currentTimeMillis(), activity)
    }

    fun testOpenWeather(apiKey: String) {
        require(apiKey.isNotBlank()) { "Falta la clave OpenWeather" }
        val frame = cloudFrames().first()
        get(WeatherTileSource("clouds", "total", frame, apiKey).getTileURLString(MapTileIndex.getTileIndex(2, 2, 1)), "image/png")
    }

    fun testAemet(apiKey: String) {
        loadLightning(apiKey).bitmap.recycle()
    }

    private fun get(url: String, accept: String): ByteArray {
        val request = Request.Builder().url(url).header("Accept", accept).header("User-Agent", "Plou/1.0").build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("HTTP ${response.code}")
            return response.body?.bytes() ?: error("Respuesta vacía")
        }
    }
}
