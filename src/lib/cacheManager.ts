/**
 * cacheManager.ts
 * ───────────────────────────────────────────────────────────────
 * Cache login server per-akun Jadhuman di sessionStorage.
 * Key: jadhuman_servercache_<username>
 *
 * Yang disimpan:
 *   - Seluruh respons server (pegawai data + foto)
 *   - Config turunan (idPegawai, deviceId, lat, lng, dll)
 *   - Password (untuk kebutuhan auto-re-login / change-password flow)
 *   - NIP yang dipakai login ke server
 *   - Timestamp simpan (untuk keperluan TTL opsional di masa depan)
 *   - Versi cache (untuk migrasi format jika perlu)
 *
 * Cache TIDAK expires otomatis — selalu valid sampai:
 *   1. Login manual baru berhasil → cache diperbarui
 *   2. Logout / ganti user → cache dihapus
 *   3. Foto diubah/dihapus → cache diperbarui
 * ───────────────────────────────────────────────────────────────
 */

const CACHE_VERSION = 1;
const CACHE_KEY_PREFIX = 'jadhuman_servercache_';

export interface ServerLoginCachePayload {
  version: number;
  /** NIP / username yang dipakai login ke server */
  serverUsername: string;
  /** Password server (plain, tersimpan lokal — tidak dikirim ke pihak lain) */
  serverPassword: string;
  /** Full pegawai response dari server */
  pegawai: Record<string, any>;
  /** Config turunan dari response server */
  config: {
    idPegawai: string;
    deviceId: string;
    latitude: string;
    longitude: string;
    idLokasi: string;
    kodeInstansi: string;
    kodeUnor: string;
  };
  /** ISO timestamp saat cache terakhir disimpan */
  savedAt: string;
}

/**
 * Normalize username Jadhuman → key sessionStorage yang aman.
 * Sama dengan konvensi docKey di LoginServer / App.tsx.
 */
function toStorageKey(jadhumanUsername: string): string {
  const normalized = jadhumanUsername.replace(/[^a-zA-Z0-9_]/g, '_');
  return `${CACHE_KEY_PREFIX}${normalized}`;
}

/** Simpan cache login server untuk akun Jadhuman tertentu. */
export function setServerLoginCache(
  jadhumanUsername: string,
  payload: Omit<ServerLoginCachePayload, 'version' | 'savedAt'>
): void {
  try {
    const key = toStorageKey(jadhumanUsername);
    const data: ServerLoginCachePayload = {
      ...payload,
      version: CACHE_VERSION,
      savedAt: new Date().toISOString(),
    };
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    // sessionStorage bisa penuh — jangan crash aplikasi
    console.warn('[cacheManager] Gagal menyimpan cache server login:', err);
  }
}

/** Ambil cache login server untuk akun Jadhuman tertentu. Null jika tidak ada / rusak. */
export function getServerLoginCache(jadhumanUsername: string): ServerLoginCachePayload | null {
  try {
    const key = toStorageKey(jadhumanUsername);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;

    const data = JSON.parse(raw) as ServerLoginCachePayload;
    // Validasi minimal: harus punya versi dan data pegawai
    if (!data || data.version !== CACHE_VERSION || !data.pegawai || !data.serverUsername) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Update hanya field `pegawai.foto` di cache yang sudah ada.
 * Dipanggil saat foto berhasil diubah atau dihapus — tidak perlu re-login server.
 */
export function updateServerLoginCacheFoto(
  jadhumanUsername: string,
  newFoto: string
): void {
  try {
    const existing = getServerLoginCache(jadhumanUsername);
    if (!existing) return;

    setServerLoginCache(jadhumanUsername, {
      ...existing,
      pegawai: { ...existing.pegawai, foto: newFoto },
    });
  } catch (err) {
    console.warn('[cacheManager] Gagal update foto di cache:', err);
  }
}

/** Hapus cache login server untuk akun Jadhuman tertentu. */
export function clearServerLoginCache(jadhumanUsername: string): void {
  try {
    const key = toStorageKey(jadhumanUsername);
    sessionStorage.removeItem(key);
  } catch (err) {
    console.warn('[cacheManager] Gagal menghapus cache server login:', err);
  }
}

/**
 * Hapus semua cache server login dari sessionStorage.
 * Dipanggil saat logout global / reset aplikasi.
 */
export function clearAllServerLoginCaches(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(CACHE_KEY_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => sessionStorage.removeItem(k));
  } catch (err) {
    console.warn('[cacheManager] Gagal menghapus semua cache server login:', err);
  }
}
