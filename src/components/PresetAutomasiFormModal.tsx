// ─────────────────────────────────────────────────────────────────────────────
// PresetAutomasiFormModal — form tambah / edit preset automasi.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Clock, Calendar, Image as ImageIcon, Save, AlertTriangle } from 'lucide-react';
import { PresetAutomasi, StockFoto, HariKerja, NAMA_HARI, URUTAN_HARI, MAX_STOCK_FOTO } from '../lib/presetAutomasi';
import StockFotoManager from './ui/StockFotoManager';
import { useBackButton } from '../hooks/useBackButton';

interface PresetAutomasiFormModalProps {
  open: boolean;
  preset: PresetAutomasi | null;
  stockFotos: StockFoto[];
  onSimpan: (data: Omit<PresetAutomasi, 'id' | 'dibuatPada' | 'diperbarui'>) => Promise<void>;
  onTambahFoto: (data: Omit<StockFoto, 'id' | 'dibuatPada'>) => Promise<StockFoto | null>;
  onHapusFoto: (id: string) => Promise<void>;
  onClose: () => void;
}

export default function PresetAutomasiFormModal({
  open,
  preset,
  stockFotos,
  onSimpan,
  onTambahFoto,
  onHapusFoto,
  onClose,
}: PresetAutomasiFormModalProps) {
  const [nama,         setNama]         = useState('');
  const [tipe,         setTipe]         = useState<'masuk' | 'pulang'>('masuk');
  const [jamMulai,     setJamMulai]     = useState('07:00');
  const [jamSelesai,   setJamSelesai]   = useState('09:00');
  const [hariAktif,    setHariAktif]    = useState<HariKerja[]>([1, 2, 3, 4, 5]);
  const [stockFotoIds, setStockFotoIds] = useState<string[]>([]);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [tab,          setTab]          = useState<'umum' | 'foto'>('umum');

  // Ref ke panel modal sendiri — klik di luar panel (di backdrop) menutup modal.
  // Kita pakai ref + onMouseDown agar tidak konflik dengan label htmlFor di dalam modal.
  const panelRef = useRef<HTMLDivElement>(null);

  useBackButton(() => { onClose(); return true; }, open);

  // Kunci scroll body saat modal terbuka
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Reset form saat open/preset berubah
  useEffect(() => {
    if (!open) return;
    if (preset) {
      setNama(preset.nama);
      setTipe(preset.tipe);
      setJamMulai(preset.jamMulai);
      setJamSelesai(preset.jamSelesai);
      setHariAktif([...preset.hariAktif]);
      setStockFotoIds([...preset.stockFotoIds]);
    } else {
      setNama('');
      setTipe('masuk');
      setJamMulai('07:00');
      setJamSelesai('09:00');
      setHariAktif([1, 2, 3, 4, 5]);
      setStockFotoIds([]);
    }
    setError(null);
    setTab('umum');
  }, [preset, open]);

  const toggleHari = (hari: HariKerja) => {
    setHariAktif(prev => prev.includes(hari) ? prev.filter(h => h !== hari) : [...prev, hari]);
  };

  const handleSimpan = async () => {
    setError(null);
    if (!nama.trim())           { setError('Nama preset tidak boleh kosong.'); setTab('umum');  return; }
    if (hariAktif.length === 0) { setError('Pilih minimal 1 hari aktif.');     setTab('umum');  return; }
    if (stockFotoIds.length === 0) { setError('Pilih minimal 1 foto untuk preset ini.'); setTab('foto'); return; }
    setSaving(true);
    try {
      await onSimpan({
        nama: nama.trim().slice(0, 80), tipe,
        jamMulai, jamSelesai, hariAktif, stockFotoIds,
        aktif: preset?.aktif ?? true,
      });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Gagal menyimpan preset.');
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = stockFotoIds.filter(id => stockFotos.some(f => f.id === id)).length;

  // Tutup modal hanya jika klik tepat di backdrop (bukan di dalam panel)
  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          // onMouseDown bukan onClick — agar tidak konflik dengan label file input
          onMouseDown={handleBackdropMouseDown}
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/60 backdrop-blur-sm"
        >
          <motion.div
            ref={panelRef}
            initial={{ y: 32, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 32, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 32 }}
            // PENTING: onMouseDown stopPropagation agar klik di dalam panel
            // tidak menutup modal (termasuk klik label file input)
            onMouseDown={e => e.stopPropagation()}
            className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col"
            style={{ maxHeight: 'min(90svh, 680px)' }}
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {preset ? 'Edit Preset' : 'Preset Baru'}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Automasi Presensi Terjadwal</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors text-slate-400"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* ── Tabs ── */}
            <div className="flex gap-1.5 px-5 pt-3 pb-0 shrink-0">
              {(['umum', 'foto'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    tab === t
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {t === 'umum'
                    ? <><Calendar className="w-3.5 h-3.5" />Jadwal</>
                    : <><ImageIcon className="w-3.5 h-3.5" />Foto ({selectedCount})</>
                  }
                </button>
              ))}
            </div>

            {/* ── Body — SATU scrollable area ── */}
            {/* overflow-y-auto HANYA di sini — tidak ada nested scroll */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-3">

              {error && (
                <div className="flex items-start gap-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 rounded-xl p-3 border border-rose-200 dark:border-rose-500/20">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* ── Tab Jadwal ── */}
              {tab === 'umum' && (
                <div className="space-y-3">
                  {/* Card Nama + Tipe */}
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">
                        Nama Preset
                      </label>
                      <input
                        type="text"
                        value={nama}
                        onChange={e => setNama(e.target.value.slice(0, 80))}
                        placeholder="mis. Senin Masuk, Jumat Pulang…"
                        maxLength={80}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-slate-100 placeholder-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">
                        Tipe Presensi
                      </label>
                      <div className="flex gap-2">
                        {(['masuk', 'pulang'] as const).map(t => (
                          <button
                            key={t} type="button" onClick={() => setTipe(t)}
                            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border ${
                              tipe === t
                                ? t === 'masuk'
                                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                  : 'bg-violet-600 text-white border-violet-600 shadow-sm'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {t === 'masuk' ? 'Masuk' : 'Pulang'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Card Rentang Waktu */}
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 mb-3">
                      <Clock className="w-3.5 h-3.5" /> Rentang Waktu Eksekusi (WIB)
                    </p>
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <p className="text-[10px] text-slate-400 mb-1">Mulai</p>
                        <input type="time" value={jamMulai} onChange={e => setJamMulai(e.target.value)}
                          className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-slate-100" />
                      </div>
                      <div className="text-slate-400 text-sm pb-2.5">–</div>
                      <div className="flex-1">
                        <p className="text-[10px] text-slate-400 mb-1">Selesai</p>
                        <input type="time" value={jamSelesai} onChange={e => setJamSelesai(e.target.value)}
                          className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-slate-100" />
                      </div>
                    </div>
                  </div>

                  {/* Card Hari Aktif */}
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 mb-3">
                      <Calendar className="w-3.5 h-3.5" /> Hari Aktif
                    </p>
                    <div className="flex gap-1.5 flex-wrap">
                      {URUTAN_HARI.map(hari => {
                        const active = hariAktif.includes(hari);
                        return (
                          <button
                            key={hari} type="button" onClick={() => toggleHari(hari)}
                            className={`w-10 h-10 rounded-xl text-xs font-bold transition-all border ${
                              active
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {NAMA_HARI[hari]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Tab Foto ── */}
              {tab === 'foto' && (
                /* Tidak ada overflow di sini — biarkan scroll dari parent */
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-4">
                  <StockFotoManager
                    fotos={stockFotos}
                    selectedIds={stockFotoIds}
                    onSelect={setStockFotoIds}
                    onTambah={onTambahFoto}
                    onHapus={onHapusFoto}
                    maxSelect={MAX_STOCK_FOTO}
                  />
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="px-5 pb-5 pt-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSimpan}
                  disabled={saving}
                  className="py-3 rounded-xl bg-blue-600 text-xs font-bold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
                >
                  {saving
                    ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />Menyimpan…</>
                    : <><Save className="w-3.5 h-3.5" />Simpan</>
                  }
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
