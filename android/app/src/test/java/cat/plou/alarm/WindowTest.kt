package cat.plou.alarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class WindowTest {

    /** Instante en hora local de Madrid, para leer las pruebas con claridad. */
    private fun madrid(y: Int, m: Int, d: Int, h: Int, min: Int): Long =
        ZonedDateTime.of(y, m, d, h, min, 0, 0, ZoneId.of("Europe/Madrid")).toInstant().toEpochMilli()

    private val tz = "Europe/Madrid"

    @Test
    fun `franja normal dentro y fuera`() {
        // Martes 8 de julio de 2025.
        assertTrue(isWithinWindow(madrid(2025, 7, 8, 10, 0), tz, "08:00", "20:00"))
        assertFalse(isWithinWindow(madrid(2025, 7, 8, 21, 0), tz, "08:00", "20:00"))
        assertFalse(isWithinWindow(madrid(2025, 7, 8, 7, 59), tz, "08:00", "20:00"))
    }

    @Test
    fun `el final de la franja es exclusivo`() {
        assertFalse(isWithinWindow(madrid(2025, 7, 8, 20, 0), tz, "08:00", "20:00"))
        assertTrue(isWithinWindow(madrid(2025, 7, 8, 8, 0), tz, "08:00", "20:00"))
    }

    @Test
    fun `franja que cruza la medianoche`() {
        assertTrue(isWithinWindow(madrid(2025, 7, 8, 23, 30), tz, "22:00", "07:00"))
        assertTrue(isWithinWindow(madrid(2025, 7, 9, 3, 0), tz, "22:00", "07:00"))
        assertFalse(isWithinWindow(madrid(2025, 7, 9, 12, 0), tz, "22:00", "07:00"))
    }

    @Test
    fun `la madrugada cuenta como el dia en que empezo la franja`() {
        // Viernes 11 de julio a las 23:00 y madrugada del sábado 12 a las 02:00:
        // ambas pertenecen a la noche del viernes (día 5).
        val viernesNoche = listOf(5)
        assertTrue(isWithinWindow(madrid(2025, 7, 11, 23, 0), tz, "22:00", "07:00", viernesNoche))
        assertTrue(isWithinWindow(madrid(2025, 7, 12, 2, 0), tz, "22:00", "07:00", viernesNoche))
        // La madrugada del viernes pertenece a la noche del jueves, no del viernes.
        assertFalse(isWithinWindow(madrid(2025, 7, 11, 2, 0), tz, "22:00", "07:00", viernesNoche))
    }

    @Test
    fun `sin dias o con los siete no se restringe`() {
        assertTrue(isWithinWindow(madrid(2025, 7, 8, 10, 0), tz, "08:00", "20:00", emptyList()))
        assertTrue(isWithinWindow(madrid(2025, 7, 8, 10, 0), tz, "08:00", "20:00", (0..6).toList()))
    }

    @Test
    fun `una franja vacia no se aplica nunca`() {
        assertFalse(isWithinWindow(madrid(2025, 7, 8, 10, 0), tz, "10:00", "10:00"))
    }

    @Test
    fun `una zona horaria desconocida cae a UTC en vez de fallar`() {
        val at = ZonedDateTime.of(2025, 7, 8, 10, 0, 0, 0, ZoneId.of("UTC")).toInstant().toEpochMilli()
        assertTrue(isWithinWindow(at, "Zona/Inventada", "09:00", "11:00"))
    }

    @Test
    fun `la hora local respeta la zona horaria`() {
        val at = madrid(2025, 7, 8, 10, 30)
        assertEquals(LocalTimeInfo(10 * 60 + 30, 2), localTime(at, tz))
        // El mismo instante son las 08:30 UTC.
        assertEquals(8 * 60 + 30, localTime(at, "UTC").minutes)
    }
}
