package cat.plou.alarm

import android.app.AlarmManager
import android.app.KeyguardManager
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
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import cat.plou.MainActivity
import cat.plou.R
import cat.plou.data.AlarmConfigDto
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
        const val ACTION_CHECK = "cat.plou.CHECK_NOW"
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

    /**
     * Cobertura mínima de teselas para fiarse de un «no pasa nada». No se exige
     * el 100 %: el borde de la rejilla queda lejos del punto vigilado y un fallo
     * suelto ahí no cambia la conclusión.
     */
    private val MIN_DATA_COVERAGE = 0.95

    private val job = SupervisorJob()
    // El análisis descarga teselas y las decodifica: es trabajo de E/S, y en el
    // grupo `Default` bloquearía hilos que hacen falta para otras cosas.
    private val scope = CoroutineScope(Dispatchers.IO + job)
    private lateinit var store: PlouStore
    private val indexClient = RadarIndexClient()
    private var checking: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        store = PlouStore(applicationContext)
        ensureChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            cancelNextCheck()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        startForegroundNotice("Vigilando el radar")
        runCheck()
        return START_STICKY
    }

    override fun onDestroy() {
        // El despertador se deja puesto a propósito: si el sistema mata el
        // servicio, la próxima alarma lo levanta. Sólo se quita al dejar de
        // vigilar, que es cuando el usuario lo ha pedido.
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

    /**
     * Una comprobación y, al terminar, el despertador para la siguiente.
     *
     * Se toma un wake lock mientras dura: si no, el aparato puede volver a
     * dormirse a mitad de la descarga de teselas y dejar el análisis colgado.
     */
    private fun runCheck() {
        if (checking?.isActive == true) return

        val power = getSystemService(PowerManager::class.java)
        val wake = power?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "plou:comprobacion")
        // Con caducidad, para que un fallo raro no deje el aparato despierto.
        runCatching { wake?.acquire(3 * 60_000L) }

        checking = scope.launch {
            val minutes = (
                runCatching { store.currentSettings() }.getOrNull()?.checkIntervalMinutes ?: 5
                ).coerceIn(2, 60)
            try {
                runCatching { checkAll() }
            } finally {
                scheduleNextCheck(minutes)
                if (wake?.isHeld == true) runCatching { wake.release() }
            }
        }
    }

    private fun checkPendingIntent(): PendingIntent = PendingIntent.getBroadcast(
        this,
        0,
        Intent(this, WatchAlarmReceiver::class.java).setAction(ACTION_CHECK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /**
     * Programa la siguiente comprobación.
     *
     * `setAndAllowWhileIdle` es el único que despierta el aparato en reposo sin
     * pedir permisos especiales. En reposo profundo el sistema agrupa estos
     * avisos y los espacia unos nueve minutos: sigue siendo muchísimo mejor que
     * una espera que no despierta a nadie.
     */
    private fun scheduleNextCheck(minutes: Int) {
        val alarms = getSystemService(AlarmManager::class.java) ?: return
        runCatching {
            alarms.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + minutes * 60_000L,
                checkPendingIntent(),
            )
        }
    }

    private fun cancelNextCheck() {
        runCatching { getSystemService(AlarmManager::class.java)?.cancel(checkPendingIntent()) }
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
        var incompletas = 0

        for (base in locations) {
            // La alarma de «mi posición» se recoloca antes de analizarla.
            val location = if (base.followDevice) {
                val punto = cat.plou.ui.deviceLocation(applicationContext)
                if (punto == null) continue else base.copy(lat = punto.latitude, lon = punto.longitude)
            } else {
                base
            }
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

            // Una tesela que no llega es indistinguible de una sin lluvia. Si no
            // hay nada que avisar y faltan datos, esto no es una comprobación
            // buena: puede ser una caída de red disfrazada de buen tiempo. Al
            // revés no aplica —lo que falta puede esconder lluvia, nunca
            // inventarla—, así que un aviso sí sale con cobertura parcial.
            val incompleto = analysis.dataCoverage < MIN_DATA_COVERAGE

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

            if (incompleto && outcome.action != AlarmAction.FIRE) {
                incompletas++
                continue
            }

            // Se guarda sobre `base`: si la ubicación sigue al aparato, sus
            // coordenadas son de este momento y no deben quedarse grabadas.
            store.upsert(base.copy(state = AlarmStateDto.from(outcome.state)))

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
                raise(location.id, location.name, notification, location.alarm)
            }
        }

        val when_ = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
            .format(java.util.Date())
        startForegroundNotice(
            when {
                fired > 0 -> "Aviso emitido a las $when_"
                // Se dice, en vez de aparentar una comprobación completa.
                incompletas > 0 -> "Datos de radar incompletos · $when_"
                else -> "Vigilando · última comprobación $when_"
            },
        )
    }

    /**
     * ¿Puede el sistema abrir la pantalla de alarma? Desde Android 14 el permiso
     * de pantalla completa sólo se concede solo a apps de llamadas y despertadores.
     */
    private fun canUseFullScreen(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() ?: false
        } else {
            true
        }

    /** Lanza el aviso: notificación de alta prioridad y pantalla completa. */
    private fun raise(
        locationId: Long,
        place: String,
        notification: AlarmNotification,
        alarm: AlarmConfigDto,
    ) {
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

        val power = getSystemService(PowerManager::class.java)
        val keyguard = getSystemService(KeyguardManager::class.java)
        val entrega = alarmDelivery(
            canFullScreen = canUseFullScreen(),
            interactive = power?.isInteractive ?: true,
            locked = keyguard?.isKeyguardLocked ?: false,
        )
        // Si la pantalla de alarma no va a abrirse, el tono lo toca el propio
        // servicio: sin esto el aviso se quedaría en el pitido genérico del
        // sistema y el tono, el volumen y la subida gradual no servirían de nada.
        if (entrega == AlarmDelivery.SOUND && alarm.tone != "SILENT") {
            runCatching {
                playTone(
                    tone = AlarmTone.of(alarm.tone),
                    volume = alarm.volume,
                    // Aquí nunca en bucle: no hay pantalla que permita callarlo.
                    loop = false,
                    seconds = alarm.soundSeconds.coerceIn(3, 30),
                    fadeIn = alarm.fadeIn,
                )
            }
        }
    }
}

/** Por dónde va a enterarse el usuario del aviso. */
internal enum class AlarmDelivery { SCREEN, SOUND }

/**
 * Decide cómo entra el aviso.
 *
 * El sistema sólo abre la pantalla de alarma si tiene permiso de pantalla
 * completa y el aparato está bloqueado o con la pantalla apagada. En cualquier
 * otro caso degrada el aviso a una notificación flotante, y entonces el tono
 * elegido tiene que sonarlo el servicio.
 */
internal fun alarmDelivery(
    canFullScreen: Boolean,
    interactive: Boolean,
    locked: Boolean,
): AlarmDelivery =
    if (canFullScreen && (!interactive || locked)) AlarmDelivery.SCREEN else AlarmDelivery.SOUND
