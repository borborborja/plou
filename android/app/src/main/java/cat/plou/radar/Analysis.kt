package cat.plou.radar

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlin.math.ceil
import kotlin.math.hypot

data class EchoHit(
    /** Distancia al punto vigilado, en km. */
    val distanceKm: Double,
    /** Rumbo desde el punto vigilado hacia el eco, en grados. */
    val bearingDeg: Double,
    /** Punto cardinal equivalente. */
    val compass: String,
    val dbz: Int,
    val mmPerHour: Double,
    val intensity: String,
    val snow: Boolean,
    val position: LatLon,
)

data class TimelinePoint(
    val minutes: Int,
    val dbz: Int,
    val mmPerHour: Double,
    /** 0 = nada, 1 = lluvia, 2 = nieve. */
    val kind: Int,
)

data class LocationAnalysis(
    val center: LatLon,
    /** Instante del último fotograma observado (epoch ms). */
    val observedAt: Long,
    /** Antigüedad del dato de radar en minutos. */
    val ageMinutes: Double,
    val radiusKm: Double,
    val thresholdDbz: Int,
    /** Fracción de la rejilla analizada con eco, útil para diagnóstico. */
    val fieldCoverage: Double,
    /** Precipitación justo sobre el punto (o muy cerca). */
    val overhead: EchoHit?,
    /** Eco más próximo dentro del radio vigilado que supera el umbral. */
    val nearest: EchoHit?,
    /** Eco más intenso dentro del radio vigilado. */
    val strongest: EchoHit?,
    /** Nº de celdas del radio con precipitación por encima del umbral. */
    val cellsAboveThreshold: Int,
    /** Porcentaje del área vigilada cubierta por precipitación. */
    val areaCoveragePct: Double,
    val motion: MotionVector?,
    /** Minutos hasta que la precipitación alcance el punto (extrapolación). */
    val etaMinutes: Int?,
    /** Minutos hasta que la precipitación entre en el radio vigilado. */
    val etaRadiusMinutes: Int?,
    /** Si ya está lloviendo, minutos estimados hasta que escampe. */
    val clearingMinutes: Int?,
    /** Evolución esperada sobre el punto durante la ventana de previsión. */
    val timeline: List<TimelinePoint>,
)

data class AnalyzeOptions(
    val radiusKm: Double,
    val thresholdDbz: Int,
    /** Ventana de extrapolación en minutos. */
    val lookaheadMinutes: Int = 90,
    val rain: Boolean = true,
    val snow: Boolean = true,
    /** Nº de fotogramas usados para estimar el movimiento. */
    val motionFrames: Int = 4,
)

private const val MOTION_CELL_KM = 4.0
private const val MAX_FIELD_RADIUS_KM = 260.0

private fun hitFrom(center: LatLon, eastKm: Double, northKm: Double, dbz: Int, kind: Int): EchoHit {
    val position = offsetKm(center, eastKm, northKm)
    val distanceKm = hypot(eastKm, northKm)
    val bearing = if (distanceKm < 1e-6) 0.0 else bearingDeg(center, position)
    return EchoHit(
        distanceKm = distanceKm,
        bearingDeg = bearing,
        compass = compassPoint(bearing),
        dbz = dbz,
        mmPerHour = dbzToMmPerHour(dbz.toDouble()),
        intensity = Intensity.labelFor(dbz.toDouble()),
        snow = kind == 2,
        position = position,
    )
}

private fun kindAllowed(kind: Int, rain: Boolean, snow: Boolean): Boolean = when (kind) {
    2 -> snow
    1 -> rain
    else -> false
}

/**
 * Analiza la situación alrededor de un punto: qué precipitación hay dentro del
 * radio vigilado, hacia dónde se mueve y cuándo llegará o escampará.
 *
 * Todo ocurre en el dispositivo: sólo se descargan teselas del proveedor.
 */
suspend fun analyzeLocation(
    index: RadarIndex,
    center: LatLon,
    options: AnalyzeOptions,
    tiles: TileSource,
    now: () -> Long = System::currentTimeMillis,
): LocationAnalysis = coroutineScope {
    val radiusKm = options.radiusKm.coerceIn(1.0, 200.0)
    val thresholdDbz = options.thresholdDbz
    val lookahead = options.lookaheadMinutes.coerceIn(5, 180)
    val motionFrames = options.motionFrames.coerceIn(2, 8)

    val frames = index.past.takeLast(motionFrames)
    val current = index.latest ?: error("No hay fotogramas de radar disponibles")

    // Rejilla gruesa multi-fotograma para estimar el desplazamiento del sistema.
    val motionRadius = minOf(MAX_FIELD_RADIUS_KM, maxOf(60.0, radiusKm * 1.5))
    val motionFields = frames.map { frame ->
        async { buildField(frame, center, FieldOptions(motionRadius, MOTION_CELL_KM), tiles) }
    }.awaitAll()
    val motion = estimateMotionSeries(motionFields)

    // Rejilla fina del fotograma actual, ampliada para cubrir la extrapolación.
    val advectionKm = motion?.let { it.speedKmh * lookahead / 60 } ?: 0.0
    val detailRadius = minOf(MAX_FIELD_RADIUS_KM, radiusKm + minOf(advectionKm, 180.0) + 5)
    val cellKm = maxOf(DEFAULT_CELL_KM, detailRadius / 140)
    val field = buildField(current, center, FieldOptions(detailRadius, cellKm), tiles)

    // Barrido del radio vigilado.
    var nearest: EchoHit? = null
    var strongest: EchoHit? = null
    var cellsAbove = 0
    var cellsInRadius = 0

    val rCells = ceil(radiusKm / field.cellKm).toInt()
    for (j in (field.half - rCells)..(field.half + rCells)) {
        if (j < 0 || j >= field.height) continue
        for (i in (field.half - rCells)..(field.half + rCells)) {
            if (i < 0 || i >= field.width) continue
            val offset = field.cellOffsetKm(i, j)
            val distance = hypot(offset.east, offset.north)
            if (distance > radiusKm) continue
            cellsInRadius++
            val k = j * field.width + i
            val dbz = field.dbz[k].toInt()
            val kind = field.kind[k].toInt()
            if (dbz < thresholdDbz || !kindAllowed(kind, options.rain, options.snow)) continue
            cellsAbove++
            if (nearest == null || distance < nearest.distanceKm) {
                nearest = hitFrom(center, offset.east, offset.north, dbz, kind)
            }
            if (strongest == null || dbz > strongest.dbz) {
                strongest = hitFrom(center, offset.east, offset.north, dbz, kind)
            }
        }
    }

    // Precipitación sobre el punto: se admite una tolerancia de una celda.
    val tolerance = maxOf(field.cellKm, 1.5)
    val overheadProbe = field.maxInDisc(0.0, 0.0, tolerance)
    val overhead = if (overheadProbe.dbz >= thresholdDbz &&
        kindAllowed(overheadProbe.kind, options.rain, options.snow)
    ) {
        hitFrom(center, 0.0, 0.0, overheadProbe.dbz.toInt(), overheadProbe.kind)
    } else {
        null
    }

    // Extrapolación lagrangiana: el valor futuro en P es el valor actual en P − v·t.
    val timeline = mutableListOf<TimelinePoint>()
    var etaMinutes: Int? = null
    var etaRadiusMinutes: Int? = null
    var clearingMinutes: Int? = null
    val step = 5

    if (motion != null && motion.speedKmh > 0.5) {
        var t = 0
        while (t <= lookahead) {
            val hours = t / 60.0
            val backEast = -motion.east * hours
            val backNorth = -motion.north * hours

            val atPoint = field.maxInDisc(backEast, backNorth, tolerance)
            val allowed = if (kindAllowed(atPoint.kind, options.rain, options.snow)) {
                atPoint.dbz
            } else {
                NO_ECHO
            }
            timeline.add(
                TimelinePoint(
                    minutes = t,
                    dbz = if (allowed > NO_ECHO) allowed.toInt() else 0,
                    mmPerHour = if (allowed > NO_ECHO) dbzToMmPerHour(allowed.toDouble()) else 0.0,
                    kind = if (allowed >= thresholdDbz) atPoint.kind else 0,
                ),
            )

            if (etaMinutes == null && allowed >= thresholdDbz) etaMinutes = t
            if (etaRadiusMinutes == null) {
                val inRadius = field.maxInDisc(backEast, backNorth, radiusKm)
                if (inRadius.dbz >= thresholdDbz &&
                    kindAllowed(inRadius.kind, options.rain, options.snow)
                ) {
                    etaRadiusMinutes = t
                }
            }
            if (overhead != null && clearingMinutes == null && t > 0 && allowed < thresholdDbz) {
                clearingMinutes = t
            }
            t += step
        }
    } else {
        // Sin movimiento fiable se asume persistencia del campo actual.
        val probe = field.maxInDisc(0.0, 0.0, tolerance)
        val allowed = if (kindAllowed(probe.kind, options.rain, options.snow)) probe.dbz else NO_ECHO
        var t = 0
        while (t <= lookahead) {
            timeline.add(
                TimelinePoint(
                    minutes = t,
                    dbz = if (allowed > NO_ECHO) allowed.toInt() else 0,
                    mmPerHour = if (allowed > NO_ECHO) dbzToMmPerHour(allowed.toDouble()) else 0.0,
                    kind = if (allowed >= thresholdDbz) probe.kind else 0,
                ),
            )
            t += step
        }
        if (allowed >= thresholdDbz) etaMinutes = 0
        if (nearest != null) etaRadiusMinutes = 0
    }

    val observedAt = current.time * 1000
    LocationAnalysis(
        center = center,
        observedAt = observedAt,
        ageMinutes = (now() - observedAt) / 60000.0,
        radiusKm = radiusKm,
        thresholdDbz = thresholdDbz,
        fieldCoverage = field.coverage,
        overhead = overhead,
        nearest = nearest,
        strongest = strongest,
        cellsAboveThreshold = cellsAbove,
        areaCoveragePct = if (cellsInRadius > 0) cellsAbove * 100.0 / cellsInRadius else 0.0,
        motion = motion,
        etaMinutes = etaMinutes,
        etaRadiusMinutes = etaRadiusMinutes,
        clearingMinutes = clearingMinutes,
        timeline = timeline,
    )
}
