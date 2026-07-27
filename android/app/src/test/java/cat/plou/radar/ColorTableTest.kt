package cat.plou.radar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ColorTableTest {

    @Test
    fun `publica los nueve esquemas del proveedor`() {
        assertEquals(9, ColorScheme.entries.size)
        assertEquals(listOf(0, 1, 2, 3, 4, 5, 6, 7, 8), ColorScheme.entries.map { it.id })
    }

    @Test
    fun `el esquema de analisis separa lluvia y nieve sin ambiguedad`() {
        assertTrue(ColorDecoder(ANALYSIS_SCHEME).snowDistinguishable)
    }

    @Test
    fun `un color de la rampa se decodifica al dBZ que le corresponde`() {
        val decoder = ColorDecoder(ANALYSIS_SCHEME)
        val ramp = ANALYSIS_SCHEME.rain
        // Se comprueba la rampa entera: cada color debe devolver un dBZ que no
        // supere el suyo (los colores repetidos se resuelven al valor más bajo).
        for (i in 0 until (DBZ_MAX - DBZ_MIN + 1)) {
            val o = i * 4
            val a = ramp[o + 3].toInt() and 0xFF
            if (a == 0) continue
            val decoded = decoder.decode(
                ramp[o].toInt() and 0xFF,
                ramp[o + 1].toInt() and 0xFF,
                ramp[o + 2].toInt() and 0xFF,
                a,
            )
            assertNotNull("dBZ ${DBZ_MIN + i} sin decodificar", decoded)
            assertTrue(decoded!!.dbz <= DBZ_MIN + i)
            assertEquals(PrecipKind.RAIN, decoded.kind)
        }
    }

    @Test
    fun `los umbrales de las alarmas se decodifican de forma exacta`() {
        val decoder = ColorDecoder(ANALYSIS_SCHEME)
        for (level in Intensity.entries) {
            val i = level.dbz - DBZ_MIN
            val o = i * 4
            val decoded = decoder.decode(
                ANALYSIS_SCHEME.rain[o].toInt() and 0xFF,
                ANALYSIS_SCHEME.rain[o + 1].toInt() and 0xFF,
                ANALYSIS_SCHEME.rain[o + 2].toInt() and 0xFF,
                ANALYSIS_SCHEME.rain[o + 3].toInt() and 0xFF,
            )
            assertEquals("umbral ${level.name}", level.dbz, decoded?.dbz)
        }
    }

    @Test
    fun `un pixel transparente no es eco`() {
        assertNull(ColorDecoder().decode(0, 0, 0, 0))
    }

    @Test
    fun `un color lejano a la paleta se descarta`() {
        // Verde oscuro: a más de 40 por canal de cualquier entrada de la paleta.
        // (El verde puro sí existe en la rampa: corresponde a 75 dBZ.)
        assertNull(ColorDecoder(ColorScheme.UNIVERSAL_BLUE).decode(0, 128, 0, 255))
    }

    @Test
    fun `un color casi exacto cae en la entrada mas parecida`() {
        val decoder = ColorDecoder(ANALYSIS_SCHEME)
        val i = 30 - DBZ_MIN
        val o = i * 4
        val exacto = decoder.decode(
            ANALYSIS_SCHEME.rain[o].toInt() and 0xFF,
            ANALYSIS_SCHEME.rain[o + 1].toInt() and 0xFF,
            ANALYSIS_SCHEME.rain[o + 2].toInt() and 0xFF,
            255,
        )
        val desviado = decoder.decode(
            (ANALYSIS_SCHEME.rain[o].toInt() and 0xFF) + 2,
            (ANALYSIS_SCHEME.rain[o + 1].toInt() and 0xFF) - 1,
            (ANALYSIS_SCHEME.rain[o + 2].toInt() and 0xFF) + 1,
            255,
        )
        assertEquals(exacto?.dbz, desviado?.dbz)
    }

    @Test
    fun `la nieve se distingue de la lluvia`() {
        val decoder = ColorDecoder(ANALYSIS_SCHEME)
        val i = 30 - DBZ_MIN
        val o = i * 4
        val snow = decoder.decode(
            ANALYSIS_SCHEME.snow[o].toInt() and 0xFF,
            ANALYSIS_SCHEME.snow[o + 1].toInt() and 0xFF,
            ANALYSIS_SCHEME.snow[o + 2].toInt() and 0xFF,
            ANALYSIS_SCHEME.snow[o + 3].toInt() and 0xFF,
        )
        assertEquals(PrecipKind.SNOW, snow?.kind)
    }

    @Test
    fun `Marshall-Palmer ida y vuelta`() {
        for (mmh in listOf(0.1, 1.0, 5.0, 20.0, 100.0)) {
            val dbz = mmPerHourToDbz(mmh)
            assertEquals(mmh, dbzToMmPerHour(dbz), mmh * 1e-6)
        }
        assertEquals(0.0, dbzToMmPerHour(DBZ_MIN.toDouble()), 1e-9)
    }

    @Test
    fun `la leyenda sube en reflectividad e intensidad`() {
        val stops = legendFor(ANALYSIS_SCHEME)
        assertTrue(stops.size > 5)
        for (i in 1 until stops.size) {
            assertTrue(stops[i].dbz > stops[i - 1].dbz)
            assertTrue(stops[i].mmPerHour > stops[i - 1].mmPerHour)
        }
        assertEquals(listOf(20, 30, 40, 50), stops.filter { it.label != null }.map { it.dbz })
    }

    @Test
    fun `la etiqueta de intensidad sigue los umbrales`() {
        assertEquals("Sin precipitación", Intensity.labelFor(0.0))
        assertEquals("Llovizna", Intensity.labelFor(12.0))
        assertEquals("Lluvia débil", Intensity.labelFor(25.0))
        assertEquals("Tormenta", Intensity.labelFor(60.0))
    }
}
