plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val buildNumber = (System.getenv("BRODOIT_BUILD_NUMBER") ?: "1").toIntOrNull() ?: 1
// above the Play listing's earlier builds (made outside this repo) and the first sideload builds (1–7)
val versionCodeBase = 1000
val siteUrl = System.getenv("BRODOIT_SITE_URL") ?: "https://brodoit.com"

android {
    namespace = "com.brodoit.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.brodoit.app"
        minSdk = 26
        targetSdk = 36
        versionCode = versionCodeBase + buildNumber
        versionName = "1.0.$buildNumber"
        resValue("string", "site_url", siteUrl)
        resValue("string", "site_host", siteUrl.removePrefix("https://").removePrefix("http://").trimEnd('/'))
        manifestPlaceholders["siteHost"] = siteUrl.removePrefix("https://").removePrefix("http://").trimEnd('/')
    }

    // direct: the APK served at brodoit.com/android (sideload). play: the bundle for the existing Play listing.
    flavorDimensions += "store"
    productFlavors {
        create("direct") { dimension = "store"; applicationId = "com.brodoit.app" }
        create("play") { dimension = "store"; applicationId = "com.brodoit.twa" }
    }

    buildTypes {
        release {
            // Signed later by the Brodoit server with its own upload key (see modules/android.js).
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1") }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
    implementation("com.google.android.gms:play-services-fitness:21.2.0")
    implementation("com.google.android.gms:play-services-base:18.5.0")
}
