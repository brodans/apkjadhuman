import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  Activity, Plus, Save, Clock, CheckCircle, XCircle,
  Search, X, ChevronDown, Camera, Image as ImageIcon, Trash2, Edit3, Play, RefreshCw,
  User, Loader2, ZoomIn,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { sendRequest } from '../api';
import ImageLightbox from '../components/ui/ImageLightbox';
import { useBackButton } from '../hooks/useBackButton';
import { usePegawaiSearch } from '../hooks/usePegawaiSearch';
import { getTodayWIB } from '../lib/dateFormatter';
import { loadPegawaiDatabase, toPegawaiSearchList } from '../lib/pegawaiData';
import {
  isProbablyImageFile, sniffImageKind, decodeImageUniversal,
} from '../lib/universalImage';
import { applyExifFinal, getExifSuntik } from '../lib/exifSuntik';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface OngoingTask {
  id?: string;
  id_log?: string;
  id_aktifitas?: string;
  jenis?: string;
  tugas?: string;
  nama_tugas?: string;
  nama_tupoksi?: string;
  keterangan?: string;
  tgl_mulai?: string;
  tgl_selesai?: string | null;
  status?: string;
  id_tupoksi?: string;
  _isDummy?: boolean;
}

interface TaskUIState {
  expanded: boolean;
  photo: string | null;
  photoInfo: string;
  isPhotoLoading: boolean;
  isCameraActive: boolean;
  loadingAkhiri: boolean;
  loadingAkhiriLanjut: boolean;
  photoModalImg: { src: string; title: string } | null;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function getTaskId(task: OngoingTask): string {
  return (task.id || task.id_log || task.id_aktifitas || '') as string;
}

/**
 * Safely parse a date string that may come in various formats from the API.
 * iOS Safari only supports ISO 8601 (with "T" separator), so we normalize:
 *   "2026-08-07 12:00:00"   → "2026-08-07T12:00:00"
 *   "2026-08-07T12:00:00"   → unchanged
 *   "2026-08-07T12:00:00+07:00" → unchanged
 * Returns NaN timestamp if the string is invalid.
 */
function parseDateSafe(dateStr: string): number {
  if (!dateStr) return NaN;
  // Replace space-separator with T to satisfy Safari ISO 8601 parser
  const normalized = dateStr.trim().replace(' ', 'T');
  const ts = new Date(normalized).getTime();
  return ts;
}

function formatElapsedTime(tglMulai: string): string {
  const start = parseDateSafe(tglMulai);
  if (isNaN(start)) return '0d';
  const diffMs = Date.now() - start;
  if (diffMs < 0) return '0d';
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}j ${minutes}m ${seconds}d`;
  if (minutes > 0) return `${minutes}m ${seconds}d`;
  return `${seconds}d`;
}

function formatElapsedLong(tglMulai: string): string {
  const start = parseDateSafe(tglMulai);
  if (isNaN(start)) return '';
  const diffMs = Date.now() - start;
  if (diffMs < 0) return '';
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} jam ${minutes} menit ${seconds} detik`;
  if (minutes > 0) return `${minutes} menit ${seconds} detik`;
  return `${seconds} detik`;
}

/**
 * Format a date string to human-readable locale string, safe for all browsers.
 */
function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return '—';
  const normalized = dateStr.trim().replace(' ', 'T');
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─────────────────────────────────────────────
// Live Timer Hook (per task)
// ─────────────────────────────────────────────
function useElapsedTimers(tasks: OngoingTask[]): Record<string, string> {
  const [timers, setTimers] = useState<Record<string, string>>({});
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const signature = tasks.map(t => `${getTaskId(t)}:${t.tgl_mulai || ''}`).join('|');

  useEffect(() => {
    if (!signature) {
      setTimers({});
      return;
    }
    const update = () => {
      const next: Record<string, string> = {};
      tasksRef.current.forEach(t => {
        if (t.tgl_mulai) next[getTaskId(t)] = formatElapsedTime(t.tgl_mulai);
      });
      setTimers(prev => {
        const keys = Object.keys(next);
        if (keys.length === Object.keys(prev).length && keys.every(k => prev[k] === next[k])) return prev;
        return next;
      });
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [signature]);

  return timers;
}

// ─── Foto processor (universal — semua format gambar didukung) ────────────────
// Meniru pengolahan lampiran aktivitas pada APK asli:
// foto di-re-encode JPEG kualitas 50 dengan RESOLUSI NATIVE dipertahankan
// (tanpa resize / batas ukuran), EXIF sumber dipertahankan (hanya tag dimensi
// piksel diperbarui; thumbnail IFD1 dilepas). Bila sumber tidak punya EXIF dan
// pengguna mengaktifkan "Suntik EXIF — Produktivitas Harian" di Pengaturan
// Jadhuman, foto disuntik EXIF Make/Model/Software.
//
// Batas aman ukuran body request ~4.5 MB — kualitas/downscale diturunkan HANYA
// bila hasil melebihi batas aman (HTTP 413).
const MAX_UPLOAD_BASE64 = 4_000_000;

async function processPhotoFileAsync(
  file: File,
  onStart: () => void,
  onDone: (dataUrl: string, info: string) => void,
  onError: (msg: string) => void,
) {
  if (!isProbablyImageFile(file)) return;
  onStart();

  try {
    const kind = await sniffImageKind(file);
    // Byte lengkap hanya perlu untuk JPEG (EXIF passthrough)
    const sourceBytes = kind === 'jpeg'
      ? new Uint8Array(await file.arrayBuffer())
      : null;

    const decoded = await decodeImageUniversal(file, kind);

    // ─── Build JPEG + EXIF + jaring pengaman ukuran ──────────────────────────
    const build = (src: HTMLCanvasElement, quality: number): string | null => {
      const dataUrl = src.toDataURL('image/jpeg', quality);
      if (dataUrl.length < 100) return null; // "data:," → encode gagal
      return applyExifFinal(dataUrl, {
        sourceBytes,
        inject: getExifSuntik('produktivitas'),
        stripThumbnail: true,
        width: src.width,
        height: src.height,
      });
    };

    let target = decoded;
    let quality = 0.5; // sama dengan APK asli
    let finalUrl = build(target, quality);

    while (finalUrl && finalUrl.length > MAX_UPLOAD_BASE64 && Math.max(target.width, target.height) > 320) {
      if (quality > 0.3) {
        quality = Math.round((quality - 0.1) * 10) / 10;
      } else {
        const nw = Math.max(1, Math.round(target.width * 0.8));
        const nh = Math.max(1, Math.round(target.height * 0.8));
        const smaller = document.createElement('canvas');
        smaller.width = nw;
        smaller.height = nh;
        const cx = smaller.getContext('2d');
        if (cx) {
          cx.imageSmoothingEnabled = true;
          cx.imageSmoothingQuality = 'high';
          cx.drawImage(target, 0, 0, nw, nh);
        }
        target = smaller;
        quality = 0.4;
      }
      finalUrl = build(target, quality);
    }

    if (!finalUrl) {
      onError('❌ Gagal memproses foto (ukuran terlalu besar untuk perangkat ini).');
      return;
    }

    const w = target.width, h = target.height;
    const size = Math.round((finalUrl.length * 3) / 4);
    const sizeLabel = size >= 1024 * 1024
      ? `${(size / (1024 * 1024)).toFixed(2)} MB`
      : `${(size / 1024).toFixed(1)} KB`;
    onDone(finalUrl, `✅ ${w}×${h} px · ${sizeLabel}`);
  } catch (err: any) {
    console.error('Gagal memproses foto:', err);
    onError(`❌ ${err?.message || 'Foto tidak bisa dibaca.'}`);
  }
}

function processPhotoFile(
  file: File,
  onStart: () => void,
  onDone: (dataUrl: string, info: string) => void,
  onError: (msg: string) => void,
) {
  void processPhotoFileAsync(file, onStart, onDone, onError);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: ActiveTaskCard
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: ActiveTaskCard
// ─────────────────────────────────────────────────────────────────────────────
interface ActiveTaskCardProps {
  task: OngoingTask;
  uiState: TaskUIState;
  elapsedShort: string;
  effectiveIdPegawai: string;
  isMobile: boolean;
  onToggleExpand: () => void;
  onAkhiri: () => void;
  onAkhiriDanLanjutkan: () => void;
  onSetPhoto: (photo: string | null, info?: string) => void;
  onSetPhotoLoading: (v: boolean) => void;
  onSetCameraActive: (v: boolean) => void;
  onSetPhotoModal: (img: { src: string; title: string } | null) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  streamRef: React.RefObject<MediaStream | null>;
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  galleryInputRef: React.RefObject<HTMLInputElement | null>;
}

const ActiveTaskCard = memo(function ActiveTaskCard({
  task,
  uiState,
  elapsedShort,
  isMobile,
  onToggleExpand,
  onAkhiri,
  onAkhiriDanLanjutkan,
  onSetPhoto,
  onSetPhotoLoading,
  onSetCameraActive,
  onSetPhotoModal,
  videoRef,
  streamRef,
  cameraInputRef,
  galleryInputRef,
}: ActiveTaskCardProps) {
  const taskName = task.tugas || task.nama_tugas || task.nama_tupoksi || '—';
  const { expanded, photo, photoInfo, isPhotoLoading, isCameraActive, loadingAkhiri, loadingAkhiriLanjut, photoModalImg } = uiState;

  // Live elapsed for expanded detail
  const [elapsedLong, setElapsedLong] = useState('');
  useEffect(() => {
    if (!expanded || !task.tgl_mulai) return;
    const update = () => setElapsedLong(formatElapsedLong(task.tgl_mulai!));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [expanded, task.tgl_mulai]);

  const startCamera = async () => {
    if (isMobile) { cameraInputRef.current?.click(); return; }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = mediaStream;
      onSetCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) { videoRef.current.srcObject = mediaStream; videoRef.current.play().catch(console.error); }
      }, 100);
    } catch { alert('Tidak dapat mengakses kamera. Pastikan izin kamera telah diberikan.'); }
  };

  const stopCamera = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    onSetCameraActive(false);
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, [streamRef]);

  const captureFromCamera = () => {
    if (!videoRef.current) return;
    const srcW = videoRef.current.videoWidth || videoRef.current.offsetWidth;
    const srcH = videoRef.current.videoHeight || videoRef.current.offsetHeight;
    const canvas = document.createElement('canvas');
    canvas.width = srcW; canvas.height = srcH;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0, srcW, srcH);
    canvas.toBlob((blob) => {
      if (blob) {
        processPhotoFile(
          new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' }),
          () => onSetPhotoLoading(true),
          (dataUrl, info) => { onSetPhoto(dataUrl, info); onSetPhotoLoading(false); },
          (msg) => { onSetPhotoLoading(false); onSetPhoto(null, msg); },
        );
        stopCamera();
      }
    }, 'image/jpeg', 1);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processPhotoFile(
        file,
        () => onSetPhotoLoading(true),
        (dataUrl, info) => { onSetPhoto(dataUrl, info); onSetPhotoLoading(false); },
        (msg) => { onSetPhotoLoading(false); onSetPhoto(null, msg); },
      );
    }
    e.target.value = '';
  };

  const isLoading = loadingAkhiri || loadingAkhiriLanjut || isPhotoLoading;

  return (
    <div
      className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
        expanded
          ? 'border-orange-300 dark:border-orange-700/60 shadow-lg shadow-orange-500/5'
          : 'border-orange-200 dark:border-orange-800/40 hover:border-orange-300 dark:hover:border-orange-700/50'
      } bg-orange-50/60 dark:bg-orange-950/10`}
    >
      {/* ── Compact Header (always visible) ── */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer group"
        aria-expanded={expanded}
      >
        {/* Pulse dot */}
        <span className="relative flex-shrink-0 w-2.5 h-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-orange-500" />
        </span>

        {/* Task name */}
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate leading-tight">{taskName}</p>
          <p className="text-[11px] text-orange-600/80 dark:text-orange-400/80 font-medium mt-0.5 truncate">
            {task.jenis === 'NON_TUPOKSI' ? 'Non Tupoksi' : 'Tupoksi'}
          </p>
        </div>

        {/* Live timer badge */}
        <span className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-bold text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/40 border border-orange-200 dark:border-orange-700/40 px-2.5 py-1 rounded-full tabular-nums tracking-tight">
          <Clock className="w-3 h-3 shrink-0" />
          {elapsedShort || '0d'}
        </span>

        {/* Chevron */}
        <span className="flex-shrink-0 text-orange-400 dark:text-orange-500 transition-transform duration-300" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <ChevronDown className="w-4 h-4" />
        </span>
      </button>

      {/* ── Expanded Detail ── */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-orange-200/60 dark:border-orange-800/30 pt-4" style={{ animation: 'expandDown 0.2s ease-out' }}>

          {/* Detail rows */}
          {!task._isDummy && (
            <div className="bg-white/70 dark:bg-slate-900/50 rounded-xl border border-orange-100/60 dark:border-orange-900/30 divide-y divide-slate-100 dark:divide-slate-700/40 overflow-hidden">
              <div className="grid grid-cols-[100px_1fr] gap-2 px-4 py-2.5 items-start">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 pt-0.5">Jenis</span>
                <span className="text-xs font-bold uppercase tracking-wider text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 rounded-md w-fit">
                  {task.jenis || 'TUPOKSI'}
                </span>
              </div>
              <div className="grid grid-cols-[100px_1fr] gap-2 px-4 py-2.5 items-start">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 pt-0.5">Tugas</span>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 leading-snug">{taskName}</span>
              </div>
              {task.keterangan && (
                <div className="grid grid-cols-[100px_1fr] gap-2 px-4 py-2.5 items-start">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 pt-0.5">Keterangan</span>
                  <span className="text-sm text-slate-600 dark:text-slate-300 italic leading-snug">{task.keterangan}</span>
                </div>
              )}
              <div className="grid grid-cols-[100px_1fr] gap-2 px-4 py-2.5 items-start">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 pt-0.5">Mulai</span>
                <span className="text-sm font-mono text-slate-700 dark:text-slate-300">
                  {formatDateDisplay(task.tgl_mulai || '')}
                </span>
              </div>
              {elapsedLong && (
                <div className="grid grid-cols-[100px_1fr] gap-2 px-4 py-2.5 items-center">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Durasi</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/40 border border-orange-200 dark:border-orange-700/40 px-2.5 py-1 rounded-full tabular-nums tracking-tight w-fit">
                    <Clock className="w-3 h-3 animate-pulse shrink-0" /> {elapsedLong}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Lampiran foto */}
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2.5">
              Lampiran Foto <span className="font-normal normal-case text-slate-400">(opsional)</span>
            </label>

            {!photo && !isPhotoLoading && (
              <div
                className="border-2 border-dashed border-orange-200 dark:border-orange-900/50 rounded-xl p-4 text-center bg-white/50 dark:bg-slate-900/30 hover:border-orange-400 dark:hover:border-orange-600 transition-all cursor-pointer group"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  const file = e.dataTransfer.files?.[0];
                  if (file?.type.match(/image.*/)) {
                    processPhotoFile(file, () => onSetPhotoLoading(true), (d, i) => { onSetPhoto(d, i); onSetPhotoLoading(false); }, (m) => { onSetPhotoLoading(false); onSetPhoto(null, m); });
                  }
                }}
              >
                <div className="flex justify-center gap-2.5 flex-wrap">
                  <button type="button" onClick={startCamera}
                    className="bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-slate-700 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 border border-slate-200 dark:border-slate-700 hover:border-emerald-200 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer active:scale-95">
                    <Camera className="w-3.5 h-3.5" /> Kamera
                  </button>
                  <button type="button" onClick={() => galleryInputRef.current?.click()}
                    className="bg-white dark:bg-slate-800 hover:bg-orange-50 dark:hover:bg-orange-900/20 text-slate-700 dark:text-slate-200 hover:text-orange-600 dark:hover:text-orange-400 border border-slate-200 dark:border-slate-700 hover:border-orange-200 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer active:scale-95">
                    <ImageIcon className="w-3.5 h-3.5" /> Galeri
                  </button>
                </div>
              </div>
            )}

            {isPhotoLoading && (
              <div className="rounded-xl bg-slate-100 dark:bg-slate-800 h-16 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Memproses foto...</span>
              </div>
            )}

            {photo && !isCameraActive && (
              <div className="space-y-2.5" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
                <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 max-h-48 flex justify-center">
                  <img src={photo} alt="Lampiran" className="max-h-48 object-contain cursor-pointer" onClick={() => onSetPhotoModal({ src: photo, title: 'Pratinjau Foto Lampiran' })} />
                  <button type="button" onClick={() => onSetPhotoModal({ src: photo, title: 'Pratinjau Foto Lampiran' })}
                    className="absolute top-2 right-2 bg-black/50 text-white p-1.5 rounded-lg hover:bg-black/70 transition-colors">
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{photoInfo}</span>
                  <button type="button" onClick={() => onSetPhoto(null, '')}
                    className="text-xs font-bold text-red-500 hover:text-red-600 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" /> Hapus
                  </button>
                </div>
              </div>
            )}

            {/* Live Camera View (desktop) */}
            {isCameraActive && (
              <div className="modal-layer fixed inset-0 z-50 bg-black flex flex-col">
                <div className="flex justify-between items-center p-4 bg-black text-white">
                  <span className="font-medium text-sm">Ambil Foto Lampiran</span>
                  <button onClick={stopCamera} className="p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors"><X className="w-6 h-6" /></button>
                </div>
                <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
                  <video ref={videoRef} playsInline autoPlay muted className="max-h-full max-w-full object-contain" />
                </div>
                <div className="p-8 bg-black flex justify-center items-center pb-12">
                  <button onClick={captureFromCamera} className="w-20 h-20 bg-white rounded-full border-4 border-slate-300 shadow-lg active:scale-95 transition-transform flex items-center justify-center">
                    <div className="w-16 h-16 bg-white border-2 border-slate-200 rounded-full" />
                  </button>
                </div>
              </div>
            )}

            <input type="file" ref={cameraInputRef} accept="image/*,.heic,.heif,.tif,.tiff,.dng,.bmp,.ico,.avif,.jxl" capture="user" className="hidden" onChange={handlePhotoChange} />
            <input type="file" ref={galleryInputRef} accept="image/*,.heic,.heif,.tif,.tiff,.dng,.bmp,.ico,.avif,.jxl" className="hidden" onChange={handlePhotoChange} />
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <button
              type="button"
              onClick={onAkhiriDanLanjutkan}
              disabled={isLoading}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl shadow-[0_4px_12px_rgba(5,150,105,0.2)] transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] text-sm"
            >
              {loadingAkhiriLanjut ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              {loadingAkhiriLanjut ? 'Memproses...' : 'Akhiri & Lanjutkan'}
            </button>
            <button
              type="button"
              onClick={onAkhiri}
              disabled={isLoading}
              className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl shadow-[0_4px_12px_rgba(249,115,22,0.15)] transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] text-sm"
            >
              {loadingAkhiri ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {loadingAkhiri ? 'Menyimpan...' : 'Akhiri Aktivitas'}
            </button>
          </div>
        </div>
      )}

      {/* Lightbox per-task */}
      {photoModalImg && (
        <ImageLightbox src={photoModalImg.src} title={photoModalImg.title} onClose={() => onSetPhotoModal(null)} />
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function Produktivitas() {
  const { pegawai, config, userRole, tabPermissions } = useAppContext();

  // ── Global state ──
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [hasChecked, setHasChecked]         = useState(false);
  const [error, setError]                   = useState('');
  const [success, setSuccess]               = useState('');

  // ── Multiple ongoing tasks ──
  const [ongoingTasks, setOngoingTasks] = useState<OngoingTask[]>([]);

  // Per-task UI state map  (keyed by task ID)
  const [taskUIMap, setTaskUIMap] = useState<Record<string, TaskUIState>>({});

  // Per-task camera refs map
  const taskRefsMap = useRef<Record<string, {
    video: React.RefObject<HTMLVideoElement | null>;
    stream: React.RefObject<MediaStream | null>;
    camera: React.RefObject<HTMLInputElement | null>;
    gallery: React.RefObject<HTMLInputElement | null>;
  }>>({});

  // ── Tupoksi ──
  const [tupoksiList, setTupoksiList] = useState<any[]>([]);

  // ── New activity form ──
  const [jenis, setJenis]                         = useState<'TUPOKSI' | 'NON_TUPOKSI'>('TUPOKSI');
  const [idTupoksi, setIdTupoksi]                 = useState('');
  const [namaTupoksiTerpilih, setNamaTupoksiTerpilih] = useState('');
  const [tugasNonTupoksi, setTugasNonTupoksi]     = useState('');
  const [keterangan, setKeterangan]               = useState('');
  const [loadingMulai, setLoadingMulai]           = useState(false);
  const [showTupoksiModal, setShowTupoksiModal]   = useState(false);
  const [searchTupoksi, setSearchTupoksi]         = useState('');

  // ── Pegawai search ──
  const [pegawaiList, setPegawaiList]                   = useState<any[]>([]);
  const canSearchPegawai = userRole === 'admin' || (tabPermissions.allowSearchPegawai ?? false);
  const [loadingPegawai, setLoadingPegawai]             = useState(false);
  const [pegawaiLoadError, setPegawaiLoadError]         = useState(false);
  const [pegawaiLoadAttempt, setPegawaiLoadAttempt]     = useState(0);
  const {
    searchPegawai,
    setSearchPegawai,
    showPegawaiDropdown,
    setShowPegawaiDropdown,
    selectedPegawai: selectedTargetPegawai,
    setSelectedPegawai: setSelectedTargetPegawai,
    pegawaiDropdownRef: dropdownRef,
    filteredPegawai,
  } = usePegawaiSearch(pegawaiList, { maxResults: 50, showAllWhenEmpty: false });

  const userAgent = navigator.userAgent || '';
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)
    || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);

  const effectiveIdPegawai = selectedTargetPegawai?.id || selectedTargetPegawai?.id_pegawai || config.idPegawai;

  // Live timers for all ongoing tasks
  const elapsedTimers = useElapsedTimers(ongoingTasks);

  // ── Ensure refs exist for each task ──
  const ensureTaskRefs = useCallback((taskId: string) => {
    if (!taskRefsMap.current[taskId]) {
      taskRefsMap.current[taskId] = {
        video:   { current: null },
        stream:  { current: null },
        camera:  { current: null },
        gallery: { current: null },
      };
    }
    return taskRefsMap.current[taskId];
  }, []);

  // ── Sync taskUIMap when ongoingTasks changes (preserve existing UI state) ──
  useEffect(() => {
    setTaskUIMap(prev => {
      let changed = false;
      const next: Record<string, TaskUIState> = { ...prev };
      const alive = new Set<string>();
      ongoingTasks.forEach(t => {
        const id = getTaskId(t);
        if (!id) return;
        alive.add(id);
        ensureTaskRefs(id);
        if (!next[id]) {
          next[id] = {
            expanded: false,
            photo: null,
            photoInfo: '',
            isPhotoLoading: false,
            isCameraActive: false,
            loadingAkhiri: false,
            loadingAkhiriLanjut: false,
            photoModalImg: null,
          };
          changed = true;
        }
      });
      Object.keys(next).forEach(id => {
        if (!alive.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [ongoingTasks, ensureTaskRefs]);

  // ── Helper to patch a single task's UI state ──
  const patchTaskUI = useCallback((taskId: string, patch: Partial<TaskUIState>) => {
    setTaskUIMap(prev => ({
      ...prev,
      [taskId]: { ...prev[taskId], ...patch },
    }));
  }, []);

  // ── Back button handlers ──
  useBackButton(() => {
    if (showTupoksiModal) { setShowTupoksiModal(false); return true; }
    return false;
  }, showTupoksiModal);

  // Load the large employee database only when this user can search it.
  useEffect(() => {
    if (!canSearchPegawai || pegawaiList.length > 0) return;
    let cancelled = false;
    setLoadingPegawai(true);
    setPegawaiLoadError(false);
    loadPegawaiDatabase()
      .then(records => { if (!cancelled) setPegawaiList(toPegawaiSearchList(records)); })
      .catch(error => {
        if (!cancelled) {
          console.error('Error loading employee search list:', error);
          setPegawaiLoadError(true);
        }
      })
      .finally(() => { if (!cancelled) setLoadingPegawai(false); });
    return () => { cancelled = true; };
  }, [canSearchPegawai, pegawaiList.length, pegawaiLoadAttempt]);

  // ── Fetch on pegawai change ──
  useEffect(() => {
    if (!pegawai) return;
    const id = selectedTargetPegawai?.id || selectedTargetPegawai?.id_pegawai || config.idPegawai;
    fetchCekAktivitas(id);
    fetchTupoksi(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pegawai, selectedTargetPegawai]);

  // ── Stop all cameras on unmount ──
  useEffect(() => {
    return () => {
      Object.values(taskRefsMap.current).forEach(refs => {
        refs.stream.current?.getTracks().forEach(t => t.stop());
      });
    };
  }, []);

  // ── Auto-dismiss success ──
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 5000);
    return () => clearTimeout(t);
  }, [success]);

  const fetchSeqRef = useRef(0);
  const hasCheckedRef = useRef(false);

  // ─────────────────────────────────
  // API: Fetch ongoing tasks (soft refresh = tanpa unmount form)
  // ─────────────────────────────────
  const fetchCekAktivitas = useCallback(async (idPeg?: string, opts?: { soft?: boolean }) => {
    const seq = ++fetchSeqRef.current;
    const soft = opts?.soft ?? hasCheckedRef.current;
    if (!soft) setCheckingStatus(true);
    try {
      const id = idPeg ?? effectiveIdPegawai;
      const today = getTodayWIB();
      const payload = { id_pegawai: id, tgl_mulai: today, tgl_akhir: today };
      const res = await sendRequest('/Tupoksi/ambilDataAktivitas', payload);
      if (seq !== fetchSeqRef.current) return; // request usang

      if (res?.success && Array.isArray(res.data) && res.data.length > 0) {
        const actives = res.data.filter((x: any) =>
          x.status === 'BELUM DIAKHIRI' ||
          x.status === 'Proses' ||
          x.tgl_selesai === null ||
          x.tgl_selesai === undefined ||
          x.tgl_selesai === ''
        );
        setOngoingTasks(actives);
      } else {
        setOngoingTasks([]);
      }
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      console.error('fetchCekAktivitas error:', err);
      setOngoingTasks([]);
    } finally {
      if (seq === fetchSeqRef.current) {
        setCheckingStatus(false);
        setHasChecked(true);
        hasCheckedRef.current = true;
      }
    }
  }, [effectiveIdPegawai]);

  // ─────────────────────────────────
  // API: Fetch tupoksi
  // ─────────────────────────────────
  const fetchTupoksi = useCallback(async (idPeg?: string) => {
    try {
      const id = idPeg ?? effectiveIdPegawai;
      const res = await sendRequest('/Tupoksi/get_data_tupoksi', { id_pegawai: id });
      let items: any[] = [];
      if (Array.isArray(res)) items = res;
      else if (res?.data && Array.isArray(res.data)) items = res.data;
      else if (res?.tugas && Array.isArray(res.tugas)) items = res.tugas;
      else if (res?.tupoksi && Array.isArray(res.tupoksi)) items = res.tupoksi;
      setTupoksiList(items);
    } catch (err) { console.error('fetchTupoksi error:', err); }
  }, [effectiveIdPegawai]);

  // ─────────────────────────────────
  // API: Akhiri per-task
  // ─────────────────────────────────
  const doAkhiriTask = async (task: OngoingTask, photo: string | null): Promise<boolean> => {
    const cleanBase64 = photo ? photo.replace(/^data:image\/[a-z]+;base64,/, '') : '';
    const taskId = getTaskId(task);
    const payload: any = {
      id_pegawai: effectiveIdPegawai,
      id_aktifitas: taskId,
      id_log: taskId,
      id: taskId,
      lampiran: cleanBase64,
      lokasi: '',
    };
    const res = await sendRequest('/Tupoksi/akhiriAktivitas', payload);
    return !!res?.success;
  };

  const handleAkhiriTask = async (task: OngoingTask) => {
    const taskId = getTaskId(task);
    const ui = taskUIMap[taskId];
    patchTaskUI(taskId, { loadingAkhiri: true });
    setError(''); setSuccess('');
    try {
      const ok = await doAkhiriTask(task, ui?.photo ?? null);
      if (ok) {
        setSuccess('Aktivitas berhasil diakhiri.');
        setOngoingTasks(prev => prev.filter(t => getTaskId(t) !== taskId));
        setTimeout(() => fetchCekAktivitas(effectiveIdPegawai), 1500);
      } else {
        setError('Gagal mengakhiri aktivitas.');
        patchTaskUI(taskId, { loadingAkhiri: false });
      }
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem.');
      patchTaskUI(taskId, { loadingAkhiri: false });
    }
  };

  const handleAkhiriDanLanjutkanTask = async (task: OngoingTask) => {
    const taskId = getTaskId(task);
    const ui = taskUIMap[taskId];
    patchTaskUI(taskId, { loadingAkhiriLanjut: true });
    setError(''); setSuccess('');
    try {
      const akhiriOk = await doAkhiriTask(task, ui?.photo ?? null);
      if (!akhiriOk) {
        setError('Gagal mengakhiri aktivitas sebelumnya.');
        patchTaskUI(taskId, { loadingAkhiriLanjut: false });
        return;
      }
      const isNonTupoksi = task.jenis === 'NON_TUPOKSI';
      const endpoint = isNonTupoksi ? '/Tupoksi/simpanNonTupoksi' : '/Tupoksi/simpanTupoksi';
      const lanjutPayload: any = { id_pegawai: effectiveIdPegawai, lokasi: '' };
      if (isNonTupoksi) {
        lanjutPayload.tugas = task.tugas || '';
        lanjutPayload.keterangan = task.keterangan || '';
        lanjutPayload.deskr_tupoksi = task.keterangan || '';
      } else {
        lanjutPayload.id_tupoksi = task.id_tupoksi || '';
        lanjutPayload.deskr_tupoksi = task.keterangan || '';
        lanjutPayload.keterangan = task.keterangan || '';
      }
      const lanjutRes = await sendRequest(endpoint, lanjutPayload);
      if (lanjutRes?.success) {
        setSuccess('Aktivitas dilanjutkan! Sesi baru sudah dimulai.');
        setOngoingTasks(prev => prev.filter(t => getTaskId(t) !== taskId));
        setTimeout(() => fetchCekAktivitas(effectiveIdPegawai), 800);
        setTimeout(() => fetchCekAktivitas(effectiveIdPegawai), 2500);
      } else {
        setOngoingTasks(prev => prev.filter(t => getTaskId(t) !== taskId));
        setError('Aktivitas diakhiri, tapi gagal melanjutkan: ' + (lanjutRes?.message || 'Error'));
        setTimeout(() => fetchCekAktivitas(effectiveIdPegawai), 1000);
      }
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem.');
      patchTaskUI(taskId, { loadingAkhiriLanjut: false });
    }
  };

  // ─────────────────────────────────
  // API: Mulai aktivitas baru
  // ─────────────────────────────────
  const handleMulaiAktivitas = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingMulai(true);
    setError(''); setSuccess('');
    try {
      const endpoint = jenis === 'TUPOKSI' ? '/Tupoksi/simpanTupoksi' : '/Tupoksi/simpanNonTupoksi';
      const payload: any = { id_pegawai: effectiveIdPegawai, lokasi: '' };
      if (jenis === 'TUPOKSI') {
        if (!idTupoksi) throw new Error('Pilih Tupoksi terlebih dahulu.');
        if (!keterangan.trim()) throw new Error('Keterangan tidak boleh kosong.');
        payload.id_tupoksi = idTupoksi;
        payload.deskr_tupoksi = keterangan;
        payload.keterangan = keterangan;
      } else {
        if (!tugasNonTupoksi.trim()) throw new Error('Nama tugas tidak boleh kosong.');
        payload.tugas = tugasNonTupoksi;
        payload.keterangan = keterangan;
        payload.deskr_tupoksi = keterangan;
      }
      const res = await sendRequest(endpoint, payload);
      if (res?.success) {
        setSuccess('Aktivitas baru berhasil dimulai!');
        setKeterangan(''); setTugasNonTupoksi(''); setIdTupoksi(''); setNamaTupoksiTerpilih('');
        await fetchCekAktivitas(effectiveIdPegawai, { soft: true });
      } else {
        setError(res?.message || 'Gagal memulai aktivitas.');
      }
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setLoadingMulai(false);
    }
  };

  // ─────────────────────────────────
  // Pegawai handlers
  // ─────────────────────────────────
  const handleSelectPegawai = (p: any) => {
    setSearchPegawai(`${p.nama} (${p.nip})`);
    setShowPegawaiDropdown(false);
    setOngoingTasks([]);
    setHasChecked(false);
    hasCheckedRef.current = false;
    loadPegawaiDatabase().then(fullDb => {
      const fullUser = fullDb.find((item: any) => item.id === p.id || item.nip === p.nip);
      setSelectedTargetPegawai(fullUser || p);
    });
  };

  const handleClearPegawaiSelection = () => {
    setSearchPegawai('');
    setOngoingTasks([]);
    setHasChecked(false);
    hasCheckedRef.current = false;
    setSelectedTargetPegawai(null);
  };

  if (!pegawai) return null;

  const hasActiveTasks = ongoingTasks.length > 0;

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes expandDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>

      <div className="w-full mx-auto bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm overflow-hidden flex flex-col p-6 sm:p-8 relative">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Produktivitas Harian</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Submit produktivitas kinerja harian</p>
            </div>
          </div>
          <button
            onClick={() => fetchCekAktivitas(effectiveIdPegawai, { soft: true })}
            disabled={checkingStatus}
            className="p-2 rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all disabled:opacity-40 cursor-pointer"
            title="Refresh status aktivitas"
          >
            <RefreshCw className={`w-4 h-4 ${checkingStatus ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="space-y-4">

          {/* ── Notifikasi ── */}
          {error && (
            <div className="p-4 bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20 font-medium text-sm rounded-xl flex items-start gap-3 shadow-sm" style={{ animation: 'fadeInUp 0.2s ease-out' }}>
              <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}
          {success && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 font-medium text-sm rounded-xl flex items-start gap-3 shadow-sm" style={{ animation: 'fadeInUp 0.2s ease-out' }}>
              <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{success}</span>
            </div>
          )}

          {/* ── Cari & Pilih Pegawai ── */}
          {canSearchPegawai ? (
            <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-3 relative z-40">
              <div className="relative" ref={dropdownRef}>
                <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                  <User className="w-4 h-4 text-emerald-500" />
                  Cari &amp; Pilih Pegawai <span className="font-normal text-slate-400 text-xs">(Opsional)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchPegawai}
                    onChange={(e) => { setSearchPegawai(e.target.value); setShowPegawaiDropdown(true); }}
                    onFocus={() => setShowPegawaiDropdown(true)}
                    placeholder="Ketik nama atau NIP pegawai..."
                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400 font-medium placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-slate-100 shadow-sm"
                  />
                  <div className="absolute left-3 top-3 text-slate-400"><Search className="w-4 h-4" /></div>
                  {searchPegawai && (
                    <button type="button" onClick={handleClearPegawaiSelection} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {showPegawaiDropdown && (
                  <div className="absolute left-0 right-0 mt-1.5 max-h-56 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 divide-y divide-slate-100 dark:divide-slate-700/50 custom-scrollbar">
                    {loadingPegawai ? (
                      <div className="p-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" /> Memuat database pegawai...
                      </div>
                    ) : pegawaiLoadError ? (
                      <div className="p-4 text-center text-xs text-rose-500" role="alert">
                        <p>Database pegawai gagal dimuat.</p>
                        <button type="button" onClick={() => setPegawaiLoadAttempt(value => value + 1)} className="mt-2 inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                          <RefreshCw className="h-3 w-3" /> Coba lagi
                        </button>
                      </div>
                    ) : filteredPegawai.length === 0 ? (
                      <div className="p-4 text-center text-slate-400 text-xs font-medium">
                        {searchPegawai.trim() === '' ? 'Ketik nama atau NIP untuk mencari' : 'Pegawai tidak ditemukan'}
                      </div>
                    ) : (
                      filteredPegawai.map((p) => (
                        <button key={p.id} type="button" onClick={() => handleSelectPegawai(p)}
                          className="w-full text-left p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex flex-col gap-0.5 cursor-pointer">
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{p.nama}</span>
                          <span className="text-xs font-mono text-slate-500 dark:text-slate-400 flex items-center gap-2">
                            <span>NIP: {p.nip}</span>
                            <span className="text-slate-300 dark:text-slate-700">|</span>
                            <span className="truncate">{p.nama_instansi}</span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {selectedTargetPegawai ? (
                <div className="p-3.5 rounded-xl border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/40 dark:bg-emerald-950/10 flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Pegawai Terpilih</span>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-white mt-0.5">{selectedTargetPegawai.nama}</h4>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">NIP: <span className="font-mono">{selectedTargetPegawai.nip}</span></p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{selectedTargetPegawai.unor || selectedTargetPegawai.nama_instansi || selectedTargetPegawai.instansi}</p>
                  </div>
                  <button type="button" onClick={handleClearPegawaiSelection}
                    className="text-xs font-bold text-red-600 hover:text-red-700 dark:text-red-400 flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 border border-red-100 dark:border-red-950/30 transition-colors shrink-0 cursor-pointer">
                    Reset
                  </button>
                </div>
              ) : (
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/20 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  Akun login: <strong className="text-slate-700 dark:text-slate-300">{pegawai?.nama}</strong>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/20 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                Aktivitas untuk: <strong className="text-slate-700 dark:text-slate-300">{pegawai?.nama}</strong>
              </div>
            </div>
          )}

          {/* ── Skeleton loading (hanya load pertama) ── */}
          {checkingStatus && !hasChecked && (
            <div className="animate-pulse space-y-2">
              <div className="h-14 bg-slate-100 dark:bg-slate-700/50 rounded-2xl" />
              <div className="h-14 bg-slate-100 dark:bg-slate-700/50 rounded-2xl w-3/4" />
            </div>
          )}

          {/* ════════════════════════════════════════════════════════
              ACTIVE TASKS SECTION
          ════════════════════════════════════════════════════════ */}
          {hasChecked && hasActiveTasks && (
            <div className="space-y-2">
              {/* Section label */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="relative flex w-2.5 h-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                    <span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-orange-500" />
                  </span>
                  <span className="text-xs font-bold text-orange-700 dark:text-orange-400 uppercase tracking-widest">
                    {ongoingTasks.length} Aktivitas Berjalan
                  </span>
                </div>
              </div>

              {/* Task cards */}
              {ongoingTasks.map((task) => {
                const taskId = getTaskId(task);
                const ui = taskUIMap[taskId] ?? {
                  expanded: false, photo: null, photoInfo: '', isPhotoLoading: false,
                  isCameraActive: false, loadingAkhiri: false, loadingAkhiriLanjut: false, photoModalImg: null,
                };
                const refs = ensureTaskRefs(taskId);
                return (
                  <ActiveTaskCard
                    key={taskId}
                    task={task}
                    uiState={ui}
                    elapsedShort={elapsedTimers[taskId] || ''}
                    effectiveIdPegawai={effectiveIdPegawai}
                    isMobile={isMobile}
                    onToggleExpand={() => patchTaskUI(taskId, { expanded: !ui.expanded })}
                    onAkhiri={() => handleAkhiriTask(task)}
                    onAkhiriDanLanjutkan={() => handleAkhiriDanLanjutkanTask(task)}
                    onSetPhoto={(photo, info) => patchTaskUI(taskId, { photo: photo ?? null, photoInfo: info ?? '' })}
                    onSetPhotoLoading={(v) => patchTaskUI(taskId, { isPhotoLoading: v })}
                    onSetCameraActive={(v) => patchTaskUI(taskId, { isCameraActive: v })}
                    onSetPhotoModal={(img) => patchTaskUI(taskId, { photoModalImg: img })}
                    videoRef={refs.video}
                    streamRef={refs.stream}
                    cameraInputRef={refs.camera}
                    galleryInputRef={refs.gallery}
                  />
                );
              })}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════
              NEW ACTIVITY FORM — always visible once checked
          ════════════════════════════════════════════════════════ */}
          {hasChecked && (
            <div className={`rounded-2xl border transition-colors duration-200 ${hasActiveTasks ? 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/40 dark:bg-emerald-950/10' : 'border-slate-200 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/20'}`}>

              {/* Header form */}
              <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${hasActiveTasks ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    {hasActiveTasks ? 'Mulai Aktivitas Paralel' : 'Input Aktivitas Baru'}
                  </h4>
                  {hasActiveTasks && (
                    <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 font-medium">Berjalan bersamaan dengan aktivitas di atas</p>
                  )}
                </div>
              </div>

              <form onSubmit={handleMulaiAktivitas} className="px-4 pb-4 space-y-4">

                {/* Jenis */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Jenis Aktivitas</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['TUPOKSI', 'NON_TUPOKSI'] as const).map((j) => (
                      <button key={j} type="button"
                        onClick={() => { setJenis(j); setIdTupoksi(''); setNamaTupoksiTerpilih(''); }}
                        className={`py-2.5 px-4 rounded-xl font-semibold text-sm transition-all border cursor-pointer ${
                          jenis === j
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-500 dark:text-emerald-400 shadow-sm'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
                        }`}
                      >
                        {j === 'TUPOKSI' ? 'Tupoksi' : 'Non Tupoksi'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pilih Tupoksi */}
                {jenis === 'TUPOKSI' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Pilih Tupoksi</label>
                    <button type="button" onClick={() => setShowTupoksiModal(true)}
                      className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-emerald-600 text-slate-800 dark:text-slate-200 rounded-xl p-3.5 outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-sm text-left flex justify-between items-center gap-2 cursor-pointer">
                      <span className={`truncate ${!idTupoksi ? 'text-slate-400' : ''}`}>
                        {idTupoksi ? namaTupoksiTerpilih || 'Tupoksi Terpilih' : '-- Pilih Tupoksi --'}
                      </span>
                      <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                    </button>
                  </div>
                )}

                {/* Nama tugas Non Tupoksi */}
                {jenis === 'NON_TUPOKSI' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Nama Tugas</label>
                    <input type="text" value={tugasNonTupoksi} onChange={(e) => setTugasNonTupoksi(e.target.value)}
                      placeholder="Contoh: Rapat koordinasi lintas seksi..."
                      className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 text-slate-800 dark:text-slate-200 rounded-xl p-3.5 outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-sm" />
                  </div>
                )}

                {/* Keterangan */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Keterangan / Uraian Kegiatan</label>
                  <textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)}
                    placeholder="Jelaskan detail kegiatan yang akan dilakukan..."
                    rows={3}
                    className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 text-slate-800 dark:text-slate-200 rounded-xl p-3.5 outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-sm resize-none custom-scrollbar" />
                </div>

                <button type="submit" disabled={loadingMulai}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3.5 px-4 rounded-xl shadow-[0_4px_12px_rgba(5,150,105,0.2)] transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]">
                  {loadingMulai
                    ? <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Menyimpan...</>
                    : <><Save className="w-5 h-5" /> Mulai Aktivitas</>
                  }
                </button>
              </form>
            </div>
          )}

        </div>

        {/* ── Modal Pilih Tupoksi ── */}
        {showTupoksiModal && (
          <div className="modal-layer fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
              <div className="p-5 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
                <h4 className="font-bold text-lg text-slate-800 dark:text-white">Pilih Tupoksi</h4>
                <button onClick={() => { setShowTupoksiModal(false); setSearchTupoksi(''); }}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 border-b border-slate-100 dark:border-slate-700/40">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" placeholder="Cari tupoksi..." value={searchTupoksi} onChange={(e) => setSearchTupoksi(e.target.value)} autoFocus
                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800 dark:text-slate-200 transition-all" />
                </div>
              </div>
              <div className="overflow-y-auto flex-1 custom-scrollbar">
                {tupoksiList.filter((item) => (item.nama_tupoksi || item.tugas || item.nama_tugas || item.aktifitas || '').toLowerCase().includes(searchTupoksi.toLowerCase())).length === 0 ? (
                  <div className="p-12 flex flex-col items-center justify-center text-center">
                    <Activity className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-3" />
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                      {tupoksiList.length === 0 ? 'Data tupoksi tidak tersedia.' : 'Tidak ditemukan hasil pencarian.'}
                    </p>
                  </div>
                ) : (
                  tupoksiList.filter((item) => (item.nama_tupoksi || item.tugas || item.nama_tugas || item.aktifitas || '').toLowerCase().includes(searchTupoksi.toLowerCase()))
                    .map((item, i) => {
                      const idVal = item.id_tupoksi || item.id_aktifitas || item.id;
                      const namaVal = item.nama_tupoksi || item.tugas || item.nama_tugas || item.aktifitas || item.jenis || '—';
                      const isSelected = idVal === idTupoksi;
                      return (
                        <button key={i} type="button"
                          onClick={() => { setIdTupoksi(idVal); setNamaTupoksiTerpilih(namaVal); setShowTupoksiModal(false); setSearchTupoksi(''); }}
                          className={`w-full text-left px-5 py-4 transition-colors flex items-start gap-3 border-b border-slate-100 dark:border-slate-700/40 last:border-0 cursor-pointer group ${isSelected ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
                          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 transition-colors ${isSelected ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600 group-hover:bg-emerald-400'}`} />
                          <p className={`text-sm leading-relaxed ${isSelected ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white'}`}>
                            {namaVal}
                          </p>
                        </button>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
