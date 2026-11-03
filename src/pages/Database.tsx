import React, { useState, useEffect, useMemo } from 'react';
import { Database as DatabaseIcon, Search, Copy, Check, X, ChevronDown, User, Phone, Mail, MapPin, BookOpen, Users, Baby, Camera, ZoomIn, RefreshCw } from 'lucide-react';
import type { BiodataRecord } from '../data/database';
import { loadPegawaiDatabase } from '../lib/pegawaiData';
import { sendRequest } from '../api';
import { getTodayWIB, formatBeautifulDateTime } from '../lib/dateFormatter';
import LazyImage from '../components/ui/LazyImage';
import ImageLightbox from '../components/ui/ImageLightbox';
import { useAppContext } from '../context/AppContext';

export default function Database() {
  const { userRole, tabPermissions } = useAppContext();
  const canSearchDatabase = userRole === 'admin' || tabPermissions.allowSearchDatabase;
  const [search, setSearch] = useState('');
  const [selectedOpd, setSelectedOpd] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const [copyMessage, setCopyMessage] = useState('');
  const [pegawaiDatabase, setPegawaiDatabase] = useState<any[]>([]);
  const [loadingPegawai, setLoadingPegawai] = useState(true);
  const [pegawaiLoadError, setPegawaiLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);

  // States for detailed view modal
  const [selectedDetailPegawai, setSelectedDetailPegawai] = useState<any | null>(null);
  const [selectedDetailBiodata, setSelectedDetailBiodata] = useState<BiodataRecord | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // States for pegawai photo (from last presensi log)
  const [pegawaiPhoto, setPegawaiPhoto] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [photoMeta, setPhotoMeta] = useState<{ jam: string; tanggal: string } | null>(null);

  // Lightbox state for viewing photo full-screen
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // States for OPD custom modal selector
  const [isOpdModalOpen, setIsOpdModalOpen] = useState(false);
  const [opdSearchQuery, setOpdSearchQuery] = useState('');
  const photoRequestRef = React.useRef<AbortController | null>(null);
  const biodataRequestRef = React.useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingPegawai(true);
    setPegawaiLoadError('');
    loadPegawaiDatabase()
      .then(records => { if (!cancelled) setPegawaiDatabase(records); })
      .catch(error => {
        if (!cancelled) {
          console.error('Gagal memuat database pegawai:', error);
          setPegawaiLoadError('Database pegawai belum dapat dimuat.');
        }
      })
      .finally(() => { if (!cancelled) setLoadingPegawai(false); });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const simplifiedPegawai = useMemo(() => pegawaiDatabase.map((item: any) => ({
    id: item?.id || item?.id_pegawai || '',
    nip: item?.nip || '',
    nama: item?.nama || '',
    instansi: item?.instansi || '',
  })), [pegawaiDatabase]);

  const opdList = useMemo(() => Array.from(
    new Set(pegawaiDatabase.map((item: any) => item?.instansi).filter(Boolean))
  ).sort() as string[], [pegawaiDatabase]);

  // Debounce the search input to keep typing completely smooth
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setVisibleCount(50);
    }, 200);
    return () => clearTimeout(handler);
  }, [search]);

  // Memoized filtered data using pre-computed simplified list
  const filteredData = useMemo(() => {
    const term = debouncedSearch.toLowerCase().trim();
    if (!term && !selectedOpd) return simplifiedPegawai;
    return simplifiedPegawai.filter((item: any) => {
      const matchesOpd = !selectedOpd || item.instansi === selectedOpd;
      const matchesSearch = !term || (item.nip || '').toLowerCase().includes(term) || (item.nama || '').toLowerCase().includes(term) || (item.id || '').toLowerCase().includes(term);
      return matchesOpd && matchesSearch;
    });
  }, [debouncedSearch, selectedOpd, simplifiedPegawai]);

  const filteredOpdList = useMemo(() => {
    const term = opdSearchQuery.trim().toLowerCase();
    if (!term) return opdList;
    return opdList.filter(opdName => opdName.toLowerCase().includes(term));
  }, [opdSearchQuery, opdList]);

  useEffect(() => () => {
    photoRequestRef.current?.abort();
    biodataRequestRef.current += 1;
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      if (visibleCount < filteredData.length) {
        setVisibleCount(prev => prev + 50);
      }
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setCopyMessage(`✅ NIP ${text} disalin ke clipboard!`);
      setTimeout(() => {
        setCopiedIndex(null);
        setCopyMessage('');
      }, 4000);
    });
  };

  const handleSelectDetail = (nip: string) => {
    photoRequestRef.current?.abort();
    photoRequestRef.current = new AbortController();
    const biodataRequest = ++biodataRequestRef.current;

    const detail = pegawaiDatabase.find((item: any) => item?.nip === nip) || null;
    setSelectedDetailPegawai(detail || null);
    setSelectedDetailBiodata(null);

    if (nip) {
      import('../data/database')
        .then(({ getBiodataByNip }) => {
          if (biodataRequest === biodataRequestRef.current) {
            setSelectedDetailBiodata(getBiodataByNip(nip));
          }
        })
        .catch(error => console.error('Gagal memuat biodata pegawai:', error));
    }

    // Reset photo state and fetch latest presensi photo
    setPegawaiPhoto(null);
    setPhotoLoading(true);
    setPhotoError(false);
    setPhotoMeta(null);
    setLightboxOpen(false);

    if (detail?.id) {
      fetchLastPhoto(detail.id, photoRequestRef.current.signal);
    } else {
      setPhotoLoading(false);
      setPhotoError(true);
    }
  };

  // Helper: build photo URL from lampiran value (same logic as TabLog)
  const buildPhotoUrl = (lamp: string): string => {
    if (lamp.startsWith('/9j/') || lamp.startsWith('iVBOR')) {
      return `data:image/jpeg;base64,${lamp}`;
    } else if (lamp.startsWith('http')) {
      return lamp;
    }
    return `/api/proxy-image?path=${encodeURIComponent(lamp)}`;
  };

  // Helper: extract a valid photo URL from a log_detail API response
  // Helper: extract a valid photo URL + metadata from a log_detail API response
  const extractPhotoFromResponse = (res: any): { url: string; jam: string; tanggal: string } | null => {
    if (!res?.data || res.data.length === 0) return null;
    // Scan from newest entry to oldest
    for (let i = res.data.length - 1; i >= 0; i--) {
      const item = res.data[i];
      const lamp = (item.lampiran || item.foto || '').trim();
      if (lamp && lamp !== 'no_image.png' && !lamp.includes('no_image')) {
        return {
          url: buildPhotoUrl(lamp),
          jam: item.jam || '',
          tanggal: item.tanggal || item.tgl || '',
        };
      }
    }
    return null;
  };

  // Format Date to YYYY-MM-DD string
  const toDateStr = (dt: Date): string =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

  // Fetch the most recent presensi photo using a two-phase strategy:
  //   Phase 1: walk back up to 14 calendar days, weekdays only (Mon-Fri) - ~10 API calls max
  //   Phase 2: sample one representative weekday (Wednesday) per month, up to 6 months back
  const fetchLastPhoto = async (idPegawai: string, signal: AbortSignal) => {
    const today = getTodayWIB();
    const [y, m, d] = today.split('-').map(Number);

    // Phase 1: last 14 calendar days, weekdays only
    for (let offset = 0; offset < 14; offset++) {
      const dt = new Date(y, m - 1, d - offset);
      const dow = dt.getDay(); // 0=Sun, 6=Sat
      if (dow < 1 || dow > 5) continue; // skip weekends
      try {
        const res = await sendRequest('/logActivity/log_detail', {
          id_pegawai: idPegawai,
          tanggal: toDateStr(dt),
        }, { signal });
        if (signal.aborted) return;
        const found = extractPhotoFromResponse(res);
        if (found) {
          setPegawaiPhoto(found.url);
          setPhotoMeta({ jam: found.jam, tanggal: found.tanggal || toDateStr(dt) });
          setPhotoLoading(false);
          return;
        }
      } catch {
        if (signal.aborted) return;
        // Keep trying the next date when the request itself fails.
      }
    }

    // Phase 2: sample ~Wednesday of each month, 1-6 months back
    for (let mo = 1; mo <= 6; mo++) {
      // Start at the 15th of the target month, then walk to nearest Wednesday
      const base = new Date(y, m - 1 - mo, 15);
      const diffToWed = (3 - base.getDay() + 7) % 7; // days forward to reach Wed
      base.setDate(base.getDate() + (diffToWed <= 3 ? diffToWed : diffToWed - 7));
      try {
        const res = await sendRequest('/logActivity/log_detail', {
          id_pegawai: idPegawai,
          tanggal: toDateStr(base),
        }, { signal });
        if (signal.aborted) return;
        const found = extractPhotoFromResponse(res);
        if (found) {
          setPegawaiPhoto(found.url);
          setPhotoMeta({ jam: found.jam, tanggal: found.tanggal || toDateStr(base) });
          setPhotoLoading(false);
          return;
        }
      } catch {
        if (signal.aborted) return;
        // Keep trying the next month when the request itself fails.
      }
    }

    // No photo found after all attempts
    if (!signal.aborted) {
      setPhotoLoading(false);
      setPhotoError(true);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <DatabaseIcon className="w-5 h-5 text-blue-500" /> Database Pegawai
        </h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="relative md:col-span-2">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
            <Search className="w-5 h-5" />
          </span>
          <input 
            type="text" 
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setVisibleCount(50);
            }}
            disabled={!canSearchDatabase}
            placeholder="Cari NIP, Nama, atau ID Pegawai..." 
            className="w-full pl-10 pr-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm transition-all bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
        <div>
          <button
            type="button"
            onClick={() => setIsOpdModalOpen(true)}
            disabled={!canSearchDatabase}
            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm transition-all bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm text-left flex justify-between items-center cursor-pointer font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="truncate">
              {selectedOpd ? selectedOpd : '-- Semua OPD / Instansi --'}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
          </button>
        </div>
      </div>
      
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm flex flex-col bg-white dark:bg-slate-900">
        <div className="grid grid-cols-[50px_1fr_1.3fr] sm:grid-cols-[80px_200px_1fr] px-1 py-1.5 sm:px-2 sm:py-3 text-[10px] sm:text-sm font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
          <div className="text-center uppercase tracking-wider flex items-center justify-center font-bold text-[9px] sm:text-xs">Aksi</div>
          <div className="px-1.5 sm:px-6 text-left tracking-wider flex items-center uppercase sm:normal-case">NIP</div>
          <div className="px-1.5 sm:px-6 text-left tracking-wider flex items-center">Nama Pegawai</div>
        </div>
        
        <div className="overflow-y-auto max-h-[500px] custom-scrollbar bg-white dark:bg-slate-800" onScroll={handleScroll}>
          {filteredData.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
              {loadingPegawai ? 'Memuat database pegawai...' : pegawaiLoadError ? (
                <div className="flex flex-col items-center gap-3">
                  <span>{pegawaiLoadError}</span>
                  <button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                    <RefreshCw className="h-4 w-4" /> Coba lagi
                  </button>
                </div>
              ) : 'Data tidak ditemukan.'}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700/50">
              {filteredData.slice(0, visibleCount).map((item: any, index: number) => (
                <div key={index} className="grid grid-cols-[50px_1fr_1.3fr] sm:grid-cols-[80px_200px_1fr] px-1 py-1.5 sm:px-2 sm:py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors items-center text-[10px] sm:text-sm text-slate-700 dark:text-slate-300">
                  <div className="text-center flex justify-center">
                    <button 
                      onClick={() => copyToClipboard(item.nip, index)}
                      className={`p-1 sm:p-1.5 rounded transition-colors ${copiedIndex === index ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                      title="Copy NIP"
                    >
                      {copiedIndex === index ? <Check className="w-3 h-3 sm:w-4 sm:h-4" /> : <Copy className="w-3 h-3 sm:w-4 sm:h-4" />}
                    </button>
                  </div>
                  <div 
                    onClick={() => handleSelectDetail(item.nip)}
                    className="px-1.5 sm:px-6 font-mono font-medium truncate select-all cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    title="Klik untuk detail"
                  >
                    {item.nip}
                  </div>
                  <div 
                    onClick={() => handleSelectDetail(item.nip)}
                    className="px-1.5 sm:px-6 font-medium text-slate-800 dark:text-slate-200 truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    title="Klik untuk detail"
                  >
                    {item.nama}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-between items-center px-2">
        <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{copyMessage}</div>
        <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 ml-auto">Total: {filteredData.length} pegawai</div>
      </div>

      {/* MODAL DETAIL PEGAWAI */}
      {selectedDetailPegawai && (
        <>
        <div className="modal-layer fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-lg overflow-hidden transform transition-all animate-scale-up flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40 shrink-0">
              <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 text-base">
                <User className="w-5 h-5 text-indigo-500" /> Detail Pegawai
              </h3>
              <button
                onClick={() => { biodataRequestRef.current += 1; setSelectedDetailPegawai(null); setSelectedDetailBiodata(null); setPegawaiPhoto(null); setPhotoLoading(false); setPhotoError(false); setPhotoMeta(null); setLightboxOpen(false); }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1 text-sm text-slate-700 dark:text-slate-300">

              {/* ── Foto Presensi Terakhir ── */}
              <div className="flex flex-col items-center gap-3 py-2">
                {/* Photo container — clickable to open lightbox */}
                <div
                  className={`relative w-32 h-32 rounded-2xl overflow-hidden border-2 shadow-lg bg-slate-100 dark:bg-slate-900 flex-shrink-0 transition-all duration-200 ${
                    !photoLoading && !photoError && pegawaiPhoto
                      ? 'border-indigo-300 dark:border-indigo-600 cursor-pointer hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-xl group'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                  onClick={() => { if (pegawaiPhoto && !photoLoading) setLightboxOpen(true); }}
                >
                  {photoLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 gap-2">
                      <div className="w-7 h-7 border-2 border-indigo-300 dark:border-indigo-600 border-t-indigo-600 dark:border-t-indigo-400 rounded-full animate-spin" />
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Memuat foto...</span>
                    </div>
                  )}
                  {!photoLoading && photoError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-800 gap-1.5">
                      <User className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium text-center px-2 leading-snug">Foto belum<br/>tersedia</span>
                    </div>
                  )}
                  {!photoLoading && !photoError && pegawaiPhoto && (
                    <>
                      <LazyImage
                        src={pegawaiPhoto}
                        alt={`Foto ${selectedDetailBiodata?.nama || selectedDetailPegawai?.nama || ''}`}
                        eager
                        containerClassName="w-full h-full"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      {/* Hover overlay: zoom icon */}
                      <div className="absolute inset-0 bg-indigo-900/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                        <ZoomIn className="w-7 h-7 text-white drop-shadow-lg" />
                      </div>
                    </>
                  )}
                </div>

                {/* Name + metadata caption */}
                <div className="text-center space-y-1.5 w-full">
                  <div className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                    {selectedDetailBiodata?.nama || selectedDetailPegawai?.nama || '-'}
                  </div>

                  {/* Photo label + datetime */}
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex items-center gap-1.5">
                      <Camera className="w-3 h-3 text-indigo-400" />
                      <span className="text-[11px] text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wide">
                        Foto Presensi Terakhir
                      </span>
                    </div>
                    {photoMeta && !photoLoading && !photoError && (() => {
                      // Build a proper datetime string: combine tanggal (YYYY-MM-DD) with jam if jam is time-only
                      const jam = photoMeta.jam || '';
                      const tgl = photoMeta.tanggal || '';
                      const isTimeOnly = /^\d{2}:\d{2}/.test(jam) && !jam.includes('-');
                      const fullDt = isTimeOnly && tgl ? `${tgl} ${jam}` : (jam || tgl);

                      // Day-of-week in Indonesian
                      const DAYS_ID = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
                      let dayName = '';
                      if (tgl) {
                        try {
                          const [yy, mm, dd] = tgl.split('-').map(Number);
                          dayName = DAYS_ID[new Date(yy, mm - 1, dd).getDay()];
                        } catch { /* ignore */ }
                      }

                      const formatted = fullDt
                        ? ((): string => {
                            const m = fullDt.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
                            if (!m) return fullDt;
                            const MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
                            const d2 = parseInt(m[3], 10);
                            const mo = parseInt(m[2], 10) - 1;
                            const yr = m[1];
                            const base = `${d2} ${MONTHS[mo]} ${yr}`;
                            return m[4] && m[5] ? `${base}, ${m[4]}:${m[5]} WIB` : base;
                          })()
                        : '-';

                      return (
                        <div className="flex flex-col items-center gap-0.5">
                          {dayName && (
                            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{dayName}</span>
                          )}
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-700/60 px-2.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-600 whitespace-nowrap">
                            {formatted}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  {/* Hint: click photo to view fullscreen */}
                  {!photoLoading && !photoError && pegawaiPhoto && (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                      Klik foto untuk memperbesar &amp; unduh
                    </p>
                  )}
                </div>
              </div>

              {/* Identitas Utama */}
              <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800/40 space-y-1">
                <div className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 mb-1">Identitas</div>
                <div className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                  {selectedDetailBiodata?.nama || selectedDetailPegawai.nama || '-'}
                </div>
                <div className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">NIP: {selectedDetailPegawai.nip || '-'}</div>
                {selectedDetailBiodata?.nip_lama && (
                  <div className="text-xs font-mono text-slate-400">NIP Lama: {selectedDetailBiodata.nip_lama}</div>
                )}
                {selectedDetailBiodata?.nik && (
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400">NIK/KTP: <span className="select-all font-semibold">{selectedDetailBiodata.nik}</span></div>
                )}
              </div>

              {/* Biodata Pribadi */}
              {selectedDetailBiodata && (
                <div className="space-y-3">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <User className="w-3 h-3" /> Biodata Pribadi
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedDetailBiodata.ttl && (
                      <div className="col-span-2 space-y-0.5">
                        <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Tempat / Tgl Lahir</div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailBiodata.ttl}</div>
                      </div>
                    )}
                    {selectedDetailBiodata.jk && (
                      <div className="space-y-0.5">
                        <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Jenis Kelamin</div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailBiodata.jk}</div>
                      </div>
                    )}
                    {selectedDetailBiodata.agama && (
                      <div className="space-y-0.5">
                        <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Agama</div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailBiodata.agama}</div>
                      </div>
                    )}
                    {selectedDetailBiodata.perkawinan && (
                      <div className="space-y-0.5">
                        <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Status Kawin</div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailBiodata.perkawinan}</div>
                      </div>
                    )}
                    {selectedDetailBiodata.tgl_nikah && (
                      <div className="space-y-0.5">
                        <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Tgl Nikah</div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailBiodata.tgl_nikah}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Kontak */}
              {selectedDetailBiodata && (selectedDetailBiodata.hp || selectedDetailBiodata.email || selectedDetailBiodata.alamat) && (
                <div className="space-y-3">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <Phone className="w-3 h-3" /> Kontak & Alamat
                  </div>
                  <div className="space-y-2">
                    {selectedDetailBiodata.hp && (
                      <div className="flex items-start gap-2">
                        <Phone className="w-3.5 h-3.5 mt-0.5 text-emerald-500 shrink-0" />
                        <span className="font-semibold select-all">{selectedDetailBiodata.hp}</span>
                      </div>
                    )}
                    {selectedDetailBiodata.email && (
                      <div className="flex items-start gap-2">
                        <Mail className="w-3.5 h-3.5 mt-0.5 text-blue-500 shrink-0" />
                        <span className="font-semibold select-all break-all">{selectedDetailBiodata.email}</span>
                      </div>
                    )}
                    {selectedDetailBiodata.alamat && (
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 text-rose-500 shrink-0" />
                        <span className="font-medium leading-snug">{selectedDetailBiodata.alamat}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Kepegawaian */}
              <div className="space-y-3">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                      <DatabaseIcon className="w-3 h-3" /> Kepegawaian
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-0.5">
                    <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Jabatan</div>
                    <div className="font-semibold text-slate-900 dark:text-white leading-tight">
                      {selectedDetailBiodata?.nama_jabatan || selectedDetailPegawai.nama_jabatan || selectedDetailPegawai.jabatan || '-'}
                    </div>
                  </div>
                  <div className="col-span-2 space-y-0.5">
                    <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Instansi / OPD</div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200 leading-tight">
                      {selectedDetailBiodata?.skpd || selectedDetailPegawai.instansi || '-'}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Status</div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedDetailBiodata?.status_kep || selectedDetailPegawai.status_pegawai || '-'}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Gol / Pangkat</div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailBiodata?.gol || '-'}</div>
                  </div>
                  {(selectedDetailBiodata?.jenis_jabatan || selectedDetailPegawai.tipe_jabatan) && (
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Tipe Jabatan</div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailBiodata?.jenis_jabatan || selectedDetailPegawai.tipe_jabatan}</div>
                    </div>
                  )}
                  {selectedDetailBiodata?.tmt_pensiun && (
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">TMT Pensiun</div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailBiodata.tmt_pensiun}</div>
                    </div>
                  )}
                  {selectedDetailPegawai.kelas_jabatan && (
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Kelas Jabatan</div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailPegawai.kelas_jabatan}</div>
                    </div>
                  )}
                  {selectedDetailPegawai.jam_kerja && (
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Jam Kerja</div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailPegawai.jam_kerja}</div>
                    </div>
                  )}
                  {selectedDetailPegawai.norekening && (
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">No. Rekening</div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200 select-all">{selectedDetailPegawai.norekening}</div>
                    </div>
                  )}
                  {selectedDetailPegawai.emei && (
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Device EMEI</div>
                      <div className="font-mono text-xs text-slate-700 dark:text-slate-300 select-all">{selectedDetailPegawai.emei}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Pendidikan */}
              {selectedDetailBiodata?.pdd_jenjang && (
                <div className="space-y-3">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <BookOpen className="w-3 h-3" /> Pendidikan Terakhir
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Jenjang</div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailBiodata.pdd_jenjang}</div>
                    </div>
                    {selectedDetailBiodata.pdd_lulus && (
                      <div className="space-y-0.5">
                        <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Tahun Lulus</div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailBiodata.pdd_lulus}</div>
                      </div>
                    )}
                    {selectedDetailBiodata.pdd_sekolah && (
                      <div className="col-span-2 space-y-0.5">
                        <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Sekolah / Universitas</div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200 leading-snug">{selectedDetailBiodata.pdd_sekolah}</div>
                      </div>
                    )}
                    {selectedDetailBiodata.pdd_jurusan && (
                      <div className="col-span-2 space-y-0.5">
                        <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Jurusan / Prodi</div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedDetailBiodata.pdd_jurusan}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Pasangan */}
              {selectedDetailBiodata?.pasangan && selectedDetailBiodata.pasangan.length > 0 && (
                <div className="space-y-3">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <Users className="w-3 h-3" /> Suami / Istri
                  </div>
                  {selectedDetailBiodata.pasangan.map((p, i) => (
                    <div key={i} className="bg-pink-50 dark:bg-pink-900/10 border border-pink-100 dark:border-pink-800/30 rounded-lg p-3 space-y-1">
                      <div className="font-bold text-slate-900 dark:text-white">{p.nama}</div>
                      {p.status && <div className="text-xs text-pink-600 dark:text-pink-400 font-semibold">{p.status}</div>}
                      {p.ttl && <div className="text-xs text-slate-500 dark:text-slate-400">{p.ttl}</div>}
                      {p.pekerjaan && <div className="text-xs text-slate-500 dark:text-slate-400">Pekerjaan: {p.pekerjaan}</div>}
                    </div>
                  ))}
                </div>
              )}

              {/* Anak */}
              {selectedDetailBiodata?.anak && selectedDetailBiodata.anak.length > 0 && (
                <div className="space-y-3">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <Baby className="w-3 h-3" /> Anak ({selectedDetailBiodata.anak.length})
                  </div>
                  <div className="space-y-2">
                    {selectedDetailBiodata.anak.map((a, i) => (
                      <div key={i} className="bg-sky-50 dark:bg-sky-900/10 border border-sky-100 dark:border-sky-800/30 rounded-lg p-3 space-y-0.5">
                        <div className="font-bold text-slate-900 dark:text-white text-xs">{i + 1}. {a.nama}</div>
                        {a.ttl && <div className="text-xs text-slate-500 dark:text-slate-400">{a.ttl}</div>}
                        <div className="flex gap-2 flex-wrap">
                          {a.status && <span className="text-[10px] bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 px-1.5 py-0.5 rounded font-semibold">{a.status}</span>}
                          {a.tunjangan && <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-semibold">Tunjangan: {a.tunjangan}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ID Teknis */}
              <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-700">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">ID Teknis</div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono break-all select-all">GUID: {selectedDetailPegawai.id || '-'}</div>
                {selectedDetailPegawai.id_jabatan && (
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono break-all select-all">GUID Jabatan: {selectedDetailPegawai.id_jabatan}</div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 shrink-0">
              <button
                onClick={() => {
                  copyToClipboard(selectedDetailPegawai.nip, -1);
                  setSelectedDetailPegawai(null);
                  setSelectedDetailBiodata(null);
                  setPegawaiPhoto(null);
                  setPhotoLoading(false);
                  setPhotoError(false);
                  setPhotoMeta(null);
                  setLightboxOpen(false);
                }}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-sm transition-colors cursor-pointer shadow-sm"
              >
                Salin NIP ke Clipboard
              </button>
              <button
                onClick={() => { setSelectedDetailPegawai(null); setSelectedDetailBiodata(null); setPegawaiPhoto(null); setPhotoLoading(false); setPhotoError(false); setPhotoMeta(null); setLightboxOpen(false); }}
                className="px-5 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-sm transition-colors cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>

        {/* Lightbox: full-screen photo view for the selected pegawai */}
        {lightboxOpen && pegawaiPhoto && (
          <ImageLightbox
            src={pegawaiPhoto}
            title={`${selectedDetailBiodata?.nama || selectedDetailPegawai?.nama || 'Pegawai'} — ${formatBeautifulDateTime(photoMeta?.jam || photoMeta?.tanggal || '')}`}
            onClose={() => setLightboxOpen(false)}
          />
        )}
        </>
      )}

      {/* OPD SEARCH MODAL */}
      {isOpdModalOpen && (
        <div className="modal-layer fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-md overflow-hidden transform transition-all animate-scale-up flex flex-col max-h-[75vh]">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40 shrink-0">
              <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 text-sm uppercase tracking-wider">
                Pilih OPD / Instansi
              </h3>
              <button 
                onClick={() => {
                  setIsOpdModalOpen(false);
                  setOpdSearchQuery('');
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Search Input inside OPD Modal */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                  <Search className="w-4 h-4" />
                </span>
                <input 
                  type="text" 
                  value={opdSearchQuery}
                  onChange={e => setOpdSearchQuery(e.target.value)}
                  placeholder="Ketik untuk mencari OPD..." 
                  className="w-full pl-9 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-xs font-semibold"
                  autoFocus
                />
              </div>
            </div>

            {/* Scrollable list of OPD options */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 bg-slate-50/50 dark:bg-slate-900/20 divide-y divide-slate-100 dark:divide-slate-700/50">
              {/* Option to clear selection: Semua OPD */}
              <button
                type="button"
                onClick={() => {
                  setSelectedOpd('');
                  setIsOpdModalOpen(false);
                  setOpdSearchQuery('');
                  setVisibleCount(50);
                }}
                className={`w-full text-left px-4 py-3 rounded-xl transition-all text-xs font-bold flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer ${!selectedOpd ? 'text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20' : 'text-slate-700 dark:text-slate-300'}`}
              >
                <span>-- Semua OPD / Instansi --</span>
                {!selectedOpd && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
              </button>

              {/* Filtered OPD options */}
              {filteredOpdList
                .map((opdName, idx) => {
                  const isSelected = selectedOpd === opdName;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSelectedOpd(opdName);
                        setIsOpdModalOpen(false);
                        setOpdSearchQuery('');
                        setVisibleCount(50);
                      }}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-all text-xs font-bold flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer ${isSelected ? 'text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20' : 'text-slate-700 dark:text-slate-300'}`}
                    >
                      <span className="pr-4">{opdName}</span>
                      {isSelected && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
                    </button>
                  );
                })}
              
              {/* Empty state inside modal */}
              {filteredOpdList.length === 0 && (
                <div className="p-4 text-center text-xs text-slate-400 italic">OPD tidak ditemukan.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
