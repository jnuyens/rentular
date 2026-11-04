plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Upload key for Play releases. The values come from ~/.gradle/gradle.properties
// or the environment, never from a file in this repository. See
// ./create-upload-key.sh and README.md.
val uploadKeyNames = listOf(
    "RENTULAR_UPLOAD_STORE_FILE",
    "RENTULAR_UPLOAD_STORE_PASSWORD",
    "RENTULAR_UPLOAD_KEY_ALIAS",
    "RENTULAR_UPLOAD_KEY_PASSWORD",
)
val uploadKey: Map<String, String?> = uploadKeyNames.associateWith { name ->
    providers.gradleProperty(name).orElse(providers.environmentVariable(name)).orNull
}
val uploadStoreFile: File? = uploadKey["RENTULAR_UPLOAD_STORE_FILE"]?.let { file(it) }
val hasUploadKey: Boolean =
    uploadKey.values.all { !it.isNullOrBlank() } && uploadStoreFile?.isFile == true

android {
    namespace = "com.rentular.app"
    compileSdk = 36
    buildToolsVersion = "36.1.0"

    defaultConfig {
        applicationId = "com.rentular.app"
        minSdk = 21
        targetSdk = 36
        // Keep versionCode equal to REQUIRED_APP_VERSION in
        // packages/shared/src/constants/appVersion.ts (a test checks this).
        versionCode = 3
        versionName = "2.0"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (hasUploadKey) {
            create("release") {
                storeFile = uploadStoreFile
                storePassword = uploadKey["RENTULAR_UPLOAD_STORE_PASSWORD"]
                keyAlias = uploadKey["RENTULAR_UPLOAD_KEY_ALIAS"]
                keyPassword = uploadKey["RENTULAR_UPLOAD_KEY_PASSWORD"]
            }
        }
    }

    buildTypes {
        release {
            // A WebView wrapper has nothing worth shrinking.
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (hasUploadKey) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

// Without an upload key a release build would come out unsigned, which Play
// rejects. Fail early with a clear message instead. Debug builds and unit tests
// are not affected.
if (!hasUploadKey) {
    tasks.matching { it.name == "preReleaseBuild" }.configureEach {
        doFirst {
            throw GradleException(
                "No upload key configured for release builds.\n" +
                    "Set these four values in ~/.gradle/gradle.properties (or as environment variables):\n" +
                    uploadKeyNames.joinToString("\n") { "  $it" } +
                    "\nThe store file must exist. Run ./create-upload-key.sh once to create the key, " +
                    "and see README.md (Releasing to Google Play)."
            )
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.webkit:webkit:1.11.0")

    testImplementation("junit:junit:4.13.2")
}
