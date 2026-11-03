// ─────────────────────────────────────────────────────────────────────────────
// Halaman Preset Automasi — daftar preset, toggle penjadwal, baterai, log.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bot, Plus, Trash2, Pencil, Power, PowerOff,
  Clock, Image as ImageIcon, AlertTriangle,
  BatteryWarning, CheckCircle2, XCircle, RefreshCw,
  ChevronDown, ChevronUp, Loader2, Bell, BellOff,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { usePresetAutomasi } from '../hooks/usePresetAutomasi';
import {
  PresetAutomasi, LogEksekusi, StockFoto,
  HariKerja, NAMA_HARI, URUTAN_HARI,
  bacaLogHarian, getTodayWIBAutomasi,
  getPenjadwalAktif, setPenjadwalAktif,
  notifySchedulerToggle, notifyPresetUpdated,
  bacaStatusAntrian,
} from '../lib/presetAutomasi';
import {
  isAndroid,
  isIgnoringBatteryOptimizations,
  requestBatteryOptimizationExemption,
} from '../lib/androidAutomasiBridge';
import {
  getPengingatAktif, setPengingatAktifStorage,
  getJamBatas, setJamBatasStorage,
  getHariAktifPengingat, setHariAktifPengingatStorage,
} from '../components/GlobalAutomasiScheduler';
import PresetAutomasiFormModal from '../components/PresetAutomasiFormModal';
import StockFotoManager from '../components/ui/StockFotoManager';

// ─── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ value, onChange, color = 'blue' }: {
  value: boolean; onChange: (v: boolean) => void; color?: 'blue' | 'amber';
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800 ${
        value
          ? color === 'blue' ? 'bg-blue-600 focus-visible:ring-blue-500' : 'bg-amber-500 focus-visible:ring-amber-500'
          : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ${value ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

// ─── KartuPreset ──────────────────────────────────────────────────────────────
function KartuPreset({ preset, stockFotos, username, onEdit, onHapus, onToggle }: {
  preset: PresetAutomasi; stockFotos: StockFoto[]; username: string;
  onEdit: () => void; onHapus: () => void; onToggle: () => void;
}) {
  const [logHariIni, setLogHariIni] = useState<LogEksekusi | null>(null);
  const [expandLog, setExpandLog] = useState(false);
  const [statusAntrian, setStatusAntrian] = useState<{ terpakai: number; sisa: number; total: number } | null>(null);

  useEffect(() => {
    let mounted = true;
    const tanggal = getTodayWIBAutomasi();
    bacaLogHarian(username, tanggal).catch(() => [] as LogEksekusi[]).then(logs => {
      if (mounted) setLogHariIni(logs.find(l => l.presetId === preset.id) ?? null);
    });
    bacaStatusAntrian(preset.id, preset.stockFotoIds).catch(() => null).then(s => {
      if (mounted) setStatusAntrian(s);
    });
    return () => { mounted = false; };
  }, [preset.id, preset.stockFotoIds, username]);

  const fotoCount = preset.stockFotoIds.filter(id => stockFotos.some(f => f.id === id)).length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={`bg-white dark:bg-slate-800 rounded-2xl border shadow-sm transition-all ${
        preset.aktif
          ? 'border-blue-200 dark:border-blue-800/50'
          : 'border-slate-200 dark:border-slate-700/60 opacity-70'
      }`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{preset.nama}</h3>
              <span className={`shrink-0 text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                preset.tipe === 'masuk'
                  ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'bg-violet-100 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400'
              }`}>
                {preset.tipe === 'masuk' ? 'Masuk' : 'Pulang'}
              </span>
              <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                preset.aktif
                  ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
              }`}>
                {preset.aktif ? 'Aktif' : 'Nonaktif'}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Clock className="w-3.5 h-3.5" />{preset.jamMulai} – {preset.jamSelesai}
              </span>
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <ImageIcon className="w-3.5 h-3.5" />{fotoCount} foto
              </span>
            </div>
            {statusAntrian && statusAntrian.total > 0 && (
              <div className="mt-2">
                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                  Giliran foto: {statusAntrian.terpakai}/{statusAntrian.total}
                  {statusAntrian.sisa === 0 ? ' — rotate dari awal' : ` · ${statusAntrian.sisa} tersisa`}
                </span>
                <div className="h-1 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mt-1">
                  <div className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${(statusAntrian.terpakai / statusAntrian.total) * 100}%` }} />
                </div>
              </div>
            )}
            <div className="flex gap-1 mt-2 flex-wrap">
              {URUTAN_HARI.map(hari => (
                <span key={hari} className={`text-[10px] font-bold w-7 h-5 flex items-center justify-center rounded-md ${
                  preset.hariAktif.includes(hari)
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-700/60 text-slate-400 dark:text-slate-500'
                }`}>{NAMA_HARI[hari]}</span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <button type="button" onClick={onToggle} title={preset.aktif ? 'Nonaktifkan' : 'Aktifkan'}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all active:scale-95 ${
                preset.aktif
                  ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
              }`}>
              {preset.aktif ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
            </button>
            <button type="button" onClick={onEdit}
              className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center transition-all active:scale-95">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={onHapus}
              className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-500 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 flex items-center justify-center transition-all active:scale-95">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {logHariIni && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60">
            <button type="button" onClick={() => setExpandLog(v => !v)}
              className={`w-full flex items-center justify-between text-xs rounded-lg px-2.5 py-1.5 transition-colors ${
                logHariIni.berhasil
                  ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
                  : 'text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10'
              }`}>
              <span className="flex items-center gap-1.5 font-bold">
                {logHariIni.berhasil ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {logHariIni.berhasil ? 'Berhasil hari ini' : 'Gagal hari ini'}
              </span>
              {expandLog ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {expandLog && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 px-1">
                {new Date(logHariIni.eksekusiPada).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB
                {logHariIni.pesan ? ` — ${logHariIni.pesan}` : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Halaman Utama ─────────────────────────────────────────────────────────────
export default function Automasi() {
  const { currentUser } = useAppContext();
  const username = currentUser?.username ?? null;

  const { presets, stockFotos, loading, error, muat, tambah, perbarui, hapus, toggleAktif, tambahFoto, hapusFoto } = usePresetAutomasi(username);

  const [penjadwalAktif, setPenjadwalAktifState]           = useState(() => getPenjadwalAktif());
  const [pengingatAktif, setPengingatAktifState]           = useState(() => getPengingatAktif());
  const [jamBatas, setJamBatasState]                       = useState(() => getJamBatas());
  const [hariAktifPengingat, setHariAktifPengingatState]   = useState<HariKerja[]>(() => getHariAktifPengingat());
  const [formOpen, setFormOpen]                            = useState(false);
  const [editPreset, setEditPreset]                        = useState<PresetAutomasi | null>(null);
  const [konfirmasiHapus, setKonfirmasiHapus]              = useState<PresetAutomasi | null>(null);
  const [batteryOk, setBatteryOk]                          = useState(true);

  useEffect(() => { if (isAndroid()) setBatteryOk(isIgnoringBatteryOptimizations()); }, []);

  const handleTogglePenjadwal = (v: boolean) => { setPenjadwalAktifState(v); setPenjadwalAktif(v); notifySchedulerToggle(v); };
  const handleTogglePengingat = (v: boolean) => {
    setPengingatAktifState(v); setPengingatAktifStorage(v);
    window.dispatchEvent(new CustomEvent('jadhuman-pengingat-update', { detail: { aktif: v } }));
  };
  const handleJamBatasChange = (v: string) => {
    setJamBatasState(v); setJamBatasStorage(v);
    window.dispatchEvent(new CustomEvent('jadhuman-pengingat-update', { detail: { jamBatas: v } }));
  };
  const handleToggleHariPengingat = (hari: HariKerja) => {
    const next: HariKerja[] = hariAktifPengingat.includes(hari)
      ? hariAktifPengingat.filter(h => h !== hari)
      : [...hariAktifPengingat, hari];
    if (next.length === 0) return;
    setHariAktifPengingatState(next); setHariAktifPengingatStorage(next);
    window.dispatchEvent(new CustomEvent('jadhuman-pengingat-update', { detail: { hariAktif: next } }));
  };

  const handleBukaForm  = (p: PresetAutomasi | null = null) => { setEditPreset(p); setFormOpen(true); };
  const handleSimpan    = async (data: Omit<PresetAutomasi, 'id' | 'dibuatPada' | 'diperbarui'>) => {
    if (editPreset) await perbarui(editPreset.id, data); else await tambah(data);
  };
  const handleHapusConfirm = async () => {
    if (!konfirmasiHapus) return;
    await hapus(konfirmasiHapus.id);
    setKonfirmasiHapus(null);
    notifyPresetUpdated();
  };

  if (!username) {
    return (
      <div className="w-full mx-auto bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700/60 text-center text-sm text-slate-500 dark:text-slate-400">
        <Bot className="w-10 h-10 mx-auto mb-3 opacity-30" />
        Login terlebih dahulu untuk menggunakan fitur automasi.
      </div>
    );
  }

  return (
    <>
      <div className="w-full mx-auto space-y-5">

        {/* ── Penjadwal ── */}
        <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700/60">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Preset Automasi</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Presensi terjadwal otomatis</p>
              </div>
            </div>
            <Toggle value={penjadwalAktif} onChange={handleTogglePenjadwal} color="blue" />
          </div>
          {isAndroid() && !batteryOk && (
            <div className="mt-4 rounded-xl px-4 py-3 text-xs flex items-start gap-2 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
              <BatteryWarning className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold">Optimasi baterai aktif</p>
                <p>Penjadwal mungkin terhenti saat layar mati. Izinkan pengecualian Doze mode agar berjalan lancar.</p>
              </div>
              <button type="button"
                onClick={() => { requestBatteryOptimizationExemption(); setTimeout(() => setBatteryOk(isIgnoringBatteryOptimizations()), 3000); }}
                className="shrink-0 px-2.5 py-1.5 rounded-lg bg-amber-600 text-white text-[10px] font-bold hover:bg-amber-700 transition-colors">
                Izinkan
              </button>
            </div>
          )}
        </div>

        {/* ── Pengingat Produktivitas ── */}
        <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700/60">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400">
                {pengingatAktif ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Pengingat Produktivitas</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Notifikasi otomatis aktivitas harian</p>
              </div>
            </div>
            <Toggle value={pengingatAktif} onChange={handleTogglePengingat} color="amber" />
          </div>

          {pengingatAktif && (
            <div className="space-y-4 mt-5">
              <div className="rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-4 space-y-3">
                <div className="flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Belum ada aktivitas produktivitas</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Notifikasi dikirim jika sudah absen masuk tapi belum ada aktivitas aktif setelah jam batas.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 shrink-0">Ingatkan mulai jam:</label>
                  <input type="time" value={jamBatas} onChange={e => handleJamBatasChange(e.target.value)}
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-800 dark:text-slate-100 font-mono" />
                  <span className="text-xs text-slate-400">WIB</span>
                </div>
                <div className="flex items-start gap-3">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 shrink-0 mt-2">Hari aktif:</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {URUTAN_HARI.map(hari => {
                      const active = hariAktifPengingat.includes(hari);
                      return (
                        <button key={hari} type="button" onClick={() => handleToggleHariPengingat(hari)}
                          className={`w-10 h-9 rounded-xl text-xs font-bold transition-all border ${
                            active
                              ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                              : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                          }`}>
                          {NAMA_HARI[hari]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="text-[10px] text-amber-700 dark:text-amber-400 bg-white/60 dark:bg-amber-900/10 rounded-xl px-2.5 py-2 border border-amber-200/50 dark:border-amber-500/10">
                  Dikirim sekali per hari. Berlaku untuk hari yang dipilih di atas.
                </p>
              </div>

              <div className="rounded-2xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 p-4">
                <div className="flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Aktivitas berjalan lama</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Pengingat otomatis setiap jam untuk aktivitas produktivitas yang masih aktif — membantu memastikan aktivitas diselesaikan atau diperbarui tepat waktu.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Daftar Preset ── */}
        <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700/60">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white text-sm">Preset ({presets.length})</h4>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Klik ikon pensil untuk edit, + untuk tambah baru</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={muat} disabled={loading}
                className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center transition-all active:scale-95">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button type="button" onClick={() => handleBukaForm(null)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-all active:scale-95 shadow-sm">
                <Plus className="w-3.5 h-3.5" /> Buat Preset
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 rounded-xl p-3 border border-rose-200 dark:border-rose-500/20 mb-4">
              <AlertTriangle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}
          {!loading && presets.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 p-10 text-center">
              <Bot className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-bold text-slate-400 dark:text-slate-500">Belum ada preset</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Buat preset untuk memulai automasi presensi.</p>
              <button type="button" onClick={() => handleBukaForm(null)}
                className="mt-4 px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-all active:scale-95">
                + Buat Preset Pertama
              </button>
            </div>
          )}
          {!loading && presets.length > 0 && (
            <div className="space-y-3">
              <AnimatePresence>
                {presets.map(p => (
                  <KartuPreset key={p.id} preset={p} stockFotos={stockFotos} username={username}
                    onEdit={() => handleBukaForm(p)} onHapus={() => setKonfirmasiHapus(p)} onToggle={() => toggleAktif(p.id)} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* ── Stock Foto Global ── */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700/60">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white text-sm">Stock Foto Global</h4>
              <p className="text-xs text-slate-400 dark:text-slate-500">{stockFotos.length}/{20} foto · dipakai bersama semua preset</p>
            </div>
          </div>
          <StockFotoManager
            fotos={stockFotos}
            onTambah={tambahFoto}
            onHapus={hapusFoto}
            readOnly={false}
          />
        </div>

      </div>

      {/* Modal Form */}
      <PresetAutomasiFormModal
        open={formOpen}
        preset={editPreset}
        stockFotos={stockFotos}
        onSimpan={handleSimpan}
        onTambahFoto={tambahFoto}
        onHapusFoto={hapusFoto}
        onClose={() => setFormOpen(false)}
      />

      {/* Konfirmasi Hapus Preset */}
      <AnimatePresence>
        {konfirmasiHapus && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-xs bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-2xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">Hapus Preset?</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[180px]">{konfirmasiHapus.nama}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Riwayat eksekusi preset ini juga akan terhapus dari log hari ini.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setKonfirmasiHapus(null)}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  Batal
                </button>
                <button type="button" onClick={handleHapusConfirm}
                  className="rounded-xl bg-rose-600 py-2.5 text-xs font-bold text-white hover:bg-rose-700 transition-colors">
                  Ya, Hapus
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
