// ─────────────────────────────────────────────────────────────────────────────
// GlobalAutomasiScheduler — dipasang di level AppShell agar berjalan di semua tab.
// Tidak merender apapun. Cukup panggil useAutomasiScheduler + usePengingatProduktivitas.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { bacaSemuaPreset, getPenjadwalAktif, setPenjadwalAktif, HariKerja, PresetAutomasi } from '../lib/presetAutomasi';
import { useAutomasiScheduler } from '../hooks/useAutomasiScheduler';
import { usePengingatProduktivitas } from '../hooks/usePengingatProduktivitas';
import { useAndroidWorkerSync } from '../hooks/useAndroidWorkerSync';
import { appStorage } from '../lib/appStorage';

// ─── Kunci IndexedDB (via appStorage) ─────────────────────────────────────────
const KEY_PENGINGAT_AKTIF = 'pengingat_produktivitas_aktif';
const KEY_JAM_BATAS       = 'pengingat_jam_batas';
const KEY_HARI_AKTIF      = 'pengingat_hari_aktif';

const HARI_DEFAULT: HariKerja[] = [1, 2, 3, 4, 5]; // Senin–Jumat

// Semua getter/setter pakai appStorage (IndexedDB + in-memory, bukan localStorage)
export function getPengingatAktif(): boolean {
  return appStorage.getItem(KEY_PENGINGAT_AKTIF) !== 'false';
}
export function setPengingatAktifStorage(v: boolean): void {
  appStorage.setItem(KEY_PENGINGAT_AKTIF, v ? 'true' : 'false');
}
export function getJamBatas(): string {
  return appStorage.getItem(KEY_JAM_BATAS) ?? '08:30';
}
export function setJamBatasStorage(v: string): void {
  appStorage.setItem(KEY_JAM_BATAS, v);
}
export function getHariAktifPengingat(): HariKerja[] {
  const raw = appStorage.getItem(KEY_HARI_AKTIF);
  if (!raw) return HARI_DEFAULT;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as HariKerja[];
  } catch {/* */}
  return HARI_DEFAULT;
}
export function setHariAktifPengingatStorage(v: HariKerja[]): void {
  appStorage.setItem(KEY_HARI_AKTIF, JSON.stringify(v));
}

// ─────────────────────────────────────────────────────────────────────────────
export default function GlobalAutomasiScheduler() {
  const { pegawai, config, currentUser } = useAppContext();
  const username = currentUser?.username ?? null;

  // Baca nilai awal dari appStorage (sudah di-load ke memory saat app init)
  const [penjadwalAktif, setPenjadwalAktifState] = useState<boolean>(() => getPenjadwalAktif());
  const [pengingatAktif, setPengingatAktifState] = useState<boolean>(() => getPengingatAktif());
  const [jamBatas,       setJamBatasState]        = useState<string>(() => getJamBatas());
  const [hariAktif,      setHariAktifState]       = useState<HariKerja[]>(() => getHariAktifPengingat());
  const [presets,        setPresets]              = useState<PresetAutomasi[]>([]);
  const [ready,          setReady]                = useState(false);

  // Muat presets dari IndexedDB
  const muatPresets = async (user: string) => {
    try {
      const p = await bacaSemuaPreset(user);
      setPresets(p);
    } catch {
      setPresets([]);
    } finally {
      setReady(true);
    }
  };

  useEffect(() => {
    if (username) { setReady(false); muatPresets(username); }
    else { setPresets([]); setReady(false); }
  }, [username]);

  // Re-load saat ada perubahan preset
  useEffect(() => {
    const handler = () => { if (username) muatPresets(username); };
    window.addEventListener('jadhuman-preset-updated', handler);
    return () => window.removeEventListener('jadhuman-preset-updated', handler);
  }, [username]);

  // Listen toggle penjadwal presensi dari halaman Automasi
  useEffect(() => {
    const handler = (e: Event) => {
      const aktif = (e as CustomEvent<{ aktif: boolean }>).detail.aktif;
      setPenjadwalAktifState(aktif);
      setPenjadwalAktif(aktif); // juga persist via presetAutomasi.ts → appStorage
    };
    window.addEventListener('jadhuman-scheduler-toggle', handler);
    return () => window.removeEventListener('jadhuman-scheduler-toggle', handler);
  }, []);

  // Listen perubahan pengingat produktivitas dari halaman Automasi
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{
        aktif?: boolean;
        jamBatas?: string;
        hariAktif?: HariKerja[];
      }>).detail;
      if (d.aktif     !== undefined) { setPengingatAktifState(d.aktif);   setPengingatAktifStorage(d.aktif); }
      if (d.jamBatas  !== undefined) { setJamBatasState(d.jamBatas);       setJamBatasStorage(d.jamBatas); }
      if (d.hariAktif !== undefined) { setHariAktifState(d.hariAktif);    setHariAktifPengingatStorage(d.hariAktif); }
    };
    window.addEventListener('jadhuman-pengingat-update', handler);
    return () => window.removeEventListener('jadhuman-pengingat-update', handler);
  }, []);

  const schedulerCtx = (pegawai && config && username)
    ? { username, config, pegawai: pegawai as any }
    : null;

  useAutomasiScheduler({
    presets,
    aktif: penjadwalAktif && ready && !!schedulerCtx,
    ctx: schedulerCtx,
  });

  usePengingatProduktivitas({
    aktif:     pengingatAktif && !!config?.idPegawai,
    idPegawai: config?.idPegawai || null,
    jamBatas,
    hariAktif,
  });

  // Sync session & preset ke Android SharedPreferences agar KeepaliveWorker bisa
  // eksekusi presensi langsung dari Kotlin saat app di-swipe dari Recent Apps.
  useAndroidWorkerSync();

  // Tidak render UI
  return null;
}
