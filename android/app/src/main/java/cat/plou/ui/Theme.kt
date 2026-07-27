package cat.plou.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Sistema de diseño de Plou: Material 3 con luces de atardecer.
 * Un único degradado de marca señala el elemento activo o primario de cada
 * pantalla; el resto son superficies neutras que dependen del tema.
 */

val BrandBlue = Color(0xFF6EA8FF)
val BrandOrange = Color(0xFFFF9D4D)
val BrandPink = Color(0xFFFF6FA0)

val BrandGradient = Brush.linearGradient(listOf(BrandBlue, BrandOrange, BrandPink))

private val LightColors = lightColorScheme(
    primary = Color(0xFF3B6FD6),
    onPrimary = Color.White,
    secondary = BrandOrange,
    background = Color(0xFFF4F6FB),
    onBackground = Color(0xFF14151A),
    surface = Color.White,
    onSurface = Color(0xFF14151A),
    surfaceVariant = Color(0xFFEDF0F7),
    onSurfaceVariant = Color(0xFF5A5E6B),
    outline = Color(0xFFDDE2EC),
)

private val DarkColors = darkColorScheme(
    primary = BrandBlue,
    onPrimary = Color(0xFF0B0D14),
    secondary = BrandOrange,
    background = Color(0xFF0B0D14),
    onBackground = Color(0xFFF5F6FA),
    surface = Color(0xFF161923),
    onSurface = Color(0xFFF5F6FA),
    surfaceVariant = Color(0xFF1E222E),
    onSurfaceVariant = Color(0xFF9AA1B4),
    outline = Color(0xFF2A2F3D),
)

/** Todo redondeado: tarjetas 24, controles en cápsula. */
private val PlouShapes = Shapes(
    extraSmall = RoundedCornerShape(10.dp),
    small = RoundedCornerShape(14.dp),
    medium = RoundedCornerShape(20.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

private val PlouTypography = Typography(
    displayLarge = TextStyle(fontSize = 52.sp, fontWeight = FontWeight.Black, letterSpacing = (-1).sp),
    headlineSmall = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Black),
    titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Bold),
    bodyMedium = TextStyle(fontSize = 14.sp),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp),
)

@Composable
fun PlouTheme(theme: String = "auto", content: @Composable () -> Unit) {
    val dark = when (theme) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    MaterialTheme(
        colorScheme = if (dark) DarkColors else LightColors,
        shapes = PlouShapes,
        typography = PlouTypography,
        content = content,
    )
}
