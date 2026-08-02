package cat.plou.forecast

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

class OpenMeteoTest {

    @Test
    fun `las coordenadas de la API siempre usan punto decimal`() {
        val previous = Locale.getDefault()
        try {
            Locale.setDefault(Locale("es", "ES"))
            assertEquals("41.3874", apiCoordinate(41.3874))
            assertEquals("-2.1700", apiCoordinate(-2.17))
        } finally {
            Locale.setDefault(previous)
        }
    }

    @Test
    fun `la hora inicial usa el huso de la prevision`() {
        // 2025-01-01 23:30 UTC: en UTC+2 ya es el día siguiente.
        val now = 1_735_774_200_000L
        assertEquals("2025-01-02T01", localHourKey(now, 2 * 3600))
    }
}
