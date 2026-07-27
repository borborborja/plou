package cat.plou.alarm

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.sin

/**
 * Tonos de alarma sintetizados, con las mismas especificaciones que la versión
 * web: mismas frecuencias, formas de onda y patrones. Generarlos en el momento
 * evita distribuir ficheros de audio y permite ajustar volumen y duración sin
 * recortes.
 */

/** Forma de onda de una nota. */
enum class Wave { SINE, SQUARE, SAW, TRIANGLE }

/**
 * Una nota del patrón.
 * @param at retardo desde el inicio del ciclo, en segundos
 * @param from frecuencia inicial en Hz
 * @param to frecuencia final; distinta de [from] produce un barrido
 */
data class Note(
    val at: Double,
    val from: Double,
    val to: Double = from,
    val duration: Double,
    val wave: Wave = Wave.SINE,
    val gain: Double = 0.5,
)

/** Un tono: un patrón que se repite cada [period] segundos. */
data class ToneSpec(val period: Double, val notes: List<Note>)

enum class AlarmTone(val label: String, val spec: ToneSpec?) {
    // Tres pitidos cortos, el aviso más reconocible.
    CLASSIC(
        "Clásico",
        ToneSpec(
            1.6,
            listOf(
                Note(0.0, 880.0, duration = 0.16, wave = Wave.SQUARE, gain = 0.6),
                Note(0.24, 880.0, duration = 0.16, wave = Wave.SQUARE, gain = 0.6),
                Note(0.48, 880.0, duration = 0.16, wave = Wave.SQUARE, gain = 0.6),
            ),
        ),
    ),

    // Arpegio ascendente suave.
    CHIME(
        "Campanilla",
        ToneSpec(
            2.4,
            listOf(
                Note(0.0, 587.33, duration = 0.5),
                Note(0.18, 783.99, duration = 0.5),
                Note(0.36, 987.77, duration = 0.7),
                Note(0.54, 1174.66, duration = 0.9),
            ),
        ),
    ),

    // Barrido continuo tipo sirena.
    SIREN(
        "Sirena",
        ToneSpec(
            1.4,
            listOf(
                Note(0.0, 520.0, 980.0, 0.7, Wave.SAW, 0.45),
                Note(0.7, 980.0, 520.0, 0.7, Wave.SAW, 0.45),
            ),
        ),
    ),

    // Pulso corto y agudo, como el barrido de un radar.
    RADAR(
        "Radar",
        ToneSpec(
            1.2,
            listOf(
                Note(0.0, 1400.0, 900.0, 0.09, Wave.SINE, 0.7),
                Note(0.6, 1400.0, 900.0, 0.09, Wave.SINE, 0.35),
            ),
        ),
    ),

    // Gota cayendo: descenso rápido de frecuencia.
    DROPLET(
        "Gota",
        ToneSpec(
            1.8,
            listOf(
                Note(0.0, 1600.0, 420.0, 0.22, Wave.SINE, 0.7),
                Note(0.55, 1300.0, 380.0, 0.22, Wave.SINE, 0.5),
            ),
        ),
    ),

    // Timbre con dos notas y cola larga.
    BELL(
        "Timbre",
        ToneSpec(
            3.0,
            listOf(
                Note(0.0, 659.25, duration = 1.4, wave = Wave.TRIANGLE),
                Note(0.05, 1318.5, duration = 1.2, wave = Wave.SINE, gain = 0.35),
                Note(0.9, 523.25, duration = 1.6, wave = Wave.TRIANGLE),
            ),
        ),
    ),

    // Latido grave y persistente.
    PULSE(
        "Pulso",
        ToneSpec(
            1.0,
            listOf(
                Note(0.0, 220.0, duration = 0.28, wave = Wave.TRIANGLE, gain = 0.8),
                Note(0.34, 174.61, duration = 0.22, wave = Wave.TRIANGLE, gain = 0.5),
            ),
        ),
    ),

    SILENT("Silencioso", null),
    ;

    companion object {
        fun of(name: String?): AlarmTone =
            entries.firstOrNull { it.name == name } ?: CLASSIC
    }
}

private const val SAMPLE_RATE = 44100

/** Valor de la onda en [phase] radianes, según su forma. */
internal fun waveAt(wave: Wave, phase: Double): Double {
    val t = phase / (2 * PI)
    val frac = t - kotlin.math.floor(t)
    return when (wave) {
        Wave.SINE -> sin(phase)
        Wave.SQUARE -> if (frac < 0.5) 1.0 else -1.0
        Wave.SAW -> 2 * frac - 1
        Wave.TRIANGLE -> 4 * abs(frac - 0.5) - 1
    }
}

/**
 * Sintetiza un ciclo del patrón en PCM de 16 bits.
 *
 * Cada nota lleva una envolvente de ataque rápido y caída exponencial, que es
 * lo que evita los chasquidos al empezar y terminar.
 */
private fun renderCycle(spec: ToneSpec, volume: Double): ShortArray {
    val samples = (spec.period * SAMPLE_RATE).toInt()
    val mezcla = DoubleArray(samples)

    for (note in spec.notes) {
        val inicio = (note.at * SAMPLE_RATE).toInt()
        val largo = (note.duration * SAMPLE_RATE).toInt()
        var phase = 0.0
        for (i in 0 until largo) {
            val pos = inicio + i
            if (pos >= samples) break
            val avance = i.toDouble() / largo
            // Barrido lineal de frecuencia entre `from` y `to`.
            val freq = note.from + (note.to - note.from) * avance
            phase += 2 * PI * freq / SAMPLE_RATE
            // Ataque de 8 ms y caída exponencial.
            val ataque = min(1.0, i / (0.008 * SAMPLE_RATE))
            val caida = exp(-3.0 * avance)
            mezcla[pos] += waveAt(note.wave, phase) * note.gain * ataque * caida
        }
    }

    return ShortArray(samples) { i ->
        val v = (mezcla[i] * volume).coerceIn(-1.0, 1.0)
        (v * Short.MAX_VALUE).toInt().toShort()
    }
}

/**
 * Reproduce un tono. Devuelve una función para detenerlo.
 *
 * @param loop repetir hasta que se descarte
 * @param seconds duración máxima cuando no se repite
 * @param fadeIn subir el volumen de forma gradual
 */
fun playTone(
    tone: AlarmTone,
    volume: Float = 0.8f,
    loop: Boolean = false,
    seconds: Int = 10,
    fadeIn: Boolean = false,
): () -> Unit {
    val spec = tone.spec ?: return {}

    val ciclo = renderCycle(spec, volume.toDouble())
    val track = AudioTrack.Builder()
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
        )
        .setAudioFormat(
            AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build(),
        )
        .setBufferSizeInBytes(ciclo.size * 2)
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()

    val parado = java.util.concurrent.atomic.AtomicBoolean(false)
    val hilo = Thread {
        runCatching {
            track.play()
            val ciclos = if (loop) Int.MAX_VALUE else maxOf(1, (seconds / spec.period).toInt())
            for (n in 0 until ciclos) {
                if (parado.get()) break
                val datos = if (fadeIn && n < 3) {
                    // Sube en tres ciclos: útil para no sobresaltar de noche.
                    val factor = (n + 1) / 3.0
                    ShortArray(ciclo.size) { (ciclo[it] * factor).toInt().toShort() }
                } else {
                    ciclo
                }
                track.write(datos, 0, datos.size)
            }
        }
        runCatching { track.stop() }
        runCatching { track.release() }
    }
    hilo.start()

    return {
        parado.set(true)
        runCatching { track.pause(); track.flush() }
    }
}

/** Volumen del sistema para el canal de alarma, en [0, 1]. */
fun alarmVolume(manager: AudioManager): Float {
    val max = manager.getStreamMaxVolume(AudioManager.STREAM_ALARM).toFloat()
    return if (max <= 0) 1f else manager.getStreamVolume(AudioManager.STREAM_ALARM) / max
}


/** Acceso a la forma de onda para las pruebas. */
internal fun waveForTest(wave: Wave, phase: Double): Double = waveAt(wave, phase)
