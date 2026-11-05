// ─────────────────────────────────────────────────────────────────────────────
// useAutomasiScheduler — polling 30 detik, cek preset, submit presensi otomatis.
//
// Cara kerja:
//   1. startAndroidForegroundService() saat aktif → WebView tidak dibunuh OS.
//   2. Setiap 30 detik (+ saat app kembali foreground) cek semua preset:
//      • hari ini aktif? waktu dalam rentang? belum dieksekusi hari ini?
//   3. Ambil foto berikutnya dari antrian round-robin shuffled per-preset.
//      – Semua foto dipakai sekali sebelum ada yang diulang.
//      – Saat antrian habis, dibuat shuffle baru dari stockFotoIds.
//   4. Build payload identik dengan submitAbsen di Presensi.tsx → sendRequest.
//   5. Tulis LogEksekusi ke IndexedDB, kirim notifikasi native.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { sendRequest } from '../api';
import {
  PresetAutomasi,
  LogEksekusi,
  bacaStockFotoById,
  tulisLog,
  sudahDieksekusiHariIni,
  dalamRentangWaktu,
  hariIniAktif,
  getNowWIBTime,
  getTodayWIBAutomasi,
  ambilFotoBerikutnya,
} from '../lib/presetAutomasi';
import {
  startAndroidForegroundService,
  stopAndroidForegroundService,
  kirimNotifikasiNative,
  requestAndroidNotificationPermission,
  readAndroidWorkerLog,
} from '../lib/androidAutomasiBridge';

const INTERVAL_MS = 30_000;

interface PresensiConfig {
  idPegawai: string;
  deviceId: string;
  latitude: string;
  longitude: string;
  idLokasi: string;
  kodeInstansi: string;
  kodeUnor: string;
  workMode: string;
  versi: string;
}

interface PegawaiData {
  nip?: string;
  nama?: string;
  badgenumber?: string;
  emei?: string;
  imei?: string;
  device_id?: string;
  sim_serial?: string;
}

interface AutomasiContext {
  username: string;
  config: PresensiConfig;
  pegawai: PegawaiData;
}

interface UseAutomasiSchedulerOptions {
  presets: PresetAutomasi[];
  aktif: boolean;
  ctx: AutomasiContext | null;
  onEksekusi?: (preset: PresetAutomasi, berhasil: boolean, pesan: string) => void;
}

async function eksekusiPreset(
  preset: PresetAutomasi,
  ctx: AutomasiContext,
  tanggal: string,
): Promise<{ berhasil: boolean; pesan: string; fotoDipilih: string }> {
  // Ambil foto berikutnya dari antrian round-robin (dijamin tidak repeat sampai semua terpakai)
  const fotoId = await ambilFotoBerikutnya(preset.id, preset.stockFotoIds);
  if (!fotoId) {
    return { berhasil: false, pesan: 'Tidak ada stock foto pada preset ini.', fotoDipilih: '' };
  }

  const foto = await bacaStockFotoById(fotoId);
  if (!foto) {
    return { berhasil: false, pesan: `Stock foto ID "${fotoId}" tidak ditemukan.`, fotoDipilih: fotoId };
  }

  // Ekstrak base64 tanpa prefix
  const comma = foto.dataUrl.indexOf(',');
  const lampiran = comma >= 0 ? foto.dataUrl.slice(comma + 1) : foto.dataUrl;
  if (!lampiran) {
    return { berhasil: false, pesan: 'Data foto tidak valid.', fotoDipilih: fotoId };
  }

  const { config, pegawai } = ctx;
  const deviceId = pegawai.emei || pegawai.imei || pegawai.device_id || pegawai.sim_serial || config.deviceId;

  const payload = {
    tanggal,
    keterangan: 'Presensi Reguler',
    lampiran,
    sim_serial: deviceId,
    lattitude: config.latitude,  // NOTE: typo intentional — sesuai API server
    longitude: config.longitude,
    imei: deviceId,
    kode_instansi: config.kodeInstansi,
    kode_unor: config.kodeUnor,
    id_lokasi: config.idLokasi,
    work_mode: config.workMode,
    id_pegawai: config.idPegawai,
    nip: pegawai.nip || '',
    bedgenumber: (pegawai as any).badgenumber || deviceId,  // NOTE: typo intentional
    versi: config.versi,
  };

  try {
    const data = await sendRequest('/login/absen_mobile', payload);
    if (data?.success) {
      return { berhasil: true, pesan: data.message || 'Berhasil', fotoDipilih: fotoId };
    }
    return { berhasil: false, pesan: data?.message || 'Server menolak presensi.', fotoDipilih: fotoId };
  } catch (err: any) {
    return { berhasil: false, pesan: err?.message || 'Koneksi gagal.', fotoDipilih: fotoId };
  }
}

/**
 * Sinkronkan log eksekusi dari Android native worker (SharedPreferences) ke IndexedDB.
 *
 * Saat app di-kill, JadhumanKeepaliveWorker (Kotlin) mengeksekusi presensi dan
 * menulis log ke SharedPreferences-nya sendiri ("jadhuman_worker_log"). Log itu
 * TIDAK terlihat oleh IndexedDB (yang dibaca oleh sudahDieksekusiHariIni).
 * Akibatnya, saat app dibuka kembali, scheduler WebView mengira belum ada
 * presensi hari ini → presensi dieksekusi ulang (double absen).
 *
 * Fungsi ini menyalin entri log worker hari ini ke IndexedDB sehingga
 * sudahDieksekusiHariIni mengembalikan true dan scheduler melewatkan preset
 * yang sudah dieksekusi worker native. tulisLog bersifat idempoten (dedup
 * per presetId+tanggal), jadi aman dipanggil berulang.
 *
 * Log native TIDAK dihapus — ia tetap dipakai worker sebagai store deduplikasi
 * sendiri (sudahEksekusiHariIni di sisi Kotlin).
 */
async function sinkronkanLogWorkerKeIndexedDB(username: string): Promise<void> {
  const workerLogs = readAndroidWorkerLog();
  if (!workerLogs.length) return;

  const tanggalHariIni = getTodayWIBAutomasi();

  for (const entry of workerLogs) {
    // Hanya proses entri hari ini — entri tanggal lain tidak relevan untuk
    // deduplikasi scheduler dan sudah ada di log IndexedDB masing-masing.
    if (entry.tanggal !== tanggalHariIni) continue;

    const log: LogEksekusi = {
      presetId: entry.presetId,
      tanggal: entry.tanggal,
      fotoDipilih: '',  // worker native tidak mencatat ID foto yang dipakai
      eksekusiPada: entry.eksekusiPada,
      berhasil: entry.berhasil,
      pesan: entry.pesan,
    };
    await tulisLog(username, entry.tanggal, log);
  }
}

async function cekDanEksekusiSemua(
  presets: PresetAutomasi[],
  ctx: AutomasiContext,
  onEksekusi?: UseAutomasiSchedulerOptions['onEksekusi'],
): Promise<void> {
  if (!presets.length) return;

  // Sinkronkan log dari worker native ke IndexedDB SEBELUM cek deduplikasi.
  // Mencegah presensi dieksekusi ulang saat app dibuka setelah worker native
  // sudah berhasil mengeksekusi di latar belakang (fix double absen).
  await sinkronkanLogWorkerKeIndexedDB(ctx.username);

  const jamSekarang = getNowWIBTime();
  const tanggal = getTodayWIBAutomasi();
  const hariSekarang = new Date().getDay();

  for (const preset of presets) {
    if (!preset.aktif) continue;
    if (!hariIniAktif(preset.hariAktif, hariSekarang)) continue;
    if (!dalamRentangWaktu(preset.jamMulai, preset.jamSelesai, jamSekarang)) continue;
    if (await sudahDieksekusiHariIni(ctx.username, preset.id, tanggal)) continue;

    const { berhasil, pesan, fotoDipilih } = await eksekusiPreset(preset, ctx, tanggal);

    const log: LogEksekusi = {
      presetId: preset.id,
      tanggal,
      fotoDipilih,
      eksekusiPada: Date.now(),
      berhasil,
      pesan,
    };
    await tulisLog(ctx.username, tanggal, log);

    if (berhasil) {
      await kirimNotifikasiNative(
        '✅ Presensi Otomatis Berhasil',
        `${preset.nama} — ${pesan}`,
      );
    } else {
      await kirimNotifikasiNative(
        '⚠️ Presensi Otomatis Gagal',
        `${preset.nama} — ${pesan}`,
      );
    }

    onEksekusi?.(preset, berhasil, pesan);
  }
}

export function useAutomasiScheduler({
  presets,
  aktif,
  ctx,
  onEksekusi,
}: UseAutomasiSchedulerOptions): void {
  const presetsRef = useRef(presets);
  presetsRef.current = presets;

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const onEksekusiRef = useRef(onEksekusi);
  onEksekusiRef.current = onEksekusi;

  useEffect(() => {
    if (!aktif || !ctx) return;

    let running = false;

    const eksekusi = async () => {
      if (running || !ctxRef.current) return;
      running = true;
      try {
        await cekDanEksekusiSemua(presetsRef.current, ctxRef.current, onEksekusiRef.current);
      } catch (e) {
        console.error('[AutomasiScheduler] Eksekusi error:', e);
      } finally {
        running = false;
      }
    };

    startAndroidForegroundService(
      'JADHUMAN Presensi Otomatis',
      'Penjadwal presensi aktif memantau jadwal harian',
    );

    requestAndroidNotificationPermission();

    // Jalankan langsung satu kali
    eksekusi();

    const intervalId = setInterval(eksekusi, INTERVAL_MS);

    // Re-cek saat app kembali ke foreground
    const onVisibility = () => {
      if (document.visibilityState === 'visible') eksekusi();
    };
    // Re-cek dari background tick yang dikirim ForegroundService Kotlin (30s sekali)
    const onBackgroundTick = () => { eksekusi(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('jadhuman-background-tick', onBackgroundTick);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('jadhuman-background-tick', onBackgroundTick);
      stopAndroidForegroundService();
    };
    // ctx hanya dibaca lewat ref — intentionally excluded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktif]);
}
