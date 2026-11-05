/**
 * androidNativeBridge — jembatan ke semua fitur native Android Jadhuman.
 *
 * Modul ini mengekspos tiga interface bridge yang diinjeksikan oleh MainActivity.kt:
 *
 *   window.AndroidJadhuman        → JadhumanBridge       (tema & status bar)
 *   window.AndroidJadhumanAutomasi → JadhumanAutomasiBridge (foreground service, notif, baterai)
 *
 * Fallback chain untuk notifikasi:
 *   1. window.AndroidJadhumanAutomasi.showNotification() — Android native push
 *   2. @tauri-apps/plugin-notification                  — Linux AppImage / desktop Tauri
 *   3. Web Notification API                             — browser / WebView fallback
 *   4. console.info                                     — last resort
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

// ─── Type declarations ─────────────────────────────────────────────────────────

interface AndroidJadhumanInterface {
  setTheme?: (dark: boolean) => void;
  setDarkOverlay?: (active: boolean) => void;
}

interface AndroidJadhumanAutomasiInterface {
  startForegroundService(title: string, content: string): void;
  stopForegroundService(): void;
  requestNotificationPermission(): void;
  showNotification(title: string, message: string): boolean;
  requestBatteryOptimizationExemption(): void;
  isIgnoringBatteryOptimizations(): boolean;
  syncSession(json: string): void;
  syncPresets(json: string, photosJson: string): void;
  readWorkerLog(): string;
  clearWorkerLog(): void;
  saveImageToGallery(base64: string, filename: string): boolean;
}

declare global {
  interface Window {
    AndroidJadhuman?: AndroidJadhumanInterface;
    AndroidJadhumanAutomasi?: AndroidJadhumanAutomasiInterface;
  }
}

// ─── Deteksi lingkungan ───────────────────────────────────────────────────────

/** Apakah sedang berjalan di WebView Android Jadhuman. */
export function isAndroidJadhuman(): boolean {
  return typeof window !== 'undefined' && Boolean(window.AndroidJadhumanAutomasi);
}

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

// ─── Status bar & tema ────────────────────────────────────────────────────────

/** Beritahu native bahwa tema app berubah. */
export function setAndroidTheme(dark: boolean): void {
  try { window.AndroidJadhuman?.setTheme?.(dark); } catch { /* ignore */ }
}

// ─── Foreground Service ────────────────────────────────────────────────────────

/**
 * Nyalakan Android Foreground Service + enqueue KeepaliveWorker.
 * Menampilkan notifikasi persisten di status bar dan mencegah OS membunuh proses.
 */
export function startAndroidForegroundService(
  title = 'JADHUMAN Presensi Otomatis',
  content = 'Penjadwal presensi aktif memantau jadwal harian',
): void {
  try {
    window.AndroidJadhumanAutomasi?.startForegroundService(title, content);
  } catch (e) {
    console.warn('[AndroidBridge] startForegroundService error:', e);
  }
}

/** Hentikan Foreground Service + cancel KeepaliveWorker. */
export function stopAndroidForegroundService(): void {
  try {
    window.AndroidJadhumanAutomasi?.stopForegroundService();
  } catch (e) {
    console.warn('[AndroidBridge] stopForegroundService error:', e);
  }
}

// ─── Notifikasi ────────────────────────────────────────────────────────────────

/** Minta izin POST_NOTIFICATIONS (Android 13+ / API 33). */
export function requestAndroidNotificationPermission(): void {
  try {
    window.AndroidJadhumanAutomasi?.requestNotificationPermission();
  } catch (e) {
    console.warn('[AndroidBridge] requestNotificationPermission error:', e);
  }
}

/**
 * Kirim notifikasi native (Android push / Tauri AppImage / Web API).
 *
 * 1. Coba Android native bridge.
 * 2. Coba Tauri plugin-notification (Linux AppImage).
 * 3. Coba Web Notification API.
 * 4. Fallback console.
 */
export async function kirimNotifikasiNative(title: string, message: string): Promise<void> {
  // 1. Android native
  if (isAndroidJadhuman()) {
    try {
      const ok = window.AndroidJadhumanAutomasi!.showNotification(title, message);
      if (ok) return;
    } catch { /* fallthrough */ }
  }

  // 2. Tauri plugin-notification
  if (isTauriRuntime()) {
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const perm = await requestPermission();
        granted = perm === 'granted';
      }
      if (granted) {
        sendNotification({ title, body: message });
        return;
      }
    } catch { /* fallthrough */ }
  }

  // 3. Web Notification API
  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      if (Notification.permission === 'granted') {
        new Notification(title, { body: message, icon: '/assets/icon-192.png' });
        return;
      }
      if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification(title, { body: message, icon: '/assets/icon-192.png' });
          return;
        }
      }
    } catch { /* fallthrough */ }
  }

  // 4. Fallback console
  console.info(`[Notifikasi] ${title}: ${message}`);
}

// ─── Optimasi baterai ──────────────────────────────────────────────────────────

/** Apakah Android sudah mengecualikan app dari Battery Optimization (Doze mode). */
export function isIgnoringBatteryOptimizations(): boolean {
  try {
    return window.AndroidJadhumanAutomasi?.isIgnoringBatteryOptimizations() ?? true;
  } catch {
    return true;
  }
}

/** Buka dialog sistem untuk minta pengecualian Battery Optimization. */
export function requestBatteryOptimizationExemption(): void {
  try {
    window.AndroidJadhumanAutomasi?.requestBatteryOptimizationExemption();
  } catch (e) {
    console.warn('[AndroidBridge] requestBatteryOptimizationExemption error:', e);
  }
}

// ─── Preset & session sync (untuk KeepaliveWorker) ────────────────────────────

export interface SessionSyncData {
  idPegawai: string;
  deviceId: string;
  latitude: string;
  longitude: string;
  idLokasi: string;
  kodeInstansi: string;
  kodeUnor: string;
  workMode: string;
  versi: string;
  /** URL endpoint absensi untuk fallback Worker. */
  baseUrl: string;
}

export interface PresetSyncData {
  id: string;
  nama: string;
  tipe: 'masuk' | 'pulang';
  jamMulai: string;
  jamSelesai: string;
  hariAktif: number[];
  aktif: boolean;
  stockFotoIds: string[];
}

export interface WorkerLogEntry {
  presetId: string;
  presetNama: string;
  tanggal: string;
  eksekusiPada: number;
  berhasil: boolean;
  pesan: string;
}

/**
 * Sync data sesi ke SharedPreferences Android.
 * Dibaca oleh JadhumanKeepaliveWorker saat app di-kill.
 */
export function syncSessionToAndroid(data: SessionSyncData): void {
  try {
    window.AndroidJadhumanAutomasi?.syncSession(JSON.stringify(data));
  } catch (e) {
    console.warn('[AndroidBridge] syncSession error:', e);
  }
}

/**
 * Sync daftar preset aktif ke SharedPreferences Android.
 * Dibaca oleh JadhumanKeepaliveWorker untuk cek jadwal.
 */
export function syncPresetsToAndroid(presets: PresetSyncData[], photos: Record<string, string>): void {
  try {
    window.AndroidJadhumanAutomasi?.syncPresets(JSON.stringify(presets), JSON.stringify(photos));
  } catch (e) {
    console.warn('[AndroidBridge] syncPresets error:', e);
  }
}

/** Baca log eksekusi yang ditulis oleh JadhumanKeepaliveWorker. */
export function readAndroidWorkerLog(): WorkerLogEntry[] {
  try {
    const raw = window.AndroidJadhumanAutomasi?.readWorkerLog();
    if (!raw) return [];
    return JSON.parse(raw) as WorkerLogEntry[];
  } catch {
    return [];
  }
}

/** Hapus worker log setelah ditampilkan ke UI. */
export function clearAndroidWorkerLog(): void {
  try {
    window.AndroidJadhumanAutomasi?.clearWorkerLog();
  } catch { /* ignore */ }
}

/**
 * Simpan gambar (base64) ke galeri device Android via MediaStore.
 * Mengembalikan true jika berhasil, false jika gagal atau izin belum diberikan.
 * Parameter base64 boleh dengan atau tanpa prefix "data:image/...;base64,".
 */
export function saveImageToGalleryAndroid(base64: string, filename: string): boolean {
  try {
    return window.AndroidJadhumanAutomasi?.saveImageToGallery(base64, filename) ?? false;
  } catch (e) {
    console.warn('[AndroidBridge] saveImageToGallery error:', e);
    return false;
  }
}
