import React, { useState, useEffect } from 'react';
import { FileText, Search, CheckCircle, Calendar as CalendarIcon, ImageIcon, AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { formatBeautifulDateTime, formatCompactDateTime, getTodayWIB, getTodayWIBWithOffset } from '../lib/dateFormatter';
import { useAppContext } from '../context/AppContext';
import { sendRequest } from '../api';
import DatePicker from '../components/ui/DatePicker';
import ImageLightbox from '../components/ui/ImageLightbox';
import { useBackButton } from '../hooks/useBackButton';
import { usePegawaiSearch } from '../hooks/usePegawaiSearch';
import LazyImage from '../components/ui/LazyImage';
import { loadPegawaiSearchList } from '../lib/pegawaiData';

export default function LogPresensi() {
  const { pegawai, config, tabPermissions, userRole } = useAppContext();

  const canTerkini = userRole === 'admin' || tabPermissions.tabLogPresensiTerkini;
  const canLengkap  = userRole === 'admin' || tabPermissions.tabLogLengkap;
  // Boleh cari pegawai lain jika admin atau permission allowSearchPresensi aktif
  const canSearchPresensi = userRole === 'admin' || tabPermissions.allowSearchPresensi;
  const [pegawaiList, setPegawaiList] = useState<any[]>([]);

  // Default ke tab yang boleh diakses
  const [activeSubTab, setActiveSubTab] = useState<'hari_ini' | 'lengkap'>(() =>
    canTerkini ? 'hari_ini' : 'lengkap'
  );

  const {
    selectedPegawai,
    setSelectedPegawai,
    searchPegawai,
    setSearchPegawai,
    showPegawaiDropdown,
    setShowPegawaiDropdown,
    pegawaiDropdownRef,
    filteredPegawai,
  } = usePegawaiSearch(pegawaiList, { showAllWhenEmpty: false, maxResults: 50 });

  useEffect(() => {
    if (!canSearchPresensi || pegawaiList.length > 0) return;
    let cancelled = false;
    loadPegawaiSearchList().then(list => { if (!cancelled) setPegawaiList(list); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [canSearchPresensi, pegawaiList.length]);

  // --- Presensi Terkini ---
  const [hariIniDate, setHariIniDate] = useState(() => getTodayWIB());
  const [loadingHariIni, setLoadingHariIni] = useState(false);
  const [dataHariIni, setDataHariIni] = useState<any[] | null>(null);
  const [errorHariIni, setErrorHariIni] = useState('');
  const [patokanHariIni, setPatokanHariIni] = useState<{ masuk: string | null; pulang: string | null } | null>(null);
  const [modalImg, setModalImg] = useState<{ src: string; title: string; images?: { src: string; title: string }[]; currentIndex?: number } | null>(null);
  const [visibleCountHariIni, setVisibleCountHariIni] = useState(50);
  const [visibleCountLengkap, setVisibleCountLengkap] = useState(50);

  // ── Jam Kerja Pegawai — untuk menentukan status masuk/pulang/terlambat/mendahului
  const [jamKerjaLog, setJamKerjaLog] = useState<any>(null);

  // Fetch jam kerja saat id pegawai atau target berubah
  useEffect(() => {
    const targetId = (canSearchPresensi && selectedPegawai) ? selectedPegawai.id : config.idPegawai;
    if (!targetId) return;
    sendRequest('/pegawai/getJamKerjaPegawai', { id_pegawai: targetId })
      .then(res => {
        let obj: any = null;
        if (Array.isArray(res))                             obj = res[0] ?? null;
        else if (Array.isArray(res?.data))                  obj = res.data[0] ?? null;
        else if (res?.data && typeof res.data === 'object') obj = res.data;
        else if (res?.jam_mulai_scan_masuk || res?.jam_kerja || res?.id_pegawai) obj = res;
        else if (res && Object.keys(res).length > 2)        obj = res;
        setJamKerjaLog(obj);
      })
      .catch(() => setJamKerjaLog(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.idPegawai, selectedPegawai]);

  // Pre-calculate all images in dataHariIni
  // ── Helper shared: extract menit dari datetime atau time string ─────────────
  // Input bisa: "2026-09-21 10:30:00" | "10:30:00" | "10:30"
  const toMenitFromDt = React.useCallback((dt: any): number | null => {
    if (!dt) return null;
    const s = String(dt);
    // Format datetime: "2026-09-21 10:30:00" atau "2026-09-21T10:30:00"
    const dtMatch = s.match(/\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/);
    if (dtMatch) return parseInt(dtMatch[1], 10) * 60 + parseInt(dtMatch[2], 10);
    // Format time only: "10:30:00" atau "10:30"
    const tMatch = s.match(/^(\d{2}):(\d{2})/);
    if (tMatch) return parseInt(tMatch[1], 10) * 60 + parseInt(tMatch[2], 10);
    return null;
  }, []);

  // Parse "07:30-15:45" dari jam_kerja sebagai fallback jadwal
  const parseJamKerjaRange = React.useCallback((): { masuk: number | null; pulang: number | null } => {
    const raw = jamKerjaLog?.jam_kerja;
    if (!raw) return { masuk: null, pulang: null };
    const m = String(raw).match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
    if (!m) return { masuk: null, pulang: null };
    return {
      masuk: parseInt(m[1], 10) * 60 + parseInt(m[2], 10),
      pulang: parseInt(m[3], 10) * 60 + parseInt(m[4], 10),
    };
  }, [jamKerjaLog]);

  // Rekap log lengkap adalah sumber kebenaran untuk label scan harian.
  const normalizeDateTime = React.useCallback((value: any, targetDate?: string): string | null => {
    if (!value) return null;
    const text = String(value).trim();
    const match = text.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
    if (match) return `${match[1]} ${match[2]}:${match[3] || '00'}`;
    const timeOnly = text.match(/^(\d{2}:\d{2})(?::(\d{2}))?/);
    if (timeOnly && targetDate) return `${targetDate} ${timeOnly[1]}:${timeOnly[2] || '00'}`;
    return null;
  }, []);

  const getDisplayStatus = React.useCallback((jamStr: string | null | undefined): string => {
    if (!jamStr) return '-';
    if (!patokanHariIni) return 'Absen Invalid';
    const scan = normalizeDateTime(jamStr, hariIniDate);
    if (!scan) return 'Absen Invalid';
    if (patokanHariIni.masuk && scan === patokanHariIni.masuk) return 'Absen Masuk';
    if (patokanHariIni.pulang && scan === patokanHariIni.pulang) return 'Absen Pulang';
    if (patokanHariIni.masuk && patokanHariIni.pulang) {
      return scan > patokanHariIni.masuk && scan < patokanHariIni.pulang
        ? 'Absen'
        : 'Absen Invalid';
    }
    return 'Absen Invalid';
  }, [hariIniDate, normalizeDateTime, patokanHariIni]);

  // ── Keterangan masuk: tepat waktu / terlambat (pakai jadwal_masuk) ──────────
  // Sama seperti Submit Presensi: setelah jadwal_masuk = Terlambat
  const getKeteranganMasuk = React.useCallback((jamStr: string | null | undefined): string => {
    if (!jamStr || !jamKerjaLog) return '-';
    const scanMenit = toMenitFromDt(jamStr);
    if (scanMenit === null) return '-';
    const range = parseJamKerjaRange();
    const jadwalMasuk = toMenitFromDt(jamKerjaLog.jadwal_masuk) ?? range.masuk;
    const bukaMasuk = toMenitFromDt(jamKerjaLog.jam_mulai_scan_masuk);
    if (bukaMasuk !== null && scanMenit < bukaMasuk) return 'Terlalu Awal';
    if (jadwalMasuk !== null && scanMenit > jadwalMasuk) return 'Terlambat';
    return 'Tepat Waktu';
  }, [jamKerjaLog, toMenitFromDt, parseJamKerjaRange]);

  // ── Keterangan pulang: normal / mendahului (pakai jadwal_pulang) ────────────
  // Sama seperti Submit Presensi: sebelum jadwal_pulang = Mendahului
  const getKeteranganPulang = React.useCallback((jamStr: string | null | undefined): string => {
    if (!jamStr || !jamKerjaLog) return '-';
    const scanMenit = toMenitFromDt(jamStr);
    if (scanMenit === null) return '-';
    const range = parseJamKerjaRange();
    const jadwalPulang = toMenitFromDt(jamKerjaLog.jadwal_pulang) ?? range.pulang;
    if (jadwalPulang !== null && scanMenit < jadwalPulang) return 'Mendahului';
    return 'Normal';
  }, [jamKerjaLog, toMenitFromDt, parseJamKerjaRange]);

  const allImages = React.useMemo(() => {
    if (!dataHariIni) return [];
    return dataHariIni.slice(0, visibleCountHariIni).map((item) => {
      let lamp = item.lampiran || item.foto;
      let hasImage = false;
      let imgUrl = '';
      
      if (lamp && lamp !== 'no_image.png' && !lamp.includes('no_image')) {
        hasImage = true;
        if (lamp.startsWith('/9j/') || lamp.startsWith('iVBOR')) {
          imgUrl = `data:image/jpeg;base64,${lamp}`;
        } else if (lamp.startsWith('http')) {
          imgUrl = lamp;
        } else {
          imgUrl = `/api/proxy-image?path=${encodeURIComponent(lamp)}`;
        }
      }

      if (!hasImage) return null;

      // Prioritas: hitung dari jam kerja (status_absen API sering selalu "Absen Masuk")
      const computed = getDisplayStatus(item.jam);
      const displayStatus = computed !== '-' ? computed : (item.status_absen || '-');

      return {
        src: imgUrl,
        title: `${displayStatus} - ${formatBeautifulDateTime(item.jam)}`
      };
    }).filter((img): img is { src: string; title: string } => img !== null);
  }, [dataHariIni, visibleCountHariIni, getDisplayStatus]);

  // Hook up back button to close lightbox
  useBackButton(() => {
    setModalImg(null);
    return true;
  }, !!modalImg);

  // --- Log Lengkap ---
  const [tglAwal, setTglAwal] = useState(getTodayWIBWithOffset(-1));
  const [tglAkhir, setTglAkhir] = useState(() => getTodayWIB());
  const [loadingLengkap, setLoadingLengkap] = useState(false);
  const [dataLengkap, setDataLengkap] = useState<any[] | null>(null);
  const [errorLengkap, setErrorLengkap] = useState('');

  const handleScrollHariIni = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      if (dataHariIni && visibleCountHariIni < dataHariIni.length) {
        setVisibleCountHariIni(prev => prev + 50);
      }
    }
  };

  const handleScrollLengkap = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      if (dataLengkap && visibleCountLengkap < dataLengkap.length) {
        setVisibleCountLengkap(prev => prev + 50);
      }
    }
  };

  const fetchHariIni = async (targetDate: string = hariIniDate) => {
    setLoadingHariIni(true);
    setErrorHariIni('');
    setDataHariIni(null);
    setPatokanHariIni(null);
    setVisibleCountHariIni(50);
    // Jika tidak punya izin search, selalu gunakan id sendiri
    const effectivePegawai = canSearchPresensi ? selectedPegawai : null;
    const payload = {
      id_pegawai: effectivePegawai ? effectivePegawai.id : config.idPegawai,
      tanggal: targetDate
    };
    try {
      const [detailRes, lengkapRes] = await Promise.all([
        sendRequest("/logActivity/log_detail", payload),
        sendRequest("/logActivity/log", { ...payload, tgl_awal: targetDate, tgl_akhir: targetDate })
      ]);
      const detailData = detailRes?.data;
      const lengkapData = lengkapRes?.data;
      if (detailRes && detailRes.message !== "Data kosong" && Array.isArray(detailData) && detailData.length > 0) {
        setDataHariIni(detailData);
        const rekap = Array.isArray(lengkapData) ? lengkapData.find((item: any) => {
          const tanggal = String(item.tanggal || '').slice(0, 10);
          return !tanggal || tanggal === targetDate;
        }) : null;
        setPatokanHariIni(rekap ? {
          masuk: normalizeDateTime(rekap.absen_masuk, targetDate),
          pulang: normalizeDateTime(rekap.absen_pulang, targetDate)
        } : null);
      } else {
        setErrorHariIni(`Belum ada data presensi untuk tanggal ${targetDate}.`);
      }
    } catch (err: any) {
      setErrorHariIni(`Network Error: ${err.message}`);
    } finally {
      setLoadingHariIni(false);
    }
  };

  const fetchLengkap = async () => {
    setLoadingLengkap(true);
    setErrorLengkap('');
    setDataLengkap(null);
    setVisibleCountLengkap(50);
    // Jika tidak punya izin search, selalu gunakan id sendiri
    const effectivePegawai = canSearchPresensi ? selectedPegawai : null;
    const payload = {
      id_pegawai: effectivePegawai ? effectivePegawai.id : config.idPegawai,
      tgl_awal: tglAwal,
      tgl_akhir: tglAkhir
    };
    try {
      const res = await sendRequest("/logActivity/log", payload);
      if (res && res.success && res.data && res.data.length > 0) {
        setDataLengkap(res.data);
      } else {
        setErrorLengkap('Data kosong pada rentang tanggal tersebut.');
      }
    } catch (err: any) {
      setErrorLengkap(`Network Error: ${err.message}`);
    } finally {
      setLoadingLengkap(false);
    }
  };

  // Auto fetch Presensi Terkini on mount or when date or selected employee changes
  useEffect(() => {
    if (!pegawai) return;
    if (activeSubTab === 'hari_ini') {
      fetchHariIni(hariIniDate);
    }
  }, [activeSubTab, hariIniDate, pegawai, canSearchPresensi ? selectedPegawai : null]);

  if (!pegawai) {
    return null; // App.tsx will auto-redirect to tabLogin
  }

  return (
    <div className="w-full min-w-0 mx-auto bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex flex-col relative z-20">
      {/* Tab Navigation */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 relative z-10 rounded-t-3xl">
        {canTerkini && (
          <button
            className={`min-w-0 flex-1 px-2 py-3.5 sm:py-4 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap transition-all duration-300 relative ${
              activeSubTab === 'hari_ini'
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
            }`}
            onClick={() => setActiveSubTab('hari_ini')}
          >
            <CalendarIcon className={`w-4 h-4 ${activeSubTab === 'hari_ini' ? 'animate-bounce-subtle' : ''}`} /> Presensi Terkini
            {activeSubTab === 'hari_ini' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-t-full"></div>
            )}
          </button>
        )}
        {canLengkap && (
          <button
            className={`min-w-0 flex-1 px-2 py-3.5 sm:py-4 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap transition-all duration-300 relative ${
              activeSubTab === 'lengkap'
                ? 'text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-900/10'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
            }`}
            onClick={() => setActiveSubTab('lengkap')}
          >
            <FileText className={`w-4 h-4 ${activeSubTab === 'lengkap' ? 'animate-bounce-subtle' : ''}`} /> Log Lengkap
            {activeSubTab === 'lengkap' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600 dark:bg-purple-400 rounded-t-full"></div>
            )}
          </button>
        )}
      </div>

      <div className="p-4 sm:p-6">
        {/* Search Pegawai Section - hanya tampil jika punya izin */}
        {canSearchPresensi ? (
        <div className={`mb-6 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200/60 dark:border-slate-700/50 relative ${showPegawaiDropdown ? 'z-[60]' : 'z-30'}`}>
          <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">
                Cek History Presensi
              </span>
              <h4 className="text-sm font-bold text-slate-850 dark:text-slate-200 flex items-center gap-1.5">
                {selectedPegawai ? (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse inline-block" />
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

            <div className="relative w-full 2xl:w-80 min-w-0" ref={pegawaiDropdownRef}>
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
                  className="w-full bg-white dark:bg-slate-800 text-slate-850 dark:text-white placeholder-slate-400 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-14 py-2 text-xs font-bold focus:outline-none focus:border-blue-500 shadow-sm"
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
          <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-200/60 dark:border-blue-700/50 flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 inline-block" />
            <div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Data Login Anda</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{pegawai.nama} • NIP: {pegawai.nip}</p>
            </div>
          </div>
        )}

        {/* Konten Presensi Hari Ini */}
        {activeSubTab === 'hari_ini' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3 relative z-30">
              <div className="min-w-0 flex-[1_1_220px]">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-blue-500 shrink-0" /> Log & Foto Presensi
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Tanggal terpilih
                </p>
              </div>
              <div className="flex w-full min-w-0 flex-[1_1_360px] flex-nowrap items-center justify-end gap-2.5 sm:w-auto">
                <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2">
                  {/* Button 1 Hari Sebelum */}
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const [year, month, day] = hariIniDate.split('-').map(Number);
                        const targetDate = new Date(year, month - 1, day - 1);
                        const y = targetDate.getFullYear();
                        const m = String(targetDate.getMonth() + 1).padStart(2, '0');
                        const d = String(targetDate.getDate()).padStart(2, '0');
                        setHariIniDate(`${y}-${m}-${d}`);
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                    className="p-1.5 xs:p-2 sm:p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-blue-300 dark:hover:border-blue-600 active:scale-95 shadow-xs transition-all shrink-0"
                    title="1 Hari Sebelum"
                  >
                    <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>

                  <div className="min-w-0 flex-1 basis-0 sm:flex-none sm:w-[220px] lg:w-[260px]">
                    <DatePicker
                      value={hariIniDate}
                      onChange={(newDate) => setHariIniDate(newDate)}
                      className="w-full min-w-0"
                    />
                  </div>

                  {/* Button 1 Hari Sesudah */}
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const [year, month, day] = hariIniDate.split('-').map(Number);
                        const targetDate = new Date(year, month - 1, day + 1);
                        const y = targetDate.getFullYear();
                        const m = String(targetDate.getMonth() + 1).padStart(2, '0');
                        const d = String(targetDate.getDate()).padStart(2, '0');
                        setHariIniDate(`${y}-${m}-${d}`);
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                    className="p-1.5 xs:p-2 sm:p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-blue-300 dark:hover:border-blue-600 active:scale-95 shadow-xs transition-all shrink-0"
                    title="1 Hari Sesudah"
                  >
                    <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>

                <button 
                  onClick={() => fetchHariIni(hariIniDate)}
                  disabled={loadingHariIni}
                  className="w-10 h-10 sm:w-11 sm:h-11 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 font-semibold rounded-xl shadow-sm transition-all flex items-center justify-center active:scale-95 shrink-0"
                  title="Segarkan data presensi"
                  aria-label="Segarkan data presensi"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingHariIni ? 'animate-spin text-blue-500' : 'text-slate-400'}`} />
                </button>
              </div>
            </div>

            {errorHariIni && (
              <div className="p-4 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800/50 font-mono text-sm rounded-xl flex gap-3 items-start">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span className="leading-relaxed">{errorHariIni}</span>
              </div>
            )}

            {dataHariIni && (
              <div 
                className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800/80 rounded-2xl overflow-x-auto custom-scrollbar shadow-sm"
                onScroll={handleScrollHariIni}
                style={{ maxHeight: '500px' }}
              >
                <table className="w-full min-w-[560px] text-left border-collapse">
                  <thead className="sticky top-0 z-20">
                    <tr>
                      <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Status/Waktu</th>
                      <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Instansi</th>
                      <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Alamat</th>
                      <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-center whitespace-nowrap shadow-sm">Foto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {dataHariIni.slice(0, visibleCountHariIni).map((item, i) => {
                      let lamp = item.lampiran || item.foto;
                      let hasImage = false;
                      let imgUrl = '';
                      
                      if (lamp && lamp !== 'no_image.png' && !lamp.includes('no_image')) {
                        hasImage = true;
                        if (lamp.startsWith('/9j/') || lamp.startsWith('iVBOR')) {
                          imgUrl = `data:image/jpeg;base64,${lamp}`;
                        } else if (lamp.startsWith('http')) {
                          imgUrl = lamp;
                        } else {
                          imgUrl = `/api/proxy-image?path=${encodeURIComponent(lamp)}`;
                        }
                      }

                      // Prioritas: hitung dari jam kerja (status_absen API sering selalu "Absen Masuk")
                      const computed = getDisplayStatus(item.jam);
                      const displayStatus = computed !== '-' ? computed : (item.status_absen || '-');
                      const ket = displayStatus === 'Absen Masuk'
                        ? getKeteranganMasuk(item.jam)
                        : displayStatus === 'Absen Pulang'
                        ? getKeteranganPulang(item.jam)
                        : null;

                      return (
                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                          <td className="p-2 sm:p-4 align-top whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold mb-1.5 ${
                              displayStatus === 'Absen Invalid'
                                ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600'
                                : displayStatus === 'Absen' || displayStatus === 'Absen Masuk' || displayStatus === 'Absen Pulang'
                                ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600'
                            }`}>
                              {displayStatus}
                            </span>
                            {ket && ket !== '-' && (
                              <span className={`block text-[10px] font-bold px-1.5 py-0.5 rounded w-max mb-1 ${
                                ket === 'Terlambat' || ket === 'Mendahului'
                                  ? 'bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400'
                                  : ket === 'Tepat Waktu' || ket === 'Normal'
                                  ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              }`}>
                                {ket}
                              </span>
                            )}
                            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                              {formatBeautifulDateTime(item.jam)}
                            </div>
                          </td>
                          <td className="p-2 sm:p-4 align-top max-w-[180px] sm:max-w-[260px] whitespace-normal break-words">
                            <div className="font-semibold text-xs sm:text-sm text-slate-800 dark:text-slate-200 whitespace-normal break-words">
                              {item.store || '-'}
                            </div>
                          </td>
                          <td className="p-2 sm:p-4 align-top">
                            <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-3 max-w-[240px]">
                              {item.alamat || '-'}
                            </div>
                          </td>
                          <td className="p-2 sm:p-4 align-top">
                            <div className="flex justify-center items-center">
                              {hasImage ? (
                                <LazyImage 
                                  src={imgUrl} 
                                  alt="Absen"
                                  onClick={() => {
                                    const idx = allImages.findIndex((img) => img.src === imgUrl);
                                    setModalImg({
                                      src: imgUrl,
                                      title: `${displayStatus} - ${formatBeautifulDateTime(item.jam)}`,
                                      images: allImages,
                                      currentIndex: idx !== -1 ? idx : 0
                                    });
                                  }}
                                  containerClassName="w-16 h-16 sm:w-20 sm:h-20 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 cursor-pointer group-hover:border-blue-400 dark:group-hover:border-blue-500/50 transition-all"
                                  className="w-full h-full object-cover hover:scale-110 transition-transform duration-300"
                                />
                              ) : (
                                <span className="text-slate-400 dark:text-slate-500 italic text-[10px] sm:text-xs">No Image</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Konten Log Lengkap */}
        {activeSubTab === 'lengkap' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-purple-500" /> Tarik Log Rentang Tanggal
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Pilih rentang tanggal untuk melihat riwayat presensi
              </p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-30">
              <DatePicker label="Tanggal Awal" value={tglAwal} onChange={setTglAwal} />
              <DatePicker label="Tanggal Akhir" value={tglAkhir} onChange={setTglAkhir} />
            </div>
            
            <button 
              onClick={fetchLengkap}
              disabled={loadingLengkap}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 text-white font-bold py-3.5 px-4 rounded-xl shadow-sm transition-all mt-2 flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              {loadingLengkap ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <Search className="w-5 h-5" />
              )}
              {loadingLengkap ? 'Menarik Data...' : 'Tarik Data Lengkap'}
            </button>
            
            {errorLengkap && (
              <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800/50 font-mono text-sm rounded-xl flex gap-3 items-start">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span className="leading-relaxed">{errorLengkap}</span>
              </div>
            )}
            
            {dataLengkap && (
              <div className="mt-6 space-y-4">
                <div className="inline-flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-4 py-2 rounded-lg border border-emerald-200 dark:border-emerald-500/20 text-sm font-bold">
                  <CheckCircle className="w-4 h-4" /> DATA REKAP DITEMUKAN
                </div>
                
                <div 
                  className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800/80 rounded-2xl overflow-x-auto custom-scrollbar shadow-sm"
                  onScroll={handleScrollLengkap}
                  style={{ maxHeight: '500px' }}
                >
                  <table className="w-full min-w-[620px] text-left border-collapse">
                    <thead className="sticky top-0 z-20">
                      <tr>
                        <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-2 sm:p-4 text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Tanggal</th>
                        <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-2 sm:p-4 text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Masuk</th>
                        <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-2 sm:p-4 text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Pulang</th>
                        <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-2 sm:p-4 text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Status</th>
                        <th className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-2 sm:p-4 text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap shadow-sm">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataLengkap.slice(0, visibleCountLengkap).map((item, i) => {
                      const statusRaw = (item.cuti || '').trim().toUpperCase();
                      const isMangkir = statusRaw === 'M';
                      const isLibur = statusRaw.includes('*');

                      let keterangan = '-';
                      if (isLibur) keterangan = 'Libur';
                      else if (statusRaw === 'IS') keterangan = 'Izin Sakit';
                      else if (statusRaw === 'CS') keterangan = 'Cuti Sakit';
                      else if (statusRaw === 'CAP') keterangan = 'Cuti Alasan Penting';
                      else if (statusRaw === 'TB') keterangan = 'Tugas Belajar';
                      else if (statusRaw === 'CT') keterangan = 'Cuti Tahunan';
                      else if (statusRaw === 'P') keterangan = 'Penugasan';
                      else if (statusRaw === 'IKK') keterangan = 'Izin Kepentingan Keluarga';
                      else if (statusRaw === 'H') keterangan = 'Hadir';
                      else if (statusRaw === 'M') keterangan = 'Mangkir';
                      else if (statusRaw === 'CB') keterangan = 'Cuti Besar';
                      else if (statusRaw === 'CM') keterangan = 'Cuti Melahirkan';
                      else if (statusRaw === 'DK') keterangan = 'Diklat';
                      else if (statusRaw === 'DL') keterangan = 'Tugas Luar';
                      else if (statusRaw === 'CLTN') keterangan = 'Cuti Diluar Tanggungan Negara';
                      else if (statusRaw === '?') keterangan = 'Tidak Checkout/ Checkin 1 hari';
                      else if (statusRaw) keterangan = statusRaw;

                      return (
                        <tr key={i} className={`transition-colors group ${isMangkir ? 'bg-red-50 dark:bg-red-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                          <td className="p-2 sm:p-4 align-top whitespace-nowrap">
                            <div className={`font-mono text-[10px] sm:text-xs ${isMangkir ? 'text-red-700 dark:text-red-400 font-bold' : 'text-slate-600 dark:text-slate-400'}`}>
                              {formatCompactDateTime(item.tanggal)}
                            </div>
                          </td>
                          <td className="p-2 sm:p-4 align-top whitespace-nowrap">
                            <div className={`font-semibold text-sm ${isMangkir ? 'text-red-400 dark:text-red-500/50' : 'text-blue-600 dark:text-blue-400'}`}>
                              {formatBeautifulDateTime(item.absen_masuk)}
                            </div>
                          </td>
                          <td className="p-2 sm:p-4 align-top whitespace-nowrap">
                            <div className={`font-semibold text-sm ${isMangkir ? 'text-red-400 dark:text-red-500/50' : 'text-blue-600 dark:text-blue-400'}`}>
                              {formatBeautifulDateTime(item.absen_pulang)}
                            </div>
                          </td>
                          <td className="p-2 sm:p-4 align-top whitespace-nowrap">
                            <span className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs font-bold border ${isMangkir ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50' : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`}>
                              {item.cuti || '-'}
                            </span>
                          </td>
                          <td className="p-2 sm:p-4 align-top whitespace-nowrap">
                            <div className={`text-sm ${isMangkir ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-600 dark:text-slate-400 font-medium'}`}>
                              {keterangan}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            )}
          </div>
        )}
      </div>

      {modalImg && (
        <ImageLightbox 
          src={modalImg.src} 
          title={modalImg.title} 
          images={modalImg.images} 
          currentIndex={modalImg.currentIndex} 
          onClose={() => setModalImg(null)} 
        />
      )}
    </div>
  );
}

