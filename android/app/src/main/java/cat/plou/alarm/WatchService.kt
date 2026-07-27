package cat.plou.alarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import cat.plou.MainActivity
import cat.plou.R
import cat.plou.data.AlarmEvent
import cat.plou.data.AlarmStateDto
import cat.plou.data.PlouStore
import cat.plou.radar.AnalyzeOptions
import cat.plou.radar.AndroidTileSource
import cat.plou.radar.LatLon
import cat.plou.radar.RadarIndex
import cat.plou.radar.RadarIndexClient
import cat.plou.radar.analyzeLocation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.TimeZone

/**
 * Vigilante en primer plano.
 *
 * Una alarma de lluvia sólo sirve si suena con la pantalla apagada, así que la
 * comprobación vive en un servicio en primer plano —con su notificación
 * permanente— en lugar de en un trabajo diferido que el sistema puede retrasar
 * media hora. Todo el análisis ocurre aquí, en el dispositivo.
 */
class WatchService : Service() {

    companion object {
        const val CHANNEL_WATCH = "plou-vigilancia"
        const val CHANNEL_ALERT = "plou-avisos"
        const val ACTION_START = "cat.plou.START_WATCH"
        const val ACTION_STOP = "cat.plou.STOP_WATCH"
        private const val NOTIFICATION_ID = 1

        fun start(context: Context) {
            val intent = Intent(context, WatchService::class.java).setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.startService(Intent(context, WatchService::class.java).setAction(ACTION_STOP))
        }

        /** Crea los canales de notificación; idempotente. */
        fun ensureChannels(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_WATCH,
                    "Vigilancia del radar",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply { description = "Aviso permanente mientras Plou vigila el radar." },
            )
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ALERT,
                    "Avisos de lluvia",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Avisos cuando se acerca precipitación."
                    enableVibration(true)
                },
            )
        }
    }

    private val job = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.Default + job)
    private lateinit var store: PlouStore
    private val indexClient = RadarIndexClient()
    private var loop: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        store = PlouStore(applicationContext)
        ensureChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        startForegroundNotice("Vigilando el radar")
        if (loop == null) loop = scope.launch { watchLoop() }
        return START_STICKY
    }

    override fun onDestroy() {
        loop = null
        scope.cancel()
        super.onDestroy()
    }

    private fun startForegroundNotice(text: String) {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_WATCH)
            .setContentTitle("Plou")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_plou)
            .setOngoing(true)
            .setContentIntent(open)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private suspend fun watchLoop() {
        while (scope.isActive) {
            val settings = runCatching { store.currentSettings() }.getOrNull()
            val minutes = (settings?.checkIntervalMinutes ?: 5).coerceIn(2, 60)
            runCatching { checkAll() }
            delay(minutes * 60_000L)
        }
    }

    /** Comprueba todas las ubicaciones con alarma activa. */
    private suspend fun checkAll() {
        val locations = store.currentLocations().filter { it.alarm.enabled }
        if (locations.isEmpty()) {
            startForegroundNotice("Sin ubicaciones vigiladas")
            return
        }

        val index: RadarIndex = indexClient.get()
        val tiles = AndroidTileSource(index = { index })
        val timezone = TimeZone.getDefault().id
        var fired = 0

        for (location in locations) {
            val config = location.alarm.toConfig()
            val analysis = runCatching {
                analyzeLocation(
                    index = index,
                    center = LatLon(location.lat, location.lon),
                    options = AnalyzeOptions(
                        radiusKm = config.radiusKm,
                        thresholdDbz = config.intensity.dbz,
                        lookaheadMinutes = maxOf(30, config.leadMinutes + 15),
                        rain = config.detectRain,
                        snow = config.detectSnow,
                    ),
                    tiles = tiles,
                )
            }.getOrNull() ?: continue

            val outcome = evaluateAlarm(
                EvaluateInput(
                    now = System.currentTimeMillis(),
                    config = config,
                    analysis = analysis,
                    state = location.state.toState(),
                    locationName = location.name,
                    timezone = timezone,
                ),
            )

            store.upsert(location.copy(state = AlarmStateDto.from(outcome.state)))

            val notification = outcome.notification
            if (outcome.action == AlarmAction.FIRE && notification != null) {
                fired++
                store.addEvent(
                    AlarmEvent(
                        at = System.currentTimeMillis(),
                        locationName = location.name,
                        title = notification.title,
                        body = notification.body,
                    ),
                )
                raise(location.id, location.name, notification)
            }
        }

        val when_ = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
            .format(java.util.Date())
        startForegroundNotice(
            if (fired > 0) "Aviso emitido a las $when_" else "Vigilando · última comprobación $when_",
        )
    }

    /** Lanza el aviso: notificación de alta prioridad y pantalla completa. */
    private fun raise(locationId: Long, place: String, notification: AlarmNotification) {
        val full = Intent(this, AlarmActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            putExtra(AlarmActivity.EXTRA_TITLE, notification.title)
            putExtra(AlarmActivity.EXTRA_BODY, notification.body)
            putExtra(AlarmActivity.EXTRA_LOCATION_ID, locationId)
            putExtra(AlarmActivity.EXTRA_PLACE, place)
        }
        val fullPending = PendingIntent.getActivity(
            this,
            locationId.toInt(),
            full,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ALERT)
            .setContentTitle(notification.title)
            .setContentText(notification.body)
            .setSmallIcon(R.drawable.ic_stat_plou)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(fullPending)
            .setFullScreenIntent(fullPending, true)

        runCatching {
            NotificationManagerCompat.from(this)
                .notify(1000 + locationId.toInt(), builder.build())
        }
    }
}
