package cat.plou.alarm

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * El aviso tiene que llegar siempre por algún sitio. Si la pantalla de alarma no
 * va a abrirse, el tono lo toca el servicio; sin esto el usuario sólo oiría el
 * pitido genérico del sistema y creería que la alarma suena como la configuró.
 */
class AlarmDeliveryTest {

    @Test
    fun `con la pantalla apagada se abre la pantalla de alarma`() {
        assertEquals(
            AlarmDelivery.SCREEN,
            alarmDelivery(canFullScreen = true, interactive = false, locked = false),
        )
    }

    @Test
    fun `bloqueado tambien se abre, aunque la pantalla este encendida`() {
        assertEquals(
            AlarmDelivery.SCREEN,
            alarmDelivery(canFullScreen = true, interactive = true, locked = true),
        )
    }

    @Test
    fun `con el movil en la mano el sistema degrada el aviso y suena el servicio`() {
        assertEquals(
            AlarmDelivery.SOUND,
            alarmDelivery(canFullScreen = true, interactive = true, locked = false),
        )
    }

    @Test
    fun `sin permiso de pantalla completa suena el servicio en cualquier caso`() {
        // Android 14 no concede ese permiso solo a una app del tiempo.
        for (interactive in listOf(true, false)) {
            for (locked in listOf(true, false)) {
                assertEquals(
                    "canFullScreen=false interactive=$interactive locked=$locked",
                    AlarmDelivery.SOUND,
                    alarmDelivery(canFullScreen = false, interactive = interactive, locked = locked),
                )
            }
        }
    }
}
