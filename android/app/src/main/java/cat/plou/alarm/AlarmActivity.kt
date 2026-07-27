package cat.plou.alarm

import android.app.NotificationManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import cat.plou.data.AlarmStateDto
import cat.plou.data.PlouStore
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Pantalla de aviso a pantalla completa, capaz de aparecer sobre la pantalla de
 * bloqueo. Es lo que hace que la alarma sirva de algo con el móvil en el bolsillo.
 */
class AlarmActivity : ComponentActivity() {

    companion object {
        const val EXTRA_TITLE = "titulo"
        const val EXTRA_BODY = "cuerpo"
        const val EXTRA_PLACE = "lugar"
        const val EXTRA_LOCATION_ID = "ubicacion"
    }

    private var tone: ToneGenerator? = null
    private var vibrator: Vibrator? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()

        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Aviso de lluvia"
        val body = intent.getStringExtra(EXTRA_BODY).orEmpty()
        val place = intent.getStringExtra(EXTRA_PLACE).orEmpty()
        val locationId = intent.getLongExtra(EXTRA_LOCATION_ID, -1L)

        startAlarmSound()

        setContent {
            AlarmScreen(
                place = place,
                title = title,
                body = body,
                onSnooze = if (locationId >= 0) {
                    { snooze(locationId) }
                } else {
                    null
                },
                onDismiss = { finishAlarm(locationId) },
            )
        }
    }

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            )
        }
    }

    private fun startAlarmSound() {
        runCatching {
            tone = ToneGenerator(AudioManager.STREAM_ALARM, 80).also {
                it.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 3000)
            }
        }
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(VibratorManager::class.java))?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Vibrator::class.java)
        }
        runCatching {
            val pattern = longArrayOf(0, 400, 250, 400, 250, 700)
            vibrator?.vibrate(VibrationEffect.createWaveform(pattern, -1))
        }
    }

    private fun stopAlarmSound() {
        runCatching { tone?.stopTone(); tone?.release() }
        tone = null
        runCatching { vibrator?.cancel() }
    }

    private fun snooze(locationId: Long) {
        val store = PlouStore(applicationContext)
        lifecycleScope.launch {
            val locations = store.currentLocations()
            val location = locations.firstOrNull { it.id == locationId } ?: return@launch
            val minutes = location.alarm.snoozeMinutes
            store.upsert(
                location.copy(
                    state = location.state.copy(
                        snoozedUntil = System.currentTimeMillis() + minutes * 60_000L,
                    ),
                ),
            )
        }
        finishAlarm(locationId)
    }

    private fun finishAlarm(locationId: Long) {
        stopAlarmSound()
        if (locationId >= 0) {
            runCatching {
                getSystemService(NotificationManager::class.java)
                    ?.cancel(1000 + locationId.toInt())
            }
        }
        finish()
    }

    override fun onDestroy() {
        stopAlarmSound()
        super.onDestroy()
    }
}

@Composable
private fun AlarmScreen(
    place: String,
    title: String,
    body: String,
    onSnooze: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    val hora = remember { SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date()) }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(
                        Color(0xFF1A2A5C),
                        Color(0xFF7A3A8C),
                        Color(0xFFFF6F4D),
                        Color(0xFFFF9D4D),
                    ),
                ),
            )
            .padding(28.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (place.isNotBlank()) {
                Text(
                    place,
                    color = Color.White,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.2f))
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                )
            }
            Box(
                modifier = Modifier
                    .size(88.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.18f)),
            )
            Text(
                title,
                color = Color.White,
                fontSize = 28.sp,
                fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center,
            )
            if (body.isNotBlank()) {
                Text(
                    body,
                    color = Color.White.copy(alpha = 0.85f),
                    fontSize = 15.sp,
                    textAlign = TextAlign.Center,
                )
            }
            Text(
                hora,
                color = Color.White,
                fontSize = 54.sp,
                fontWeight = FontWeight.Black,
            )
            if (onSnooze != null) {
                Button(
                    onClick = onSnooze,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color.White.copy(alpha = 0.2f),
                        contentColor = Color.White,
                    ),
                ) { Text("Posponer") }
            }
            Button(
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color.White,
                    contentColor = Color(0xFF1A2A5C),
                ),
            ) { Text("Descartar", fontWeight = FontWeight.Bold) }
        }
    }
}
