/**
 * patch-android-native.mts — Patch Android native untuk JADHUMAN.
 *
 * Dijalankan SEBELUM setiap `tauri android build`:
 *   npm run tauri:android:build → `tsx tools/patch-android-native.mts && tauri android build ...`
 *
 * Yang dilakukan (idempotent — aman dijalankan berulang):
 *   1. Generate ulang icon dari src-tauri/icons/icon.png → semua mipmap-*
 *   2. Tulis/timpa AndroidManifest.xml (theme + 8 permissions + service + receiver)
 *   3. Tulis/timpa build.gradle.kts (compileSdk 37, WorkManager, ProGuard, signing)
 *   4. Tulis/timpa proguard-rules.pro (WorkManager + Room + Jadhuman keep rules)
 *   5. Tulis/timpa resources (colors.xml, themes.xml day+night, splash)
 *   6. Tulis/timpa Kotlin sources:
 *      - AutomationWebView.kt   (singleton WebView → dispatch jadhuman-background-tick)
 *      - MainActivity.kt        (JadhumanBridge + JadhumanAutomasiBridge + insets + theme)
 *      - JadhumanForegroundService.kt  (START_STICKY + 30s tick + 24h wake lock)
 *      - JadhumanNotificationHelper.kt (IMPORTANCE_HIGH + BigTextStyle)
 *      - JadhumanBootReceiver.kt       (restart service + enqueue worker saat boot/update)
 *      - JadhumanKeepaliveWorker.kt    (15-min WorkManager, HTTP form-urlencoded, dedup)
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// ─── Helper ────────────────────────────────────────────────────────────────────
const root = join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'src', 'main');
const put  = (file: string, content: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

// ─── 1. Icons ─────────────────────────────────────────────────────────────────
const iconSrc = join(process.cwd(), 'src-tauri', 'icons', 'icon.png');
const iconOut = join(tmpdir(), 'tauri-icons-' + randomBytes(4).toString('hex'));
const resDir  = join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res');

console.log('🎨 Generating Android icons dari icon Jadhuman...');
mkdirSync(iconOut, { recursive: true });
execFileSync('npx', ['@tauri-apps/cli', 'icon', iconSrc, '-o', iconOut], {
  stdio: 'inherit',
  cwd: process.cwd(),
});

const mipmaps = ['mipmap-hdpi', 'mipmap-mdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
for (const mipmap of mipmaps) {
  const src = join(iconOut, 'android', mipmap);
  const dst = join(resDir, mipmap);
  try { cpSync(src, dst, { recursive: true }); console.log(`  ✅ ${mipmap} disalin`); }
  catch { console.warn(`  ⚠️  ${mipmap} tidak ditemukan, skip`); }
}
try { cpSync(join(iconOut, 'android', 'mipmap-anydpi-v26'), join(resDir, 'mipmap-anydpi-v26'), { recursive: true }); console.log('  ✅ mipmap-anydpi-v26 disalin'); }
catch { console.warn('  ⚠️  mipmap-anydpi-v26 tidak ditemukan, skip'); }
try {
  const dst = join(resDir, 'values', 'ic_launcher_background.xml');
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(join(iconOut, 'android', 'values', 'ic_launcher_background.xml'), dst);
  console.log('  ✅ ic_launcher_background.xml disalin');
} catch { console.warn('  ⚠️  ic_launcher_background.xml tidak ditemukan, skip'); }
console.log('🎨 Icon Jadhuman berhasil diterapkan!\n');

// ─── 2. Splash screen ─────────────────────────────────────────────────────────
const splashIcon = join(root, 'res/drawable-nodpi/splash_icon.png');
mkdirSync(dirname(splashIcon), { recursive: true });
cpSync(join(iconOut, '128x128@2x.png'), splashIcon);
put(join(root, 'res/drawable/splash_screen.xml'),
  `<layer-list xmlns:android="http://schemas.android.com/apk/res/android"><item android:drawable="@color/splash_background"/><item><bitmap android:gravity="center" android:src="@drawable/splash_icon" /></item></layer-list>\n`);

// ─── 3. AndroidManifest.xml ────────────────────────────────────────────────────
const manifestPath = join(root, 'AndroidManifest.xml');
if (!existsSync(manifestPath)) throw new Error(`AndroidManifest.xml tidak ditemukan: ${manifestPath}`);

let manifest = readFileSync(manifestPath, 'utf8');
// Ganti semua style references ke Theme.jadhuman
manifest = manifest.replace(/android:theme="@style\/[^"]+"/g, 'android:theme="@style/Theme.jadhuman"');
if (!/android:theme=/.test(manifest)) {
  manifest = manifest.replace(/<application\b/, '<application android:theme="@style/Theme.jadhuman"');
}
// Tambahkan permissions (idempotent — skip jika sudah ada)
const perms = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.WAKE_LOCK',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];
for (const p of perms) {
  if (!manifest.includes(p)) {
    manifest = manifest.replace(/<application\b/, `<uses-permission android:name="${p}" />\n    <application`);
  }
}
// WRITE_EXTERNAL_STORAGE hanya untuk API < 29 (scoped storage di Q+ pakai MediaStore)
if (!manifest.includes('WRITE_EXTERNAL_STORAGE')) {
  manifest = manifest.replace(/<application\b/,
    '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />\n    <application');
}
// Tambahkan service + receiver (idempotent)
if (!manifest.includes('JadhumanForegroundService')) {
  manifest = manifest.replace('</application>', `
        <service
            android:name="id.go.jatim.jadhuman.JadhumanForegroundService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Maintains user-enabled scheduled attendance automation while the app is in the background" />
        </service>

        <receiver
            android:name="id.go.jatim.jadhuman.JadhumanBootReceiver"
            android:exported="true"
            android:directBootAware="true">
            <intent-filter android:priority="999">
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="android.intent.action.ACTION_LOCKED_BOOT_COMPLETED" />
            </intent-filter>
        </receiver>
    </application>`);
}
writeFileSync(manifestPath, manifest);
console.log('✅ AndroidManifest.xml diperbarui (theme, 8 permissions, service specialUse, receiver directBootAware)');

// ─── 4. Resources: colors & themes ────────────────────────────────────────────
// Light & dark DIPISAH hanya untuk splash/status bar. Popup bawaan Android
// (selection toolbar, context menu) mengikuti tema device masing-masing —
// tanpa override warna supaya tampil normal seperti bawaan device.

put(join(root, 'res/values/colors.xml'), `<resources>
  <color name="splash_background">#F8FAFC</color>
  <color name="splash_icon_background">#F8FAFC</color>
</resources>\n`);

put(join(root, 'res/values-night/colors.xml'), `<resources>
  <color name="splash_background">#0B1120</color>
  <color name="splash_icon_background">#0B1120</color>
</resources>\n`);

// Popup bawaan Android (text selection, context menu, dll) harus memakai
// tema asli Material3 device masing-masing — tanpa override colorSurface /
// textColorHighlight supaya tidak gelap-gelap-an / tidak kebaca.
// Light theme — hanya splash & status bar, sisanya default Material3.
const themeXmlDay = `<resources xmlns:tools="http://schemas.android.com/tools">
  <style name="Theme.jadhuman" parent="Theme.Material3.Light.NoActionBar">
    <item name="android:windowLightStatusBar">true</item>
    <item name="android:statusBarColor">@android:color/transparent</item>
    <item name="android:windowLightNavigationBar">true</item>
    <item name="android:navigationBarColor">@android:color/transparent</item>
    <item name="android:enforceStatusBarContrast" tools:targetApi="29">false</item>
    <item name="android:enforceNavigationBarContrast" tools:targetApi="29">false</item>
    <item name="android:windowBackground">@drawable/splash_screen</item>
    <item name="android:windowNoTitle">true</item>
    <item name="android:windowSplashScreenBackground">@color/splash_background</item>
    <item name="android:windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
    <item name="android:windowSplashScreenIconBackgroundColor">@color/splash_icon_background</item>
  </style>
</resources>\n`;

// Dark theme — sama, hanya splash & status bar, sisanya default Material3.
const themeXmlNight = `<resources xmlns:tools="http://schemas.android.com/tools">
  <style name="Theme.jadhuman" parent="Theme.Material3.Dark.NoActionBar">
    <item name="android:windowLightStatusBar">false</item>
    <item name="android:statusBarColor">@android:color/transparent</item>
    <item name="android:windowLightNavigationBar">false</item>
    <item name="android:navigationBarColor">@android:color/transparent</item>
    <item name="android:enforceStatusBarContrast" tools:targetApi="29">false</item>
    <item name="android:enforceNavigationBarContrast" tools:targetApi="29">false</item>
    <item name="android:windowBackground">@drawable/splash_screen</item>
    <item name="android:windowNoTitle">true</item>
    <item name="android:windowSplashScreenBackground">@color/splash_background</item>
    <item name="android:windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
    <item name="android:windowSplashScreenIconBackgroundColor">@color/splash_icon_background</item>
  </style>
</resources>\n`;

put(join(root, 'res/values/themes.xml'), themeXmlDay);
put(join(root, 'res/values-night/themes.xml'), themeXmlNight);
console.log('✅ Resources (colors.xml day+night, themes.xml day+night) ditulis');

// ─── 5. build.gradle.kts ──────────────────────────────────────────────────────
const gradle = join(process.cwd(), 'src-tauri/gen/android/app/build.gradle.kts');
writeFileSync(gradle, [
  'import java.util.Properties',
  'import org.jetbrains.kotlin.gradle.dsl.JvmTarget',
  '',
  'plugins {',
  '    id("com.android.application")',
  '    id("org.jetbrains.kotlin.android")',
  '    id("rust")',
  '}',
  '',
  'val tauriProperties = Properties().apply {',
  '    val propFile = file("tauri.properties")',
  '    if (propFile.exists()) {',
  '        propFile.inputStream().use { load(it) }',
  '    }',
  '}',
  '',
  'android {',
  '    compileSdk = 37',
  '    namespace = "id.go.jatim.jadhuman"',
  '    defaultConfig {',
  '        manifestPlaceholders["usesCleartextTraffic"] = "true"',
  '        applicationId = "id.go.jatim.jadhuman"',
  '        minSdk = 24',
  '        targetSdk = 37',
  '        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()',
  '        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")',
  '    }',
  '    signingConfigs {',
  '        create("release") {',
  '            storeFile = File(System.getenv("ANDROID_KEYSTORE_PATH") ?: "/tmp/jadhuman-release.jks")',
  '            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""',
  '            keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: ""',
  '            keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: ""',
  '        }',
  '    }',
  '    buildTypes {',
  '        getByName("debug") {',
  '            manifestPlaceholders["usesCleartextTraffic"] = "true"',
  '            isDebuggable = true',
  '            isJniDebuggable = true',
  '            isMinifyEnabled = false',
  '            packaging {',
  '                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")',
  '                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")',
  '                jniLibs.keepDebugSymbols.add("*/x86/*.so")',
  '                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")',
  '            }',
  '        }',
  '        getByName("release") {',
  '            isMinifyEnabled = true',
  '            signingConfig = signingConfigs.getByName("release")',
  '            optimization {',
  '               enable = true',
  '            }',
  '            proguardFiles(',
  '                *fileTree(".") {',
  '                  include("**/*.pro")',
  '                  exclude("build/**")',
  '                }.files.toTypedArray()',
  '            )',
  '        }',
  '    }',
  '    compileOptions {',
  '        sourceCompatibility = JavaVersion.VERSION_1_8',
  '        targetCompatibility = JavaVersion.VERSION_1_8',
  '    }',
  '    buildFeatures {',
  '        buildConfig = true',
  '    }',
  '}',
  '',
  'kotlin {',
  '    compilerOptions {',
  '        jvmTarget = JvmTarget.JVM_1_8',
  '    }',
  '}',
  '',
  'rust {',
  '    rootDirRel = "../../../"',
  '}',
  '',
  'dependencies {',
  '    implementation("androidx.core:core-ktx:1.12.0")',
  '    implementation("androidx.webkit:webkit:1.14.0")',
  '    implementation("androidx.appcompat:appcompat:1.7.1")',
  '    implementation("androidx.activity:activity-ktx:1.10.1")',
  '    implementation("com.google.android.material:material:1.12.0")',
  '    implementation("androidx.lifecycle:lifecycle-process:2.10.0")',
  '    implementation("androidx.work:work-runtime-ktx:2.9.0")',
  '    testImplementation("junit:junit:4.13.2")',
  '    androidTestImplementation("androidx.test.ext:junit:1.1.4")',
  '    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")',
  '}',
  '',
  'apply(from = file("tauri.build.gradle.kts"))',
].join('\n'));
console.log('✅ build.gradle.kts ditulis');

// ─── 6. ProGuard rules — selalu overwrite agar perubahan rules selalu diterapkan
const proguardPath = join(process.cwd(), 'src-tauri/gen/android/app/proguard-rules.pro');
writeFileSync(proguardPath, `# ── WorkManager & Room ─────────────────────────────────────────────────────────
# Wajib ada agar R8 tidak strip class WorkManager/Room saat isMinifyEnabled=true.
-keep class androidx.work.** { *; }
-keep class androidx.work.impl.** { *; }
-keep class androidx.room.** { *; }
-keep class androidx.room.RoomDatabase { *; }
-keepclassmembers class * extends androidx.room.RoomDatabase { *; }
-keep class * extends androidx.work.Worker { *; }
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-keepnames class androidx.work.impl.WorkDatabase
-keepnames class androidx.work.impl.WorkDatabase_Impl

# ── Jadhuman native classes (bridge, service, worker, receiver) ────────────────
# Tanpa rule ini R8 bisa me-rename atau menghapus class yang dipanggil oleh
# BroadcastReceiver, WorkManager, dan JavascriptInterface dari WebView.
-keep class id.go.jatim.jadhuman.** { *; }
-keepclassmembers class id.go.jatim.jadhuman.** { *; }

# ── JavascriptInterface ────────────────────────────────────────────────────────
# Method @JavascriptInterface harus tetap ada agar JS bisa memanggilnya.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── Kotlin ─────────────────────────────────────────────────────────────────────
-keep class kotlin.Metadata { *; }
-keepclassmembers class **$\$serializer { *; }
`);
console.log('✅ proguard-rules.pro ditulis (always-overwrite)');

// ─── 7. AutomationWebView.kt ──────────────────────────────────────────────────
put(join(root, 'java/id/go/jatim/jadhuman/AutomationWebView.kt'), `package id.go.jatim.jadhuman

import android.webkit.WebView
import java.lang.ref.WeakReference

/**
 * Singleton holder untuk WebView aktif.
 *
 * JadhumanForegroundService memanggil requestCheck() setiap 30 detik
 * untuk men-dispatch event 'jadhuman-background-tick' ke JavaScript.
 * Ini menjaga scheduler JS (useAutomasiScheduler) tetap berjalan
 * meski app ada di background / layar mati.
 */
internal object AutomationWebView {
    @Volatile var instance: WeakReference<WebView>? = null

    fun requestCheck() {
        instance?.get()?.post {
            try {
                instance?.get()?.evaluateJavascript(
                    "window.dispatchEvent(new Event('jadhuman-background-tick'))",
                    null
                )
            } catch (_: Exception) {}
        }
    }
}
`);
console.log('✅ AutomationWebView.kt ditulis');

// ─── 8. MainActivity.kt ───────────────────────────────────────────────────────
put(join(root, 'java/id/go/jatim/jadhuman/MainActivity.kt'), `package id.go.jatim.jadhuman

import android.Manifest
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.lang.ref.WeakReference
import id.go.jatim.jadhuman.TauriActivity

class MainActivity : TauriActivity() {

  // ── Bridge tema + overlay dark mode ──────────────────────────────────────────
  inner class JadhumanBridge {
    @JavascriptInterface
    fun setTheme(dark: Boolean) {
      mainHandler.post {
        appThemeIsDark = dark
        // JANGAN paksa AppCompatDelegate night mode — popup bawaan Android
        // (text selection, context menu dsb.) harus ikut tema bawaan device
        // masing-masing, bukan tema yang dipaksa lewat proses ini.
        applySystemBarTheme()
      }
    }

    @JavascriptInterface
    fun setDarkOverlay(active: Boolean) {
      mainHandler.post {
        overlayDarkMode = active
        applySystemBarTheme()
      }
    }
  }

  // ── Bridge automasi presensi terjadwal ────────────────────────────────────────
  inner class JadhumanAutomasiBridge {

    @JavascriptInterface
    fun startForegroundService(title: String, content: String) {
      mainHandler.post {
        try {
          val intent = Intent(this@MainActivity, JadhumanForegroundService::class.java).apply {
            action = JadhumanForegroundService.ACTION_START
            putExtra(JadhumanForegroundService.EXTRA_TITLE, title)
            putExtra(JadhumanForegroundService.EXTRA_CONTENT, content)
          }
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent)
          else startService(intent)
          getSharedPreferences("jadhuman_automasi", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("penjadwal_aktif", true).apply()
          JadhumanKeepaliveWorker.enqueue(this@MainActivity)
        } catch (e: Exception) {
          Log.e("JadhumanAutomasi", "startForegroundService error: \${e.message}")
        }
      }
    }

    @JavascriptInterface
    fun stopForegroundService() {
      mainHandler.post {
        try {
          stopService(Intent(this@MainActivity, JadhumanForegroundService::class.java).apply {
            action = JadhumanForegroundService.ACTION_STOP
          })
          getSharedPreferences("jadhuman_automasi", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("penjadwal_aktif", false).apply()
          JadhumanKeepaliveWorker.cancel(this@MainActivity)
        } catch (e: Exception) {
          Log.e("JadhumanAutomasi", "stopForegroundService error: \${e.message}")
        }
      }
    }

    @JavascriptInterface
    fun requestNotificationPermission() {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
          checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
      }
    }

    @JavascriptInterface
    fun showNotification(title: String, message: String): Boolean {
      mainHandler.post {
        try {
          JadhumanNotificationHelper.showNotification(this@MainActivity, title, message)
        } catch (e: Exception) {
          Log.e("JadhumanAutomasi", "showNotification error: \${e.message}")
        }
      }
      return true
    }

    @JavascriptInterface
    fun requestBatteryOptimizationExemption() {
      mainHandler.post {
        try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(POWER_SERVICE) as? PowerManager
            if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
              startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = android.net.Uri.parse("package:\${packageName}")
              })
            }
          }
        } catch (e: Exception) {
          Log.e("JadhumanAutomasi", "requestBatteryOptimizationExemption error: \${e.message}")
        }
      }
    }

    @JavascriptInterface
    fun isIgnoringBatteryOptimizations(): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
      val pm = getSystemService(POWER_SERVICE) as? PowerManager
      return pm?.isIgnoringBatteryOptimizations(packageName) == true
    }

    /**
     * Simpan session ke SharedPreferences.
     * Dibaca JadhumanKeepaliveWorker saat app di-kill.
     * JSON: { idPegawai, deviceId, latitude, longitude, idLokasi,
     *          kodeInstansi, kodeUnor, workMode, versi, baseUrl }
     */
    @JavascriptInterface
    fun syncSession(json: String) {
      try {
        getSharedPreferences("jadhuman_session", android.content.Context.MODE_PRIVATE)
          .edit().putString("session_json", json).apply()
      } catch (_: Exception) {}
    }

    /**
     * Simpan daftar preset aktif + jadwal ke SharedPreferences.
     * Dibaca JadhumanKeepaliveWorker untuk cek jadwal & eksekusi absen.
     * JSON: PresetSyncData[] — lihat src/lib/androidNativeBridge.ts
     */
    @JavascriptInterface
    fun syncPresets(json: String, photosJson: String) {
      try {
        getSharedPreferences("jadhuman_presets", android.content.Context.MODE_PRIVATE)
          .edit()
          .putString("presets_json", json)
          .putString("photos_json", photosJson)
          .apply()
      } catch (_: Exception) {}
    }

    /** Baca log eksekusi yang ditulis oleh JadhumanKeepaliveWorker. */
    @JavascriptInterface
    fun readWorkerLog(): String = try {
      getSharedPreferences("jadhuman_worker_log", android.content.Context.MODE_PRIVATE)
        .getString("log_json", "[]") ?: "[]"
    } catch (_: Exception) { "[]" }

    /** Hapus log setelah dibaca UI. */
    @JavascriptInterface
    fun clearWorkerLog() {
      try {
        getSharedPreferences("jadhuman_worker_log", android.content.Context.MODE_PRIVATE)
          .edit().putString("log_json", "[]").apply()
      } catch (_: Exception) {}
    }

    /**
     * Simpan gambar (base64) ke galeri device via MediaStore.
     * Dipanggil ImageLightbox.tsx saat tombol Unduh ditekan.
     * Android 10+ (API 29) tidak butuh WRITE_EXTERNAL_STORAGE (scoped storage).
     *
     * Raw bytes ditulis langsung — TIDAK decode→re-encode via Bitmap —
     * sehingga EXIF metadata (GPS, orientasi, kamera, timestamp) 100% utuh,
     * identik byte-per-byte dengan file asli.
     */
    @JavascriptInterface
    fun saveImageToGallery(base64: String, filename: String): Boolean {
      try {
        // Permission check untuk API < 29 (Q+ scoped storage tidak butuh izin)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
          if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
              != PackageManager.PERMISSION_GRANTED) {
            mainHandler.post {
              requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), 1001)
            }
            return false
          }
        }

        // Strip prefix "data:image/...;base64," jika masih ada
        val cleanBase64 = if (base64.contains(",")) {
          base64.substring(base64.indexOf(",") + 1)
        } else base64

        val imageBytes = Base64.decode(cleanBase64, Base64.DEFAULT)
        if (imageBytes.isEmpty()) return false

        // Deteksi MIME dari magic bytes (sniffing) — lebih akurat dari MIME header
        val mimeType = when {
          imageBytes.size >= 3 &&
            imageBytes[0] == 0xFF.toByte() && imageBytes[1] == 0xD8.toByte() && imageBytes[2] == 0xFF.toByte() -> "image/jpeg"
          imageBytes.size >= 4 &&
            imageBytes[0] == 0x89.toByte() && imageBytes[1] == 0x50.toByte() &&
            imageBytes[2] == 0x4E.toByte() && imageBytes[3] == 0x47.toByte() -> "image/png"
          imageBytes.size >= 12 &&
            imageBytes[0] == 0x52.toByte() && imageBytes[1] == 0x49.toByte() &&
            imageBytes[2] == 0x46.toByte() && imageBytes[3] == 0x46.toByte() &&
            imageBytes[8] == 0x57.toByte() && imageBytes[9] == 0x45.toByte() &&
            imageBytes[10] == 0x42.toByte() && imageBytes[11] == 0x50.toByte() -> "image/webp"
          imageBytes.size >= 3 &&
            imageBytes[0] == 0x47.toByte() && imageBytes[1] == 0x49.toByte() &&
            imageBytes[2] == 0x46.toByte() -> "image/gif"
          else -> "image/jpeg"
        }

        // Ekstensi file sesuai MIME sebenarnya
        val ext = when (mimeType) {
          "image/png"  -> ".png"
          "image/webp" -> ".webp"
          "image/gif"  -> ".gif"
          else         -> ".jpg"
        }
        val displayName = if (filename.endsWith(".jpg", true) || filename.endsWith(".jpeg", true) ||
            filename.endsWith(".png", true) || filename.endsWith(".webp", true) ||
            filename.endsWith(".gif", true)) {
          filename
        } else {
          "\${filename}\${ext}"
        }

        val contentValues = ContentValues().apply {
          put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
          put(MediaStore.Images.Media.MIME_TYPE, mimeType)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Jadhuman")
            put(MediaStore.Images.Media.IS_PENDING, 1)
          }
        }

        val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
          ?: return false

        // Tulis RAW bytes langsung ke MediaStore — tidak ada decode→re-encode.
        // EXIF metadata (GPS, orientasi, kamera, timestamp) preserved 100%.
        var success = false
        contentResolver.openOutputStream(uri)?.use { out ->
          out.write(imageBytes)
          out.flush()
          success = true
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val updateValues = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
          contentResolver.update(uri, updateValues, null, null)
        }

        return success
      } catch (e: Exception) {
        Log.e("JadhumanAutomasi", "saveImageToGallery error: \${e.message}")
        return false
      }
    }
  }

  private val mainHandler       = Handler(Looper.getMainLooper())
  private var appThemeIsDark    = false
  private var overlayDarkMode   = false
  private var bridgeInjected    = false
  private var checkAttempts     = 0
  private val maxCheckAttempts  = 30 // 30 × 200ms = 6 detik
  private var cachedInsets: WindowInsetsCompat? = null
  private var insetSyncAttempts = 0
  private var pendingInsetsSync: Runnable? = null

  private val notifPermLauncher = registerForActivityResult(
    ActivityResultContracts.RequestPermission()
  ) { granted -> Log.d("Jadhuman", "POST_NOTIFICATIONS granted: \$granted") }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // True edge-to-edge: konten mengalir dari ujung ke ujung tanpa padding/scrim
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    window.decorView.setPadding(0, 0, 0, 0)

    // Matikan enforcement kontras bawaan Android (scrim abu/putih di system bar)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced    = false
      window.isNavigationBarContrastEnforced = false
    }

    // Terapkan tema awal dari preferensi sistem
    val systemIsDark = (resources.configuration.uiMode and
        Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    appThemeIsDark = systemIsDark
    applySystemBarTheme()

    // Tangkap insets → kirim ke CSS variables WebView
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
      cachedInsets = insets
      window.decorView.setPadding(0, 0, 0, 0)
      findWebView(window.decorView)?.let { sendInsetsToWeb(insets, it) }
      insets
    }
    ViewCompat.requestApplyInsets(window.decorView)

    // Injeksikan bridge segera saat WebView muncul di hierarchy
    window.decorView.viewTreeObserver.addOnGlobalLayoutListener(
      object : ViewTreeObserver.OnGlobalLayoutListener {
        override fun onGlobalLayout() {
          if (!bridgeInjected) findWebView(window.decorView)?.let { injectBridge(it) }
        }
      })
    startBridgeInjectionLoop()

    // Request POST_NOTIFICATIONS saat startup di Android 13+ (API 33)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
          != PackageManager.PERMISSION_GRANTED) {
        notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
      }
    }
  }

  override fun onResume() {
    super.onResume()
    val wv = findWebView(window.decorView)
    if (wv != null) {
      if (!bridgeInjected) injectBridge(wv)
      else {
        syncThemeFromWeb(wv)
        val insets = cachedInsets ?: ViewCompat.getRootWindowInsets(window.decorView)
        if (insets != null) sendInsetsToWeb(insets, wv)
      }
    } else startBridgeInjectionLoop()
  }

  private fun startBridgeInjectionLoop() {
    if (bridgeInjected) return
    val wv = findWebView(window.decorView)
    if (wv != null) { injectBridge(wv); return }
    checkAttempts++
    if (checkAttempts < maxCheckAttempts) mainHandler.postDelayed({ startBridgeInjectionLoop() }, 200)
  }

  private fun injectBridge(wv: WebView) {
    if (bridgeInjected) return
    bridgeInjected = true

    // Simpan referensi agar ForegroundService bisa dispatch background-tick
    AutomationWebView.instance = WeakReference(wv)

    wv.addJavascriptInterface(JadhumanBridge(), "AndroidJadhuman")
    wv.addJavascriptInterface(JadhumanAutomasiBridge(), "AndroidJadhumanAutomasi")

    wv.settings.domStorageEnabled = true
    wv.settings.databaseEnabled   = true
    wv.settings.javaScriptCanOpenWindowsAutomatically = true
    android.webkit.CookieManager.getInstance().apply {
      setAcceptCookie(true)
      setAcceptThirdPartyCookies(wv, true)
    }

    val insets = cachedInsets ?: ViewCompat.getRootWindowInsets(window.decorView)
    if (insets != null) sendInsetsToWeb(insets, wv)
    syncThemeFromWeb(wv)
  }

  private fun sendInsetsToWeb(insets: WindowInsetsCompat, targetWv: WebView? = null) {
    val wv = targetWv ?: findWebView(window.decorView) ?: return
    val sb      = insets.getInsets(WindowInsetsCompat.Type.statusBars())
    val nb      = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
    val density = resources.displayMetrics.density
    val topDp    = (sb.top    / density).toInt()
    val bottomDp = (nb.bottom / density).toInt()
    val leftDp   = (sb.left   / density).toInt()
    val rightDp  = (sb.right  / density).toInt()

    val script = """
      (function() {
        try {
          if (document.readyState !== 'complete' || !document.body || !document.getElementById('root')) return false;
          var top   = '\${topDp}px';   var bot   = '\${bottomDp}px';
          var left  = '\${leftDp}px';  var right = '\${rightDp}px';
          document.documentElement.style.setProperty('--sat',  top);
          document.documentElement.style.setProperty('--sab',  bot);
          document.documentElement.style.setProperty('--safe-area-inset-top',    top);
          document.documentElement.style.setProperty('--safe-area-inset-bottom', bot);
          document.documentElement.style.setProperty('--safe-area-inset-left',   left);
          document.documentElement.style.setProperty('--safe-area-inset-right',  right);
          document.documentElement.style.setProperty('--poni-atas',  top);
          document.documentElement.style.setProperty('--poni-bawah', bot);
          document.documentElement.style.setProperty('--poni-kiri',  left);
          document.documentElement.style.setProperty('--poni-kanan', right);
          document.body.classList.add('is-native');
          document.documentElement.classList.add('is-native');
          window.__JADHUMAN_SAFE_AREA_READY__ = true;
          window.dispatchEvent(new Event('jadhuman-safe-area-ready'));
          return true;
        } catch(e) { return false; }
      })();
    """.trimIndent()

    wv.evaluateJavascript(script) { result ->
      if (result == "true") {
        insetSyncAttempts = 0
        pendingInsetsSync?.let { mainHandler.removeCallbacks(it) }
        pendingInsetsSync = null
      } else if (insetSyncAttempts < 100) {
        insetSyncAttempts++
        pendingInsetsSync?.let { mainHandler.removeCallbacks(it) }
        val retry = Runnable { sendInsetsToWeb(insets, wv) }
        pendingInsetsSync = retry
        mainHandler.postDelayed(retry, 100)
      } else {
        Log.e("Jadhuman", "safe-area sync gagal setelah 100 percobaan")
      }
    }
  }

  private fun syncThemeFromWeb(wv: WebView?) {
    if (wv == null) return
    wv.evaluateJavascript("""
      (function(){try{
        var d = document.documentElement.classList.contains('dark') ||
                (document.body && document.body.dataset && document.body.dataset.theme === 'dark') ||
                localStorage.getItem('theme') === 'dark';
        return d ? 'dark' : 'light';
      }catch(e){return '';}}())
    """.trimIndent()) { result ->
      if      (result?.contains("dark")  == true) { appThemeIsDark = true;  applySystemBarTheme() }
      else if (result?.contains("light") == true) { appThemeIsDark = false; applySystemBarTheme() }
    }
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) for (i in 0 until view.childCount) {
      findWebView(view.getChildAt(i))?.let { return it }
    }
    return null
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val wv = findWebView(window.decorView)
    if (wv != null) {
      syncThemeFromWeb(wv)
      val insets = cachedInsets ?: ViewCompat.getRootWindowInsets(window.decorView)
      if (insets != null) sendInsetsToWeb(insets, wv)
    } else {
      appThemeIsDark = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
      applySystemBarTheme()
    }
  }

  /**
   * Status bar & nav bar selalu transparan (edge-to-edge).
   * Light mode → ikon status bar & tombol nav HITAM.
   * Dark mode  → ikon status bar & tombol nav PUTIH.
   * Warna fallback di balik bar mengikuti tema agar tidak ada flash warna salah.
   */
  private fun applySystemBarTheme() {
    runOnUiThread {
      val isDark = appThemeIsDark || overlayDarkMode
      val workspaceColor = if (isDark) Color.parseColor("#0B1120") else Color.parseColor("#F8FAFC")

      window.statusBarColor     = Color.TRANSPARENT
      window.navigationBarColor = Color.TRANSPARENT
      window.decorView.setPadding(0, 0, 0, 0)

      window.setBackgroundDrawable(ColorDrawable(workspaceColor))
      window.decorView.setBackgroundColor(workspaceColor)
      findWebView(window.decorView)?.setBackgroundColor(workspaceColor)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        window.isStatusBarContrastEnforced    = false
        window.isNavigationBarContrastEnforced = false
      }

      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.systemBarsBehavior              = WindowInsetsControllerCompat.BEHAVIOR_DEFAULT
      controller.isAppearanceLightStatusBars     = !isDark
      controller.isAppearanceLightNavigationBars = !isDark
    }
  }
}
`);
console.log('✅ MainActivity.kt ditulis');

// ─── 9. JadhumanForegroundService.kt ──────────────────────────────────────────
put(join(root, 'java/id/go/jatim/jadhuman/JadhumanForegroundService.kt'), `package id.go.jatim.jadhuman

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

class JadhumanForegroundService : Service() {

    companion object {
        const val CHANNEL_ID      = "jadhuman_automasi_channel"
        const val NOTIFICATION_ID = 7821
        const val ACTION_START    = "id.go.jatim.jadhuman.AUTOMASI_START"
        const val ACTION_STOP     = "id.go.jatim.jadhuman.AUTOMASI_STOP"
        const val EXTRA_TITLE     = "extra_title"
        const val EXTRA_CONTENT   = "extra_content"
        private const val WAKE_LOCK_TAG = "Jadhuman:AutomasiWakeLock"
        private const val TAG = "JadhumanFGService"
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var notificationTitle   = "JADHUMAN Automasi"
    private var notificationContent = "Penjadwal presensi aktif di latar belakang"
    private val handler = Handler(Looper.getMainLooper())

    // Setiap 30 detik: dispatch 'jadhuman-background-tick' ke WebView
    // agar useAutomasiScheduler (JS) tetap berjalan meski layar mati / app di background.
    private val automationTick = object : Runnable {
        override fun run() {
            AutomationWebView.requestCheck()
            refreshOngoingNotification()
            handler.postDelayed(this, 30_000L)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        acquireWakeLock()
        handler.postDelayed(automationTick, 30_000L)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Log.d(TAG, "ACTION_STOP received")
            handler.removeCallbacks(automationTick)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
            else @Suppress("DEPRECATION") stopForeground(true)
            stopSelf()
            return START_NOT_STICKY
        }
        notificationTitle   = intent?.getStringExtra(EXTRA_TITLE)   ?: notificationTitle
        notificationContent = intent?.getStringExtra(EXTRA_CONTENT) ?: notificationContent
        startForeground(NOTIFICATION_ID, buildNotification())
        Log.d(TAG, "Foreground service started")
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(automationTick)
        releaseWakeLock()
        Log.d(TAG, "Destroyed")
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "Layanan Presensi Latar Belakang",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Menjaga penjadwal presensi otomatis tetap berjalan di latar belakang"
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            }
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    private fun buildNotification(): android.app.Notification {
        val pi = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(
                this, 0, it,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
            )
        }
        val notif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(notificationTitle)
            .setContentText(notificationContent)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(pi)
            .build()
        notif.flags = notif.flags or android.app.Notification.FLAG_NO_CLEAR
        return notif
    }

    private fun refreshOngoingNotification() {
        try {
            (getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager)
                ?.notify(NOTIFICATION_ID, buildNotification())
        } catch (_: SecurityException) {}
    }

    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
            wakeLock?.acquire(24L * 60 * 60 * 1000) // 24 jam — diperbaharui setiap restart service
        } catch (e: Exception) { Log.e(TAG, "acquireWakeLock: \${e.message}") }
    }

    private fun releaseWakeLock() {
        try { if (wakeLock?.isHeld == true) wakeLock?.release() }
        catch (e: Exception) { Log.e(TAG, "releaseWakeLock: \${e.message}") }
    }
}
`);
console.log('✅ JadhumanForegroundService.kt ditulis');

// ─── 10. JadhumanNotificationHelper.kt ────────────────────────────────────────
put(join(root, 'java/id/go/jatim/jadhuman/JadhumanNotificationHelper.kt'), `package id.go.jatim.jadhuman

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Helper untuk notifikasi hasil presensi otomatis (IMPORTANCE_HIGH — heads-up).
 * Berbeda dengan notifikasi ForegroundService (IMPORTANCE_LOW — silent persistent).
 */
object JadhumanNotificationHelper {

    private const val CHANNEL_ID   = "jadhuman_attendance_alerts"
    private const val CHANNEL_NAME = "Notifikasi Presensi JADHUMAN"

    fun showNotification(context: Context, title: String, message: String) {
        createChannel(context)

        val pi = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
            PendingIntent.getActivity(
                context,
                (System.currentTimeMillis() % 10_000L).toInt(),
                it,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
            )
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()

        val notifId = (System.currentTimeMillis() % 100_000L).toInt()
        try {
            NotificationManagerCompat.from(context).notify(notifId, notification)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS belum diberikan — tidak crash, cukup log
            android.util.Log.w("JadhumanNotif", "POST_NOTIFICATIONS not granted: \${e.message}")
        }
    }

    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Status eksekusi presensi otomatis terjadwal"
                enableVibration(true)
                enableLights(true)
            }
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(ch)
        }
    }
}
`);
console.log('✅ JadhumanNotificationHelper.kt ditulis');

// ─── 11. JadhumanBootReceiver.kt ──────────────────────────────────────────────
put(join(root, 'java/id/go/jatim/jadhuman/JadhumanBootReceiver.kt'), `package id.go.jatim.jadhuman

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Restart ForegroundService + KeepaliveWorker setelah:
 * - Reboot (BOOT_COMPLETED)
 * - Update APK (MY_PACKAGE_REPLACED)
 * - Direct boot (ACTION_LOCKED_BOOT_COMPLETED)
 *
 * Hanya aktif jika pengguna sebelumnya mengaktifkan penjadwal (penjadwal_aktif=true).
 */
class JadhumanBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val act = intent.action ?: return
        if (act != Intent.ACTION_BOOT_COMPLETED
            && act != Intent.ACTION_MY_PACKAGE_REPLACED
            && act != "android.intent.action.ACTION_LOCKED_BOOT_COMPLETED") return

        val prefs = context.getSharedPreferences("jadhuman_automasi", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("penjadwal_aktif", false)) {
            Log.d("JadhumanBoot", "penjadwal_aktif=false, tidak ada aksi")
            return
        }

        // Restart ForegroundService
        try {
            val svcIntent = Intent(context, JadhumanForegroundService::class.java).apply {
                action = JadhumanForegroundService.ACTION_START
                putExtra(JadhumanForegroundService.EXTRA_TITLE, "JADHUMAN Presensi Otomatis")
                putExtra(JadhumanForegroundService.EXTRA_CONTENT, "Penjadwal presensi aktif memantau jadwal harian")
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(svcIntent)
            else context.startService(svcIntent)
            Log.d("JadhumanBoot", "ForegroundService dimulai setelah: \$act")
        } catch (e: Exception) {
            Log.e("JadhumanBoot", "ForegroundService gagal: \${e.message}")
        }

        // Enqueue KeepaliveWorker
        try {
            val req = PeriodicWorkRequestBuilder<JadhumanKeepaliveWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                JadhumanKeepaliveWorker.WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                req
            )
            Log.d("JadhumanBoot", "KeepaliveWorker dienqueue setelah: \$act")
        } catch (e: Exception) {
            Log.e("JadhumanBoot", "WorkManager gagal: \${e.message}")
        }
    }
}
`);
console.log('✅ JadhumanBootReceiver.kt ditulis');

// ─── 12. JadhumanKeepaliveWorker.kt ───────────────────────────────────────────
put(join(root, 'java/id/go/jatim/jadhuman/JadhumanKeepaliveWorker.kt'), `package id.go.jatim.jadhuman

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * JadhumanKeepaliveWorker — Worker periodik 15 menit via WorkManager.
 *
 * Berjalan BAHKAN saat app di-swipe dari Recent Apps (WebView sudah di-kill).
 * Membaca session, preset, dan foto stock dari SharedPreferences (ditulis oleh JS bridge di
 * MainActivity.kt via syncSession()/syncPresets()), lalu eksekusi presensi
 * langsung via HTTP tanpa WebView.
 *
 * SharedPreferences yang dipakai:
 *   "jadhuman_automasi"    → penjadwal_aktif (Boolean)
 *   "jadhuman_session"     → session_json (JSON: credentials server presensi)
 *   "jadhuman_presets"     → presets_json + photos_json (jadwal dan map ID foto ke Base64 JPEG)
 *   "jadhuman_worker_log"  → log_json (hasil eksekusi, dibaca kembali oleh JS)
 */
class JadhumanKeepaliveWorker(
    private val ctx: Context,
    params: WorkerParameters,
) : Worker(ctx, params) {

    companion object {
        const val WORK_NAME = "jadhuman_keepalive"

        fun enqueue(context: Context) {
            try {
                val req = PeriodicWorkRequestBuilder<JadhumanKeepaliveWorker>(
                    15, TimeUnit.MINUTES
                ).build()
                WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                    WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, req
                )
                Log.d("JadhumanWorker", "Keepalive dienqueue")
            } catch (e: Exception) {
                Log.e("JadhumanWorker", "enqueue gagal: \${e.message}")
            }
        }

        fun cancel(context: Context) {
            try {
                WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
                Log.d("JadhumanWorker", "Keepalive dibatalkan")
            } catch (e: Exception) {
                Log.e("JadhumanWorker", "cancel gagal: \${e.message}")
            }
        }
    }

    override fun doWork(): Result {
        val automasi = ctx.getSharedPreferences("jadhuman_automasi", Context.MODE_PRIVATE)
        if (!automasi.getBoolean("penjadwal_aktif", false)) return Result.success()

        // Pastikan ForegroundService tetap hidup (bisa dimatikan OS saat memori rendah)
        restartForegroundService()

        // Eksekusi presensi dari Kotlin native
        try {
            eksekusiPreset()
        } catch (e: Exception) {
            Log.e("JadhumanWorker", "eksekusi error: \${e.message}")
        }

        return Result.success()
    }

    private fun restartForegroundService() {
        try {
            val intent = Intent(ctx, JadhumanForegroundService::class.java).apply {
                action = JadhumanForegroundService.ACTION_START
                putExtra(JadhumanForegroundService.EXTRA_TITLE, "JADHUMAN Presensi Otomatis")
                putExtra(JadhumanForegroundService.EXTRA_CONTENT, "Penjadwal presensi aktif memantau jadwal harian")
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
            else ctx.startService(intent)
        } catch (e: Exception) {
            Log.e("JadhumanWorker", "restart FG service gagal: \${e.message}")
        }
    }

    private fun eksekusiPreset() {
        // Baca session
        val sessionJson = ctx.getSharedPreferences("jadhuman_session", Context.MODE_PRIVATE)
            .getString("session_json", null) ?: return
        val session = JSONObject(sessionJson)

        val idPegawai    = session.optString("idPegawai").ifBlank    { return }
        val deviceId     = session.optString("deviceId")
        val latitude     = session.optString("latitude")
        val longitude    = session.optString("longitude")
        val idLokasi     = session.optString("idLokasi")
        val kodeInstansi = session.optString("kodeInstansi")
        val kodeUnor     = session.optString("kodeUnor")
        val workMode     = session.optString("workMode").ifBlank     { "1" }
        val versi        = session.optString("versi").ifBlank        { "2.0.0" }
        val baseUrl      = session.optString("baseUrl").ifBlank      {
            "http://103.109.206.102:8089/Ponorogo-absensApi/index.php/login/absen_mobile"
        }

        // Baca presets
        val presetsJson = ctx.getSharedPreferences("jadhuman_presets", Context.MODE_PRIVATE)
            .getString("presets_json", null) ?: return
        val presets = JSONArray(presetsJson)
        val stockPhotosJson = ctx.getSharedPreferences("jadhuman_presets", Context.MODE_PRIVATE)
          .getString("photos_json", "{}") ?: "{}"
        val stockPhotos = try { JSONObject(stockPhotosJson) } catch (_: Exception) { JSONObject() }

        val wib = TimeZone.getTimeZone("Asia/Jakarta")
        val now = Calendar.getInstance(wib)
        val hariIni     = now.get(Calendar.DAY_OF_WEEK) - 1  // 0=Min … 6=Sab
        val jamSekarang = String.format("%02d:%02d", now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE))
        val tanggal     = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = wib }.format(now.time)
        // Server Ponorogo mengharapkan format dd-MM-yyyy
        val tanggalDisplay = SimpleDateFormat("dd-MM-yyyy", Locale.US).apply { timeZone = wib }.format(now.time)

        for (i in 0 until presets.length()) {
            val preset   = presets.getJSONObject(i)
            if (!preset.optBoolean("aktif", false)) continue

            // Cek hari aktif
            val hariAktif = preset.optJSONArray("hariAktif") ?: continue
            val hariList  = (0 until hariAktif.length()).map { hariAktif.getInt(it) }
            if (hariIni !in hariList) continue

            // Cek rentang waktu (support wrap-around tengah malam)
            if (!dalamRentangWaktu(
                preset.optString("jamMulai"),
                preset.optString("jamSelesai"),
                jamSekarang,
            )) continue

            // Deduplication — jangan kirim ulang jika sudah berhasil hari ini
            val presetId = preset.optString("id")
            if (sudahEksekusiHariIni(presetId, tanggal)) continue

            // Retry selalu memakai foto yang sama; indeks maju hanya setelah request berhasil.
            val fotoIds = preset.optJSONArray("stockFotoIds") ?: JSONArray()
            val indexKey = "foto_index_\$presetId"
            val workerState = ctx.getSharedPreferences("jadhuman_worker_state", Context.MODE_PRIVATE)
            val fotoIndex = if (fotoIds.length() > 0) {
              val savedIndex = workerState.getInt(indexKey, 0)
              ((savedIndex % fotoIds.length()) + fotoIds.length()) % fotoIds.length()
            } else 0
            val fotoId = fotoIds.optString(fotoIndex)
            val lampiran = stockPhotos.optString(fotoId, "")

            // Eksekusi HTTP
            val (berhasil, pesan) = if (lampiran.isBlank()) {
              Pair(false, "Stock foto preset belum tersinkron atau kosong.")
            } else {
              kirimAbsen(
                baseUrl      = baseUrl,
                tanggal      = tanggalDisplay,
                idPegawai    = idPegawai,
                deviceId     = deviceId,
                latitude     = latitude,
                longitude    = longitude,
                idLokasi     = idLokasi,
                kodeInstansi = kodeInstansi,
                kodeUnor     = kodeUnor,
                workMode     = workMode,
                versi        = versi,
                lampiran     = lampiran,
              )
            }
            if (berhasil && fotoIds.length() > 0) {
              workerState.edit().putInt(indexKey, (fotoIndex + 1) % fotoIds.length()).apply()
            }

            // Tulis log (untuk dibaca kembali oleh JS via readWorkerLog())
            tulisLog(
                presetId   = presetId,
                presetNama = preset.optString("nama"),
                tanggal    = tanggal,
                berhasil   = berhasil,
                pesan      = pesan,
            )

            // Notifikasi native (IMPORTANCE_HIGH — tampil sebagai heads-up)
            val notifTitle = if (berhasil) "✅ Presensi Berhasil" else "⚠️ Presensi Gagal"
            JadhumanNotificationHelper.showNotification(
                ctx, notifTitle, "\${preset.optString("nama")} — \$pesan"
            )

            Log.d("JadhumanWorker", "Preset '\${preset.optString("nama")}': berhasil=\$berhasil, pesan=\$pesan")
        }
    }

    /**
     * Kirim presensi via HTTP POST form-urlencoded.
    * Payload identik dengan yang dikirim frontend JS via sendRequest('/login/absen_mobile', ...).
    * Lampiran berupa Base64 JPEG dari stock foto yang disinkronkan sebelum WebView tidur.
     */
    private fun kirimAbsen(
        baseUrl: String,
        tanggal: String,
        idPegawai: String,
        deviceId: String,
        latitude: String,
        longitude: String,
        idLokasi: String,
        kodeInstansi: String,
        kodeUnor: String,
        workMode: String,
        versi: String,
        lampiran: String,
    ): Pair<Boolean, String> {
        return try {
            fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")
            val params = buildString {
                append("tanggal=\${enc(tanggal)}")
                append("&keterangan=\${enc("Presensi Reguler")}")
                append("&lampiran=\${enc(lampiran)}")
                append("&sim_serial=\${enc(deviceId)}")
                append("&lattitude=\${enc(latitude)}")   // sic — typo di API server
                append("&longitude=\${enc(longitude)}")
                append("&imei=\${enc(deviceId)}")
                append("&kode_instansi=\${enc(kodeInstansi)}")
                append("&kode_unor=\${enc(kodeUnor)}")
                append("&id_lokasi=\${enc(idLokasi)}")
                append("&work_mode=\${enc(workMode)}")
                append("&id_pegawai=\${enc(idPegawai)}")
                append("&versi=\${enc(versi)}")
            }

            val conn = URL(baseUrl).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            conn.setRequestProperty("Accept", "application/json, text/plain, */*")
            conn.doOutput    = true
            conn.connectTimeout = 20_000
            conn.readTimeout    = 20_000

            OutputStreamWriter(conn.outputStream).use { it.write(params) }

            val code = conn.responseCode
            val body = try { conn.inputStream.bufferedReader().readText() }
                       catch (_: Exception) { conn.errorStream?.bufferedReader()?.readText() ?: "" }
            conn.disconnect()

            if (code != 200) return Pair(false, "HTTP \$code")

            val resp    = JSONObject(body)
            val success = resp.optBoolean("success", false)
            val msg     = resp.optString("message", "").ifBlank { if (success) "Berhasil" else "Ditolak server" }
            Pair(success, msg)
        } catch (e: Exception) {
            Pair(false, e.message ?: "Koneksi gagal")
        }
    }

    /** Apakah jam sekarang ada di rentang [mulai, selesai]. Support wrap-around tengah malam. */
    private fun dalamRentangWaktu(mulai: String, selesai: String, sekarang: String): Boolean {
        fun toMenit(hhmm: String): Int {
            val p = hhmm.split(":")
            if (p.size < 2) return -1
            return (p[0].toIntOrNull() ?: return -1) * 60 + (p[1].toIntOrNull() ?: return -1)
        }
        val m = toMenit(mulai); val s = toMenit(selesai); val n = toMenit(sekarang)
        if (m < 0 || s < 0 || n < 0) return false
        return if (m <= s) n in m..s else n >= m || n <= s
    }

    /** Apakah preset sudah berhasil dieksekusi hari ini (deduplication). */
    private fun sudahEksekusiHariIni(presetId: String, tanggal: String): Boolean {
        val raw = ctx.getSharedPreferences("jadhuman_worker_log", Context.MODE_PRIVATE)
            .getString("log_json", "[]") ?: "[]"
        return try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val e = arr.getJSONObject(i)
                if (e.optString("presetId") == presetId
                    && e.optString("tanggal") == tanggal
                    && e.optBoolean("berhasil", false)) return true
            }
            false
        } catch (_: Exception) { false }
    }

    private fun tulisLog(
        presetId: String, presetNama: String, tanggal: String,
        berhasil: Boolean, pesan: String,
    ) {
        val prefs = ctx.getSharedPreferences("jadhuman_worker_log", Context.MODE_PRIVATE)
        val raw   = prefs.getString("log_json", "[]") ?: "[]"
        val arr   = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
        // Hapus entri lama untuk preset+tanggal yang sama agar log tidak menumpuk
        val baru = JSONArray()
        for (i in 0 until arr.length()) {
            val e = arr.getJSONObject(i)
            if (e.optString("presetId") == presetId && e.optString("tanggal") == tanggal) continue
            baru.put(e)
        }
        baru.put(JSONObject().apply {
            put("presetId",   presetId)
            put("presetNama", presetNama)
            put("tanggal",    tanggal)
            put("eksekusiPada", System.currentTimeMillis())
            put("berhasil",   berhasil)
            put("pesan",      pesan)
        })
        prefs.edit().putString("log_json", baru.toString()).apply()
    }
}
`);
console.log('✅ JadhumanKeepaliveWorker.kt ditulis');

console.log(`
✅ ═══════════════════════════════════════════════════════════════════════════════
   JADHUMAN Android Native Patch — selesai
   ─────────────────────────────────────────────────────────────────────────────
   AndroidManifest.xml   : 8 permissions, ForegroundService (specialUse +
                           PROPERTY_SPECIAL_USE_FGS_SUBTYPE), BootReceiver
                           (directBootAware, priority=999)
   build.gradle.kts      : compileSdk/targetSdk 37, minSdk 24, WorkManager,
                           isMinifyEnabled=true, optimization.enable=true,
                           proguard glob **/*.pro
   proguard-rules.pro    : WorkManager + Room + @JavascriptInterface + Kotlin
                           + -keep id.go.jatim.jadhuman.** (always-overwrite)
   themes.xml (day+night): transparent bar, no contrast enforcement, splash
   AutomationWebView.kt  : singleton dispatch jadhuman-background-tick
   MainActivity.kt       : JadhumanBridge + JadhumanAutomasiBridge,
                           edge-to-edge insets retry 100x, syncThemeFromWeb,
                           localStorage.getItem('theme'), ActivityResultContracts
                           notif permission, auto-request saat onCreate
   ForegroundService.kt  : START_STICKY, 30s tick, 24h wake lock, FLAG_NO_CLEAR,
                           CATEGORY_SERVICE, setSound(null), no vibration
   NotificationHelper.kt : IMPORTANCE_HIGH, BigTextStyle, CATEGORY_EVENT,
                           VISIBILITY_PUBLIC, enableLights, NotificationManagerCompat,
                           SecurityException catch
   BootReceiver.kt       : BOOT_COMPLETED + MY_PACKAGE_REPLACED +
                           ACTION_LOCKED_BOOT_COMPLETED, ExistingPeriodicWorkPolicy.UPDATE
   KeepaliveWorker.kt    : 15-min period, UPDATE policy, HTTP form-urlencoded,
                           dedup tanggal+presetId, SharedPreferences log,
                           tanggalDisplay dd-MM-yyyy, dalamRentangWaktu wrap-around
   ═══════════════════════════════════════════════════════════════════════════════
`);
