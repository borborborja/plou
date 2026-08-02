package cat.plou.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

data class DeviceLocation(
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Float?,
    val measuredAt: Long,
)

fun hasForegroundLocationPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED

fun hasBackgroundLocationPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
        PackageManager.PERMISSION_GRANTED

private fun Location.isRecent(now: Long, maxAgeMillis: Long): Boolean {
    val age = now - time
    return age in 0..maxAgeMillis && (!hasAccuracy() || accuracy <= 10_000f)
}

@SuppressLint("MissingPermission")
private suspend fun currentFrom(
    context: Context,
    manager: LocationManager,
    provider: String,
): Location? = withTimeoutOrNull(8_000L) {
    suspendCancellableCoroutine { continuation ->
        val cancellation = CancellationSignal()
        continuation.invokeOnCancellation { cancellation.cancel() }
        LocationManagerCompat.getCurrentLocation(
            manager,
            provider,
            cancellation,
            ContextCompat.getMainExecutor(context),
        ) { location ->
            if (continuation.isActive) continuation.resume(location)
        }
    }
}

/**
 * Devuelve una lectura reciente. Primero reutiliza una posición de pocos
 * minutos para no despertar sensores en cada ciclo y, si no existe, solicita
 * una nueva. Nunca entrega silenciosamente una coordenada antigua.
 */
@SuppressLint("MissingPermission")
suspend fun currentDeviceLocation(
    context: Context,
    maxAgeMillis: Long = 5 * 60_000L,
    now: () -> Long = System::currentTimeMillis,
): DeviceLocation? {
    if (!hasForegroundLocationPermission(context)) return null
    val manager = context.getSystemService(LocationManager::class.java) ?: return null
    val providers = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
        .filter { provider -> runCatching { manager.isProviderEnabled(provider) }.getOrDefault(false) }
    if (providers.isEmpty()) return null

    val at = now()
    val cached = (providers + LocationManager.PASSIVE_PROVIDER)
        .distinct()
        .mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
        .filter { it.isRecent(at, maxAgeMillis) }
        .maxByOrNull { it.time }

    var fresh: Location? = null
    if (cached == null) {
        for (provider in providers) {
            val candidate = runCatching { currentFrom(context, manager, provider) }.getOrNull()
            if (candidate != null && candidate.isRecent(now(), maxAgeMillis)) {
                fresh = candidate
                break
            }
        }
    }
    val location = cached ?: fresh ?: return null

    return DeviceLocation(
        latitude = location.latitude,
        longitude = location.longitude,
        accuracyM = location.accuracy.takeIf { location.hasAccuracy() },
        measuredAt = location.time,
    )
}
