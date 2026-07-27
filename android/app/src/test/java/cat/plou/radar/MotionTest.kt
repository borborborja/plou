package cat.plou.radar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * El convenio de signos es lo delicado aquí: en esta rejilla `i` crece hacia el
 * este y `j` hacia el norte. Se construyen campos desplazados una cantidad
 * conocida y se comprueba que se recupera esa misma cantidad.
 */
class MotionTest {

    private val cellKm = 4.0
    private val size = 41 // 20 celdas a cada lado del centro

    private fun field(time: Long, blob: List<Pair<Int, Int>>): PrecipField {
        val half = size / 2
        val dbz = ShortArray(size * size) { NO_ECHO }
        val kind = ByteArray(size * size)
        for ((i, j) in blob) {
            if (i < 0 || i >= size || j < 0 || j >= size) continue
            dbz[j * size + i] = 40
            kind[j * size + i] = 1
        }
        return PrecipField(
            center = LatLon(41.39, 2.17),
            time = time,
            nowcast = false,
            cellKm = cellKm,
            half = half,
            width = size,
            height = size,
            dbz = dbz,
            kind = kind,
            coverage = blob.size.toDouble() / (size * size),
        )
    }

    /** Mancha cuadrada de 7×7 celdas centrada en (ci, cj). */
    private fun blob(ci: Int, cj: Int): List<Pair<Int, Int>> = buildList {
        for (dj in -3..3) for (di in -3..3) add((ci + di) to (cj + dj))
    }

    private fun desplazamiento(di: Int, dj: Int): MotionVector? {
        val t0 = 1_700_000_000L
        val a = field(t0, blob(20, 20))
        val b = field(t0 + 600, blob(20 + di, 20 + dj))
        return estimateMotion(a, b)
    }

    @Test
    fun `hacia el este`() {
        val v = desplazamiento(3, 0)
        assertNotNull(v)
        // 3 celdas de 4 km en 10 minutos = 72 km/h hacia el este.
        assertEquals(72.0, v!!.east, 4.0)
        assertEquals(0.0, v.north, 4.0)
        assertEquals(90.0, v.bearingDeg, 5.0)
    }

    @Test
    fun `hacia el norte`() {
        val v = desplazamiento(0, 2)
        assertNotNull(v)
        assertEquals(0.0, v!!.east, 4.0)
        assertEquals(48.0, v.north, 4.0)
        assertEquals(0.0, v.bearingDeg, 5.0)
    }

    @Test
    fun `hacia el oeste`() {
        val v = desplazamiento(-2, 0)
        assertNotNull(v)
        assertEquals(-48.0, v!!.east, 4.0)
        assertEquals(270.0, v.bearingDeg, 5.0)
    }

    @Test
    fun `hacia el sur`() {
        val v = desplazamiento(0, -3)
        assertNotNull(v)
        assertEquals(-72.0, v!!.north, 4.0)
        assertEquals(180.0, v.bearingDeg, 5.0)
    }

    @Test
    fun `hacia el suroeste`() {
        val v = desplazamiento(-2, -2)
        assertNotNull(v)
        assertTrue(v!!.east < 0)
        assertTrue(v.north < 0)
        assertEquals(225.0, v.bearingDeg, 8.0)
    }

    @Test
    fun `un campo quieto no inventa movimiento`() {
        val v = desplazamiento(0, 0)
        assertNotNull(v)
        assertEquals(0.0, v!!.speedKmh, 2.0)
    }

    @Test
    fun `sin ecos no hay estimacion`() {
        val t0 = 1_700_000_000L
        assertNull(estimateMotion(field(t0, emptyList()), field(t0 + 600, emptyList())))
    }

    @Test
    fun `no estima con geometrias distintas`() {
        val t0 = 1_700_000_000L
        val a = field(t0, blob(20, 20))
        val b = PrecipField(
            center = a.center, time = t0 + 600, nowcast = false, cellKm = 8.0,
            half = a.half, width = a.width, height = a.height,
            dbz = a.dbz, kind = a.kind, coverage = a.coverage,
        )
        assertNull(estimateMotion(a, b))
    }

    @Test
    fun `la serie combina varios pares`() {
        val t0 = 1_700_000_000L
        val fields = (0..3).map { field(t0 + it * 600L, blob(20 + it * 2, 20)) }
        val v = estimateMotionSeries(fields)
        assertNotNull(v)
        assertEquals(48.0, v!!.east, 4.0)
    }
}
