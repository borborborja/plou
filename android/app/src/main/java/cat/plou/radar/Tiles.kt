package cat.plou.radar

/** Reflectividad que representa «sin eco». */
const val NO_ECHO: Short = (DBZ_MIN - 1).toShort()

/**
 * Tesela ya traducida a magnitudes físicas: reflectividad y tipo por píxel.
 * `kind`: 0 = sin eco, 1 = lluvia, 2 = nieve.
 */
class DecodedTile(
    val size: Int,
    val dbz: ShortArray,
    val kind: ByteArray,
    val empty: Boolean,
)

/**
 * De dónde salen las teselas ya decodificadas. Se abstrae para que el análisis
 * sea comprobable sin red ni Android: las pruebas inyectan teselas sintéticas.
 */
fun interface TileSource {
    /** Tesela del fotograma en esas coordenadas, o `null` si no hay datos. */
    suspend fun tile(frame: RadarFrame, z: Int, x: Int, y: Int): DecodedTile?
}

/** Traduce los píxeles ARGB de una tesela a reflectividad y tipo. */
fun decodeTile(argb: IntArray, size: Int, decoder: ColorDecoder): DecodedTile {
    val dbz = ShortArray(size * size) { NO_ECHO }
    val kind = ByteArray(size * size)
    var echoes = 0
    for (i in argb.indices) {
        val pixel = decoder.decodeArgb(argb[i]) ?: continue
        dbz[i] = pixel.dbz.toShort()
        kind[i] = if (pixel.kind == PrecipKind.SNOW) 2 else 1
        echoes++
    }
    return DecodedTile(size, dbz, kind, echoes == 0)
}
