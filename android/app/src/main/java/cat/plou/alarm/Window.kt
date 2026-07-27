package cat.plou.alarm

import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

/** Franjas horarias locales (silencio y vigilancia) con soporte de zona horaria. */

data class LocalTimeInfo(
    /** Minutos transcurridos desde medianoche. */
    val minutes: Int,
    /** Día de la semana, 0 = domingo. */
    val weekday: Int,
)

/** Hora local y día de la semana en la zona horaria indicada. */
fun localTime(at: Long, timezone: String): LocalTimeInfo {
    // Zona horaria desconocida: se cae a UTC en lugar de fallar.
    val zone = runCatching { ZoneId.of(timezone) }.getOrDefault(ZoneId.of("UTC"))
    val t: ZonedDateTime = Instant.ofEpochMilli(at).atZone(zone)
    val weekday = when (t.dayOfWeek) {
        DayOfWeek.SUNDAY -> 0
        DayOfWeek.MONDAY -> 1
        DayOfWeek.TUESDAY -> 2
        DayOfWeek.WEDNESDAY -> 3
        DayOfWeek.THURSDAY -> 4
        DayOfWeek.FRIDAY -> 5
        DayOfWeek.SATURDAY -> 6
    }
    return LocalTimeInfo(t.hour * 60 + t.minute, weekday)
}

private fun parseHhMm(value: String): Int {
    val parts = value.split(":")
    val h = parts.getOrNull(0)?.toIntOrNull() ?: 0
    val m = parts.getOrNull(1)?.toIntOrNull() ?: 0
    return (h % 24) * 60 + (m % 60)
}

/**
 * ¿El instante `at` cae dentro de la franja `from`–`to`?
 *
 * Las franjas que cruzan la medianoche (p. ej. 22:00–07:00) se tratan
 * correctamente: en ese caso el día que se comprueba es el de *inicio* de la
 * franja, de modo que «noches del viernes» incluye la madrugada del sábado.
 */
fun isWithinWindow(
    at: Long,
    timezone: String,
    from: String,
    to: String,
    days: List<Int> = emptyList(),
): Boolean {
    val (minutes, weekday) = localTime(at, timezone)
    val start = parseHhMm(from)
    val end = parseHhMm(to)
    val restricted = days.isNotEmpty() && days.size < 7

    // Franja vacía: no se aplica nunca.
    if (start == end) return false

    if (start < end) {
        if (minutes < start || minutes >= end) return false
        return if (restricted) days.contains(weekday) else true
    }

    // Cruza medianoche.
    if (minutes >= start) return if (restricted) days.contains(weekday) else true
    if (minutes < end) {
        val startDay = (weekday + 6) % 7
        return if (restricted) days.contains(startDay) else true
    }
    return false
}
