package cat.plou.map

import org.junit.Assert.assertEquals
import org.junit.Test

class WeatherLayersTest {
    @Test
    fun `cloud timeline covers ten days in three hour steps`() {
        val frames = cloudFrames(1_800_000_000_000L)
        assertEquals(81, frames.size)
        assertEquals(3 * 60 * 60_000L, frames[1].time - frames[0].time)
        assertEquals(10 * 24 * 60 * 60_000L, frames.last().time - frames.first().time)
    }

    @Test
    fun `cloud tiles stop at provider useful zoom`() {
        val frame = cloudFrames().first()
        val clouds = WeatherTileSource("clouds", "total", frame, "test")
        val satellite = WeatherTileSource("satellite", "geocolour", frame, "")
        assertEquals(10, clouds.maximumZoomLevel)
        assertEquals(12, satellite.maximumZoomLevel)
    }
}
