package cat.plou.radar

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot

/**
 * Vector de desplazamiento del campo de precipitación, en km/h.
 * `east`/`north` son las componentes; `speedKmh` y `bearingDeg` la forma polar
 * (rumbo *hacia el que* se mueve la precipitación).
 */
data class MotionVector(
    val east: Double,
    val north: Double,
    val speedKmh: Double,
    val bearingDeg: Double,
    /** Confianza en [0, 1] derivada de la mejora relativa del ajuste. */
    val confidence: Double,
    /** Nº de celdas con eco empleadas en la correlación. */
    val samples: Int,
)

/** Velocidad máxima plausible de un sistema precipitante, en km/h. */
private const val MAX_SPEED_KMH = 160.0

/** Reflectividad mínima que se considera señal (evita perseguir ruido). */
private const val SIGNAL_FLOOR_DBZ = 5

/** Fracción mínima de celdas con eco para intentar la correlación. */
private const val MIN_COVERAGE = 0.004

private fun PrecipField.toIntensity(): FloatArray = FloatArray(dbz.size) { k ->
    val v = dbz[k].toInt()
    if (v > SIGNAL_FLOOR_DBZ) (v - SIGNAL_FLOOR_DBZ).toFloat() else 0f
}

private fun PrecipField.countEchoes(): Int = dbz.count { it > SIGNAL_FLOOR_DBZ }

/**
 * Error cuadrático medio entre `a` y `b` cuando `b` se desplaza `(di, dj)`
 * celdas. Devuelve `null` si el solape es demasiado pequeño.
 */
private fun shiftedMse(
    a: FloatArray,
    b: FloatArray,
    width: Int,
    height: Int,
    di: Int,
    dj: Int,
    minOverlap: Int,
): Double? {
    var sum = 0.0
    var n = 0
    val j0 = maxOf(0, -dj)
    val j1 = minOf(height, height - dj)
    val i0 = maxOf(0, -di)
    val i1 = minOf(width, width - di)
    for (j in j0 until j1) {
        val rowA = j * width
        val rowB = (j + dj) * width + di
        for (i in i0 until i1) {
            val d = (a[rowA + i] - b[rowB + i]).toDouble()
            sum += d * d
            n++
        }
    }
    if (n < minOverlap) return null
    return sum / n
}

/** Ajuste parabólico en 1D sobre tres puntos para afinar el mínimo. */
private fun parabolicOffset(left: Double, center: Double, right: Double): Double {
    val denom = left - 2 * center + right
    if (abs(denom) < 1e-9) return 0.0
    return (0.5 * (left - right) / denom).coerceIn(-1.0, 1.0)
}

/**
 * Estima el desplazamiento entre dos rejillas consecutivas por correlación
 * cruzada (mínimo error cuadrático) con refinado subcelda.
 *
 * `previous` y `current` deben compartir geometría (mismo centro y celda).
 */
fun estimateMotion(previous: PrecipField, current: PrecipField): MotionVector? {
    if (previous.width != current.width ||
        previous.height != current.height ||
        previous.cellKm != current.cellKm
    ) {
        return null
    }
    val dtHours = (current.time - previous.time) / 3600.0
    if (dtHours <= 0) return null

    val echoesPrev = previous.countEchoes()
    val echoesCur = current.countEchoes()
    val total = current.dbz.size
    if (echoesPrev.toDouble() / total < MIN_COVERAGE) return null
    if (echoesCur.toDouble() / total < MIN_COVERAGE) return null

    val a = previous.toIntensity()
    val b = current.toIntensity()
    val width = current.width
    val height = current.height
    val cellKm = current.cellKm

    val maxShift = minOf(
        floor(minOf(width, height) / 3.0).toInt(),
        maxOf(1, ceil(MAX_SPEED_KMH * dtHours / cellKm).toInt()),
    )
    val minOverlap = maxOf(64, (width * height * 0.25).toInt())

    var bestDi = 0
    var bestDj = 0
    var bestMse = Double.POSITIVE_INFINITY
    val scores = HashMap<Int, Double>()
    fun key(di: Int, dj: Int) = (di + 512) * 4096 + (dj + 512)

    for (dj in -maxShift..maxShift) {
        for (di in -maxShift..maxShift) {
            val mse = shiftedMse(a, b, width, height, di, dj, minOverlap) ?: continue
            scores[key(di, dj)] = mse
            if (mse < bestMse) {
                bestMse = mse
                bestDi = di
                bestDj = dj
            }
        }
    }
    if (!bestMse.isFinite()) return null

    // Confianza: cuánto mejora el mejor desplazamiento frente a «sin movimiento».
    val zero = scores[key(0, 0)]
    var confidence = 0.0
    if (zero != null && zero > 0) {
        confidence = (1 - bestMse / zero).coerceIn(0.0, 1.0)
        if (bestDi == 0 && bestDj == 0) confidence = 0.35 // campo estacionario
    }

    fun around(di: Int, dj: Int): Double = scores[key(di, dj)] ?: (bestMse * 1.05)
    val subI = parabolicOffset(around(bestDi - 1, bestDj), bestMse, around(bestDi + 1, bestDj))
    val subJ = parabolicOffset(around(bestDi, bestDj - 1), bestMse, around(bestDi, bestDj + 1))

    // `shiftedMse` compara a(i, j) con b(i + di, j + dj): el mínimo indica dónde
    // ha reaparecido en `b` el eco que en `a` estaba en (i, j). El campo se ha
    // desplazado, por tanto, `+di` celdas al este y `+dj` celdas al norte
    // (en esta rejilla `j` crece hacia el norte).
    val cellsEast = bestDi + subI
    val cellsNorth = bestDj + subJ
    val east = cellsEast * cellKm / dtHours
    val north = cellsNorth * cellKm / dtHours

    return MotionVector(
        east = east,
        north = north,
        speedKmh = hypot(east, north),
        bearingDeg = (atan2(east, north) * 180 / PI + 360) % 360,
        confidence = confidence,
        samples = minOf(echoesPrev, echoesCur),
    )
}

/**
 * Combina las estimaciones de varios pares consecutivos con la mediana, lo que
 * amortigua estimaciones erráticas.
 */
fun estimateMotionSeries(fields: List<PrecipField>): MotionVector? {
    if (fields.size < 2) return null
    val vectors = mutableListOf<MotionVector>()
    for (i in 1 until fields.size) {
        val v = estimateMotion(fields[i - 1], fields[i])
        if (v != null && v.confidence > 0.05) vectors.add(v)
    }
    if (vectors.isEmpty()) return null
    if (vectors.size == 1) return vectors[0]

    fun median(values: List<Double>): Double {
        val s = values.sorted()
        val mid = s.size / 2
        return if (s.size % 2 == 1) s[mid] else (s[mid - 1] + s[mid]) / 2
    }

    val east = median(vectors.map { it.east })
    val north = median(vectors.map { it.north })
    return MotionVector(
        east = east,
        north = north,
        speedKmh = hypot(east, north),
        bearingDeg = (atan2(east, north) * 180 / PI + 360) % 360,
        confidence = median(vectors.map { it.confidence }),
        samples = vectors.maxOf { it.samples },
    )
}
