package cat.plou.alarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Los tonos deben coincidir con los de la versión web: si alguien retoca una
 * frecuencia aquí, la alarma dejaría de sonar igual en los dos sitios.
 */
class TonesTest {

    @Test
    fun `hay ocho tonos, uno de ellos silencioso`() {
        assertEquals(8, AlarmTone.entries.size)
        assertNull(AlarmTone.SILENT.spec)
        assertEquals(7, AlarmTone.entries.count { it.spec != null })
    }

    @Test
    fun `el clasico son tres pitidos cuadrados de 880 Hz`() {
        val spec = AlarmTone.CLASSIC.spec!!
        assertEquals(1.6, spec.period, 1e-9)
        assertEquals(3, spec.notes.size)
        spec.notes.forEach {
            assertEquals(880.0, it.from, 1e-9)
            assertEquals(Wave.SQUARE, it.wave)
        }
        assertEquals(listOf(0.0, 0.24, 0.48), spec.notes.map { it.at })
    }

    @Test
    fun `la sirena barre hacia arriba y hacia abajo`() {
        val spec = AlarmTone.SIREN.spec!!
        val (sube, baja) = spec.notes
        assertTrue(sube.to > sube.from)
        assertTrue(baja.to < baja.from)
        assertEquals(sube.from, baja.to, 1e-9)
    }

    @Test
    fun `la gota cae en frecuencia`() {
        AlarmTone.DROPLET.spec!!.notes.forEach { assertTrue(it.to < it.from) }
    }

    @Test
    fun `las notas caben dentro de su ciclo`() {
        // Si una nota se saliera del periodo, se cortaría al repetir el patrón.
        AlarmTone.entries.mapNotNull { it.spec }.forEach { spec ->
            spec.notes.forEach { nota ->
                assertTrue(
                    "una nota se sale del ciclo",
                    nota.at + nota.duration <= spec.period + 1e-9,
                )
            }
        }
    }

    @Test
    fun `todas las notas tienen duracion y ganancia utiles`() {
        AlarmTone.entries.mapNotNull { it.spec }.forEach { spec ->
            assertTrue(spec.period > 0)
            spec.notes.forEach {
                assertTrue(it.duration > 0)
                assertTrue(it.gain > 0 && it.gain <= 1)
                assertTrue(it.from > 0 && it.to > 0)
            }
        }
    }

    @Test
    fun `un tono desconocido cae en el clasico`() {
        assertEquals(AlarmTone.CLASSIC, AlarmTone.of("NO_EXISTE"))
        assertEquals(AlarmTone.CLASSIC, AlarmTone.of(null))
        assertEquals(AlarmTone.BELL, AlarmTone.of("BELL"))
    }

    @Test
    fun `el tono silencioso no reproduce nada`() {
        // No debe fallar ni dejar nada sonando.
        val parar = playTone(AlarmTone.SILENT)
        assertNotNull(parar)
        parar()
    }

    @Test
    fun `la forma de onda se mantiene en su rango`() {
        for (wave in Wave.entries) {
            var min = Double.MAX_VALUE
            var max = -Double.MAX_VALUE
            var i = 0.0
            while (i < 20.0) {
                val v = waveForTest(wave, i)
                if (v < min) min = v
                if (v > max) max = v
                i += 0.01
            }
            assertTrue("$wave se sale de [-1, 1]", min >= -1.0001 && max <= 1.0001)
            assertFalse("$wave no oscila", max - min < 0.5)
        }
    }
}
