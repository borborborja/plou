package cat.plou.alarm

import cat.plou.radar.EchoHit
import cat.plou.radar.Intensity
import cat.plou.radar.LatLon
import cat.plou.radar.LocationAnalysis
import cat.plou.radar.MotionVector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class EngineTest {

    private val center = LatLon(41.39, 2.17)
    private val tz = "Europe/Madrid"

    private fun madrid(h: Int, min: Int, day: Int = 8): Long =
        ZonedDateTime.of(2025, 7, day, h, min, 0, 0, ZoneId.of(tz)).toInstant().toEpochMilli()

    private fun hit(distanceKm: Double, dbz: Int = 30, snow: Boolean = false) = EchoHit(
        distanceKm = distanceKm,
        bearingDeg = 270.0,
        compass = "O",
        dbz = dbz,
        mmPerHour = 2.7,
        intensity = Intensity.labelFor(dbz.toDouble()),
        snow = snow,
        position = center,
    )

    private fun analysis(
        overhead: EchoHit? = null,
        nearest: EchoHit? = null,
        arrival: EchoHit? = null,
        motion: MotionVector? = null,
        eta: Int? = null,
    ) = LocationAnalysis(
        center = center,
        observedAt = 1_700_000_000_000,
        ageMinutes = 3.0,
        radiusKm = 20.0,
        thresholdDbz = 20,
        fieldCoverage = 0.1,
        overhead = overhead,
        nearest = nearest,
        strongest = nearest ?: overhead,
        arrival = arrival,
        cellsAboveThreshold = if (nearest != null || overhead != null) 5 else 0,
        areaCoveragePct = 4.0,
        motion = motion,
        etaMinutes = eta,
        etaRadiusMinutes = eta,
        clearingMinutes = null,
        timeline = emptyList(),
    )

    private fun input(
        config: AlarmConfig = AlarmConfig(),
        analysis: LocationAnalysis = analysis(nearest = hit(8.0)),
        state: AlarmState = AlarmState(),
        now: Long = madrid(12, 0),
    ) = EvaluateInput(now, config, analysis, state, "Casa", tz)

    @Test
    fun `avisa cuando hay lluvia en el radio`() {
        val out = evaluateAlarm(input())
        assertEquals(AlarmAction.FIRE, out.action)
        assertEquals(AlarmKind.NEARBY, out.notification?.kind)
        assertTrue(out.state.active)
        assertEquals(madrid(12, 0), out.state.lastFiredAt)
    }

    @Test
    fun `la alarma desactivada no hace nada`() {
        val out = evaluateAlarm(input(config = AlarmConfig(enabled = false)))
        assertEquals(AlarmAction.NONE, out.action)
        assertNull(out.notification)
    }

    @Test
    fun `lluvia encima gana sobre el modo elegido`() {
        val out = evaluateAlarm(
            input(
                config = AlarmConfig(mode = AlarmMode.OVERHEAD),
                analysis = analysis(overhead = hit(0.0), nearest = hit(5.0)),
            ),
        )
        assertEquals(AlarmAction.FIRE, out.action)
        assertEquals(AlarmKind.OVERHEAD, out.notification?.kind)
    }

    @Test
    fun `en modo encima no avisa por lluvia cercana`() {
        val out = evaluateAlarm(input(config = AlarmConfig(mode = AlarmMode.OVERHEAD)))
        assertEquals(AlarmAction.NONE, out.action)
    }

    @Test
    fun `en modo acercandose exige velocidad y antelacion`() {
        val lento = MotionVector(1.0, 0.0, 1.0, 90.0, 0.8, 100)
        val rapido = MotionVector(20.0, 0.0, 20.0, 90.0, 0.8, 100)
        val config = AlarmConfig(mode = AlarmMode.APPROACHING, leadMinutes = 30, minSpeedKmh = 5.0)

        // Demasiado lento.
        assertEquals(
            AlarmAction.NONE,
            evaluateAlarm(input(config, analysis(nearest = hit(9.0), motion = lento, eta = 10))).action,
        )
        // Llega más tarde de la antelación configurada.
        assertEquals(
            AlarmAction.NONE,
            evaluateAlarm(input(config, analysis(nearest = hit(9.0), motion = rapido, eta = 45))).action,
        )
        // Dentro de plazo y con velocidad suficiente.
        val out = evaluateAlarm(input(config, analysis(nearest = hit(9.0), motion = rapido, eta = 12)))
        assertEquals(AlarmAction.FIRE, out.action)
        assertEquals(AlarmKind.APPROACHING, out.notification?.kind)
        assertEquals(12, out.notification?.etaMinutes)
    }

    @Test
    fun `avisa antes de que el eco entre en el radio`() {
        val rapido = MotionVector(60.0, 0.0, 60.0, 90.0, 0.8, 100)
        val fuera = hit(42.0)
        val config = AlarmConfig(mode = AlarmMode.APPROACHING, leadMinutes = 30, minSpeedKmh = 5.0)

        val out = evaluateAlarm(
            input(config, analysis(nearest = null, arrival = fuera, motion = rapido, eta = 20)),
        )

        assertEquals(AlarmAction.FIRE, out.action)
        assertEquals(AlarmKind.APPROACHING, out.notification?.kind)
        assertEquals(42.0, out.notification?.distanceKm)
    }

    @Test
    fun `no repite el aviso de una situacion ya activa`() {
        val state = AlarmState(active = true, lastFiredAt = madrid(11, 50))
        val out = evaluateAlarm(input(state = state))
        assertEquals(AlarmAction.NONE, out.action)
    }

    @Test
    fun `con repeticion espera al intervalo`() {
        val config = AlarmConfig(repeat = true, repeatMinutes = 30)
        val reciente = AlarmState(active = true, lastFiredAt = madrid(11, 50))
        assertEquals(AlarmAction.NONE, evaluateAlarm(input(config, state = reciente)).action)

        val antiguo = AlarmState(active = true, lastFiredAt = madrid(11, 0))
        val out = evaluateAlarm(input(config, state = antiguo))
        assertEquals(AlarmAction.FIRE, out.action)
    }

    @Test
    fun `las horas de silencio absorben el episodio sin avisar`() {
        val config = AlarmConfig(quietHours = TimeWindow(enabled = true, from = "22:00", to = "07:00"))
        val out = evaluateAlarm(input(config, now = madrid(23, 30)))
        assertEquals(AlarmAction.SUPPRESS, out.action)
        // Queda marcada como activa, pero sin haber avisado a nadie: eso es lo
        // que permite decirlo al levantarse el silencio si sigue lloviendo.
        assertTrue(out.state.active)
        assertNull(out.notification)
    }

    @Test
    fun `al terminar el silencio avisa si el episodio sigue vivo`() {
        val config = AlarmConfig(quietHours = TimeWindow(enabled = true, from = "22:00", to = "07:00"))
        val noche = evaluateAlarm(input(config, now = madrid(23, 30)))
        assertEquals(AlarmAction.SUPPRESS, noche.action)

        // Sigue lloviendo a las 07:30, ya fuera de la franja de silencio.
        val manana = evaluateAlarm(input(config, state = noche.state, now = madrid(7, 30)))
        assertEquals(AlarmAction.FIRE, manana.action)
    }

    @Test
    fun `no repite el aviso de una situacion que si se anuncio`() {
        val primero = evaluateAlarm(input())
        assertEquals(AlarmAction.FIRE, primero.action)

        val segundo = evaluateAlarm(input(state = primero.state, now = madrid(12, 30)))
        assertEquals(AlarmAction.NONE, segundo.action)
        assertEquals("aviso ya emitido para esta situación", segundo.reason)
    }

    @Test
    fun `un aviso anterior al ultimo cierre no cuenta para la situacion nueva`() {
        // Avisó a las 08:00, escampó a las 10:00; lo de ahora es otro episodio.
        val out = evaluateAlarm(
            input(
                state = AlarmState(
                    active = true,
                    lastFiredAt = madrid(8, 0),
                    lastClearedAt = madrid(10, 0),
                ),
            ),
        )
        assertEquals(AlarmAction.FIRE, out.action)
    }

    @Test
    fun `fuera de la franja de vigilancia no se evalua`() {
        val config = AlarmConfig(schedule = TimeWindow(enabled = true, from = "08:00", to = "20:00"))
        val out = evaluateAlarm(input(config, now = madrid(6, 0)))
        assertEquals(AlarmAction.NONE, out.action)
        assertEquals("fuera de la franja de vigilancia", out.reason)
    }

    @Test
    fun `posponer silencia pero mantiene la situacion viva`() {
        val state = AlarmState(snoozedUntil = madrid(12, 30))
        val out = evaluateAlarm(input(state = state))
        assertEquals(AlarmAction.SUPPRESS, out.action)
        assertTrue(out.state.active)
    }

    @Test
    fun `respeta el intervalo minimo entre avisos distintos`() {
        val config = AlarmConfig(minIntervalMinutes = 60)
        val state = AlarmState(active = false, lastFiredAt = madrid(11, 30))
        assertEquals(AlarmAction.SUPPRESS, evaluateAlarm(input(config, state = state)).action)
    }

    @Test
    fun `al escampar cierra la situacion`() {
        val state = AlarmState(active = true, lastFiredAt = madrid(11, 0))
        val out = evaluateAlarm(input(analysis = analysis(), state = state))
        assertEquals(AlarmAction.NONE, out.action)
        assertTrue(!out.state.active)
        assertEquals(madrid(12, 0), out.state.lastClearedAt)
    }

    @Test
    fun `avisa de que ha escampado si esta configurado`() {
        val config = AlarmConfig(notifyOnClear = true)
        val state = AlarmState(active = true, lastFiredAt = madrid(11, 0))
        val out = evaluateAlarm(input(config, analysis = analysis(), state = state))
        assertEquals(AlarmAction.FIRE, out.action)
        assertEquals(AlarmKind.CLEAR, out.notification?.kind)
    }

    @Test
    fun `no avisa de que ha escampado en horas de silencio`() {
        val config = AlarmConfig(
            notifyOnClear = true,
            quietHours = TimeWindow(enabled = true, from = "22:00", to = "07:00"),
        )
        val state = AlarmState(active = true, lastFiredAt = madrid(23, 0))
        val out = evaluateAlarm(input(config, analysis = analysis(), state = state, now = madrid(23, 30)))
        assertEquals(AlarmAction.NONE, out.action)
    }

    @Test
    fun `sin precipitacion y sin situacion previa no pasa nada`() {
        val out = evaluateAlarm(input(analysis = analysis()))
        assertEquals(AlarmAction.NONE, out.action)
        assertEquals("sin precipitación relevante", out.reason)
    }

    @Test
    fun `la notificacion describe la nieve como tal`() {
        val out = evaluateAlarm(input(analysis = analysis(overhead = hit(0.0, snow = true))))
        assertNotNull(out.notification)
        assertTrue(out.notification!!.title.startsWith("Nieve"))
        assertTrue(out.notification.snow)
    }
}
