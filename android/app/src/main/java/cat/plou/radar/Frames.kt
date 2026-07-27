package cat.plou.radar

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** Un fotograma de radar: instante y ruta base de sus teselas. */
data class RadarFrame(
    /** Instante del fotograma (epoch en segundos). */
    val time: Long,
    /** Ruta base de las teselas de ese fotograma. */
    val path: String,
    /** `past` = observación; `nowcast` = extrapolación del proveedor. */
    val nowcast: Boolean,
)

data class RadarIndex(
    /** Base de URL de las teselas. */
    val host: String,
    val generated: Long,
    val past: List<RadarFrame>,
    val forecast: List<RadarFrame>,
) {
    /** Todos los fotogramas en orden cronológico. */
    val all: List<RadarFrame> get() = past + forecast

    /** Fotograma observado más reciente. */
    val latest: RadarFrame? get() = past.lastOrNull()
}

/** Opciones de una tesela de radar. */
data class TileOptions(
    val size: Int = 512,
    val color: Int = ANALYSIS_SCHEME.id,
    val smooth: Boolean = false,
    val snow: Boolean = true,
)

private const val INDEX_URL = "https://api.rainviewer.com/public/weather-maps.json"
private const val USER_AGENT = "Plou/1.0 (+https://github.com/borborborja/plou)"

/**
 * Cliente del índice de fotogramas. La app habla directamente con el proveedor:
 * no hay servidor propio de por medio.
 */
class RadarIndexClient(
    private val http: OkHttpClient = defaultHttpClient(),
    private val ttlMillis: Long = 120_000,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private var cached: RadarIndex? = null
    private var fetchedAt = 0L

    private val json = Json { ignoreUnknownKeys = true }

    /** Índice cacheado durante [ttlMillis]; ante un fallo sirve el último bueno. */
    @Synchronized
    fun get(force: Boolean = false): RadarIndex {
        val hit = cached
        if (!force && hit != null && now() - fetchedAt < ttlMillis) return hit
        return try {
            val fresh = load()
            cached = fresh
            fetchedAt = now()
            fresh
        } catch (e: Exception) {
            hit ?: throw e
        }
    }

    private fun load(): RadarIndex {
        val request = Request.Builder()
            .url(INDEX_URL)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/json")
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("Índice de radar: HTTP ${response.code}")
            val body = response.body?.string() ?: error("Índice de radar vacío")
            return parseIndex(body)
        }
    }

    internal fun parseIndex(body: String): RadarIndex {
        val root = json.parseToJsonElement(body).jsonObject
        val host = root["host"]?.jsonPrimitive?.content?.trimEnd('/')
            ?: error("Índice de radar sin campo `host`")
        val radar = root["radar"]?.jsonObject
        val past = frames(radar, "past", nowcast = false)
        val forecast = frames(radar, "nowcast", nowcast = true)
        if (past.isEmpty()) error("Índice de radar sin fotogramas")
        return RadarIndex(
            host = host,
            generated = root["generated"]?.jsonPrimitive?.content?.toLongOrNull()
                ?: (System.currentTimeMillis() / 1000),
            past = past,
            forecast = forecast,
        )
    }

    private fun frames(
        parent: kotlinx.serialization.json.JsonObject?,
        key: String,
        nowcast: Boolean,
    ): List<RadarFrame> {
        val array = parent?.get(key)?.jsonArray ?: return emptyList()
        return array.mapNotNull { element ->
            val obj = element.jsonObject
            val time = obj["time"]?.jsonPrimitive?.content?.toLongOrNull() ?: return@mapNotNull null
            val path = obj["path"]?.jsonPrimitive?.content ?: return@mapNotNull null
            RadarFrame(time, path, nowcast)
        }.sortedBy { it.time }
    }
}

/**
 * URL de una tesela.
 * Formato: `{host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png`
 */
fun tileUrl(index: RadarIndex, frame: RadarFrame, z: Int, x: Int, y: Int, opts: TileOptions): String {
    val smooth = if (opts.smooth) 1 else 0
    val snow = if (opts.snow) 1 else 0
    return "${index.host}${frame.path}/${opts.size}/$z/$x/$y/${opts.color}/${smooth}_$snow.png"
}

/** Plantilla con los marcadores que espera un mapa de teselas. */
fun tileUrlTemplate(index: RadarIndex, frame: RadarFrame, opts: TileOptions): String {
    val smooth = if (opts.smooth) 1 else 0
    val snow = if (opts.snow) 1 else 0
    return "${index.host}${frame.path}/${opts.size}/%d/%d/%d/${opts.color}/${smooth}_$snow.png"
}

fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(15, TimeUnit.SECONDS)
    .build()
