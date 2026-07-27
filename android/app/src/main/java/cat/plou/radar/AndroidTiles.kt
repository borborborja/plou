package cat.plou.radar

import android.graphics.BitmapFactory
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Teselas descargadas del proveedor y traducidas a reflectividad en el propio
 * dispositivo. Se cachean ya decodificadas: repetir el análisis de varias
 * ubicaciones cercanas no vuelve a bajar ni a decodificar las mismas teselas.
 */
class AndroidTileSource(
    private val http: OkHttpClient = defaultHttpClient(),
    private val index: () -> RadarIndex,
    private val options: TileOptions = TileOptions(),
    cacheEntries: Int = 120,
) : TileSource {

    private val decoder = ColorDecoder(ColorScheme.byId(options.color))
    private val cache = LruCache<String, DecodedTile>(cacheEntries)

    override suspend fun tile(frame: RadarFrame, z: Int, x: Int, y: Int): DecodedTile? =
        withContext(Dispatchers.IO) {
            val url = tileUrl(index(), frame, z, x, y, options)
            cache.get(url)?.let { return@withContext it }

            val request = Request.Builder().url(url).header("User-Agent", "Plou/1.0").build()
            http.newCall(request).execute().use { response ->
                // 404/204: fuera de cobertura o sin datos, no es un error.
                if (response.code == 404 || response.code == 204) return@withContext null
                if (!response.isSuccessful) return@withContext null
                val bytes = response.body?.bytes() ?: return@withContext null
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    ?: return@withContext null
                try {
                    val size = bitmap.width
                    val pixels = IntArray(size * bitmap.height)
                    bitmap.getPixels(pixels, 0, size, 0, 0, size, bitmap.height)
                    val decoded = decodeTile(pixels, size, decoder)
                    cache.put(url, decoded)
                    decoded
                } finally {
                    bitmap.recycle()
                }
            }
        }
}
