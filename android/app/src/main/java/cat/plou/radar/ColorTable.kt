package cat.plou.radar

import kotlin.math.log10
import kotlin.math.pow

/** Tipo de precipitación que representa un píxel de la tesela. */
enum class PrecipKind { RAIN, SNOW }

data class DecodedPixel(val dbz: Int, val kind: PrecipKind)

private const val LEVELS = DBZ_MAX - DBZ_MIN + 1

/**
 * Esquema usado para analizar: es el único garantizado en el acceso gratuito y
 * además sus rampas de lluvia y nieve no se solapan, lo que permite distinguir
 * el tipo de precipitación a partir del color del píxel.
 */
val ANALYSIS_SCHEME = ColorScheme.UNIVERSAL_BLUE

/** Tolerancia por canal (~40/255) al buscar el color más parecido. */
private const val MAX_NEAREST_DISTANCE_SQ = 3 * 40 * 40

/**
 * Traduce el color de un píxel a reflectividad y tipo de precipitación.
 *
 * Se construye un mapa exacto color → nivel recorriendo las rampas de menor a
 * mayor dBZ y conservando la primera aparición: ante colores repetidos se queda
 * el valor más bajo, que es el criterio conservador para una alarma.
 */
class ColorDecoder(val scheme: ColorScheme = ANALYSIS_SCHEME) {

    private val exact = HashMap<Int, DecodedPixel>(LEVELS * 2)
    private val nearestCache = HashMap<Int, DecodedPixel?>()

    /** ¿Las rampas de lluvia y nieve de este esquema son distinguibles? */
    val snowDistinguishable: Boolean

    init {
        var collisions = 0
        for ((kind, ramp) in listOf(PrecipKind.RAIN to scheme.rain, PrecipKind.SNOW to scheme.snow)) {
            for (i in 0 until LEVELS) {
                val o = i * 4
                val a = ramp[o + 3].toInt() and 0xFF
                if (a == 0) continue // píxel transparente: ausencia de eco
                val packed = pack(
                    ramp[o].toInt() and 0xFF,
                    ramp[o + 1].toInt() and 0xFF,
                    ramp[o + 2].toInt() and 0xFF,
                    a,
                )
                val existing = exact[packed]
                if (existing != null) {
                    if (existing.kind != kind) collisions++
                    continue
                }
                exact[packed] = DecodedPixel(DBZ_MIN + i, kind)
            }
        }
        snowDistinguishable = collisions == 0
    }

    private fun pack(r: Int, g: Int, b: Int, a: Int): Int =
        (r shl 24) or (g shl 16) or (b shl 8) or a

    /**
     * Devuelve el eco del píxel, o `null` si no hay ninguno (o si el color queda
     * demasiado lejos de cualquier entrada de la paleta, p. ej. por un suavizado
     * agresivo). Las teselas de análisis se piden sin suavizar, de modo que en
     * la práctica casi todos los píxeles casan de forma exacta.
     */
    fun decode(r: Int, g: Int, b: Int, a: Int): DecodedPixel? {
        if (a == 0) return null
        val packed = pack(r, g, b, a)
        exact[packed]?.let { return it }
        if (nearestCache.containsKey(packed)) return nearestCache[packed]

        var best: DecodedPixel? = null
        var bestDistance = Int.MAX_VALUE
        for ((color, pixel) in exact) {
            val dr = ((color ushr 24) and 0xFF) - r
            val dg = ((color ushr 16) and 0xFF) - g
            val db = ((color ushr 8) and 0xFF) - b
            val distance = dr * dr + dg * dg + db * db
            if (distance < bestDistance) {
                bestDistance = distance
                best = pixel
            }
        }
        val result = if (bestDistance <= MAX_NEAREST_DISTANCE_SQ) best else null
        nearestCache[packed] = result
        return result
    }

    /** Decodifica un píxel ARGB tal y como lo devuelve `Bitmap.getPixels`. */
    fun decodeArgb(argb: Int): DecodedPixel? = decode(
        (argb ushr 16) and 0xFF,
        (argb ushr 8) and 0xFF,
        argb and 0xFF,
        (argb ushr 24) and 0xFF,
    )
}

/**
 * Intensidad en mm/h a partir de la reflectividad, con la relación de
 * Marshall-Palmer Z = 200 R^1.6.
 */
fun dbzToMmPerHour(dbz: Double): Double {
    if (dbz <= DBZ_MIN) return 0.0
    val z = 10.0.pow(dbz / 10.0)
    return (z / 200.0).pow(1.0 / 1.6)
}

/** Inversa de [dbzToMmPerHour]. */
fun mmPerHourToDbz(mmh: Double): Double {
    if (mmh <= 0.0) return DBZ_MIN.toDouble()
    return 10.0 * log10(200.0 * mmh.pow(1.6))
}

/** Umbrales de sensibilidad que ofrece la configuración de alarmas. */
enum class Intensity(val dbz: Int, val label: String) {
    DRIZZLE(12, "Llovizna"),
    LIGHT(20, "Lluvia débil"),
    MODERATE(30, "Lluvia moderada"),
    HEAVY(40, "Lluvia fuerte"),
    VIOLENT(50, "Tormenta"),
    ;

    companion object {
        /** Etiqueta del nivel alcanzado por una reflectividad dada. */
        fun labelFor(dbz: Double): String {
            var label = "Sin precipitación"
            for (level in entries) if (dbz >= level.dbz) label = level.label
            return label
        }
    }
}

data class LegendStop(
    val dbz: Int,
    val mmPerHour: Double,
    val rain: Int,
    val snow: Int?,
    val label: String?,
)

private val LEGEND_DBZ = listOf(10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65)

/** Color ARGB de la rampa para una reflectividad, o `null` si es transparente. */
private fun rampColor(ramp: ByteArray, dbz: Int): Int? {
    val i = dbz - DBZ_MIN
    if (i < 0 || i >= LEVELS) return null
    val o = i * 4
    val a = ramp[o + 3].toInt() and 0xFF
    if (a == 0) return null
    return (a shl 24) or
        ((ramp[o].toInt() and 0xFF) shl 16) or
        ((ramp[o + 1].toInt() and 0xFF) shl 8) or
        (ramp[o + 2].toInt() and 0xFF)
}

/**
 * Escalones de la leyenda leídos de la propia rampa, de modo que la leyenda no
 * puede desajustarse de lo que se ve en el mapa.
 */
fun legendFor(scheme: ColorScheme): List<LegendStop> {
    val distinguishable = ColorDecoder(scheme).snowDistinguishable
    return LEGEND_DBZ.mapNotNull { dbz ->
        val rain = rampColor(scheme.rain, dbz) ?: return@mapNotNull null
        LegendStop(
            dbz = dbz,
            mmPerHour = dbzToMmPerHour(dbz.toDouble()),
            rain = rain,
            snow = if (distinguishable) rampColor(scheme.snow, dbz) else null,
            label = Intensity.entries.firstOrNull { it.dbz == dbz }?.label,
        )
    }
}
