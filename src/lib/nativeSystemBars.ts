/**
 * nativeSystemBars — kontrol overlay dark mode ke native Android.
 *
 * Saat ada overlay (modal, drawer, dll.) yang membutuhkan ikon status bar putih,
 * acquireNativeDarkOverlay() memberi tahu native Android untuk memaksa ikon putih
 * meski app dalam light mode. Bisa di-acquire lebih dari satu kali (ref-counted).
 */

let activeDarkOverlays = 0;

function syncNativeOverlay() {
  try {
    window.AndroidJadhuman?.setDarkOverlay?.(activeDarkOverlays > 0);
  } catch { /* ignore */ }
}

/**
 * Mulai satu overlay dark. Mengembalikan fungsi untuk melepasnya.
 * Aman untuk dipanggil berkali-kali — overlay dihitung secara ref-counted.
 */
export function acquireNativeDarkOverlay(): () => void {
  activeDarkOverlays += 1;
  syncNativeOverlay();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeDarkOverlays = Math.max(0, activeDarkOverlays - 1);
    syncNativeOverlay();
  };
}
