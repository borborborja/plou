import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

/**
 * Credenciales de firma. En local salen de un fichero fuera del repositorio
 * (`~/.android-keystores/plou-release.properties`); en CI, de variables de
 * entorno alimentadas por los secretos del repositorio. Si no hay ninguna, la
 * compilación de release queda sin firmar en vez de fallar.
 */
val signingProps = Properties().apply {
    val fromEnv = System.getenv("PLOU_KEYSTORE_FILE")
    if (fromEnv != null) {
        setProperty("storeFile", fromEnv)
        setProperty("storePassword", System.getenv("PLOU_KEYSTORE_PASSWORD") ?: "")
        setProperty("keyAlias", System.getenv("PLOU_KEY_ALIAS") ?: "plou")
        setProperty("keyPassword", System.getenv("PLOU_KEY_PASSWORD") ?: "")
    } else {
        val local = File(System.getProperty("user.home"), ".android-keystores/plou-release.properties")
        if (local.exists()) local.inputStream().use { load(it) }
    }
}
val hasSigning = signingProps.getProperty("storeFile")?.let { File(it).exists() } == true

android {
    namespace = "cat.plou"
    compileSdk = 35

    defaultConfig {
        applicationId = "cat.plou"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("PLOU_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("PLOU_VERSION_NAME") ?: "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (hasSigning) {
            create("release") {
                storeFile = File(signingProps.getProperty("storeFile"))
                storePassword = signingProps.getProperty("storePassword")
                keyAlias = signingProps.getProperty("keyAlias")
                keyPassword = signingProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Misma clave en todas las versiones: así una actualización se
            // instala encima sin tener que desinstalar la anterior.
            if (hasSigning) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // Mapa de teselas XYZ sin clave de API ni servicios propietarios.
    implementation("org.osmdroid:osmdroid-android:6.1.20")

    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.compose.ui:ui-tooling-preview")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
