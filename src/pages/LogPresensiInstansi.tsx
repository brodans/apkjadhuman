import React, { useState, useEffect, useRef } from 'react';
import { FileText, Search, RefreshCw, ChevronLeft, ChevronRight, AlertCircle, Building2, ExternalLink, Image as ImageIcon, ChevronDown } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import DatePicker from '../components/ui/DatePicker';
import ImageLightbox from '../components/ui/ImageLightbox';
import { formatCompactDateTime } from '../lib/dateFormatter';
import LazyImage from '../components/ui/LazyImage';
import { useBackButton } from '../hooks/useBackButton';
import { OPD_LIST } from '../data/opd';
import { fetchAbsensiLog } from '../api';

export default function LogPresensiInstansi() {
  const { pegawai, config, instansiLogState, setInstansiLogState, tabPermissions, userRole } = useAppContext();

  // Boleh ganti instansi & cari nama jika admin atau permission allowSearchInstansi aktif
  const canSearchInstansi = userRole === 'admin' || tabPermissions.allowSearchInstansi;

  const {
    dateStart,
    dateEnd,
    unorCode,
    selectedOPD,
    searchOPD,
    searchQuery,
    currentPage,
    pageSize,
    logs,
    totalElements,
    totalPages,
    hasLoadedOnce
  } = instansiLogState;

  // Individual state updaters for backward compatibility
  const setDateStart = (val: string) => setInstansiLogState(prev => ({ ...prev, dateStart: val }));
  const setDateEnd = (val: string) => setInstansiLogState(prev => ({ ...prev, dateEnd: val }));
  const setUnorCode = (val: string) => setInstansiLogState(prev => ({ ...prev, unorCode: val }));
  const setSelectedOPD = (val: any) => setInstansiLogState(prev => ({ ...prev, selectedOPD: val }));
  const setSearchOPD = (val: string) => setInstansiLogState(prev => ({ ...prev, searchOPD: val }));
  const setSearchQuery = (val: string) => setInstansiLogState(prev => ({ ...prev, searchQuery: val }));
  const setCurrentPage = (val: number) => setInstansiLogState(prev => ({ ...prev, currentPage: val }));
  const setPageSize = (val: number) => setInstansiLogState(prev => ({ ...prev, pageSize: val }));

  // OPD Autocomplete dropdown
  const [showOPDDropdown, setShowOPDDropdown] = useState(false);
  const opdDropdownRef = useRef<HTMLDivElement>(null);

  // Custom Page Size Dropdown
  const [showPageSizeDropdown, setShowPageSizeDropdown] = useState(false);
  const pageSizeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (opdDropdownRef.current && !opdDropdownRef.current.contains(event.target as Node)) {
        setShowOPDDropdown(false);
      }
      if (pageSizeDropdownRef.current && !pageSizeDropdownRef.current.contains(event.target as Node)) {
        setShowPageSizeDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sync selectedOPD with unorCode
  useEffect(() => {
    const found = OPD_LIST.find(o => o.kode === unorCode);
    if (found) {
      setInstansiLogState(prev => ({ ...prev, selectedOPD: found }));
    } else {
      setInstansiLogState(prev => ({ ...prev, selectedOPD: null }));
    }
  }, [unorCode]);

  // Jika tidak punya izin cari instansi lain, kunci ke instansi user sendiri
  useEffect(() => {
    if (!canSearchInstansi && (config.kodeInstansi || config.kodeUnor)) {
      const ownKode = config.kodeInstansi || config.kodeUnor;
      setInstansiLogState(prev => ({ ...prev, unorCode: ownKode, searchOPD: '' }));
    }
  }, [canSearchInstansi, config.kodeInstansi, config.kodeUnor]);

  const filteredOPD = OPD_LIST.filter(opd =>
    opd.nama.toLowerCase().includes(searchOPD.toLowerCase()) ||
    opd.kode.toLowerCase().includes(searchOPD.toLowerCase())
  );

  // Query states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lightbox
  const [modalImg, setModalImg] = useState<{ src: string; title: string; images?: { src: string; title: string }[]; currentIndex?: number } | null>(null);

  // Sync OPD / UNOR code if logged in user's config loads after initial render
  const configSyncedRef = useRef(false);
  useEffect(() => {
    if (configSyncedRef.current) return;
    if (config.kodeInstansi || config.kodeUnor) {
      configSyncedRef.current = true;
      setInstansiLogState(prev => {
        // Only set if unorCode is still empty (not manually changed)
        if (!prev.unorCode) {
          return { ...prev, unorCode: config.kodeInstansi || config.kodeUnor || '5.19.00.00.00' };
        }
        return prev;
      });
    }
  }, [config.kodeInstansi, config.kodeUnor]);

  const isFirstRender = useRef(true);

  // Only auto-fetch on first mount when user is logged in and not yet loaded
  useEffect(() => {
    if (!pegawai) return;
    if (!isFirstRender.current) return;
    isFirstRender.current = false;
    if (hasLoadedOnce) return; // Skip re-fetch on tab switch
    if (unorCode.trim() || searchQuery.trim()) {
      fetchLogs(1);
    }
  }, [pegawai]);

  // Fetch logs for current parameters
  const fetchLogs = async (pageToFetch = currentPage, forcedUnor = unorCode, overrideSearch?: string) => {
    const currentSearch = typeof overrideSearch === 'string' ? overrideSearch : searchQuery;
    
    if (!forcedUnor.trim() && !currentSearch.trim()) {
      setInstansiLogState(prev => ({
        ...prev,
        logs: [],
        totalElements: 0,
        totalPages: 0,
        currentPage: 1
      }));
      setError(null);
      return;
    }
    
    setLoading(true);
    setError(null);
    const queryParams = new URLSearchParams({
      unor: forcedUnor.trim(),
      dateStart,
      dateEnd,
      page: String(pageToFetch),
      size: String(pageSize)
    });

    if (currentSearch.trim()) {
      const query = currentSearch.trim();
      if (/^\d+$/.test(query)) {
        queryParams.append('nip', query);
      } else {
        queryParams.append('nama', query);
      }
    }

    const reqPayload: Record<string, string> = {};
    queryParams.forEach((value, key) => {
      reqPayload[key] = value;
    });

    try {
      const data = await fetchAbsensiLog(queryParams);
      setInstansiLogState(prev => ({
        ...prev,
        logs: data.content || [],
        totalElements: data.totalElements || 0,
        totalPages: data.totalPages || 0,
        currentPage: pageToFetch,
        hasLoadedOnce: true
      }));
    } catch (err: any) {
      console.error("Failed to fetch logs:", err);
      setError(err.message || 'Terjadi kesalahan saat memuat data presensi instansi.');
    } finally {
      setLoading(false);
    }
  };

  // Data is filtered on the server side; filteredLogs maps directly to fetched logs
  const filteredLogs = logs;

  // Pre-calculate all images in filteredLogs
  const allImages = React.useMemo(() => {
    return filteredLogs.map((item) => {
      const lamp = item.lampiran || "";
      if (!lamp) return null;
      const imgUrl = `/api/proxy-image?path=${encodeURIComponent(lamp)}`;
      return {
        src: imgUrl,
        title: `Foto ${item.nama_pegawai || 'Pegawai'} - ${item.tanggal || ''} ${item.jam || ''}`
      };
    }).filter((img): img is { src: string; title: string } => img !== null);
  }, [filteredLogs]);

  // Back button hook to close lightbox
  useBackButton(() => {
    if (modalImg) {
      setModalImg(null);
      return true;
    }
    return false;
  }, modalImg !== null);

  if (!pegawai) {
    return null; // App.tsx auto-redirect ke tabLogin
  }

  return (
    <div className="space-y-6">
      {/* Filter and Query Form Card */}
      <div className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60 pb-3">
          <h3 className="min-w-0 text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <span>⚙️ Konfigurasi Filter Pencarian</span>
          </h3>
          <button
            onClick={() => fetchLogs(currentPage)}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 active:scale-95 text-slate-700 dark:text-slate-200 h-9 w-9 sm:h-10 sm:w-10 p-0 rounded-xl transition-all cursor-pointer shadow-sm shrink-0"
            title="Segarkan data"
            aria-label="Segarkan data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DatePicker 
            label="Tanggal Mulai" 
            value={dateStart} 
            onChange={(val) => {
              setDateStart(val);
              setCurrentPage(1);
            }} 
          />
          <DatePicker 
            label="Tanggal Selesai" 
            value={dateEnd} 
            onChange={(val) => {
              setDateEnd(val);
              setCurrentPage(1);
            }} 
          />
          
          <div className="relative" ref={opdDropdownRef}>
            <div className="flex items-center justify-between h-5 mb-1">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">
                {canSearchInstansi ? 'Cari & Pilih Instansi / OPD' : 'Instansi (Terkunci)'}
              </label>
            </div>
            {canSearchInstansi ? (
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                <Building2 className="w-4 h-4" />
              </div>
              <input 
                type="text" 
                value={searchOPD}
                onChange={(e) => {
                  setSearchOPD(e.target.value);
                  setShowOPDDropdown(true);
                }}
                onFocus={() => setShowOPDDropdown(true)}
                placeholder={selectedOPD ? selectedOPD.nama : "Semua Instansi (Global)..."}
                className="w-full pl-10 pr-12 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
              {selectedOPD && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOPD(null);
                    setUnorCode('');
                    setSearchOPD('');
                    fetchLogs(1, '');
                  }}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-600 px-1.5 py-0.5 rounded cursor-pointer">Batal</span>
                </button>
              )}
            </div>
            ) : (
              /* Terkunci ke instansi sendiri */
              <div className="flex items-center gap-2 py-2 px-3 bg-slate-100 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-lg">
                <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">
                  {selectedOPD ? selectedOPD.nama : (unorCode || 'Instansi Anda')}
                </span>
                <span className="ml-auto text-[9px] font-bold bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded shrink-0">TERKUNCI</span>
              </div>
            )}

            {canSearchInstansi && showOPDDropdown && (
              <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-40 divide-y divide-slate-100 dark:divide-slate-700/50">
                {filteredOPD.length === 0 ? (
                  <div className="p-3 text-center text-slate-400 text-xs">
                    Instansi tidak ditemukan.
                  </div>
                ) : (
                  filteredOPD.slice(0, 50).map((opd) => (
                    <button
                      key={opd.kode}
                      type="button"
                      onClick={() => {
                        setSelectedOPD(opd);
                        setUnorCode(opd.kode);
                        setSearchOPD('');
                        setShowOPDDropdown(false);
                        fetchLogs(1, opd.kode);
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer block"
                    >
                      <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{opd.nama}</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">Kode: {opd.kode}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

        </div>

        <div className="border-t border-slate-100 dark:border-slate-700/80 pt-4 flex flex-col md:flex-row gap-4 items-center justify-between">
          {/* Server-side Search Form - hanya tampil jika punya izin */}
          {canSearchInstansi ? (
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              fetchLogs(1);
            }}
            className="flex items-center gap-2 w-full md:w-96"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={unorCode ? "Cari Nama / NIP di instansi ini..." : "Cari Nama / NIP di semua instansi..."}
                className="w-full pl-10 pr-12 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white text-xs outline-none focus:ring-2 focus:ring-blue-500/30 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    fetchLogs(1, unorCode, '');
                  }}
                  className="absolute right-3 top-2.5 text-[10px] font-bold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 transition-colors"
                >
                  Batal
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shrink-0"
            >
              {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>Cari</span>
            </button>
          </form>
          ) : (
            /* Info: pencarian nama tidak tersedia */
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-500 dark:text-slate-400 w-full md:w-96">
              <Search className="w-3.5 h-3.5 shrink-0 opacity-40" />
              <span className="font-semibold">Pencarian nama tidak tersedia untuk akun ini</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs w-full md:w-auto md:justify-end">
            <div className="flex items-center gap-2 relative" ref={pageSizeDropdownRef}>
              <span className="text-slate-500 dark:text-slate-400 font-semibold whitespace-nowrap">Tampilkan baris:</span>
              <button
                type="button"
                onClick={() => setShowPageSizeDropdown(!showPageSizeDropdown)}
                className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white font-bold text-xs flex items-center gap-1.5 shadow-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer select-none"
              >
                <span>{pageSize} Baris</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>

              {showPageSizeDropdown && (
                <div className="absolute right-0 top-full mt-1.5 min-w-[120px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 divide-y divide-slate-100 dark:divide-slate-700/50 overflow-hidden">
                  {[10, 20, 50, 100].map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        setPageSize(size);
                        setCurrentPage(1);
                        setShowPageSizeDropdown(false);
                      }}
                      className={`w-full text-left px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-xs font-bold cursor-pointer transition-colors block ${pageSize === size ? 'text-blue-600 dark:text-blue-400 bg-blue-50/30 dark:bg-blue-950/20' : 'text-slate-700 dark:text-slate-300'}`}
                    >
                      {size} Baris
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => fetchLogs(1)}
              disabled={loading}
              className="w-full md:w-auto h-[38px] bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer text-sm shadow-sm active:scale-[0.98]"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span className="truncate">Terapkan Filter</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/30 text-rose-800 dark:text-rose-400 rounded-2xl text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Gagal mengambil data</p>
            <p className="text-xs opacity-90 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {loading && logs.length === 0 ? (
        <div className="p-20 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex flex-col items-center justify-center text-center">
          <RefreshCw className="w-10 h-10 text-blue-600 dark:text-blue-400 animate-spin mb-4" />
          <p className="text-slate-600 dark:text-slate-300 font-bold text-sm">Menghubungi server instansi...</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Mengunduh data log kehadiran.</p>
        </div>
      ) : (!unorCode.trim() && !searchQuery.trim()) ? (
        <div className="p-16 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 bg-blue-50 dark:bg-blue-900/20 rounded-2xl flex items-center justify-center mb-4 text-blue-500">
            <Search className="w-7 h-7" />
          </div>
          <p className="text-slate-700 dark:text-slate-300 font-bold text-sm">Pencarian Log Kehadiran</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1.5 max-w-sm leading-relaxed">
            Pilih instansi/OPD di atas, atau masukkan kata kunci Nama/NIP di kolom pencarian untuk melakukan pencarian di seluruh instansi.
          </p>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="p-16 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 bg-slate-50 dark:bg-slate-900 rounded-2xl flex items-center justify-center mb-4 text-slate-400">
            <FileText className="w-7 h-7" />
          </div>
          <p className="text-slate-700 dark:text-slate-300 font-bold text-sm">Tidak Ada Log Presensi Instansi</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1.5 max-w-sm leading-relaxed">
            Tidak ditemukan data presensi pada rentang tanggal {dateStart} s.d {dateEnd} {unorCode ? `untuk OPD ${unorCode}` : 'di semua instansi'} {searchQuery ? `dengan nama/NIP "${searchQuery}"` : ''}.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Info bar */}
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
              Menampilkan <span className="text-slate-800 dark:text-white font-bold">{filteredLogs.length}</span> dari <span className="text-slate-800 dark:text-white font-bold">{totalElements}</span> rekam kehadiran instansi
            </p>
            <p className="text-xs font-mono text-slate-400 dark:text-slate-500">
              Halaman {currentPage} dari {totalPages}
            </p>
          </div>

          {/* Table Container */}
          <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[760px] table-fixed text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                    <th className="w-[42px] py-2.5 px-2 sm:py-3 sm:px-2.5 text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">No</th>
                    <th className="w-[138px] py-2.5 px-2 sm:py-3 sm:px-2.5 text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nama</th>
                    <th className="w-[158px] py-2.5 px-2 sm:py-3 sm:px-2.5 text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">NIP</th>
                    <th className="w-[136px] py-2.5 px-2 sm:py-3 sm:px-2.5 text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Tanggal & Waktu</th>
                    <th className="py-2.5 px-2 sm:py-3 sm:px-2.5 text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Lokasi Presensi</th>
                    <th className="w-[72px] py-2.5 px-2 sm:py-3 sm:px-2.5 text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">Foto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {filteredLogs.map((item, idx) => {
                    const rowNumber = (currentPage - 1) * pageSize + idx + 1;
                    const lamp = item.lampiran || "";
                    // Photo proxy url using the default port 8087 proxy
                    const imgUrl = lamp 
                      ? `/api/proxy-image?path=${encodeURIComponent(lamp)}`
                      : "";

                    return (
                      <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors">
                        <td className="py-2.5 px-2 sm:py-3 sm:px-2.5 text-center text-[10px] sm:text-xs font-mono font-bold text-slate-400 dark:text-slate-500">
                          {rowNumber}
                        </td>
                        <td className="py-2.5 px-2 sm:py-3 sm:px-2.5 max-w-[180px] sm:max-w-[240px] whitespace-normal break-words">
                          <span className="font-bold text-slate-800 dark:text-white text-xs sm:text-sm block">{item.nama_pegawai || '-'}</span>
                        </td>
                        <td className="py-2.5 px-2 sm:py-3 sm:px-2.5 whitespace-nowrap">
                          <span className="inline-block whitespace-nowrap font-semibold font-mono text-[10px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-1.5 py-0.5 rounded-lg">
                            {item.imei || '-'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 sm:py-3 sm:px-2.5 whitespace-normal">
                          <div className="flex flex-col gap-0.5 text-[10px] text-slate-700 dark:text-slate-300">
                            <span className="font-bold whitespace-nowrap" title={item.tanggal || ''}>{formatCompactDateTime(item.tanggal)}</span>
                            <span className="font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap" title={item.jam || ''}>{item.jam || '-'}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2 sm:py-3 sm:px-2.5 max-w-[180px] sm:max-w-[280px] whitespace-normal break-words" title={item.lokasi || ''}>
                          <span className="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-semibold">
                            {item.lokasi || '-'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 sm:py-3 sm:px-2.5 text-center">
                          {imgUrl ? (
                            <button
                              onClick={() => {
                                const imgIdx = allImages.findIndex((img) => img.src === imgUrl);
                                setModalImg({
                                  src: imgUrl,
                                  title: `Foto ${item.nama_pegawai} - ${item.tanggal} ${item.jam}`,
                                  images: allImages,
                                  currentIndex: imgIdx !== -1 ? imgIdx : 0
                                });
                              }}
                              className="group relative inline-block rounded-lg overflow-hidden shadow-sm hover:shadow-md border border-slate-200 dark:border-slate-700 bg-slate-100 transition-all cursor-pointer aspect-square w-10 h-10"
                            >
                              <LazyImage
                                src={imgUrl}
                                alt="Presensi Lampiran"
                                loadIndex={idx}
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                                containerClassName="w-full h-full"
                              />
                              <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                                <ExternalLink className="w-3.5 h-3.5" />
                              </div>
                            </button>
                          ) : (
                            <div className="inline-flex items-center justify-center w-10 h-10 bg-slate-100 dark:bg-slate-900 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 text-slate-300 dark:text-slate-600">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination Component */}
          {totalPages > 1 && (
            <div className="bg-white dark:bg-slate-800 p-4 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold text-center sm:text-left">
                Halaman <span className="font-bold text-slate-800 dark:text-white">{currentPage}</span> dari <span className="font-bold text-slate-800 dark:text-white">{totalPages}</span> ({totalElements} data)
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchLogs(currentPage - 1)}
                  disabled={currentPage <= 1 || loading}
                  className="p-2 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-400 disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-1.5">
                  {/* Smart pagination numbers */}
                  {(() => {
                    const pages: number[] = [];
                    const maxVisiblePages = 5;
                    if (totalPages <= maxVisiblePages) {
                      for (let i = 1; i <= totalPages; i++) {
                        pages.push(i);
                      }
                    } else {
                      let start = Math.max(1, currentPage - 2);
                      let end = Math.min(totalPages, currentPage + 2);
                      if (currentPage <= 3) {
                        end = 5;
                      } else if (currentPage >= totalPages - 2) {
                        start = totalPages - 4;
                      }
                      for (let i = start; i <= end; i++) {
                        pages.push(i);
                      }
                    }
                    
                    return pages.map((pageNum) => {
                      const isCurrent = pageNum === currentPage;
                      return (
                        <button
                          key={pageNum}
                          onClick={() => fetchLogs(pageNum)}
                          disabled={loading}
                          className={`w-8.5 h-8.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                            isCurrent 
                              ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/10' 
                              : 'border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    });
                  })()}
                </div>

                <button
                  onClick={() => fetchLogs(currentPage + 1)}
                  disabled={currentPage >= totalPages || loading}
                  className="p-2 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-400 disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lightbox for Foto */}
      {modalImg && (
        <ImageLightbox 
          src={modalImg.src} 
          title={modalImg.title} 
          onClose={() => setModalImg(null)} 
          images={modalImg.images}
          currentIndex={modalImg.currentIndex}
        />
      )}
    </div>
  );
}
