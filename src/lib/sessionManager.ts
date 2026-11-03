import type { UserAccountSafe, TabPermissions, UserRole } from './userManager';
import { DEFAULT_ADMIN_PERMISSIONS, DEFAULT_USER_PERMISSIONS } from './userManager';
import { clearAllServerLoginCaches } from './cacheManager';
import { appStorage } from './appStorage';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Storage key dipisah per-role; Tauri memakai IndexedDB, browser per-tab:
 *   - jadhuman_session_admin  → HANYA menyimpan sesi admin
 *   - jadhuman_session_user   → HANYA menyimpan sesi user
 *
 * Di browser, sessionStorage terisolasi per-tab. Sesi Tauri persisten sampai logout.
 */
const SESSION_KEY: Record<UserRole, string> = {
  admin: 'jadhuman_session_admin',
  user:  'jadhuman_session_user',
};

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

const getSessionStorage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> =>
  isTauriRuntime() ? appStorage : window.sessionStorage;

export const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 menit idle

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredSession {
  currentUser: UserAccountSafe | null; // null = admin lama (tanpa user object)
  tabPermissions: TabPermissions;
  authTime: number;
  /** Role yang di-bind saat login — HARUS cocok dengan currentUser.role */
  boundRole: UserRole;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function createAdminUserAccount(username = 'admin'): UserAccountSafe {
  return {
    id: 'admin',
    username: username.toLowerCase().trim() || 'admin',
    displayName: 'Administrator',
    role: 'admin',
    permissions: DEFAULT_ADMIN_PERMISSIONS,
    createdAt: 0,
    updatedAt: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simpan sesi per-role; Tauri memakai storage persisten sampai logout.
 * Sebelum simpan, hapus session role lain agar tidak ada dua session sekaligus.
 */
export function saveSession(user: UserAccountSafe | null, permissions: TabPermissions): void {
  try {
    if (typeof window === 'undefined') return;

    const boundRole: UserRole = user?.role === 'user' ? 'user' : 'admin';

    const session: StoredSession = {
      currentUser: user,
      tabPermissions: permissions,
      authTime: Date.now(),
      boundRole,
    };

    const storage = getSessionStorage();
    const otherRole: UserRole = boundRole === 'admin' ? 'user' : 'admin';
    storage.removeItem(SESSION_KEY[otherRole]);
    const legacyStorage = isTauriRuntime() ? window.sessionStorage : appStorage;
    legacyStorage.removeItem(SESSION_KEY.admin);
    legacyStorage.removeItem(SESSION_KEY.user);

    storage.setItem(SESSION_KEY[boundRole], JSON.stringify(session));
  } catch (err) {
    console.warn('[sessionManager] Gagal menyimpan session:', err);
  }
}

/**
 * Ambil sesi aktif. Null jika tidak ada / kadaluarsa / rusak / mismatch role.
 */
export function loadSession(): StoredSession | null {
  try {
    if (typeof window === 'undefined') return null;

    const storage = getSessionStorage();
    let rawAdmin = storage.getItem(SESSION_KEY.admin);
    let rawUser = storage.getItem(SESSION_KEY.user);

    if (isTauriRuntime()) {
      const legacyAdmin = window.sessionStorage.getItem(SESSION_KEY.admin);
      const legacyUser = window.sessionStorage.getItem(SESSION_KEY.user);
      if ((rawAdmin && legacyUser) || (rawUser && legacyAdmin)) {
        clearAllSessions();
        return null;
      }
      if (!rawAdmin && legacyAdmin) {
        storage.setItem(SESSION_KEY.admin, legacyAdmin);
        rawAdmin = legacyAdmin;
      }
      if (!rawUser && legacyUser) {
        storage.setItem(SESSION_KEY.user, legacyUser);
        rawUser = legacyUser;
      }
      window.sessionStorage.removeItem(SESSION_KEY.admin);
      window.sessionStorage.removeItem(SESSION_KEY.user);
    }

    // Anomali: dua session aktif sekaligus — hapus keduanya
    if (rawAdmin && rawUser) {
      clearAllSessions();
      return null;
    }

    const raw = rawAdmin || rawUser;
    const detectedRole: UserRole = rawAdmin ? 'admin' : 'user';
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredSession;

    if (!parsed || !parsed.boundRole || !parsed.authTime) {
      clearAllSessions();
      return null;
    }

    // Validasi: boundRole harus sesuai dengan key yang dibaca
    if (parsed.boundRole !== detectedRole) {
      console.warn('[sessionManager] boundRole mismatch — sesi diinvalidasi');
      clearAllSessions();
      return null;
    }

    // Validasi: currentUser.role harus sesuai boundRole (cegah escalation)
    if (parsed.currentUser && parsed.currentUser.role !== parsed.boundRole) {
      console.warn('[sessionManager] currentUser.role mismatch — sesi diinvalidasi');
      clearAllSessions();
      return null;
    }

    // Validasi timeout idle
    if (!isTauriRuntime() && Date.now() - parsed.authTime > SESSION_TIMEOUT_MS) {
      clearAllSessions();
      return null;
    }

    return parsed;
  } catch {
    clearAllSessions();
    return null;
  }
}

/**
 * Perbarui timestamp sesi (reset idle timer).
 */
export function touchSession(): void {
  try {
    if (typeof window === 'undefined') return;
    if (isTauriRuntime()) return;
    const current = loadSession();
    if (!current) return;
    const updated: StoredSession = { ...current, authTime: Date.now() };
    getSessionStorage().setItem(SESSION_KEY[current.boundRole], JSON.stringify(updated));
  } catch (err) {
    console.warn('[sessionManager] Gagal touch session:', err);
  }
}

/**
 * Hapus sesi autentikasi tanpa menghapus kredensial server untuk auto-login.
 */
export function clearAuthSessions(): void {
  try {
    if (typeof window === 'undefined') return;
    for (const storage of [window.sessionStorage, appStorage]) {
      storage.removeItem(SESSION_KEY.admin);
      storage.removeItem(SESSION_KEY.user);
      storage.removeItem('jadhuman_auth');
      storage.removeItem('jadhuman_auth_time');
    }
  } catch (err) {
    console.warn('[sessionManager] Gagal hapus sesi autentikasi:', err);
  }
}

/**
 * Hapus semua sesi dari tab ini, termasuk cache login server.
 */
export function clearAllSessions(): void {
  clearAuthSessions();
  try {
    clearAllServerLoginCaches();
  } catch (err) {
    console.warn('[sessionManager] Gagal hapus cache login server:', err);
  }
}

/**
 * Hapus sesi role tertentu saja.
 */
export function clearSessionByRole(role: UserRole): void {
  try {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(SESSION_KEY[role]);
    appStorage.removeItem(SESSION_KEY[role]);
  } catch { /* ignore */ }
}

// ─── Blank permissions untuk state unauthenticated ───────────────────────────
export const UNAUTHENTICATED_PERMISSIONS: TabPermissions = {
  ...DEFAULT_USER_PERMISSIONS,
  tabLogin: false,
  tabAbsen: false,
};
