import { db } from './firebase';
import {
  collection, doc, getDoc, getDocs,
  setDoc, deleteDoc, query, where, deleteField
} from 'firebase/firestore';
import bcrypt from 'bcryptjs';
import { decryptAppCredential } from './encryption';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserRole = 'admin' | 'user';

export interface TabPermissions {
  tabLogin: boolean;  // ⚠️ Always true for all users (enforced in code)
  tabAbsen: boolean;
  tabLog: boolean;
  tabInputAktivitas: boolean;
  tabAktivitas: boolean;
  tabReview: boolean;
  tabIzin: boolean;
  tabPengajuanIzin: boolean;
  tabLogPresensiInstansi: boolean;
  tabDatabase: boolean;
  tabUnor: boolean;
  tabReport: boolean;
  tabAutomasi: boolean;
  tabLogPresensiTerkini: boolean;
  tabLogLengkap: boolean;
  reportPerPegawai: boolean;
  reportPerPegawaiAktivitas: boolean;
  reportSkorPerInstansi: boolean;
  reportAktivitasPerInstansi: boolean;
  reportRekapTppAktivitas: boolean;
  /** Izinkan user mencari & memilih pegawai lain saat submit presensi/aktivitas */
  allowSearchPegawai: boolean;
  /** Izinkan user mencari pegawai di Database Pegawai */
  allowSearchDatabase: boolean;
  /** Izinkan user mencari lokasi/unit di Struktur Organisasi */
  allowSearchUnor: boolean;
  /** Izinkan user mencari & memilih pegawai lain di History Presensi */
  allowSearchPresensi: boolean;
  /** Izinkan user mencari & memilih pegawai lain di History Produktivitas */
  allowSearchProduktivitas: boolean;
  /** Izinkan user mencari & memilih pegawai lain di Review Produktivitas */
  allowSearchReview: boolean;
  /** Izinkan user mencari & memilih pegawai lain di History Izin */
  allowSearchIzin: boolean;
  /** Izinkan user mencari & memilih pegawai/instansi lain di Menu Laporan */
  allowSearchLaporan: boolean;
  /** Izinkan user mencari nama pegawai & mengganti instansi di History Presensi Instansi */
  allowSearchInstansi: boolean;
  /** ✨ NEW: Izinkan user edit NIP & password di Login Info (jika false = view-only mode) */
  allowEditLoginCredentials: boolean;
}

export interface UserAccount {
  id: string;
  username: string;           // lowercase, sanitized
  passwordHash: string;       // bcrypt hash — NEVER stored as plaintext
  role: UserRole;
  displayName: string;
  permissions: TabPermissions;
  createdAt: number;
  updatedAt: number;
  // Migration compat: tolerated but ignored on verify
  passwordEncrypted?: string;
}

export type UserAccountSafe = Omit<UserAccount, 'passwordHash' | 'passwordEncrypted'>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BCRYPT_ROUNDS = 10;
const USERS_COLLECTION = 'jadhuman_users';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_ADMIN_PERMISSIONS: TabPermissions = {
  tabLogin: true, tabAbsen: true, tabLog: true,
  tabInputAktivitas: true, tabAktivitas: true, tabReview: true,
  tabIzin: true, tabPengajuanIzin: true, tabLogPresensiInstansi: true, tabDatabase: true,
  tabUnor: true, tabReport: true, tabAutomasi: true,
  tabLogPresensiTerkini: true, tabLogLengkap: true,
  reportPerPegawai: true, reportPerPegawaiAktivitas: true,
  reportSkorPerInstansi: true, reportAktivitasPerInstansi: true,
  reportRekapTppAktivitas: true,
  allowSearchPegawai: true,
  allowSearchDatabase: true,
  allowSearchUnor: true,
  allowSearchPresensi: true,
  allowSearchProduktivitas: true,
  allowSearchReview: true,
  allowSearchIzin: true,
  allowSearchLaporan: true,
  allowSearchInstansi: true,
  allowEditLoginCredentials: true,
};

export const DEFAULT_USER_PERMISSIONS: TabPermissions = {
  tabLogin: true, tabAbsen: true, tabLog: true,
  tabInputAktivitas: true, tabAktivitas: true, tabReview: true,
  tabIzin: true, tabPengajuanIzin: true, tabLogPresensiInstansi: false, tabDatabase: false,
  tabUnor: false, tabReport: false, tabAutomasi: true,
  tabLogPresensiTerkini: true, tabLogLengkap: true,
  reportPerPegawai: false, reportPerPegawaiAktivitas: false,
  reportSkorPerInstansi: false, reportAktivitasPerInstansi: false,
  reportRekapTppAktivitas: false,
  allowSearchPegawai: false,
  allowSearchDatabase: false,
  allowSearchUnor: false,
  allowSearchPresensi: false,
  allowSearchProduktivitas: false,
  allowSearchReview: false,
  allowSearchIzin: false,
  allowSearchLaporan: false,
  allowSearchInstansi: false,
  allowEditLoginCredentials: false,  // Default: user tidak bisa edit credentials
};

export function normalizeUserPermissions(raw?: Record<string, unknown>): TabPermissions {
  const permissions = {
    ...DEFAULT_USER_PERMISSIONS,
    ...(raw || {}),
  } as TabPermissions & { tabLokasi?: boolean };

  delete permissions.tabLokasi;
  return permissions;
}

export const TAB_PERMISSION_LABELS: Record<keyof TabPermissions, string> = {
  tabLogin: 'Login Info (Selalu Aktif)',
  tabAbsen: 'Submit Presensi',
  tabLog: 'History Presensi',
  tabInputAktivitas: 'Produktivitas Harian',
  tabAktivitas: 'History Produktivitas',
  tabReview: 'Review Produktivitas',
  tabIzin: 'Izin/Cuti',
  tabPengajuanIzin: 'Pengajuan Izin / Cuti',
  tabLogPresensiInstansi: 'History Presensi Instansi',
  tabDatabase: 'Database Pegawai',
  tabUnor: 'Struktur Organisasi',
  tabReport: 'Laporan',
  tabAutomasi: 'Preset Automasi',
  tabLogPresensiTerkini: 'Presensi Terkini',
  tabLogLengkap: 'Log Lengkap',
  reportPerPegawai: 'Laporan Presensi per Pegawai',
  reportPerPegawaiAktivitas: 'Laporan Aktivitas per Pegawai',
  reportSkorPerInstansi: 'Skor Produktivitas per Instansi',
  reportAktivitasPerInstansi: 'Aktivitas per Instansi',
  reportRekapTppAktivitas: 'Rekap TPP Aktivitas',
  allowSearchPegawai: 'Cari & Pilih Pegawai Lain (Presensi/Aktivitas)',
  allowSearchDatabase: 'Cari Pegawai di Database',
  allowSearchUnor: 'Cari Lokasi & Struktur Organisasi',
  allowSearchPresensi: 'Cari Nama Pegawai di History Presensi',
  allowSearchProduktivitas: 'Cari Nama Pegawai di History Produktivitas',
  allowSearchReview: 'Cari Nama Pegawai di Review Produktivitas',
  allowSearchIzin: 'Cari Nama Pegawai di History Izin',
  allowSearchLaporan: 'Cari Pegawai & Instansi di Menu Laporan',
  allowSearchInstansi: 'Cari Nama & Ganti Instansi di Presensi Instansi',
  allowEditLoginCredentials: 'Edit NIP & Password di Login Info',
};

export const PERMISSION_GROUPS: { label: string; keys: (keyof TabPermissions)[] }[] = [
  {
    label: 'Menu Utama',
    keys: ['tabLogin','tabAbsen','tabLog','tabInputAktivitas','tabAktivitas','tabReview','tabIzin','tabAutomasi','tabLogPresensiInstansi','tabDatabase','tabUnor','tabReport'],
  },
  {
    label: 'Sub-fitur: History Presensi',
    keys: ['tabLogPresensiTerkini', 'tabLogLengkap'],
  },
  {
    label: 'Sub-fitur: Izin/Cuti',
    keys: ['tabPengajuanIzin'],
  },
  {
    label: 'Sub-fitur: Laporan',
    keys: ['reportPerPegawai','reportPerPegawaiAktivitas','reportSkorPerInstansi','reportAktivitasPerInstansi','reportRekapTppAktivitas'],
  },
  {
    label: 'Pengaturan Pencarian & Akses Data',
    keys: ['allowSearchPegawai','allowSearchDatabase','allowSearchUnor','allowSearchPresensi','allowSearchProduktivitas','allowSearchReview','allowSearchIzin','allowSearchInstansi','allowSearchLaporan'],
  },
  {
    label: 'Pengaturan Login Info',
    keys: ['allowEditLoginCredentials'],
  },
];

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

/** Karakter yang diizinkan untuk username */
const USERNAME_REGEX = /^[a-z0-9_.-]{2,32}$/;

export function validateUsername(username: string): string {
  const u = username.toLowerCase().trim();
  if (!u) throw new Error('Username tidak boleh kosong.');
  if (u.length < 2 || u.length > 32) throw new Error('Username harus 2–32 karakter.');
  if (!USERNAME_REGEX.test(u)) throw new Error('Username hanya boleh huruf kecil, angka, _ . -');
  if (u === 'admin') throw new Error('Username "admin" direservasi untuk administrator.');
  return u;
}

export function validatePassword(password: string, label = 'Password'): void {
  if (!password || password.length < 4) throw new Error(`${label} minimal 4 karakter.`);
  if (password.length > 128) throw new Error(`${label} terlalu panjang (maks 128 karakter).`);
}

/** Strip semua HTML/script injection chars dari string umum */
export function sanitizeString(val: string, maxLen = 256): string {
  if (!val || typeof val !== 'string') return '';
  return val
    .replace(/[<>"'`\\;]/g, '')
    .trim()
    .substring(0, maxLen);
}

// ---------------------------------------------------------------------------
// Bcrypt helpers
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// ---------------------------------------------------------------------------
// Firebase CRUD
// ---------------------------------------------------------------------------

export async function fetchAllUsers(): Promise<UserAccountSafe[]> {
  const q = query(collection(db, USERS_COLLECTION), where('role', '==', 'user'));
  const snap = await getDocs(q);
  return snap.docs.map(d => {
    const { passwordHash: _ph, passwordEncrypted: _pe, ...safe } = d.data() as UserAccount;
    return {
      ...safe,
      permissions: normalizeUserPermissions((safe as UserAccount).permissions as unknown as Record<string, unknown>),
    } as UserAccountSafe;
  });
}

export async function findUserByUsername(username: string): Promise<UserAccount | null> {
  const normalized = username.toLowerCase().trim();
  const q = query(collection(db, USERS_COLLECTION), where('username', '==', normalized));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].data() as UserAccount;
}

/**
 * Verifikasi username+password untuk login.
 * Menggunakan bcrypt.compare yang bersifat timing-safe.
 * Jika user tidak ditemukan, tetap jalankan bcrypt compare dummy
 * agar response time tidak berbeda (prevent user enumeration).
 */
const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

export async function verifyUserPassword(
  username: string,
  password: string
): Promise<UserAccountSafe | null> {
  // Sanitize dulu
  const sanitizedUser = username.toLowerCase().trim().substring(0, 32);
  const sanitizedPass = password.substring(0, 128);

  const user = await findUserByUsername(sanitizedUser);

  if (!user) {
    // Dummy compare untuk prevent timing attack / user enumeration
    await bcrypt.compare(sanitizedPass, DUMMY_HASH);
    return null;
  }

  let valid = false;

  // Path 1: bcrypt hash (sistem baru)
  if (user.passwordHash) {
    valid = await bcrypt.compare(sanitizedPass, user.passwordHash);
  }

  // Path 2: legacy AES encrypted (migrasi — sekali berhasil, upgrade ke bcrypt)
  if (!valid && user.passwordEncrypted) {
    try {
      const decrypted = decryptAppCredential(user.passwordEncrypted);
      if (decrypted && decrypted === sanitizedPass) {
        valid = true;
        // Otomatis migrate ke bcrypt setelah berhasil login
        const newHash = await hashPassword(sanitizedPass);
        const ref = doc(db, USERS_COLLECTION, user.id);
        await setDoc(ref, {
          passwordHash: newHash,
          passwordEncrypted: null,  // hapus legacy
          updatedAt: Date.now(),
        }, { merge: true });
      }
    } catch { /* ignore */ }
  }

  if (!valid) return null;

  const { passwordHash: _ph, passwordEncrypted: _pe, ...safe } = user;
  return {
    ...safe,
    // Tambahkan permission baru untuk akun lama tanpa mengubah pilihan admin.
    permissions: normalizeUserPermissions(user.permissions as unknown as Record<string, unknown>),
  } as UserAccountSafe;
}

export async function createUserAccount(
  username: string,
  password: string,
  _displayName: string,
  permissions: TabPermissions
): Promise<UserAccountSafe> {
  const normalizedUsername = validateUsername(username);
  validatePassword(password);

  const existing = await findUserByUsername(normalizedUsername);
  if (existing) throw new Error(`Username "${normalizedUsername}" sudah dipakai.`);

  const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();
  const passwordHash = await hashPassword(password);

  const account: UserAccount = {
    id,
    username: normalizedUsername,
    passwordHash,
    role: 'user',
    displayName: normalizedUsername,
    permissions,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, USERS_COLLECTION, id), account);
  const { passwordHash: _ph, ...safe } = account;
  return safe as UserAccountSafe;
}

export async function updateUserAccount(
  id: string,
  updates: {
    displayName?: string;
    password?: string;
    permissions?: TabPermissions;
    username?: string;
  }
): Promise<void> {
  const ref = doc(db, USERS_COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Akun tidak ditemukan.');

  const current = snap.data() as UserAccount;

  if (updates.username) {
    const normalized = validateUsername(updates.username);
    if (normalized !== current.username) {
      const existing = await findUserByUsername(normalized);
      if (existing) throw new Error(`Username "${normalized}" sudah dipakai.`);
    }
  }

  if (updates.password) {
    validatePassword(updates.password, 'Password baru');
  }

  // Gunakan Firestore deleteField untuk menghapus field legacy secara eksplisit

  const patch: Record<string, unknown> = { updatedAt: Date.now() };

  if (updates.username !== undefined) {
    // Gunakan hasil validateUsername yang sudah dinormalisasi di atas
    const normalizedUsername = validateUsername(updates.username);
    patch.username = normalizedUsername;
    patch.displayName = normalizedUsername;
  }
  if (updates.displayName !== undefined) patch.displayName = sanitizeString(updates.displayName, 64);
  if (updates.permissions !== undefined) patch.permissions = updates.permissions;
  if (updates.password && updates.password.length > 0) {
    patch.passwordHash = await hashPassword(updates.password);
    patch.passwordEncrypted = deleteField(); // hapus field legacy dari Firestore
  }

  await setDoc(ref, patch, { merge: true });
}

export async function deleteUserAccount(id: string): Promise<void> {
  if (!id || typeof id !== 'string') throw new Error('ID tidak valid.');
  // Validasi: pastikan doc ini memang role=user sebelum hapus
  const snap = await getDoc(doc(db, USERS_COLLECTION, id));
  if (!snap.exists()) throw new Error('Akun tidak ditemukan.');
  const data = snap.data() as UserAccount;
  if (data.role !== 'user') throw new Error('Tidak dapat menghapus akun administrator.');
  await deleteDoc(doc(db, USERS_COLLECTION, id));
}
