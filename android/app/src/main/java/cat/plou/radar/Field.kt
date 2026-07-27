package cat.plou.radar

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * Rejilla local de precipitación centrada en un punto, con celdas de tamaño fijo
 * en kilómetros. Trabajar en km (y no en píxeles Mercator) hace que las
 * velocidades y los tiempos de llegada sean directamente interpretables.
 *
 * El índice de la celda `(i, j)` es `j * width + i`, donde `i` crece hacia el
 * este y `j` hacia el norte. El centro está en `(half, half)`.
 */
class PrecipField(
    val center: LatLon,
    val time: Long,
    val nowcast: Boolean,
    val cellKm: Double,
    val half: Int,
    val width: Int,
    val height: Int,
    /** dBZ por celda; [NO_ECHO] si no hay eco. */
    val dbz: ShortArray,
    /** 0 = sin eco, 1 = lluvia, 2 = nieve. */
    val kind: ByteArray,
    /** Fracción de celdas con eco, útil para descartar rejillas vacías. */
    val coverage: Double,
)

const val DEFAULT_CELL_KM = 1.5

data class FieldOptions(
    /** Radio cubierto por la rejilla, en km. */
    val radiusKm: Double,
    val cellKm: Double = DEFAULT_CELL_KM,
    val zoom: Int = 7,
    val tileSize: Int = 512,
)

/**
 * Construye la rejilla local de un fotograma pidiendo las teselas necesarias.
 *
 * Cada celda toma el máximo de los píxeles de radar que cubre, de modo que los
 * núcleos pequeños de precipitación no se pierden al submuestrear.
 */
suspend fun buildField(
    frame: RadarFrame,
    center: LatLon,
    options: FieldOptions,
    tiles: TileSource,
): PrecipField = coroutineScope {
    val cellKm = options.cellKm
    val zoom = options.zoom
    val tileSize = options.tileSize

    val half = maxOf(1, ceil(options.radiusKm / cellKm).toInt())
    val width = half * 2 + 1
    val height = width

    val dbz = ShortArray(width * height) { NO_ECHO }
    val kind = ByteArray(width * height)

    // Huella en píxeles de una celda: se muestrea un bloque para tomar el máximo.
    val mpp = metersPerPixel(center.lat, zoom, tileSize)
    val footprint = ((cellKm * 1000) / mpp).roundToInt().coerceIn(1, 8)
    val fpOffset = (footprint - 1) / 2.0

    val scale = tileSize.toDouble() * (1 shl zoom)
    val nTiles = 1 shl zoom
    val px = DoubleArray(width * height)
    val py = DoubleArray(width * height)
    val needed = HashSet<Long>()

    for (j in 0 until height) {
        val northKm = (j - half) * cellKm
        for (i in 0 until width) {
            val eastKm = (i - half) * cellKm
            val p = latLonToGlobalPixel(offsetKm(center, eastKm, northKm), zoom, tileSize)
            val k = j * width + i
            px[k] = p.x
            py[k] = p.y
            // Todas las teselas tocadas por la huella de la celda.
            for (dy in -1..1) {
                for (dx in -1..1) {
                    val gx = p.x + dx * fpOffset
                    val gy = p.y + dy * fpOffset
                    if (gy < 0 || gy >= scale) continue
                    val tx = ((floor(gx / tileSize).toInt() % nTiles) + nTiles) % nTiles
                    val ty = floor(gy / tileSize).toInt()
                    needed.add(tx.toLong() shl 32 or (ty.toLong() and 0xFFFFFFFFL))
                }
            }
        }
    }

    val fetched = HashMap<Long, DecodedTile?>()
    needed.map { key ->
        async {
            val tx = (key ushr 32).toInt()
            val ty = (key and 0xFFFFFFFFL).toInt()
            val tile = runCatching { tiles.tile(frame, zoom, tx, ty) }.getOrNull()
            synchronized(fetched) { fetched[key] = tile }
        }
    }.awaitAll()

    var echoes = 0
    for (k in px.indices) {
        var bestDbz = NO_ECHO
        var bestKind: Byte = 0
        for (dy in 0 until footprint) {
            val gy = py[k] - fpOffset + dy
            if (gy < 0 || gy >= scale) continue
            val ty = floor(gy / tileSize).toInt()
            val iy = floor(gy).toInt() - ty * tileSize
            for (dx in 0 until footprint) {
                val gxRaw = px[k] - fpOffset + dx
                val gx = ((gxRaw % scale) + scale) % scale
                val tx = ((floor(gx / tileSize).toInt() % nTiles) + nTiles) % nTiles
                val tile = fetched[tx.toLong() shl 32 or (ty.toLong() and 0xFFFFFFFFL)] ?: continue
                val ix = floor(gx).toInt() - floor(gx / tileSize).toInt() * tileSize
                if (ix < 0 || ix >= tile.size || iy < 0 || iy >= tile.size) continue
                val v = tile.dbz[iy * tile.size + ix]
                if (v > bestDbz) {
                    bestDbz = v
                    bestKind = tile.kind[iy * tile.size + ix]
                }
            }
        }
        dbz[k] = bestDbz
        kind[k] = bestKind
        if (bestDbz > NO_ECHO) echoes++
    }

    PrecipField(
        center = center,
        time = frame.time,
        nowcast = frame.nowcast,
        cellKm = cellKm,
        half = half,
        width = width,
        height = height,
        dbz = dbz,
        kind = kind,
        coverage = echoes.toDouble() / dbz.size,
    )
}

/** dBZ de la celda que contiene el desplazamiento indicado (km este/norte). */
fun PrecipField.valueAt(eastKm: Double, northKm: Double): Short {
    val i = (eastKm / cellKm).roundToInt() + half
    val j = (northKm / cellKm).roundToInt() + half
    if (i < 0 || i >= width || j < 0 || j >= height) return NO_ECHO
    return dbz[j * width + i]
}

fun PrecipField.kindAt(eastKm: Double, northKm: Double): Int {
    val i = (eastKm / cellKm).roundToInt() + half
    val j = (northKm / cellKm).roundToInt() + half
    if (i < 0 || i >= width || j < 0 || j >= height) return 0
    return kind[j * width + i].toInt()
}

data class DiscMax(val dbz: Short, val kind: Int)

/**
 * Máximo de reflectividad en un disco alrededor de un desplazamiento dado.
 * Sirve para tolerar pequeños errores de posición.
 */
fun PrecipField.maxInDisc(eastKm: Double, northKm: Double, radiusKm: Double): DiscMax {
    val r = maxOf(0, ceil(radiusKm / cellKm).toInt())
    val ci = (eastKm / cellKm).roundToInt() + half
    val cj = (northKm / cellKm).roundToInt() + half
    var bestDbz = NO_ECHO
    var bestKind = 0
    for (j in (cj - r)..(cj + r)) {
        if (j < 0 || j >= height) continue
        for (i in (ci - r)..(ci + r)) {
            if (i < 0 || i >= width) continue
            val di = i - ci
            val dj = j - cj
            if (di * di + dj * dj > r * r) continue
            val k = j * width + i
            if (dbz[k] > bestDbz) {
                bestDbz = dbz[k]
                bestKind = kind[k].toInt()
            }
        }
    }
    return DiscMax(bestDbz, bestKind)
}

data class OffsetKm(val east: Double, val north: Double)

/** Desplazamiento en km (este, norte) del centro de la celda `(i, j)`. */
fun PrecipField.cellOffsetKm(i: Int, j: Int): OffsetKm =
    OffsetKm((i - half) * cellKm, (j - half) * cellKm)
