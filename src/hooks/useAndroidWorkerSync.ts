/**
 * useAndroidWorkerSync — auto-sync session dan preset ke Android SharedPreferences.
 *
 * Data yang di-sync dipakai JadhumanKeepaliveWorker untuk eksekusi presensi
 * langsung dari Kotlin ketika app di-swipe dari Recent Apps (WebView sudah mati).
 *
 * Sync dilakukan:
 *   • Saat komponen mount (jika sudah login)
 *   • Setiap 60 detik (untuk update lokasi/config yang mungkin berubah)
 *   • Saat event 'jadhuman-preset-updated' diterima
 */

import { useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import {
  bacaSemuaPreset,
} from '../lib/presetAutomasi';
import {
  isAndroidJadhuman,
  syncSessionToAndroid,
  syncPresetsToAndroid,
  type SessionSyncData,
  type PresetSyncData,
} from '../lib/androidNativeBridge';

const ABSENSI_ENDPOINT = 'http://103.109.206.102:8089/Ponorogo-absensApi/index.php/login/absen_mobile';

export function useAndroidWorkerSync(): void {
  const { currentUser, config, pegawai } = useAppContext();
  const username = currentUser?.username ?? '';
  const lastSyncRef = useRef<string>('');

  useEffect(() => {
    if (!isAndroidJadhuman() || !username) return;

    let cancelled = false;

    async function doSync() {
      if (cancelled) return;

      try {
        // 1. Sync session (kredensial server presensi)
        const deviceId = (pegawai as any)?.emei
          || (pegawai as any)?.imei
          || (pegawai as any)?.device_id
          || config.deviceId
          || '';

        const session: SessionSyncData = {
          idPegawai:    config.idPegawai    || '',
          deviceId,
          latitude:     config.latitude     || '',
          longitude:    config.longitude    || '',
          idLokasi:     config.idLokasi     || '',
          kodeInstansi: config.kodeInstansi || '',
          kodeUnor:     config.kodeUnor     || '',
          workMode:     config.workMode     || '1',
          versi:        config.versi        || '2.0.0',
          baseUrl:      ABSENSI_ENDPOINT,
        };

        // Jangan sync jika belum ada idPegawai (belum login ke server)
        if (!session.idPegawai) return;

        syncSessionToAndroid(session);

        // 2. Baca preset aktif
        const semuaPreset = await bacaSemuaPreset(username);
        if (cancelled) return;

        const aktif = semuaPreset.filter(p => p.aktif);

        const syncData: PresetSyncData[] = aktif.map(p => ({
          id:        p.id,
          nama:      p.nama,
          tipe:      p.tipe,
          jamMulai:  p.jamMulai,
          jamSelesai: p.jamSelesai,
          hariAktif: p.hariAktif as number[],
          aktif:     p.aktif,
        }));

        // Cek apakah data berubah sebelum sync (hindari SharedPreferences write berlebihan)
        const hash = JSON.stringify(syncData) + session.idPegawai + session.latitude + session.longitude;
        if (hash === lastSyncRef.current) return;
        lastSyncRef.current = hash;

        syncPresetsToAndroid(syncData);
      } catch (e) {
        console.warn('[AndroidWorkerSync] Gagal sync:', e);
      }
    }

    void doSync();

    const interval = setInterval(() => { void doSync(); }, 60_000);

    const onPresetUpdated = () => { void doSync(); };
    window.addEventListener('jadhuman-preset-updated', onPresetUpdated);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('jadhuman-preset-updated', onPresetUpdated);
    };
  }, [username, config.idPegawai, config.latitude, config.longitude]);
}
