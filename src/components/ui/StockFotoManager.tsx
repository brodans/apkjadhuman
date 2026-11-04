// ─────────────────────────────────────────────────────────────────────────────
// StockFotoManager — manajemen stock foto presensi otomatis.
//
// Upload: input[type=file] ditumpuk langsung di atas elemen trigger via position
//         absolute + opacity:0 — cara paling reliable di semua WebView & browser.
// Simpan: IndexedDB via onTambah prop.
// Decode: universal — native browser, heic2any (WASM) untuk HEIC/HEIF,
//         UTIF untuk TIFF (lihat src/lib/universalImage.ts).
// Metadata sumber tidak disalin; foto didecode lalu disimpan sebagai JPEG kecil.
// Konfirmasi hapus: inline, tidak pakai fixed/portal agar tidak ada double scroll.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import {
  ImageIcon, Plus, Trash2, X, AlertTriangle, Loader2,
} from 'lucide-react';
import {
  isProbablyImageFile, sniffImageKind, decodeImageUniversal, scaleCanvasMaxSide, canvasToJpeg,
} from '../../lib/universalImage';
import { StockFoto, MAX_STOCK_FOTO, notifyPresetUpdated } from '../../lib/presetAutomasi';
import ImageLightbox from './ImageLightbox';

const LONG_SIDE = 320;

// ─── Foto processor ───────────────────────────────────────────────────────────
// Selalu resolve, tidak pernah throw.
async function processFoto(
  file: File,
): Promise<{ dataUrl: string; w: number; h: number; sizeOri: number; err?: string }> {
  const sizeOri = file.size;
  if (!isProbablyImageFile(file)) {
    return { dataUrl: '', w: 0, h: 0, sizeOri, err: 'Format RAW tidak didukung. Pilih JPG, PNG, atau format gambar umum.' };
  }
  const kind = await sniffImageKind(file);

  let decoded: HTMLCanvasElement;
  try {
    decoded = await decodeImageUniversal(file, kind);
  } catch (e: any) {
    return { dataUrl: '', w: 0, h: 0, sizeOri, err: e?.message || 'Gagal decode gambar.' };
  }

  let scaled: { canvas: HTMLCanvasElement; w: number; h: number };
  try {
    scaled = scaleCanvasMaxSide(decoded, LONG_SIDE);
  } catch (e: any) {
    return { dataUrl: '', w: 0, h: 0, sizeOri, err: e?.message || 'Gambar terlalu besar untuk diproses.' };
  }

  const outW = scaled.w, outH = scaled.h;
  let rawUrl: string;
  try {
    rawUrl = canvasToJpeg(scaled.canvas, 0.92);
  } catch (e: any) {
    return { dataUrl: '', w: 0, h: 0, sizeOri, err: e?.message || 'Gagal mengencode JPEG.' };
  }

  return { dataUrl: rawUrl, w: outW, h: outH, sizeOri };
}

// ─── Tombol upload dengan input file tertindih langsung ───────────────────────
// Input diposisikan absolute di atas tombol dengan opacity:0 dan zIndex 10 —
// klik jatuh tepat ke input (elemen di atasnya pakai pointer-events-none).
// onChange men-snapshot File[] SEBELUM mengosongkan value input, karena
// input.files adalah live FileList (ikut kosong saat value='').
interface UploadButtonProps {
  disabled?: boolean;
  uploading?: boolean;
  children: React.ReactNode;
  className?: string;
  onFiles: (f: File[]) => void;
  asLabel?: boolean; // kalau true, pakai label bungkus
}
function UploadZone({ disabled, uploading, children, className, onFiles }: UploadButtonProps) {
  return (
    <div
      className={`relative ${className ?? ''}`}
      style={{ position: 'relative' }}
    >
      {children}
      {/* Input file menumpuk penuh di atas children — opacity 0, klik menembus */}
      <input
        type="file"
        accept="image/*,.heic,.heif,.tif,.tiff,.bmp,.ico,.avif,.jxl"
        multiple
        disabled={disabled || uploading}
        onChange={e => {
          // Snapshot File[] DULU — input.files adalah live FileList; mengosongkan
          // input (value='') membuat FileList ikut kosong di browser modern.
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          if (files.length > 0) onFiles(files);
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0,
          cursor: disabled || uploading ? 'not-allowed' : 'pointer',
          zIndex: 10,
        }}
      />
    </div>
  );
}

// ─── Komponen utama ───────────────────────────────────────────────────────────
export interface StockFotoManagerProps {
  fotos: StockFoto[];
  selectedIds?: string[];
  onSelect?: (ids: string[]) => void;
  onTambah: (data: Omit<StockFoto,'id'|'dibuatPada'>) => Promise<StockFoto|null>;
  onHapus: (id: string) => Promise<void>;
  maxSelect?: number;
  readOnly?: boolean;
}

export default function StockFotoManager({
  fotos, selectedIds=[], onSelect, onTambah, onHapus,
  maxSelect=MAX_STOCK_FOTO, readOnly=false,
}: StockFotoManagerProps) {
  const [uploading,      setUploading]      = useState(false);
  const [uploadErrors,   setUploadErrors]   = useState<string[]>([]);
  const [progress,       setProgress]       = useState<{done:number;total:number}|null>(null);
  const [lightbox,       setLightbox]       = useState<{src:string;title:string}|null>(null);
  const [hapusTarget,    setHapusTarget]    = useState<string|null>(null);
  const [hapusSemuaOpen, setHapusSemuaOpen] = useState(false);
  const [hapusBerjalan,  setHapusBerjalan]  = useState(false);
  const slotTersisa = MAX_STOCK_FOTO - fotos.length;

  const handleFiles = async (files: FileList|File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploadErrors([]); setUploading(true); setProgress({done:0,total:arr.length});
    const errs: string[] = [];
    let changed = false;
    let done=0;
    for (const file of arr) {
      try {
        const r = await processFoto(file);
        if (!r.dataUrl) { errs.push(`${file.name}: ${r.err||'Gagal'}`); }
        else {
          const nama = file.name.replace(/\.[^.]+$/,'').slice(0,60)||`Foto ${Date.now()}`;
          const foto = await onTambah({nama, dataUrl:r.dataUrl, ukuranAsli:r.sizeOri, lebarPx:r.w, tinggiPx:r.h});
          changed ||= !!foto;
        }
      } catch(e:any) { errs.push(`${file.name}: ${e?.message||'Error'}`); }
      done++; setProgress({done, total:arr.length});
    }
    setUploading(false); setProgress(null);
    if (errs.length) setUploadErrors(errs);
    if (changed) notifyPresetUpdated();
  };

  const hapusSatu = async (id: string) => {
    await onHapus(id);
    setHapusTarget(null);
    notifyPresetUpdated();
  };
  const hapusSemua = async () => {
    setHapusBerjalan(true);
    let changed = false;
    for (const f of fotos) {
      try { await onHapus(f.id); changed = true; } catch {/**/}
    }
    setHapusBerjalan(false); setHapusSemuaOpen(false);
    if (changed) notifyPresetUpdated();
  };
  const toggleSelect = (id: string) => {
    if (!onSelect) return;
    if (selectedIds.includes(id)) onSelect(selectedIds.filter(s=>s!==id));
    else { if (selectedIds.length>=maxSelect) return; onSelect([...selectedIds,id]); }
  };

  return (
    <div className="space-y-3">

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-slate-500 dark:text-slate-400">
            {fotos.length}<span className="font-normal text-slate-400">/{MAX_STOCK_FOTO}</span>
          </span>
          {onSelect && (
            <span className="text-slate-400">
              · <span className="font-bold text-slate-600 dark:text-slate-300">{selectedIds.length}</span>/{maxSelect} dipilih
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {fotos.length > 0 && (
            <button type="button" onClick={()=>setHapusSemuaOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5"/> Hapus Semua
            </button>
          )}
          {slotTersisa > 0 && (
            <UploadZone disabled={uploading} uploading={uploading} onFiles={handleFiles}
              className="rounded-xl">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white shadow-sm select-none pointer-events-none ${uploading?'opacity-60':''}`}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Plus className="w-3.5 h-3.5"/>}
                Tambah Foto
              </div>
            </UploadZone>
          )}
        </div>
      </div>

      {/* Errors */}
      {uploadErrors.length > 0 && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10 p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5"/> {uploadErrors.length} foto gagal
            </span>
            <button type="button" onClick={()=>setUploadErrors([])} className="text-rose-400 hover:text-rose-600"><X className="w-3.5 h-3.5"/></button>
          </div>
          {uploadErrors.map((e,i)=><p key={i} className="text-[11px] text-rose-600 dark:text-rose-400 truncate">{e}</p>)}
        </div>
      )}

      {/* Progress */}
      {uploading && progress && (
        <div className="rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600"/>
            <span className="text-xs font-bold text-blue-700 dark:text-blue-300">Memproses {progress.done}/{progress.total}…</span>
          </div>
          <div className="h-1.5 bg-blue-200 dark:bg-blue-900 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all" style={{width:`${(progress.done/progress.total)*100}%`}}/>
          </div>
        </div>
      )}

      {/* Empty state */}
      {fotos.length === 0 && !uploading && (
        <UploadZone onFiles={handleFiles} className="w-full rounded-2xl">
          <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 p-8 text-center transition-colors group pointer-events-none">
            <ImageIcon className="w-8 h-8 mb-2 text-slate-300 dark:text-slate-600 group-hover:text-blue-400 transition-colors"/>
            <span className="text-xs font-bold text-slate-400 dark:text-slate-500">Belum ada foto</span>
            <span className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Ketuk untuk memilih — bisa banyak sekaligus</span>
          </div>
        </UploadZone>
      )}

      {/* Grid */}
      {fotos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {fotos.map(foto => {
            const isSel=selectedIds.includes(foto.id), canSel=isSel||selectedIds.length<maxSelect;
            return (
              <div key={foto.id} className="relative group">
                <button type="button"
                  onClick={()=>{ if(onSelect&&!readOnly) toggleSelect(foto.id); else setLightbox({src:foto.dataUrl,title:foto.nama}); }}
                  disabled={!!(onSelect&&!isSel&&!canSel&&!readOnly)}
                  className={`w-full aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                    isSel?'border-blue-500 ring-2 ring-blue-500/30'
                    :onSelect&&!readOnly
                      ?canSel?'border-slate-200 dark:border-slate-700 hover:border-blue-400':'opacity-40 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                      :'border-slate-200 dark:border-slate-700 cursor-zoom-in hover:border-slate-400'
                  }`}>
                  <img src={foto.dataUrl} alt={foto.nama} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                </button>
                {isSel && onSelect && (
                  <div className="absolute top-1 left-1 w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center shadow pointer-events-none">
                    <span className="text-white text-[9px] font-black">{selectedIds.indexOf(foto.id)+1}</span>
                  </div>
                )}
                <button type="button" onClick={e=>{e.stopPropagation();setHapusTarget(foto.id);}}
                  className="absolute top-1 right-1 w-6 h-6 bg-rose-500/80 hover:bg-rose-600 text-white rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">
                  <Trash2 className="w-3 h-3"/>
                </button>
                <p className="mt-1 text-[10px] text-center text-slate-500 dark:text-slate-400 truncate">{foto.nama}</p>
              </div>
            );
          })}
          {/* Slot tambah */}
          {slotTersisa > 0 && !uploading && (
            <UploadZone onFiles={handleFiles} className="aspect-square rounded-xl">
              <div className="w-full h-full aspect-square rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 flex flex-col items-center justify-center gap-1 transition-colors pointer-events-none">
                <Plus className="w-5 h-5 text-slate-400 dark:text-slate-500"/>
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">{slotTersisa}</span>
              </div>
            </UploadZone>
          )}
        </div>
      )}

      {lightbox && <ImageLightbox src={lightbox.src} title={lightbox.title} onClose={()=>setLightbox(null)}/>}

      {/* Konfirmasi hapus satu — inline */}
      {hapusTarget && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10 p-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Hapus foto ini?</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Foto dihapus permanen dari penyimpanan dan semua preset.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={()=>setHapusTarget(null)}
              className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 transition-colors">
              Batal
            </button>
            <button type="button" onClick={()=>hapusSatu(hapusTarget)}
              className="flex-1 py-2 rounded-xl bg-rose-600 text-xs font-bold text-white hover:bg-rose-700 transition-colors">
              Hapus
            </button>
          </div>
        </div>
      )}

      {/* Konfirmasi hapus semua — inline */}
      {hapusSemuaOpen && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10 p-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Hapus semua {fotos.length} foto?</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Semua foto dihapus permanen dari penyimpanan dan semua preset.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={()=>setHapusSemuaOpen(false)} disabled={hapusBerjalan}
              className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 transition-colors disabled:opacity-50">
              Batal
            </button>
            <button type="button" onClick={hapusSemua} disabled={hapusBerjalan}
              className="flex-1 py-2 rounded-xl bg-rose-600 text-xs font-bold text-white hover:bg-rose-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
              {hapusBerjalan?<><Loader2 className="w-3.5 h-3.5 animate-spin"/>Menghapus…</>:'Hapus Semua'}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
