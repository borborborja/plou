package cat.plou.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Despertador de la vigilancia.
 *
 * Una espera con `delay()` no despierta el aparato: con la pantalla apagada el
 * sistema suspende la CPU y la comprobación se retrasa sin que nadie se entere,
 * justo cuando una alarma de lluvia es más útil. AlarmManager sí despierta, y el
 * servicio se arranca desde aquí porque el sistema mantiene el aparato despierto
 * mientras corre `onReceive`.
 */
class WatchAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        runCatching { WatchService.start(context.applicationContext) }
    }
}
