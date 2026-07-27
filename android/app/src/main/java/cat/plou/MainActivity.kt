package cat.plou

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import cat.plou.alarm.WatchService
import cat.plou.data.PlouStore
import cat.plou.data.Settings
import cat.plou.ui.PlouApp
import cat.plou.ui.PlouTheme

/** Pantalla principal: radar, previsión, alarmas y ajustes. */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WatchService.ensureChannels(this)

        val store = PlouStore(applicationContext)

        setContent {
            val settings by store.settings.collectAsState(initial = Settings())

            // El permiso de notificaciones se pide una vez, al abrir: sin él la
            // alarma no puede avisar de nada.
            val askNotifications = rememberLauncherForActivityResult(
                ActivityResultContracts.RequestPermission(),
            ) { }
            LaunchedEffect(Unit) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    val granted = ContextCompat.checkSelfPermission(
                        this@MainActivity,
                        Manifest.permission.POST_NOTIFICATIONS,
                    ) == PackageManager.PERMISSION_GRANTED
                    if (!granted) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }

            PlouTheme(settings.theme) {
                PlouApp(store = store, settings = settings)
            }
        }
    }
}
