// ─────────────────────────────────────────────────────────────────────────────
// usePengingatProduktivitas — pengingat produktivitas terjadwal.
//
// Dua jenis pengingat, aktif hanya pada hari yang dikonfigurasi (default Sen–Jum):
//
// 1. PENGINGAT JAM BATAS — "Belum ada aktivitas produktivitas"
//    Syarat: hari ini ada di hariAktif
//            sudah absen masuk hari ini (getJamKerjaPegawai → absen_masuk)
//            BELUM ada aktivitas aktif (ambilDataAktivitas → BELUM DIAKHIRI)
//            Waktu sekarang sudah melewati batas (default 08:30 WIB)
//            Belum pernah dikirim notif untuk tanggal hari ini
//
// 2. PENGINGAT AKTIVITAS 2 JAM — "Aktivitas sudah berjalan X jam"
//    Syarat: hari ini ada di hariAktif
//            ada aktivitas dengan tgl_mulai > 2 jam yang lalu
//            Belum pernah dikirim notif untuk aktivitas + jam ke-N ini
//            (cooldown per-ID-aktivitas per-jam: notif maks 1x per jam penuh berlalu)
//
// Polling: setiap 60 detik.
// State cooldown disimpan di IndexedDB (store "pengingat-state") agar persisten.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { sendRequest } from '../api';
import { kirimNotifikasiNative } from '../lib/androidAutomasiBridge';
import { getTodayWIBAutomasi, getNowWIBTime, HariKerja } from '../lib/presetAutomasi';

const INTERVAL_MS = 60_000;
const JAM_BATAS_DEFAULT = '08:30';
const DURASI_MAKS_JAM = 2;
const HARI_AKTIF_DEFAULT: HariKerja[] = [1, 2, 3, 4, 5]; // Senin–Jumat

// ─── IndexedDB state store ────────────────────────────────────────────────────
const DB_REMINDER = 'jadhuman-pengingat';
const DB_REMINDER_VERSION = 1;
const STORE_STATE = 'pengingat-state';

let dbReminderPromise: Promise<IDBDatabase> | null = null;

function bukaDbPengingat(): Promise<IDBDatabase> {
  if (dbReminderPromise) return dbReminderPromise;
  dbReminderPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_REMINDER, DB_REMINDER_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE, { keyPath: 'kunci' });
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => { dbReminderPromise = null; reject(req.error); };
    req.onblocked = () => { dbReminderPromise = null; reject(new Error('DB pengingat diblokir.')); };
  });
  return dbReminderPromise;
}

async function bacaState(kunci: string): Promise<string | null> {
  const db = await bukaDbPengingat();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_STATE, 'readonly');
    const req = tx.objectStore(STORE_STATE).get(kunci);
    req.onsuccess = () => res((req.result as any)?.nilai ?? null);
    req.onerror = () => rej(req.error);
  });
}

async function tulisState(kunci: string, nilai: string): Promise<void> {
  const db = await bukaDbPengingat();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_STATE, 'readwrite');
    tx.objectStore(STORE_STATE).put({ kunci, nilai });
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ─── Helper waktu ──────────────────────────────────────────────────────────────
function toMenit(jam: string): number {
  const [h, m] = jam.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Apakah hari ini (0=Min..6=Sab) ada di dalam daftar hariAktif? */
function isHariAktif(hariAktif: HariKerja[]): boolean {
  return hariAktif.includes(new Date().getDay() as HariKerja);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pengecekan 1: Pengingat produktivitas belum mulai
// ─────────────────────────────────────────────────────────────────────────────
async function cekPengingatProduktivitas(
  idPegawai: string,
  jamBatas: string,
  hariAktif: HariKerja[],
): Promise<void> {
  if (!isHariAktif(hariAktif)) return;

  const jamSekarang = getNowWIBTime();
  if (toMenit(jamSekarang) < toMenit(jamBatas)) return;

  const tanggal = getTodayWIBAutomasi();
  const kunciTerkirim = `produktivitas_reminder_${idPegawai}_${tanggal}`;

  const sudahKirim = await bacaState(kunciTerkirim).catch(() => null);
  if (sudahKirim === 'ya') return;

  // Cek absensi
  let sudahAbsen = false;
  try {
    const res = await sendRequest('/pegawai/getJamKerjaPegawai', { id_pegawai: idPegawai });
    const obj: any =
      (Array.isArray(res) && res.length > 0 ? res[0] : null) ??
      (res?.data && Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null) ??
      (typeof res === 'object' && res !== null ? res : null);
    if (obj) {
      const normBool = (v: unknown): boolean =>
        v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
      sudahAbsen =
        normBool(obj.absen_masuk) ||
        Boolean(obj.jam_masuk) ||
        Boolean(obj.jam_absen) ||
        Boolean(obj.absen);
    }
  } catch { return; }

  if (!sudahAbsen) return;

  // Cek aktivitas aktif
  try {
    const res = await sendRequest('/Tupoksi/ambilDataAktivitas', {
      id_pegawai: idPegawai,
      tgl_mulai: tanggal,
      tgl_akhir: tanggal,
    });
    if (res?.success && Array.isArray(res.data) && res.data.length > 0) {
      const aktif = res.data.filter((x: any) =>
        x.status === 'BELUM DIAKHIRI' || x.status === 'Proses' ||
        x.tgl_selesai === null || x.tgl_selesai === undefined || x.tgl_selesai === '',
      );
      if (aktif.length > 0) return;
    }
  } catch { return; }

  await kirimNotifikasiNative(
    '📋 Pengingat Produktivitas',
    `Sudah melewati jam ${jamBatas} dan belum ada aktivitas yang sedang berjalan. Yuk mulai catat produktivitas hari ini!`,
  );
  await tulisState(kunciTerkirim, 'ya').catch(() => {/* abaikan */});
}

// ─────────────────────────────────────────────────────────────────────────────
// Pengecekan 2: Aktivitas sudah berjalan ≥ 2 jam
// ─────────────────────────────────────────────────────────────────────────────
async function cekAktivitasTerlalulama(
  idPegawai: string,
  hariAktif: HariKerja[],
): Promise<void> {
  if (!isHariAktif(hariAktif)) return;

  const tanggal = getTodayWIBAutomasi();
  let aktifList: any[] = [];
  try {
    const res = await sendRequest('/Tupoksi/ambilDataAktivitas', {
      id_pegawai: idPegawai,
      tgl_mulai: tanggal,
      tgl_akhir: tanggal,
    });
    if (res?.success && Array.isArray(res.data)) {
      aktifList = res.data.filter((x: any) =>
        (x.status === 'BELUM DIAKHIRI' || x.status === 'Proses' ||
         x.tgl_selesai === null || x.tgl_selesai === undefined || x.tgl_selesai === '') &&
        x.tgl_mulai,
      );
    }
  } catch { return; }

  for (const task of aktifList) {
    const tglMulai = (task.tgl_mulai as string).trim().replace(' ', 'T');
    const mulaiMs = new Date(tglMulai).getTime();
    if (isNaN(mulaiMs)) continue;

    const durMs = Date.now() - mulaiMs;
    const durJam = durMs / (1000 * 60 * 60);
    if (durJam < DURASI_MAKS_JAM) continue;

    const jamPenuh = Math.floor(durJam);
    const taskId = task.id || task.id_log || task.id_aktifitas || '';
    if (!taskId) continue;

    const kunci = `aktivitas_lama_${taskId}_${jamPenuh}j`;
    const sudahKirim = await bacaState(kunci).catch(() => null);
    if (sudahKirim === 'ya') continue;

    const namaTask = task.tugas || task.nama_tugas || task.nama_tupoksi || 'Aktivitas';
    const jamStr = `${jamPenuh} jam ${Math.floor((durJam - jamPenuh) * 60)} menit`;

    await kirimNotifikasiNative(
      '⏰ Aktivitas Sudah Berjalan Lama',
      `"${namaTask}" sudah berjalan ${jamStr}. Jangan lupa akhiri aktivitas jika sudah selesai.`,
    );
    await tulisState(kunci, 'ya').catch(() => {/* abaikan */});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook utama
// ─────────────────────────────────────────────────────────────────────────────
export interface UsePengingatProduktivitasOptions {
  aktif: boolean;
  idPegawai: string | null;
  jamBatas?: string;
  hariAktif?: HariKerja[];
}

export function usePengingatProduktivitas({
  aktif,
  idPegawai,
  jamBatas = JAM_BATAS_DEFAULT,
  hariAktif = HARI_AKTIF_DEFAULT,
}: UsePengingatProduktivitasOptions): void {
  const idPegawaiRef  = useRef(idPegawai);
  idPegawaiRef.current = idPegawai;
  const jamBatasRef   = useRef(jamBatas);
  jamBatasRef.current  = jamBatas;
  const hariAktifRef  = useRef(hariAktif);
  hariAktifRef.current = hariAktif;

  useEffect(() => {
    if (!aktif || !idPegawai) return;

    let running = false;

    const cek = async () => {
      if (running || !idPegawaiRef.current) return;
      running = true;
      try {
        await Promise.all([
          cekPengingatProduktivitas(idPegawaiRef.current, jamBatasRef.current, hariAktifRef.current),
          cekAktivitasTerlalulama(idPegawaiRef.current, hariAktifRef.current),
        ]);
      } catch (e) {
        console.error('[PengingatProduktivitas] Error:', e);
      } finally {
        running = false;
      }
    };

    cek();
    const intervalId = setInterval(cek, INTERVAL_MS);
    const onVisibility = () => { if (document.visibilityState === 'visible') cek(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktif]);
}
