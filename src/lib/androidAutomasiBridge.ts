/**
 * androidAutomasiBridge — re-export dari androidNativeBridge untuk backward compatibility.
 *
 * Semua fungsi telah dipindahkan ke androidNativeBridge.ts yang lebih lengkap
 * (termasuk syncSession, syncPresets, readWorkerLog).
 * File ini dipertahankan agar import yang sudah ada tidak perlu diubah.
 */

export {
  isAndroidJadhuman as isAndroid,
  startAndroidForegroundService,
  stopAndroidForegroundService,
  requestAndroidNotificationPermission,
  kirimNotifikasiNative,
  isIgnoringBatteryOptimizations,
  requestBatteryOptimizationExemption,
  syncSessionToAndroid,
  syncPresetsToAndroid,
  readAndroidWorkerLog,
  clearAndroidWorkerLog,
  saveImageToGalleryAndroid,
} from './androidNativeBridge';
