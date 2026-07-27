package cat.plou.radar

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Una tesela que no llega queda como «sin eco», igual que una de cielo
 * despejado. Si la rejilla no lleva la cuenta, una caída de red se lee como buen
 * tiempo y la alarma calla creyendo que ha mirado.
 */
class FieldDataCoverageTest {

    private val frame = RadarFrame(time = 1_700_000_000, path = "/v2/radar/0", nowcast = false)
    private val center = LatLon(41.39, 2.17)
    private val options = FieldOptions(radiusKm = 20.0)

    /** Tesela lisa con el dBZ indicado en todos sus píxeles. */
    private fun tile(dbz: Short, size: Int = 512) = DecodedTile(
        size = size,
        dbz = ShortArray(size * size) { dbz },
        kind = ByteArray(size * size) { 1 },
        empty = false,
    )

    @Test
    fun `si llegan todas las teselas la cobertura es total`() {
        val field = runBlocking {
            buildField(frame, center, options, { _, _, _, _ -> tile(30) })
        }
        assertEquals(1.0, field.dataCoverage, 1e-9)
    }

    @Test
    fun `una tesela que no llega baja la cobertura sin dejar rastro en el eco`() {
        var primera = true
        val field = runBlocking {
            buildField(frame, center, options) { _, _, _, _ ->
                // La primera falla; las demás traen lluvia.
                if (primera) { primera = false; null } else tile(30)
            }
        }
        assertTrue("debería faltar dato", field.dataCoverage < 1.0)
        assertTrue("la cobertura no puede ser negativa", field.dataCoverage >= 0.0)
    }

    @Test
    fun `sin ninguna tesela la cobertura es cero y el campo queda vacio`() {
        val field = runBlocking {
            buildField(frame, center, options) { _, _, _, _ -> null }
        }
        assertEquals(0.0, field.dataCoverage, 1e-9)
        // Y aquí está el fondo del asunto: sin datos, el campo es idéntico al de
        // un cielo despejado. Sólo `dataCoverage` los distingue.
        assertEquals(0.0, field.coverage, 1e-9)
    }

    @Test
    fun `una tesela que revienta cuenta como no llegada, no como despejado`() {
        val field = runBlocking {
            buildField(frame, center, options) { _, _, _, _ -> error("se cayó la red") }
        }
        assertEquals(0.0, field.dataCoverage, 1e-9)
    }
}
