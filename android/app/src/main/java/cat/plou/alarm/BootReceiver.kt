package cat.plou.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import cat.plou.data.PlouStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Reanuda la vigilancia después de un reinicio.
 *
 * Sin esto, quien tuviera la alarma puesta dejaba de recibir avisos al reiniciar
 * el móvil y no había ninguna señal de ello: la app seguía diciendo que estaba
 * vigilando porque la preferencia seguía activada.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val accion = intent.action
        if (accion != Intent.ACTION_BOOT_COMPLETED &&
            accion != Intent.ACTION_MY_PACKAGE_REPLACED &&
            accion != "android.intent.action.QUICKBOOT_POWERON"
        ) {
            return
        }

        // La preferencia se lee en segundo plano; `goAsync` mantiene vivo el
        // receptor mientras tanto.
        val pending = goAsync()
        val app = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            try {
                if (PlouStore(app).currentSettings().watching) WatchService.start(app)
            } catch (_: Exception) {
                // Si no se puede leer la preferencia, no se arranca nada: es
                // preferible a dejar un servicio en marcha sin que lo hayan pedido.
            } finally {
                pending.finish()
            }
        }
    }
}
