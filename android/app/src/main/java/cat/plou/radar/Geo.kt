package cat.plou.radar

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** Utilidades geográficas: distancias, rumbos y proyección Web Mercator. */

const val EARTH_RADIUS_KM = 6371.0088
const val KM_PER_LAT_DEGREE = 110.574

private const val DEG = PI / 180.0

data class LatLon(val lat: Double, val lon: Double)

/** Distancia ortodrómica en kilómetros. */
fun haversineKm(a: LatLon, b: LatLon): Double {
    val dLat = (b.lat - a.lat) * DEG
    val dLon = (b.lon - a.lon) * DEG
    val lat1 = a.lat * DEG
    val lat2 = b.lat * DEG
    val h = sin(dLat / 2).let { it * it } +
        cos(lat1) * cos(lat2) * sin(dLon / 2).let { it * it }
    return 2 * EARTH_RADIUS_KM * asin(min(1.0, sqrt(h)))
}

/** Rumbo inicial de `a` a `b` en grados (0 = norte, 90 = este). */
fun bearingDeg(a: LatLon, b: LatLon): Double {
    val lat1 = a.lat * DEG
    val lat2 = b.lat * DEG
    val dLon = (b.lon - a.lon) * DEG
    val y = sin(dLon) * cos(lat2)
    val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
    return (atan2(y, x) / DEG + 360) % 360
}

/** Kilómetros por grado de longitud a una latitud dada. */
fun kmPerLonDegree(lat: Double): Double = 111.32 * cos(lat * DEG)

/**
 * Desplazamiento plano desde un punto: `eastKm`/`northKm` en kilómetros.
 * Aproximación válida para radios de unos cientos de km.
 */
fun offsetKm(origin: LatLon, eastKm: Double, northKm: Double): LatLon {
    val lat = origin.lat + northKm / KM_PER_LAT_DEGREE
    val kmLon = kmPerLonDegree(origin.lat)
    val lon = if (abs(kmLon) < 1e-6) origin.lon else origin.lon + eastKm / kmLon
    return LatLon(lat, normalizeLon(lon))
}

fun normalizeLon(lon: Double): Double {
    var l = lon
    while (l > 180) l -= 360
    while (l < -180) l += 360
    return l
}

fun clampLat(lat: Double): Double = lat.coerceIn(-85.05112878, 85.05112878)

data class PixelXY(val x: Double, val y: Double)

/** Píxel global en Web Mercator para un zoom y tamaño de tesela. */
fun latLonToGlobalPixel(point: LatLon, zoom: Int, tileSize: Int): PixelXY {
    val scale = tileSize.toDouble() * (1 shl zoom)
    val lat = clampLat(point.lat)
    val x = ((normalizeLon(point.lon) + 180) / 360) * scale
    val sinLat = sin(lat * DEG)
    val y = (0.5 - ln((1 + sinLat) / (1 - sinLat)) / (4 * PI)) * scale
    return PixelXY(x, y)
}

/** Metros por píxel en Web Mercator a una latitud y zoom dados. */
fun metersPerPixel(lat: Double, zoom: Int, tileSize: Int): Double =
    (40075016.686 * cos(clampLat(lat) * DEG)) / (tileSize.toDouble() * (1 shl zoom))

private val COMPASS_ES = arrayOf(
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO",
)

/** Punto cardinal (16 rumbos, nomenclatura castellana) para un ángulo. */
fun compassPoint(deg: Double): String {
    val idx = ((((deg % 360) + 360) % 360) / 22.5).roundToInt() % 16
    return COMPASS_ES[idx]
}

/** Diferencia angular con signo entre dos rumbos, en el rango [-180, 180). */
fun angleDelta(from: Double, to: Double): Double = ((((to - from) % 360) + 540) % 360) - 180
