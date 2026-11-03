// ─────────────────────────────────────────────────────────────────────────────
// ExifSuntikPanel — kartu pengaturan "Suntik EXIF" untuk satu fitur.
// Dipakai 3× di Pengaturan Jadhuman (Preset / Presensi / Produktivitas).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Cpu, ChevronDown, ChevronUp } from 'lucide-react';
import {
  EXIF_SUNTIK_LABEL, type ExifSuntikConfig, type ExifSuntikTarget,
} from '../../lib/exifSuntik';

interface ExifSuntikPanelProps {
  target: ExifSuntikTarget;
  config: ExifSuntikConfig;
  onChange: (cfg: ExifSuntikConfig) => void;
}

export default function ExifSuntikPanel({ target, config, onChange }: ExifSuntikPanelProps) {
  const [open, setOpen] = useState(false);
  const label = EXIF_SUNTIK_LABEL[target];

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900/40">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left">
        <span className="flex items-center gap-2.5 min-w-0">
          <Cpu className="w-4 h-4 text-indigo-500 shrink-0" />
          <span className="min-w-0">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2 flex-wrap">
              {label.judul}
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${config.aktif ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'}`}>
                {config.aktif ? 'ON' : 'OFF'}
              </span>
            </span>
            <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{label.deskripsi}</span>
          </span>
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
      </button>

      {open && (
        <div className="px-3.5 py-4 space-y-3 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Aktifkan Suntik EXIF</span>
            <button type="button" role="switch" aria-checked={config.aktif}
              onClick={() => onChange({ ...config, aktif: !config.aktif })}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors ${config.aktif ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${config.aktif ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          {config.aktif && (
            <div className="space-y-3">
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                EXIF palsu disuntik hanya bila foto sumber tidak punya EXIF (mis. PNG / screenshot). Foto JPEG asli tetap dipakai EXIF-nya.
              </p>
              {([['make', 'Make', 'samsung'], ['model', 'Model', 'SM-A546E'], ['software', 'Software', 'A546EXXU6CYA1']] as const).map(([key, lbl, ph]) => (
                <div key={key}>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">{lbl}</label>
                  <input type="text" value={(config as any)[key]} onChange={e => onChange({ ...config, [key]: e.target.value })} placeholder={ph} maxLength={64}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-100 placeholder-slate-400" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
