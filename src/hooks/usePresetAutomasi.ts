// ─────────────────────────────────────────────────────────────────────────────
// usePresetAutomasi — CRUD wrapper dengan React state, per akun.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import {
  PresetAutomasi,
  StockFoto,
  bacaSemuaPreset,
  tambahPreset,
  perbaruiPreset,
  hapusPreset,
  toggleAktifPreset,
  bacaSemuaStockFoto,
  tambahStockFoto,
  hapusStockFoto,
  notifyPresetUpdated,
  MAX_STOCK_FOTO,
  resetAntrianFoto,
} from '../lib/presetAutomasi';

interface UsePresetAutomasiReturn {
  presets: PresetAutomasi[];
  stockFotos: StockFoto[];
  loading: boolean;
  error: string | null;
  muat: () => Promise<void>;
  muatFoto: () => Promise<void>;
  tambah: (data: Omit<PresetAutomasi, 'id' | 'dibuatPada' | 'diperbarui'>) => Promise<void>;
  perbarui: (id: string, data: Partial<Omit<PresetAutomasi, 'id' | 'dibuatPada'>>) => Promise<void>;
  hapus: (id: string) => Promise<void>;
  toggleAktif: (id: string) => Promise<void>;
  tambahFoto: (data: Omit<StockFoto, 'id' | 'dibuatPada'>) => Promise<StockFoto | null>;
  hapusFoto: (id: string) => Promise<void>;
  canAddFoto: boolean;
}

export function usePresetAutomasi(username: string | null): UsePresetAutomasiReturn {
  const [presets, setPresets] = useState<PresetAutomasi[]>([]);
  const [stockFotos, setStockFotos] = useState<StockFoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const muat = useCallback(async () => {
    if (!username) { setPresets([]); return; }
    setLoading(true);
    setError(null);
    try {
      const [p, f] = await Promise.all([
        bacaSemuaPreset(username),
        bacaSemuaStockFoto(),
      ]);
      setPresets(p);
      setStockFotos(f);
    } catch (e: any) {
      setError(e?.message || 'Gagal memuat data automasi.');
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => { muat(); }, [muat]);

  // Re-load ketika preset diperbarui dari luar (mis. GlobalAutomasiScheduler reload)
  useEffect(() => {
    const handler = () => muat();
    window.addEventListener('jadhuman-preset-updated', handler);
    return () => window.removeEventListener('jadhuman-preset-updated', handler);
  }, [muat]);

  const tambah = useCallback(async (data: Omit<PresetAutomasi, 'id' | 'dibuatPada' | 'diperbarui'>) => {
    if (!username) return;
    await tambahPreset(username, data);
    await muat();
    notifyPresetUpdated();
  }, [username, muat]);

  const perbarui = useCallback(async (id: string, data: Partial<Omit<PresetAutomasi, 'id' | 'dibuatPada'>>) => {
    if (!username) return;
    await perbaruiPreset(username, id, data);
    // Jika pool foto berubah, reset antrian agar shuffle mulai dari awal dengan pool baru
    if (data.stockFotoIds !== undefined) {
      await resetAntrianFoto(id).catch(() => {/* abaikan jika store belum ada */});
    }
    await muat();
    notifyPresetUpdated();
  }, [username, muat]);

  const hapus = useCallback(async (id: string) => {
    if (!username) return;
    await hapusPreset(username, id);
    // Hapus antrian foto preset ini
    await resetAntrianFoto(id).catch(() => {/* abaikan */});
    await muat();
    notifyPresetUpdated();
  }, [username, muat]);

  const toggleAktif = useCallback(async (id: string) => {
    if (!username) return;
    await toggleAktifPreset(username, id);
    await muat();
    notifyPresetUpdated();
  }, [username, muat]);

  const muatFoto = useCallback(async () => {
    try {
      const f = await bacaSemuaStockFoto();
      setStockFotos(f);
    } catch { /* abaikan */ }
  }, []);

  const tambahFoto = useCallback(async (data: Omit<StockFoto, 'id' | 'dibuatPada'>): Promise<StockFoto | null> => {
    // Batas dicek di tambahStockFoto langsung via DB count — tidak pakai state stale
    try {
      const foto = await tambahStockFoto(data);
      // Update state langsung tanpa full reload agar batch upload tidak lambat
      setStockFotos(prev => [...prev, foto]);
      return foto;
    } catch (e: any) {
      // Re-throw agar StockFotoManager bisa tampilkan error per-foto
      throw e;
    }
  }, []);

  const hapusFoto = useCallback(async (id: string) => {
    await hapusStockFoto(id);
    setStockFotos(prev => prev.filter(f => f.id !== id));
  }, []);

  return {
    presets,
    stockFotos,
    loading,
    error,
    muat,
    muatFoto,
    tambah,
    perbarui,
    hapus,
    toggleAktif,
    tambahFoto,
    hapusFoto,
    canAddFoto: stockFotos.length < MAX_STOCK_FOTO,
  };
}
