import React, { useEffect, useRef, useState } from 'react';
import { FileCheck, FilePlus, Search, CheckCircle, AlertTriangle, Send, X, Paperclip, UploadCloud, FileText, ChevronDown, Loader2, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppContext } from '../context/AppContext';
import { sendRequest, sendMultipart } from '../api';
import DatePicker from '../components/ui/DatePicker';
import { formatBeautifulDateTime, getTodayWIB, getTodayWIBWithOffset } from '../lib/dateFormatter';
import ImageLightbox from '../components/ui/ImageLightbox';
import { useBackButton } from '../hooks/useBackButton';
import { usePegawaiSearch } from '../hooks/usePegawaiSearch';
import { loadPegawaiSearchList } from '../lib/pegawaiData';

interface JenisIzin { id: string; nama: string; }
interface FormState {
  id_jenis_ijin_cuti: string;
  tgl_mulai: string;
  tgl_selesai: string;
  keterangan: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const MAX_FILE_SIZE_MB = 5;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx'];

function useLazyPegawaiList(enabled: boolean) {
  const [pegawaiList, setPegawaiList] = useState<any[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    loadPegawaiSearchList().then(list => {
      if (mounted) setPegawaiList(list);
    }).catch(error => {
      console.error('Gagal memuat daftar pegawai:', error);
    });
    return () => { mounted = false; };
  }, [enabled]);

  return pegawaiList;
}

function IzinForm() {
  const { pegawai, config, tabPermissions, userRole } = useAppContext();
  const canSearchPegawai = userRole === 'admin' || tabPermissions.allowSearchIzin;
  const pegawaiList = useLazyPegawaiList(canSearchPegawai);
  const { selectedPegawai, setSelectedPegawai, searchPegawai, setSearchPegawai, showPegawaiDropdown, setShowPegawaiDropdown, pegawaiDropdownRef, filteredPegawai } = usePegawaiSearch(pegawaiList, { maxResults: 50 });
  const today = getTodayWIB();
  const [form, setForm] = useState<FormState>({ id_jenis_ijin_cuti: '', tgl_mulai: today, tgl_selesai: today, keterangan: '' });
  const [jenisIzinList, setJenisIzinList] = useState<JenisIzin[]>([]);
  const [loadingJenis, setLoadingJenis] = useState(false);
  const [jenisDropdownOpen, setJenisDropdownOpen] = useState(false);
  const jenisDropdownRef = useRef<HTMLDivElement>(null);
  const [lampiranFile, setLampiranFile] = useState<File | null>(null);
  const [lampiranError, setLampiranError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const fetchJenisIzin = async () => {
    if (!pegawai) return;
    setLoadingJenis(true);
    try {
      const targetId = selectedPegawai ? (selectedPegawai.id || selectedPegawai.id_pegawai) : config.idPegawai;
      const res = await sendRequest('/izin/jenis_izin', { id_pegawai: targetId || config.idPegawai });
      if (res?.success && Array.isArray(res.data)) setJenisIzinList(res.data);
      else if (Array.isArray(res)) setJenisIzinList(res);
    } catch (err: any) {
      console.error('Gagal memuat jenis izin:', err.message);
    } finally { setLoadingJenis(false); }
  };

  useEffect(() => {
    fetchJenisIzin();
    setForm(prev => ({ ...prev, id_jenis_ijin_cuti: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pegawai, selectedPegawai]);

  useEffect(() => {
    const closeDropdown = (event: MouseEvent) => {
      if (jenisDropdownRef.current && !jenisDropdownRef.current.contains(event.target as Node)) setJenisDropdownOpen(false);
    };
    document.addEventListener('mousedown', closeDropdown);
    return () => document.removeEventListener('mousedown', closeDropdown);
  }, []);

  useBackButton(() => { setIsConfirmOpen(false); return true; }, isConfirmOpen);

  const removeFile = () => {
    setLampiranFile(null); setLampiranError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processFile = (file: File) => {
    setLampiranError('');
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_MIME.includes(file.type) && !ALLOWED_EXTENSIONS.includes(extension)) {
      setLampiranError('Format tidak didukung. Gunakan JPG, JPEG, PNG, WEBP, PDF, DOC, atau DOCX.');
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setLampiranError(`Ukuran file maksimum ${MAX_FILE_SIZE_MB} MB.`);
      return;
    }
    setLampiranFile(file);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) processFile(file);
    event.target.value = '';
  };

  const handleFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingFile(false);
    const file = event.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleSubmit = async () => {
    setIsConfirmOpen(false); setSuccessMsg(''); setErrorMsg(''); setLoading(true);
    try {
      const targetPegawai = selectedPegawai || pegawai;
      const targetId = selectedPegawai ? (selectedPegawai.id || selectedPegawai.id_pegawai || selectedPegawai.nip) : config.idPegawai;
      const fields: Record<string, string> = { id_pegawai: targetId, id_jenis_ijin_cuti: form.id_jenis_ijin_cuti, tgl_mulai: form.tgl_mulai, tgl_selesai: form.tgl_selesai, keterangan: form.keterangan.trim(), nip: String(targetPegawai?.nip || '') };
      let filePayload: { base64: string; filename: string; mimeType: string } | undefined;
      if (lampiranFile) filePayload = { base64: await fileToBase64(lampiranFile), filename: lampiranFile.name, mimeType: lampiranFile.type };
      const data = await sendMultipart('/Izin/insert_ijin', fields, filePayload);
      if (data?.success || data?.status === 'success' || data?.code === 200 || data?.code === '200') {
        setSuccessMsg(data.message || 'Pengajuan izin berhasil dikirim!');
        setForm({ id_jenis_ijin_cuti: '', tgl_mulai: today, tgl_selesai: today, keterangan: '' });
        removeFile();
      } else setErrorMsg(data.message || data.error || 'Pengajuan gagal. Silakan coba lagi.');
    } catch (err: any) {
      setErrorMsg(`Network Error: ${err.message}`);
    } finally { setLoading(false); }
  };

  const validationError = !form.id_jenis_ijin_cuti ? 'Jenis izin wajib dipilih.' : !form.tgl_mulai ? 'Tanggal mulai wajib diisi.' : !form.tgl_selesai ? 'Tanggal selesai wajib diisi.' : form.tgl_selesai < form.tgl_mulai ? 'Tanggal selesai tidak boleh sebelum tanggal mulai.' : !form.keterangan.trim() ? 'Keterangan wajib diisi.' : '';
  const selectedJenisNama = jenisIzinList.find(item => item.id === form.id_jenis_ijin_cuti)?.nama ?? '';
  const activePegawai = selectedPegawai || pegawai;

  if (!pegawai) return null;
  return (
    <div className="w-full mx-auto space-y-5 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
      <h3 className="text-lg font-bold text-slate-800 dark:text-white border-b-2 border-blue-500 pb-2 mb-4 flex items-center gap-2"><FilePlus className="w-5 h-5 text-blue-500" /> Pengajuan Izin / Cuti</h3>
      {canSearchPegawai ? <div className="p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200/60 dark:border-slate-700/50 relative z-30"><div className="flex flex-col md:flex-row md:items-center justify-between gap-4"><div><p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Pengajuan Untuk</p><p className="text-sm font-bold text-slate-800 dark:text-slate-200">{selectedPegawai ? selectedPegawai.nama : pegawai.nama}</p><p className="text-xs text-slate-500">NIP: {selectedPegawai ? selectedPegawai.nip : pegawai.nip}</p></div><div className="relative w-full md:w-80" ref={pegawaiDropdownRef}><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" /><input value={searchPegawai} onChange={event => { setSearchPegawai(event.target.value); setShowPegawaiDropdown(true); }} onFocus={() => setShowPegawaiDropdown(true)} placeholder="Cari nama atau NIP pegawai..." className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-14 py-2 text-xs font-bold" />{selectedPegawai && <button type="button" onClick={() => { setSelectedPegawai(null); setSearchPegawai(''); }} className="absolute right-3 top-2 text-[10px] font-bold text-rose-500">Reset</button>}{showPegawaiDropdown && <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50">{filteredPegawai.slice(0, 10).map((item: any) => <button key={item.id} type="button" onClick={() => { setSelectedPegawai(item); setSearchPegawai(''); setShowPegawaiDropdown(false); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700"><span className="block text-xs font-bold">{item.nama}</span><span className="block text-[10px] text-slate-400">NIP: {item.nip}</span></button>)}</div>}</div></div></div> : <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl"><p className="text-xs font-bold">{pegawai.nama}</p><p className="text-xs text-slate-500">{pegawai.nip}</p></div>}
      <div ref={jenisDropdownRef}><label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">Jenis Izin / Cuti <span className="text-red-500">*</span></label><button type="button" onClick={() => setJenisDropdownOpen(value => !value)} disabled={loadingJenis} className="w-full flex items-center justify-between bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-3 text-sm text-left"><span>{loadingJenis ? 'Memuat jenis izin...' : selectedJenisNama || 'Pilih jenis izin / cuti'}</span>{loadingJenis ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}</button>{jenisDropdownOpen && <div className="mt-1 max-h-56 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl">{jenisIzinList.map(item => <button key={item.id} type="button" onClick={() => { setForm(prev => ({ ...prev, id_jenis_ijin_cuti: item.id })); setJenisDropdownOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 dark:hover:bg-slate-700">{item.nama}</button>)}</div>}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><DatePicker label="Tanggal Mulai *" value={form.tgl_mulai} onChange={value => setForm(prev => ({ ...prev, tgl_mulai: value }))} /><DatePicker label="Tanggal Selesai *" value={form.tgl_selesai} onChange={value => setForm(prev => ({ ...prev, tgl_selesai: value }))} /></div>
      <div><label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">Keterangan / Alasan <span className="text-red-500">*</span></label><textarea rows={4} value={form.keterangan} onChange={event => setForm(prev => ({ ...prev, keterangan: event.target.value }))} className="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-3 text-sm resize-none" placeholder="Tulis alasan / keterangan pengajuan izin..." /></div>
      <div>
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">
          Lampiran <span className="font-normal text-slate-400">(opsional)</span>
        </label>
        {lampiranFile ? (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm dark:bg-slate-800 dark:text-blue-400">
              {lampiranFile.type.startsWith('image/') ? <Paperclip className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{lampiranFile.name}</p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{formatFileSize(lampiranFile.size)} · Siap dilampirkan</p>
            </div>
            <button type="button" onClick={removeFile} aria-label="Hapus lampiran" className="rounded-lg p-2 text-rose-500 transition-colors hover:bg-rose-100 dark:hover:bg-rose-950/40">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click(); }}
            onDragEnter={event => { event.preventDefault(); setIsDraggingFile(true); }}
            onDragOver={event => { event.preventDefault(); setIsDraggingFile(true); }}
            onDragLeave={event => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDraggingFile(false); }}
            onDrop={handleFileDrop}
            className={`group cursor-pointer rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-all ${isDraggingFile ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30' : 'border-slate-300 bg-slate-50/70 hover:border-blue-400 hover:bg-blue-50/60 dark:border-slate-600 dark:bg-slate-900/40 dark:hover:border-blue-500 dark:hover:bg-blue-950/20'}`}
          >
            <div className={`mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full transition-colors ${isDraggingFile ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-600 group-hover:bg-blue-600 group-hover:text-white dark:bg-blue-950/60 dark:text-blue-400'}`}>
              <UploadCloud className="h-5 w-5" />
            </div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Tarik dan lepas file di sini</p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">atau klik untuk memilih dari perangkat</p>
            <p className="mt-3 text-[10px] font-medium text-slate-400 dark:text-slate-500">Format: JPG, JPEG, PNG, WEBP, PDF, DOC, DOCX · Maks. {MAX_FILE_SIZE_MB} MB</p>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx" onChange={handleFileChange} className="hidden" />
        {lampiranError && <p className="mt-2 text-xs font-medium text-red-500">{lampiranError}</p>}
      </div>
      {errorMsg && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm">{errorMsg}</div>}{successMsg && <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl text-sm">{successMsg}</div>}
      <button type="button" disabled={loading} onClick={() => { setErrorMsg(validationError); if (!validationError) setIsConfirmOpen(true); }} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />} {loading ? 'Mengirim Pengajuan...' : 'Kirim Pengajuan Izin'}</button>
      <AnimatePresence>{isConfirmOpen && <div className="modal-layer fixed inset-0 z-[150] flex items-center justify-center p-4"><motion.div className="absolute inset-0 bg-slate-950/80" onClick={() => setIsConfirmOpen(false)} /><motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-2xl z-10"><div className="flex justify-between mb-4"><b>Konfirmasi Pengajuan Izin</b><button type="button" onClick={() => setIsConfirmOpen(false)}><X className="w-4 h-4" /></button></div><p className="text-sm text-slate-600 dark:text-slate-300 mb-5">{activePegawai?.nama} - {selectedJenisNama}<br />{form.tgl_mulai} s/d {form.tgl_selesai}<br />{form.keterangan}</p><div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setIsConfirmOpen(false)} className="py-3 border rounded-xl font-bold">Batal</button><button type="button" onClick={handleSubmit} className="py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center gap-1"><Check className="w-4 h-4" /> Ya, Kirim</button></div></motion.div></div>}</AnimatePresence>
    </div>
  );
}

export default function Izin() {
  const { pegawai, config, tabPermissions, userRole } = useAppContext();
  const canPengajuan = userRole === 'admin' || tabPermissions.tabPengajuanIzin;
  const canHistory = userRole === 'admin' || tabPermissions.tabIzin;
  const [activeTab, setActiveTab] = useState<'pengajuan' | 'history'>(() => canPengajuan ? 'pengajuan' : 'history');

  // Boleh cari pegawai lain jika admin atau permission allowSearchIzin aktif
  const canSearchIzin = userRole === 'admin' || tabPermissions.allowSearchIzin;
  const pegawaiList = useLazyPegawaiList(canSearchIzin);

  const {
    selectedPegawai,
    setSelectedPegawai,
    searchPegawai,
    setSearchPegawai,
    showPegawaiDropdown,
    setShowPegawaiDropdown,
    pegawaiDropdownRef,
    filteredPegawai,
  } = usePegawaiSearch(pegawaiList, { maxResults: 50 });
  
  const [tglAwal, setTglAwal] = useState(getTodayWIBWithOffset(-3));
  const [tglAkhir, setTglAkhir] = useState(getTodayWIB());
  
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [modalImg, setModalImg] = useState<{src: string, title: string} | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);

  // Hook up back button to close lightbox
  useBackButton(() => {
    setModalImg(null);
    return true;
  }, !!modalImg);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      if (data && visibleCount < data.length) {
        setVisibleCount(prev => prev + 50);
      }
    }
  };

  const fetchIzin = async () => {
    setLoading(true);
    setError('');
    setData(null);
    setVisibleCount(50);
    // Jika tidak punya izin search, selalu gunakan id sendiri
    const effectivePegawai = canSearchIzin ? selectedPegawai : null;
    const targetIdPegawai = effectivePegawai ? effectivePegawai.id : config.idPegawai;
    const payload = {
      id_pegawai: targetIdPegawai,
      tgl_awal: tglAwal,
      tgl_akhir: tglAkhir
    };
    try {
      const res = await sendRequest("/izin/history_Izin", payload);
      if (res && res.success && res.data && res.data.length > 0) {
        setData(res.data);
      } else {
        setError('History kosong.');
      }
    } catch (err: any) {
      setError(`Network Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!pegawai) {
    return null; // App.tsx will auto-redirect to tabLogin
  }

  return (
    <div className="w-full mx-auto space-y-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
      <h3 className="text-lg font-bold text-slate-800 dark:text-white border-b-2 border-teal-500 pb-2 mb-4 flex items-center gap-2">
        <FileCheck className="w-5 h-5 text-teal-500" /> Izin / Cuti
      </h3>

      <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-900/60 rounded-xl" role="tablist" aria-label="Menu Izin/Cuti">
        {canPengajuan && <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pengajuan'}
          onClick={() => setActiveTab('pengajuan')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-colors ${activeTab === 'pengajuan' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
        >
          <FilePlus className="w-4 h-4" /> Pengajuan Izin / Cuti
        </button>}
        {canHistory && <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'history'}
          onClick={() => setActiveTab('history')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-colors ${activeTab === 'history' ? 'bg-white dark:bg-slate-700 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
        >
          <FileCheck className="w-4 h-4" /> History Izin
        </button>}
      </div>

      {activeTab === 'pengajuan' && canPengajuan ? <IzinForm /> : canHistory ? <>

      {/* Search Pegawai Section - hanya tampil jika punya izin */}
      {canSearchIzin ? (
      <div className={`mb-6 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200/60 dark:border-slate-700/50 relative ${showPegawaiDropdown ? 'z-[60]' : 'z-30'}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">
              Cek History Izin / Cuti
            </span>
            <h4 className="text-sm font-bold text-slate-850 dark:text-slate-200 flex items-center gap-1.5">
              {selectedPegawai ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-teal-500 animate-pulse inline-block" />
                  <span>Menelusuri Pegawai Lain</span>
                </>
              ) : (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                  <span>Data Login Anda</span>
                </>
              )}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {selectedPegawai 
                ? `Nama: ${selectedPegawai.nama} • NIP: ${selectedPegawai.nip}`
                : `Nama: ${pegawai.nama} • NIP: ${pegawai.nip}`
              }
            </p>
          </div>

          <div className="relative w-full md:w-80" ref={pegawaiDropdownRef}>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={searchPegawai}
                onChange={(e) => {
                  setSearchPegawai(e.target.value);
                  setShowPegawaiDropdown(true);
                }}
                onFocus={() => setShowPegawaiDropdown(true)}
                placeholder="Cari nama atau NIP pegawai..."
                className="w-full bg-white dark:bg-slate-800 text-slate-850 dark:text-white placeholder-slate-400 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-14 py-2 text-xs font-bold focus:outline-none focus:border-teal-500 shadow-sm"
              />
              {selectedPegawai && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPegawai(null);
                    setSearchPegawai('');
                  }}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-rose-500 hover:text-rose-600 font-bold text-[10px]"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Dropdown list */}
            {showPegawaiDropdown && (
              <div className="absolute right-0 left-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-[70] divide-y divide-slate-100 dark:divide-slate-700/50 custom-scrollbar">
                {filteredPegawai.length === 0 ? (
                  <div className="p-3 text-center text-slate-400 text-xs">
                    Pegawai tidak ditemukan.
                  </div>
                ) : (
                  filteredPegawai.slice(0, 10).map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedPegawai(p);
                        setSearchPegawai('');
                        setShowPegawaiDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer block"
                    >
                      <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{p.nama}</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">NIP: {p.nip} {p.nama_instansi ? `• ${p.nama_instansi}` : ''}</span>
                    </button>
                  ))
                )}
                {filteredPegawai.length > 10 && (
                  <div className="p-1.5 bg-slate-50 dark:bg-slate-900/40 text-center text-[9px] text-slate-400 font-medium">
                    Menampilkan 10 teratas. Gunakan pencarian lebih spesifik.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      ) : (
        /* Info banner: hanya menampilkan data sendiri */
        <div className="mb-6 p-3 bg-teal-50 dark:bg-teal-900/20 rounded-2xl border border-teal-200/60 dark:border-teal-700/50 flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 inline-block" />
          <div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Data Login Anda</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{pegawai.nama} • NIP: {pegawai.nip}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DatePicker label="Tanggal Awal" value={tglAwal} onChange={setTglAwal} />
        <DatePicker label="Tanggal Akhir" value={tglAkhir} onChange={setTglAkhir} />
      </div>
      <button 
        onClick={fetchIzin}
        disabled={loading}
        className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl shadow-sm transition-colors mt-6 flex items-center justify-center gap-2"
      >
        <Search className="w-5 h-5" /> {loading ? 'Menarik Data...' : 'Tarik History Izin'}
      </button>

      {error && (
        <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20 font-medium text-sm rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {data && (
        <div 
          className="mt-6 p-4 bg-white dark:bg-slate-900/50 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800/80 text-sm rounded-xl overflow-x-auto max-h-[500px] custom-scrollbar shadow-sm"
          onScroll={handleScroll}
        >
          <div className="text-teal-600 dark:text-teal-400 font-bold mb-4 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> HISTORY IZIN & CUTI
          </div>
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] sm:text-sm">
              <tr>
                <th className="p-1.5 sm:p-3 font-semibold rounded-tl-lg whitespace-nowrap">Tanggal Pengajuan</th>
                <th className="p-1.5 sm:p-3 font-semibold whitespace-nowrap">Jenis Izin</th>
                <th className="p-1.5 sm:p-3 font-semibold whitespace-nowrap">Tanggal Pelaksanaan</th>
                <th className="p-1.5 sm:p-3 font-semibold whitespace-nowrap">Keterangan</th>
                <th className="p-1.5 sm:p-3 font-semibold rounded-tr-lg whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, visibleCount).map((item, i) => {
                let sts = (item.status || '').toUpperCase();
                let bcol = sts === 'DISETUJUI' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' : sts === 'DITOLAK' ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400';
                
                return (
                  <tr key={i} className="border-b border-slate-200 dark:border-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-[10px] sm:text-sm text-slate-700 dark:text-slate-300 transition-colors">
                    <td className="p-1.5 sm:p-3 align-top whitespace-nowrap">
                      {item.tgl_surat ? formatBeautifulDateTime(item.tgl_surat.split('T')[0]) : '-'}
                    </td>
                    <td className="p-1.5 sm:p-3 align-top min-w-[100px] sm:min-w-[120px] whitespace-normal">
                      <div className="font-bold text-blue-600 dark:text-blue-400 leading-tight">{item.cuti || '-'}</div>
                    </td>
                    <td className="p-1.5 sm:p-3 align-top whitespace-nowrap font-medium leading-tight">
                      {item.tgl_mulai ? formatBeautifulDateTime(item.tgl_mulai.split('T')[0]) : '-'} <span className="text-slate-400">s/d</span><br/>{item.tgl_selesai ? formatBeautifulDateTime(item.tgl_selesai.split('T')[0]) : '-'}
                    </td>
                    <td className="p-1.5 sm:p-3 align-top min-w-[120px] sm:min-w-[150px] whitespace-normal break-words leading-tight">
                      {item.keterangan || '-'}
                      {item.alasan_ditolak && sts === 'DITOLAK' && (
                        <div className="text-[9px] sm:text-xs text-red-500 dark:text-red-400 mt-1 font-medium">Alasan Tolak: {item.alasan_ditolak}</div>
                      )}
                    </td>
                    <td className="p-1.5 sm:p-3 align-top">
                      <span className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[9px] sm:text-xs font-bold block w-max leading-none ${bcol}`}>{item.status || '-'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalImg && (
        <ImageLightbox src={modalImg.src} title={modalImg.title} onClose={() => setModalImg(null)} />
      )}
      </> : null}
    </div>
  );
}
