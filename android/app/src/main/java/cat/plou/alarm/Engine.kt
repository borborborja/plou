package cat.plou.alarm

import cat.plou.radar.EchoHit
import cat.plou.radar.Intensity
import cat.plou.radar.LocationAnalysis
import kotlin.math.roundToInt

/** Cómo debe avisar una ubicación. */
enum class AlarmMode { OVERHEAD, IN_RADIUS, APPROACHING }

/** Qué ha disparado el aviso. */
enum class AlarmKind { OVERHEAD, NEARBY, APPROACHING, CLEAR }

/** Configuración de la alarma de una ubicación. */
data class AlarmConfig(
    val enabled: Boolean = true,
    val radiusKm: Double = 20.0,
    val intensity: Intensity = Intensity.LIGHT,
    val detectRain: Boolean = true,
    val detectSnow: Boolean = false,
    val mode: AlarmMode = AlarmMode.IN_RADIUS,
    /** Antelación máxima con la que avisar de una llegada, en minutos. */
    val leadMinutes: Int = 30,
    /** Por debajo de esta velocidad no se avisa por acercamiento. */
    val minSpeedKmh: Double = 5.0,
    val repeat: Boolean = false,
    val repeatMinutes: Int = 30,
    /** Silencio mínimo entre avisos distintos. */
    val minIntervalMinutes: Int = 60,
    val notifyOnClear: Boolean = false,
    val snoozeMinutes: Int = 30,
    val quietHours: TimeWindow = TimeWindow(),
    val schedule: TimeWindow = TimeWindow(),
)

/** Franja horaria con días de la semana (0 = domingo). */
data class TimeWindow(
    val enabled: Boolean = false,
    val from: String = "22:00",
    val to: String = "07:00",
    val days: List<Int> = emptyList(),
)

/** Estado persistente de la alarma de una ubicación. */
data class AlarmState(
    val active: Boolean = false,
    val activeKind: AlarmKind? = null,
    val lastFiredAt: Long? = null,
    val lastClearedAt: Long? = null,
    val lastCheckedAt: Long? = null,
    val snoozedUntil: Long? = null,
)

data class AlarmNotification(
    val kind: AlarmKind,
    val title: String,
    val body: String,
    val etaMinutes: Int?,
    val distanceKm: Double?,
    val compass: String?,
    val snow: Boolean,
)

enum class AlarmAction { NONE, FIRE, SUPPRESS }

data class AlarmOutcome(
    val action: AlarmAction,
    val reason: String,
    val state: AlarmState,
    val notification: AlarmNotification? = null,
)

data class EvaluateInput(
    val now: Long,
    val config: AlarmConfig,
    val analysis: LocationAnalysis,
    val state: AlarmState,
    val locationName: String,
    val timezone: String,
)

/** Detección que ha satisfecho la condición de alarma. */
private data class Trigger(val kind: AlarmKind, val hit: EchoHit, val etaMinutes: Int?)

/**
 * ¿La situación observada cumple la condición configurada?
 *
 * `overhead` gana siempre: si ya está precipitando encima, ese es el aviso
 * relevante sea cual sea el modo elegido.
 */
private fun detectTrigger(config: AlarmConfig, analysis: LocationAnalysis): Trigger? {
    analysis.overhead?.let { return Trigger(AlarmKind.OVERHEAD, it, 0) }

    if (config.mode == AlarmMode.OVERHEAD) return null

    if (config.mode == AlarmMode.IN_RADIUS) {
        val nearest = analysis.nearest ?: return null
        return Trigger(AlarmKind.NEARBY, nearest, analysis.etaMinutes)
    }

    // Modo «acercándose»: hace falta un desplazamiento fiable y un tiempo de
    // llegada dentro de la antelación configurada.
    val motion = analysis.motion ?: return null
    if (motion.speedKmh < config.minSpeedKmh) return null
    val eta = analysis.etaMinutes ?: return null
    if (eta > config.leadMinutes) return null
    val hit = analysis.nearest ?: analysis.strongest ?: return null
    return Trigger(AlarmKind.APPROACHING, hit, eta)
}

private fun buildNotification(trigger: Trigger, input: EvaluateInput): AlarmNotification {
    val place = input.locationName
    val snow = trigger.hit.snow
    val what = if (snow) "Nieve" else "Lluvia"
    val intensity = Intensity.labelFor(trigger.hit.dbz.toDouble()).lowercase()

    val title: String
    val body: String
    when (trigger.kind) {
        AlarmKind.OVERHEAD -> {
            title = "$what en $place"
            body = "$intensity · ${"%.1f".format(trigger.hit.mmPerHour)} mm/h"
        }
        AlarmKind.APPROACHING -> {
            title = "$what acercándose a $place"
            body = "Llega en ${trigger.etaMinutes ?: 0} min desde el ${trigger.hit.compass} · $intensity"
        }
        else -> {
            title = "$what cerca de $place"
            body = "A ${"%.1f".format(trigger.hit.distanceKm)} km al ${trigger.hit.compass} · $intensity"
        }
    }

    val motion = input.analysis.motion
    val extra = if (motion != null && motion.speedKmh >= 3 && trigger.kind != AlarmKind.OVERHEAD) {
        " · se desplaza a ${motion.speedKmh.roundToInt()} km/h"
    } else {
        ""
    }

    return AlarmNotification(
        kind = trigger.kind,
        title = title,
        body = body + extra,
        etaMinutes = trigger.etaMinutes,
        distanceKm = trigger.hit.distanceKm,
        compass = trigger.hit.compass,
        snow = snow,
    )
}

/**
 * Decide qué hacer con una ubicación a partir del análisis de radar y del
 * estado previo de su alarma. Es una función pura: devuelve el nuevo estado y,
 * si procede, la notificación que hay que mostrar.
 */
fun evaluateAlarm(input: EvaluateInput): AlarmOutcome {
    val now = input.now
    val config = input.config
    val state = input.state.copy(lastCheckedAt = now)

    if (!config.enabled) {
        return AlarmOutcome(
            AlarmAction.NONE,
            "alarma desactivada",
            state.copy(active = false, activeKind = null),
        )
    }

    // Fuera de la franja de vigilancia no se evalúa nada.
    if (config.schedule.enabled &&
        !isWithinWindow(now, input.timezone, config.schedule.from, config.schedule.to, config.schedule.days)
    ) {
        return AlarmOutcome(
            AlarmAction.NONE,
            "fuera de la franja de vigilancia",
            state.copy(active = false, activeKind = null),
        )
    }

    val trigger = detectTrigger(config, input.analysis)

    val quiet = config.quietHours.enabled &&
        isWithinWindow(now, input.timezone, config.quietHours.from, config.quietHours.to, config.quietHours.days)

    // --- Sin condición: cerrar la situación activa, si la había -------------
    if (trigger == null) {
        if (state.active) {
            val cleared = state.copy(active = false, activeKind = null, lastClearedAt = now)
            if (config.notifyOnClear && !quiet) {
                return AlarmOutcome(
                    AlarmAction.FIRE,
                    "ha dejado de detectarse precipitación",
                    cleared.copy(lastFiredAt = now),
                    AlarmNotification(
                        kind = AlarmKind.CLEAR,
                        title = "Ha escampado en ${input.locationName}",
                        body = "El radar ya no detecta precipitación en la zona.",
                        etaMinutes = null,
                        distanceKm = null,
                        compass = null,
                        snow = false,
                    ),
                )
            }
            return AlarmOutcome(AlarmAction.NONE, "situación cerrada", cleared)
        }
        return AlarmOutcome(AlarmAction.NONE, "sin precipitación relevante", state)
    }

    // --- Hay condición ------------------------------------------------------
    val snoozedUntil = state.snoozedUntil
    if (snoozedUntil != null && snoozedUntil > now) {
        // El aplazamiento silencia el aviso pero mantiene viva la situación.
        return AlarmOutcome(
            AlarmAction.SUPPRESS,
            "alarma pospuesta",
            state.copy(active = true, activeKind = trigger.kind),
        )
    }

    /**
     * ¿Se ha llegado a avisar de *esta* situación?
     *
     * Un episodio que empieza dentro de las horas de silencio queda marcado como
     * activo sin que nadie haya sido avisado. Si eso contara como avisado, al
     * terminar la franja no se diría nunca —por mucho que siguiera lloviendo
     * encima—, porque el episodio ya no sería nuevo. Un aviso pertenece a la
     * situación en curso sólo si es posterior al último cierre.
     */
    val announced = state.lastFiredAt != null &&
        (state.lastClearedAt == null || state.lastFiredAt > state.lastClearedAt)

    if (state.active && announced) {
        if (!config.repeat) {
            return AlarmOutcome(
                AlarmAction.NONE,
                "aviso ya emitido para esta situación",
                state.copy(activeKind = trigger.kind),
            )
        }
        val since = state.lastFiredAt?.let { (now - it) / 60000.0 } ?: Double.POSITIVE_INFINITY
        if (since < config.repeatMinutes) {
            return AlarmOutcome(
                AlarmAction.NONE,
                "esperando al siguiente recordatorio",
                state.copy(activeKind = trigger.kind),
            )
        }
        if (quiet) {
            return AlarmOutcome(
                AlarmAction.SUPPRESS,
                "horas de silencio",
                state.copy(activeKind = trigger.kind),
            )
        }
        return AlarmOutcome(
            AlarmAction.FIRE,
            "recordatorio de situación en curso",
            state.copy(active = true, activeKind = trigger.kind, lastFiredAt = now),
            buildNotification(trigger, input),
        )
    }

    // Situación nueva.
    if (quiet) {
        // Se absorbe en silencio: al terminar la franja no salta un aviso tardío
        // por un episodio que empezó de madrugada.
        return AlarmOutcome(
            AlarmAction.SUPPRESS,
            "horas de silencio",
            state.copy(active = true, activeKind = trigger.kind),
        )
    }

    val lastFired = state.lastFiredAt
    if (lastFired != null && (now - lastFired) / 60000.0 < config.minIntervalMinutes) {
        return AlarmOutcome(
            AlarmAction.SUPPRESS,
            "intervalo mínimo entre avisos",
            state.copy(active = true, activeKind = trigger.kind),
        )
    }

    return AlarmOutcome(
        AlarmAction.FIRE,
        "condición cumplida (${trigger.kind})",
        state.copy(active = true, activeKind = trigger.kind, lastFiredAt = now),
        buildNotification(trigger, input),
    )
}
