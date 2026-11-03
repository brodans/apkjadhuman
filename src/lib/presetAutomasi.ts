// ─────────────────────────────────────────────────────────────────────────────
// Preset Automasi — model data, IndexedDB persistence, CRUD, dan helper waktu.
//
// Database: "jadhuman-automasi" (v2)
//   • "preset-akun"  (keyPath: 'akun')  → { akun, presets: PresetAutomasi[] }
//   • "log-harian"   (keyPath: 'kunci') → { kunci, logs: LogEksekusi[] }
//   • "stock-foto"   (keyPath: 'id')    → StockFoto
//   • "foto-queue"   (keyPath: 'kunci') → { kunci: presetId, antrian: string[] }
//
// Foto dipilih dengan antrian shuffled per-preset:
//   – Setiap preset punya antrian terpisah.
//   – Ambil dari depan antrian; saat antrian habis, isi ulang dengan shuffle baru.
//   – Dijamin semua foto terpakai sebelum ada yang diulang.
// ─────────────────────────────────────────────────────────────────────────────

import { appStorage } from './appStorage';

export type HariKerja = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Minggu … 6 = Sabtu

export interface PresetAutomasi {
  id: string;
  nama: string;
  tipe: 'masuk' | 'pulang';
  /** Rentang waktu eksekusi, format "HH:MM" (WIB) */
  jamMulai: string;
  jamSelesai: string;
  hariAktif: HariKerja[];
  /** ID stock foto yang boleh dipakai, dipilih acak saat eksekusi. Maks 20. */
  stockFotoIds: string[];
  aktif: boolean;
  dibuatPada: number;  // ms timestamp
  diperbarui: number;  // ms timestamp
}

export interface LogEksekusi {
  presetId: string;
  tanggal: string;      // "YYYY-MM-DD" WIB
  fotoDipilih: string;  // ID stock foto
  eksekusiPada: number; // ms timestamp
  berhasil: boolean;
  pesan?: string;
}

export interface StockFoto {
  id: string;
  /** Nama bebas untuk identifikasi di UI */
  nama: string;
  /** Data URL (data:image/jpeg;base64,...) sudah diproses (320px, EXIF-normalized) */
  dataUrl: string;
  /** Ukuran file asli (bytes, sebelum processing) — hanya informatif */
  ukuranAsli: number;
  /** Dimensi hasil processing */
  lebarPx: number;
  tinggiPx: number;
  dibuatPada: number;
}

// ─── Nama hari ────────────────────────────────────────────────────────────────
export const NAMA_HARI: Record<HariKerja, string> = {
  0: 'Min', 1: 'Sen', 2: 'Sel', 3: 'Rab', 4: 'Kam', 5: 'Jum', 6: 'Sab',
};
export const URUTAN_HARI: HariKerja[] = [1, 2, 3, 4, 5, 6, 0];

// ─── Database ─────────────────────────────────────────────────────────────────
const DB_NAME = 'jadhuman-automasi';
const DB_VERSION = 2;
const STORE_PRESET = 'preset-akun';
const STORE_LOG = 'log-harian';
const STORE_FOTO = 'stock-foto';
const STORE_QUEUE = 'foto-queue';

let dbPromise: Promise<IDBDatabase> | null = null;

function bukaDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (_event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PRESET)) {
        db.createObjectStore(STORE_PRESET, { keyPath: 'akun' });
      }
      if (!db.objectStoreNames.contains(STORE_LOG)) {
        db.createObjectStore(STORE_LOG, { keyPath: 'kunci' });
      }
      if (!db.objectStoreNames.contains(STORE_FOTO)) {
        db.createObjectStore(STORE_FOTO, { keyPath: 'id' });
      }
      // v2: antrian foto per-preset
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'kunci' });
      }
    };
    req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => { dbPromise = null; reject(req.error || new Error('Gagal membuka database automasi.')); };
    req.onblocked = () => { dbPromise = null; reject(new Error('Database automasi diblokir oleh tab lain.')); };
  });
  return dbPromise;
}

function reqResult<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

// ─── Sanitasi username sebagai kunci ──────────────────────────────────────────
function kunciAkun(username: string): string {
  return username.replace(/[/\\.#$[\]]/g, '_').slice(0, 64).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD: Preset
// ─────────────────────────────────────────────────────────────────────────────

export async function bacaSemuaPreset(username: string): Promise<PresetAutomasi[]> {
  const akun = kunciAkun(username);
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_PRESET, 'readonly');
  const store = tx.objectStore(STORE_PRESET);
  const row = await reqResult<{ akun: string; presets: PresetAutomasi[] } | undefined>(store.get(akun));
  return row?.presets ?? [];
}

async function simpanSemuaPreset(username: string, presets: PresetAutomasi[]): Promise<void> {
  const akun = kunciAkun(username);
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_PRESET, 'readwrite');
  tx.objectStore(STORE_PRESET).put({ akun, presets });
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

export async function tambahPreset(
  username: string,
  data: Omit<PresetAutomasi, 'id' | 'dibuatPada' | 'diperbarui'>,
): Promise<PresetAutomasi> {
  const presets = await bacaSemuaPreset(username);
  const now = Date.now();
  const id = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${now}-${Math.random().toString(36).slice(2, 9)}`;
  const baru: PresetAutomasi = { ...data, id, dibuatPada: now, diperbarui: now };
  await simpanSemuaPreset(username, [...presets, baru]);
  return baru;
}

export async function perbaruiPreset(
  username: string,
  id: string,
  data: Partial<Omit<PresetAutomasi, 'id' | 'dibuatPada'>>,
): Promise<void> {
  const presets = await bacaSemuaPreset(username);
  const updated = presets.map(p => p.id === id ? { ...p, ...data, diperbarui: Date.now() } : p);
  await simpanSemuaPreset(username, updated);
}

export async function hapusPreset(username: string, id: string): Promise<void> {
  const presets = await bacaSemuaPreset(username);
  await simpanSemuaPreset(username, presets.filter(p => p.id !== id));
}

export async function toggleAktifPreset(username: string, id: string): Promise<void> {
  const presets = await bacaSemuaPreset(username);
  const updated = presets.map(p => p.id === id ? { ...p, aktif: !p.aktif, diperbarui: Date.now() } : p);
  await simpanSemuaPreset(username, updated);
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD: Stock Foto (per-database, bukan per-akun — foto bebas dipakai semua preset)
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_STOCK_FOTO = 20;

export async function bacaSemuaStockFoto(): Promise<StockFoto[]> {
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_FOTO, 'readonly');
  return reqResult<StockFoto[]>(tx.objectStore(STORE_FOTO).getAll());
}

export async function tambahStockFoto(
  data: Omit<StockFoto, 'id' | 'dibuatPada'>,
): Promise<StockFoto> {
  const db = await bukaDatabase();
  // Cek batas langsung dari DB (bukan dari state React yang bisa stale)
  const jumlah = await new Promise<number>((res, rej) => {
    const tx  = db.transaction(STORE_FOTO, 'readonly');
    const req = tx.objectStore(STORE_FOTO).count();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
  if (jumlah >= MAX_STOCK_FOTO) {
    throw new Error(`Batas ${MAX_STOCK_FOTO} foto sudah tercapai.`);
  }
  const id = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const foto: StockFoto = { ...data, id, dibuatPada: Date.now() };
  const tx2 = db.transaction(STORE_FOTO, 'readwrite');
  tx2.objectStore(STORE_FOTO).put(foto);
  await new Promise<void>((res, rej) => { tx2.oncomplete = () => res(); tx2.onerror = () => rej(tx2.error); });
  return foto;
}

export async function hapusStockFoto(id: string): Promise<void> {
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_FOTO, 'readwrite');
  tx.objectStore(STORE_FOTO).delete(id);
  return new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

export async function bacaStockFotoById(id: string): Promise<StockFoto | undefined> {
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_FOTO, 'readonly');
  return reqResult<StockFoto | undefined>(tx.objectStore(STORE_FOTO).get(id));
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD: Log Eksekusi
// ─────────────────────────────────────────────────────────────────────────────

export async function bacaLogHarian(username: string, tanggal: string): Promise<LogEksekusi[]> {
  const kunci = `${kunciAkun(username)}__${tanggal}`;
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_LOG, 'readonly');
  const row = await reqResult<{ kunci: string; logs: LogEksekusi[] } | undefined>(
    tx.objectStore(STORE_LOG).get(kunci),
  );
  return row?.logs ?? [];
}

export async function tulisLog(username: string, tanggal: string, log: LogEksekusi): Promise<void> {
  const kunci = `${kunciAkun(username)}__${tanggal}`;
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_LOG, 'readwrite');
  const store = tx.objectStore(STORE_LOG);
  const row = await reqResult<{ kunci: string; logs: LogEksekusi[] } | undefined>(store.get(kunci));
  const logs = row?.logs ?? [];
  const idx = logs.findIndex(l => l.presetId === log.presetId);
  if (idx >= 0) logs[idx] = log; else logs.push(log);
  store.put({ kunci, logs });
  return new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

export async function sudahDieksekusiHariIni(
  username: string,
  presetId: string,
  tanggal: string,
): Promise<boolean> {
  const logs = await bacaLogHarian(username, tanggal);
  return logs.some(l => l.presetId === presetId && l.berhasil);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper waktu
// ─────────────────────────────────────────────────────────────────────────────

/** "HH:MM" → menit dari tengah malam */
function toMenit(jam: string): number {
  const [h, m] = jam.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Apakah jamSekarang (WIB "HH:MM") ada di dalam rentang [jamMulai, jamSelesai]? */
export function dalamRentangWaktu(jamMulai: string, jamSelesai: string, jamSekarang: string): boolean {
  const mulai = toMenit(jamMulai);
  const selesai = toMenit(jamSelesai);
  const skrg = toMenit(jamSekarang);
  if (mulai <= selesai) {
    return skrg >= mulai && skrg <= selesai;
  }
  // Melintasi tengah malam (mis. 23:00 – 02:00)
  return skrg >= mulai || skrg <= selesai;
}

/** Apakah preset aktif pada hari ini? */
export function hariIniAktif(hariAktif: HariKerja[], hariSekarang: number): boolean {
  return hariAktif.includes(hariSekarang as HariKerja);
}

/** "HH:MM" WIB saat ini */
export function getNowWIBTime(): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date()).replace('.', ':');
}

/** "YYYY-MM-DD" WIB saat ini */
export function getTodayWIBAutomasi(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    const now = new Date();
    const wib = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60000);
    return wib.toISOString().split('T')[0];
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Antrian Foto Per-Preset (shuffled queue, round-robin tanpa pengulangan)
//
// Setiap preset punya antrian terpisah di store "foto-queue".
// Kunci: presetId.
// Isi: { kunci: presetId, antrian: string[] } — array ID foto yang belum dipakai.
//
// Algoritma:
//   1. Baca antrian preset dari IndexedDB.
//   2. Filter antrian: buang ID yang sudah tidak ada di stockFotoIds (foto dihapus).
//   3. Jika antrian kosong → buat shuffle baru dari stockFotoIds.
//   4. Ambil ID pertama dari antrian, simpan sisa kembali ke IndexedDB.
//   5. Kembalikan ID yang diambil.
// ─────────────────────────────────────────────────────────────────────────────

/** Fisher–Yates shuffle, kembalikan array baru (tidak ubah aslinya). */
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Ambil foto berikutnya untuk preset ini secara round-robin shuffled.
 * Semua foto dipakai satu kali sebelum ada yang diulang.
 * Jika stockFotoIds berubah (foto ditambah/dihapus), antrian otomatis disesuaikan.
 */
export async function ambilFotoBerikutnya(
  presetId: string,
  stockFotoIds: string[],
): Promise<string | null> {
  if (!stockFotoIds.length) return null;

  const db = await bukaDatabase();
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  const store = tx.objectStore(STORE_QUEUE);

  const row = await reqResult<{ kunci: string; antrian: string[] } | undefined>(
    store.get(presetId),
  );

  // Pertahankan hanya ID yang masih ada di stockFotoIds saat ini
  const setValid = new Set(stockFotoIds);
  let antrian = (row?.antrian ?? []).filter(id => setValid.has(id));

  // Antrian habis (atau baru pertama kali) → shuffle ulang dari pool lengkap
  if (antrian.length === 0) {
    antrian = shuffleArray(stockFotoIds);
  }

  const dipilih = antrian[0];
  const sisanya = antrian.slice(1);

  store.put({ kunci: presetId, antrian: sisanya });

  await new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });

  return dipilih;
}

/**
 * Reset antrian foto preset (mis. ketika stockFotoIds diubah drastis oleh user).
 * Tidak wajib — ambilFotoBerikutnya() auto-filter foto yang sudah tidak ada.
 */
export async function resetAntrianFoto(presetId: string): Promise<void> {
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  tx.objectStore(STORE_QUEUE).delete(presetId);
  return new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/**
 * Baca status antrian foto preset: berapa yang sudah dipakai dan berapa sisa.
 * Berguna untuk ditampilkan di UI.
 */
export async function bacaStatusAntrian(
  presetId: string,
  stockFotoIds: string[],
): Promise<{ terpakai: number; sisa: number; total: number }> {
  const total = stockFotoIds.length;
  if (total === 0) return { terpakai: 0, sisa: 0, total: 0 };

  const db = await bukaDatabase();
  const tx = db.transaction(STORE_QUEUE, 'readonly');
  const row = await reqResult<{ kunci: string; antrian: string[] } | undefined>(
    tx.objectStore(STORE_QUEUE).get(presetId),
  );

  const setValid = new Set(stockFotoIds);
  const antrian = (row?.antrian ?? []).filter(id => setValid.has(id));
  const sisa = antrian.length;
  const terpakai = total - sisa;

  return { terpakai, sisa, total };
}

// ─── Event bus sederhana ──────────────────────────────────────────────────────
export function notifyPresetUpdated(): void {
  window.dispatchEvent(new Event('jadhuman-preset-updated'));
}

export function notifySchedulerToggle(aktif: boolean): void {
  window.dispatchEvent(new CustomEvent('jadhuman-scheduler-toggle', { detail: { aktif } }));
}

// ─── Persistensi toggle penjadwal ─────────────────────────────────────────────
const KEY_PENJADWAL = 'automasi_penjadwal_aktif';

export function getPenjadwalAktif(): boolean {
  try {
    return appStorage.getItem(KEY_PENJADWAL) === 'true';
  } catch {
    return false;
  }
}

export function setPenjadwalAktif(aktif: boolean): void {
  try {
    appStorage.setItem(KEY_PENJADWAL, aktif ? 'true' : 'false');
  } catch {
    // ignore
  }
}
