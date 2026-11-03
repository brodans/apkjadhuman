import React, { useState, useEffect, useRef } from 'react';
import { FileText, Download, FileSpreadsheet, Users, Building2, AlertTriangle, FileCheck, Loader2, BarChart3, Activity, Coins, Maximize2, Minimize2, X } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import DatePicker from '../components/ui/DatePicker';
import { getTodayWIB, getTodayWIBWithOffset } from '../lib/dateFormatter';
import { OPD_LIST } from '../data/opd';
import { usePegawaiSearch } from '../hooks/usePegawaiSearch';
import { loadPegawaiSearchList } from '../lib/pegawaiData';
import { fetchReport, isTauri } from '../api';
import ReportDocumentPreview from '../components/ui/ReportDocumentPreview';

interface PegawaiSelection {
  id: string;
  nip: string;
  nama: string;
  nama_instansi?: string;
  nama_unit_kerja?: string;
  kode_unor?: string;
}

interface InstansiSelection {
  kode: string;
  nama: string;
}

export default function Laporan() {
  const { pegawai, config, tabPermissions, userRole } = useAppContext();

  // Tentukan jenis laporan yang boleh diakses
  const canReport = {
    perPegawai:            userRole === 'admin' || tabPermissions.reportPerPegawai,
    perPegawaiAktivitas:   userRole === 'admin' || tabPermissions.reportPerPegawaiAktivitas,
    skorPerInstansi:       userRole === 'admin' || tabPermissions.reportSkorPerInstansi,
    aktivitasPerInstansi:  userRole === 'admin' || tabPermissions.reportAktivitasPerInstansi,
    rekapTppAktivitas:     userRole === 'admin' || tabPermissions.reportRekapTppAktivitas,
  };
  // Boleh cari pegawai/instansi lain jika admin atau permission allowSearchLaporan aktif
  const canSearchLaporan = userRole === 'admin' || tabPermissions.allowSearchLaporan;

  const instansiDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (instansiDropdownRef.current && !instansiDropdownRef.current.contains(event.target as Node)) {
        setShowInstansiDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // General state
  const [reportType, setReportType] = useState<'per-pegawai' | 'per-pegawai-aktivitas' | 'skor-per-instansi' | 'aktivitas-per-instansi' | 'rekap-tpp-aktivitas'>(() => {
    // Default ke tipe pertama yang diizinkan
    if (canReport.perPegawai) return 'per-pegawai';
    if (canReport.perPegawaiAktivitas) return 'per-pegawai-aktivitas';
    if (canReport.skorPerInstansi) return 'skor-per-instansi';
    if (canReport.aktivitasPerInstansi) return 'aktivitas-per-instansi';
    return 'rekap-tpp-aktivitas';
  });
  const [reportFormat, setReportFormat] = useState<'pdf' | 'xls'>('pdf');
  const [dateStart, setDateStart] = useState(() => getTodayWIBWithOffset(-1));
  const [dateEnd, setDateEnd] = useState(() => getTodayWIB());
  
  // Pegawai Selection state
  const [pegawaiList, setPegawaiList] = useState<PegawaiSelection[]>([]);
  const [loadingPegawai, setLoadingPegawai] = useState(false);
  const {
    selectedPegawai,
    setSelectedPegawai,
    searchPegawai,
    setSearchPegawai,
    showPegawaiDropdown,
    setShowPegawaiDropdown,
    pegawaiDropdownRef,
    filteredPegawai,
  } = usePegawaiSearch(pegawaiList);

  // Instansi Selection state
  const [instansiList, setInstansiList] = useState<InstansiSelection[]>([]);
  const [selectedInstansi, setSelectedInstansi] = useState<InstansiSelection | null>(null);
  const [searchInstansi, setSearchInstansi] = useState('');
  const [showInstansiDropdown, setShowInstansiDropdown] = useState(false);
  const [manualInstansiId, setManualInstansiId] = useState('');
  
  // Status filter for OPD reports
  const [statusFilter, setStatusFilter] = useState('all');

  // Preview & Generation state
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [reportBlob, setReportBlob] = useState<Blob | null>(null);
  const [reportFileName, setReportFileName] = useState('');
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportModalFullscreen, setReportModalFullscreen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportModalRef = useRef<HTMLDivElement>(null);

  const clearReport = () => {
    setReportUrl(null);
    setReportBlob(null);
    setReportModalOpen(false);
    setReportModalFullscreen(false);
  };

  useEffect(() => {
    return () => {
      if (reportUrl?.startsWith('blob:')) URL.revokeObjectURL(reportUrl);
    };
  }, [reportUrl]);

  const closeReportModal = async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (cause) {
        console.error('Failed to exit report fullscreen:', cause);
      }
    }
    setReportModalOpen(false);
    setReportModalFullscreen(false);
  };

  const toggleReportFullscreen = async () => {
    if (!reportModalRef.current) return;

    if (reportModalFullscreen) {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch (cause) {
          console.error('Failed to exit report fullscreen:', cause);
        }
      }
      setReportModalFullscreen(false);
      return;
    }

    try {
      if (typeof reportModalRef.current.requestFullscreen === 'function') {
        await reportModalRef.current.requestFullscreen();
      }
      setReportModalFullscreen(true);
    } catch (cause) {
      console.warn('Fullscreen API is unavailable; using the in-app fullscreen layout.', cause);
      setReportModalFullscreen(true);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setReportModalFullscreen(Boolean(document.fullscreenElement));
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !reportModalOpen) return;
      if (reportModalFullscreen) {
        if (!document.fullscreenElement) setReportModalFullscreen(false);
        return;
      }
      if (!document.fullscreenElement) {
        void closeReportModal();
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [reportModalOpen, reportModalFullscreen]);

  // Set default status filter when reportType changes
  useEffect(() => {
    if (reportType === 'skor-per-instansi' || reportType === 'aktivitas-per-instansi' || reportType === 'rekap-tpp-aktivitas') {
      setStatusFilter('pns');
    } else {
      setStatusFilter('all');
    }
  }, [reportType]);

  // Load employee database and extract unique instansi
  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        setLoadingPegawai(true);
        const pegawaiSearchList = await loadPegawaiSearchList();
        if (cancelled) return;
        setPegawaiList(pegawaiSearchList);

        // Pre-select logged-in employee if exists
        if (config.idPegawai) {
          const loggedIn = pegawaiSearchList.find((p: any) => p.id === config.idPegawai);
          if (loggedIn) {
            setSelectedPegawai(loggedIn);
          }
        }

        // Use all OPD from OPD_LIST (derived from data.txt)
        const listInstansi: InstansiSelection[] = OPD_LIST.map((item: any) => ({
          kode: item.kode,
          nama: item.nama
        }));

        setInstansiList(listInstansi);

        // Pre-select current instansi of logged-in employee
        const userInstCode = config.kodeInstansi || config.kodeUnor;
        if (userInstCode) {
          const found = listInstansi.find(i => i.kode === userInstCode);
          if (found) {
            setSelectedInstansi(found);
            setManualInstansiId(found.kode);
          } else {
            setManualInstansiId(userInstCode);
          }
        } else {
          setManualInstansiId('5.19.00.00.00');
        }

      } catch (err) {
        console.error("Error preparing report lists:", err);
      } finally {
        if (!cancelled) setLoadingPegawai(false);
      }
    };

    void loadData();
    return () => { cancelled = true; };
  }, [config.idPegawai, config.kodeInstansi, config.kodeUnor]);

  // Filter lists based on search
  const filteredInstansi = instansiList.filter(i => 
    i.nama.toLowerCase().includes(searchInstansi.toLowerCase()) || 
    i.kode.toLowerCase().includes(searchInstansi.toLowerCase())
  );

  // Generate Report URL
  const handleGenerateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setReportUrl(null);
    setReportBlob(null);
    setReportModalOpen(false);
    setReportModalFullscreen(false);

    // Validate
    if (reportType === 'per-pegawai' || reportType === 'per-pegawai-aktivitas') {
      if (!selectedPegawai) {
        setError('Silakan pilih Pegawai terlebih dahulu.');
        return;
      }
    } else {
      const activeInstId = selectedInstansi ? selectedInstansi.kode : manualInstansiId;
      if (!activeInstId.trim()) {
        setError('Silakan tentukan atau pilih Kode Instansi terlebih dahulu.');
        return;
      }
    }

    setGenerating(true);

    try {
      const params = new URLSearchParams({
        reportType,
        t1: dateStart,
        t2: dateEnd,
        format: reportFormat
      });

      if (reportType === 'per-pegawai' || reportType === 'per-pegawai-aktivitas') {
        params.append('idp', selectedPegawai!.id);
      } else {
        const activeInstId = selectedInstansi ? selectedInstansi.kode : manualInstansiId;
        params.append('idu', activeInstId.trim());
        params.append('status', statusFilter);
      }

      const mime = reportFormat === 'xls' ? 'application/vnd.ms-excel' : 'application/pdf';
      let fileBlob: Blob;
      if (isTauri()) {
        const b64 = await fetchReport(params.toString());
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        fileBlob = new Blob([bytes.buffer], { type: mime });
      } else {
        const reportUrl = await fetchReport(params.toString());
        const response = await fetch(reportUrl);
        if (!response.ok) {
          const responseText = await response.text();
          let message = `Gagal memuat laporan (HTTP ${response.status}).`;
          try {
            const body = JSON.parse(responseText) as { error?: string };
            if (body.error) message = body.error;
          } catch {
            if (responseText.trim()) message = responseText.slice(0, 300);
          }
          throw new Error(message);
        }
        fileBlob = new Blob([await response.arrayBuffer()], { type: mime });
      }

      if (reportFormat === 'pdf') {
        const bytes = new Uint8Array(await fileBlob.slice(0, 5).arrayBuffer());
        const signature = new TextDecoder().decode(bytes);
        if (signature !== '%PDF-') throw new Error('Server tidak mengembalikan berkas PDF yang valid.');
      }

      const fileName = `${reportType}-${dateStart}-ke-${dateEnd}.${reportFormat}`;
      setReportFileName(fileName);
      setReportBlob(fileBlob);
      setReportUrl(URL.createObjectURL(fileBlob));
      setReportModalOpen(true);
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan saat memformulasikan report.');
    } finally {
      setGenerating(false);
    }
  };

  if (!pegawai) {
    return null; // App.tsx auto-redirect ke tabLogin
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="grid grid-cols-1 gap-6">
        <div className="space-y-6">
          <form onSubmit={handleGenerateReport} className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm space-y-5">
            <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700 pb-3 flex items-center gap-2">
              <span>⚙️</span> Konfigurasi Parameter Laporan
            </h3>

            {/* Parameter 1: Report Type Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Jenis Laporan
              </label>
              <div className="grid grid-cols-1 gap-2">
                {canReport.perPegawai && (
                  <button
                    type="button"
                    onClick={() => { setReportType('per-pegawai'); clearReport(); }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer ${reportType === 'per-pegawai' ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/10 text-slate-800 dark:text-white font-bold ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                  >
                    <FileText className={`w-5 h-5 shrink-0 mt-0.5 ${reportType === 'per-pegawai' ? 'text-blue-500' : 'text-slate-400'}`} />
                    <div>
                      <span className="block text-xs font-bold">1. Laporan Absensi Pegawai</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5">Rekapitulasi total presensi masuk, pulang, izin per individu.</span>
                    </div>
                  </button>
                )}

                {canReport.perPegawaiAktivitas && (
                  <button
                    type="button"
                    onClick={() => { setReportType('per-pegawai-aktivitas'); clearReport(); }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer ${reportType === 'per-pegawai-aktivitas' ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/10 text-slate-800 dark:text-white font-bold ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                  >
                    <FileCheck className={`w-5 h-5 shrink-0 mt-0.5 ${reportType === 'per-pegawai-aktivitas' ? 'text-blue-500' : 'text-slate-400'}`} />
                    <div>
                      <span className="block text-xs font-bold">2. Laporan Aktivitas Pegawai</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5">Detail isian log aktivitas pekerjaan harian yang dilaporkan.</span>
                    </div>
                  </button>
                )}

                {canReport.skorPerInstansi && (
                  <button
                    type="button"
                    onClick={() => { setReportType('skor-per-instansi'); clearReport(); }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer ${reportType === 'skor-per-instansi' ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/10 text-slate-800 dark:text-white font-bold ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                  >
                    <BarChart3 className={`w-5 h-5 shrink-0 mt-0.5 ${reportType === 'skor-per-instansi' ? 'text-blue-500' : 'text-slate-400'}`} />
                    <div>
                      <span className="block text-xs font-bold">3. Rekap Persentase Disiplin Kerja</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5">Skor kedisiplinan dan persentase kehadiran pegawai per instansi (Pusat).</span>
                    </div>
                  </button>
                )}

                {canReport.aktivitasPerInstansi && (
                  <button
                    type="button"
                    onClick={() => { setReportType('aktivitas-per-instansi'); clearReport(); }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer ${reportType === 'aktivitas-per-instansi' ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/10 text-slate-800 dark:text-white font-bold ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                  >
                    <Activity className={`w-5 h-5 shrink-0 mt-0.5 ${reportType === 'aktivitas-per-instansi' ? 'text-blue-500' : 'text-slate-400'}`} />
                    <div>
                      <span className="block text-xs font-bold">4. Rekap Persentase Produktivitas Kerja</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5">Kumulatif isian log aktivitas pekerjaan harian pegawai per instansi (Pusat).</span>
                    </div>
                  </button>
                )}

                {canReport.rekapTppAktivitas && (
                  <button
                    type="button"
                    onClick={() => { setReportType('rekap-tpp-aktivitas'); clearReport(); }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer ${reportType === 'rekap-tpp-aktivitas' ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/10 text-slate-800 dark:text-white font-bold ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                  >
                    <Coins className={`w-5 h-5 shrink-0 mt-0.5 ${reportType === 'rekap-tpp-aktivitas' ? 'text-blue-500' : 'text-slate-400'}`} />
                    <div>
                      <span className="block text-xs font-bold">5. Laporan Pembayaran TPP</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5">Rekapitulasi TPP berdasarkan kehadiran dan log produktivitas per instansi.</span>
                    </div>
                  </button>
                )}
              </div>
            </div>

            {/* Parameter 1.5: Format Laporan Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Format Laporan
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReportFormat('pdf');
                    clearReport();
                  }}
                  className={`px-4 py-2.5 rounded-2xl border text-xs font-bold transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${reportFormat === 'pdf' ? 'border-red-500 bg-red-50/20 text-red-700 dark:text-red-400 font-extrabold ring-1 ring-red-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                >
                  <span className="text-red-500">📄</span> Dokumen PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReportFormat('xls');
                    clearReport();
                  }}
                  className={`px-4 py-2.5 rounded-2xl border text-xs font-bold transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${reportFormat === 'xls' ? 'border-emerald-500 bg-emerald-50/20 text-emerald-700 dark:text-emerald-400 font-extrabold ring-1 ring-emerald-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                >
                  <span className="text-emerald-500">📊</span> Excel Spreadsheet
                </button>
              </div>
            </div>

            {/* Parameter 2: Pegawai Selection Dropdown (Only for type 1 and 2) */}
            {(reportType === 'per-pegawai' || reportType === 'per-pegawai-aktivitas') && (
              <div className="space-y-2 relative" ref={pegawaiDropdownRef}>
                <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {canSearchLaporan ? 'Pilih Pegawai' : 'Pegawai (Terkunci)'}
                </label>
                
                {canSearchLaporan ? (
                <>
                {/* Custom Searchable Input Select */}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                    <Users className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={searchPegawai}
                    onChange={(e) => {
                      setSearchPegawai(e.target.value);
                      setShowPegawaiDropdown(true);
                    }}
                    onFocus={() => setShowPegawaiDropdown(true)}
                    placeholder={selectedPegawai ? `${selectedPegawai.nama} (${selectedPegawai.nip})` : "Cari nama atau NIP pegawai..."}
                    className="w-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white placeholder-slate-400 border border-slate-200 dark:border-slate-700 rounded-2xl pl-10 pr-10 py-3 text-xs font-bold focus:outline-none focus:border-blue-500"
                  />
                  {selectedPegawai && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPegawai(null);
                        setSearchPegawai('');
                      }}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                    >
                      <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded-md">Batal</span>
                    </button>
                  )}
                </div>

                {/* Dropdown Options List */}
                {showPegawaiDropdown && (
                  <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl z-30 divide-y divide-slate-100 dark:divide-slate-700/50">
                      {loadingPegawai ? (
                        <div className="p-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Memuat database pegawai...
                        </div>
                      ) : filteredPegawai.length === 0 ? (
                        <div className="p-4 text-center text-slate-400 text-xs">
                          Pegawai tidak ditemukan.
                        </div>
                      ) : (
                        filteredPegawai.slice(0, 10).map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setSelectedPegawai(p);
                              setSearchPegawai('');
                              setShowPegawaiDropdown(false);
                              clearReport();
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer block"
                          >
                            <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{p.nama}</span>
                            <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">NIP: {p.nip} {p.nama_instansi ? `• ${p.nama_instansi}` : ''}</span>
                          </button>
                        ))
                      )}
                      {filteredPegawai.length > 10 && (
                        <div className="p-2 bg-slate-50 dark:bg-slate-900/40 text-center text-[9px] text-slate-400 font-medium">
                          Menampilkan 10 hasil teratas dari total {filteredPegawai.length} pegawai. Gunakan pencarian lebih spesifik.
                        </div>
                      )}
                    </div>
                )}
                </>
                ) : null}

                {/* Selected Pegawai Card */}
                {selectedPegawai && (
                  <div className="p-3 bg-blue-50/40 dark:bg-slate-900/30 border border-blue-100/50 dark:border-slate-700/50 rounded-2xl mt-2 space-y-1">
                    <span className="text-[10px] font-bold text-blue-500 dark:text-blue-400 uppercase tracking-wide block">
                      {canSearchLaporan ? 'Terpilih:' : 'Akun Anda:'}
                    </span>
                    <span className="text-xs font-extrabold block text-slate-700 dark:text-slate-200">{selectedPegawai.nama}</span>
                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 block">NIP: {selectedPegawai.nip}</span>
                    {selectedPegawai.nama_instansi && (
                      <span className="text-[10px] text-slate-400 block truncate">Unit: {selectedPegawai.nama_instansi}</span>
                    )}
                    {!canSearchLaporan && (
                      <span className="text-[9px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded mt-1 inline-block">TERKUNCI KE AKUN SENDIRI</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Parameter 2: Instansi/OPD Selection Dropdown */}
            {(reportType === 'skor-per-instansi' || reportType === 'aktivitas-per-instansi' || reportType === 'rekap-tpp-aktivitas') && (
              <div className="space-y-4">
                <div className="space-y-2 relative" ref={instansiDropdownRef}>
                  <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    {canSearchLaporan ? 'Pilih Perangkat Daerah (OPD)' : 'Instansi (Terkunci)'}
                  </label>

                  {canSearchLaporan ? (
                  <>
                  {/* Searchable input */}
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      value={searchInstansi}
                      onChange={(e) => {
                        setSearchInstansi(e.target.value);
                        setShowInstansiDropdown(true);
                      }}
                      onFocus={() => setShowInstansiDropdown(true)}
                      placeholder={selectedInstansi ? selectedInstansi.nama : "Cari nama instansi/OPD..."}
                      className="w-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white placeholder-slate-400 border border-slate-200 dark:border-slate-700 rounded-2xl pl-10 pr-10 py-3 text-xs font-bold focus:outline-none focus:border-blue-500"
                    />
                    {selectedInstansi && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedInstansi(null);
                          setSearchInstansi('');
                        }}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                      >
                        <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded-md">Batal</span>
                      </button>
                    )}
                  </div>

                  {/* Instansi Dropdown options */}
                  {showInstansiDropdown && (
                    <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl z-30 divide-y divide-slate-100 dark:divide-slate-700/50 custom-scrollbar">
                        {filteredInstansi.length === 0 ? (
                          <div className="p-4 text-center text-slate-400 text-xs">
                            Instansi tidak ditemukan.
                          </div>
                        ) : (
                          filteredInstansi.slice(0, 50).map((i) => (
                            <button
                              key={i.kode}
                              type="button"
                              onClick={() => {
                                setSelectedInstansi(i);
                                setManualInstansiId(i.kode);
                                setSearchInstansi('');
                                setShowInstansiDropdown(false);
                                clearReport();
                              }}
                              className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer block"
                            >
                              <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{i.nama}</span>
                              <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">IDU: {i.kode}</span>
                            </button>
                          ))
                        )}
                      </div>
                  )}
                  </>
                  ) : (
                    /* Terkunci ke instansi sendiri */
                    <div className="flex items-center gap-2 py-3 px-4 bg-slate-100 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-2xl">
                      <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                          {selectedInstansi ? selectedInstansi.nama : (manualInstansiId || 'Instansi Anda')}
                        </p>
                        <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">IDU: {manualInstansiId || '-'}</p>
                      </div>
                      <span className="text-[9px] font-bold bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded shrink-0">TERKUNCI</span>
                    </div>
                  )}
                </div>

                {/* Manual Code Input Field - hanya tampil jika ada izin cari */}
                {canSearchLaporan && (
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">
                    Kode Instansi Pusat (IDU)
                  </label>
                  <input
                    type="text"
                    value={manualInstansiId}
                    onChange={(e) => {
                      setManualInstansiId(e.target.value);
                      setSelectedInstansi(null); // Clear preset if edited manually
                      clearReport();
                    }}
                    placeholder="Contoh: 5.19.00.00.00"
                    className="w-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono font-semibold focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-[9px] text-slate-400 block leading-relaxed">
                    *IDU default didasarkan pada Kode Instansi unit kerja Anda di server pusat.
                  </span>
                </div>
                )}

                 {/* Status Selection Filter */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">
                    Status Filter Rekap
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      clearReport();
                    }}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500"
                  >
                    <option value="pns">Pegawai Negeri Sipil (PNS)</option>
                    <option value="non_pns">Non-PNS (PTT / Kontrak / Lainnya)</option>
                  </select>
                </div>
              </div>
            )}

            {/* Parameter 3: Date Picker Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DatePicker
                label="Tanggal Mulai"
                value={dateStart}
                onChange={(date) => {
                  setDateStart(date);
                  clearReport();
                }}
              />
              <DatePicker
                label="Tanggal Akhir"
                value={dateEnd}
                onChange={(date) => {
                  setDateEnd(date);
                  clearReport();
                }}
              />
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={generating}
              className={`w-full text-white py-3.5 px-4 rounded-2xl text-xs font-extrabold tracking-wide transition-all shadow-md cursor-pointer flex items-center justify-center gap-2 ${reportFormat === 'xls' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/10' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/10'}`}
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Memformulasikan Report...
                </>
              ) : (
                <>
                  {reportFormat === 'xls' ? (
                    <>
                      <span>📊</span> Generate Report Excel
                    </>
                  ) : (
                    <>
                      <span>📄</span> Generate Report PDF
                    </>
                  )}
                </>
              )}
            </button>
          </form>

          {reportUrl && reportBlob && !reportModalOpen && (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-4 rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
                reportFormat === 'xls'
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400'
                  : 'bg-rose-50 text-rose-600 dark:bg-rose-950/20 dark:text-rose-400'
              }`}>
                {reportFormat === 'xls' ? <FileSpreadsheet className="h-7 w-7" /> : <FileText className="h-7 w-7" />}
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-slate-800 dark:text-white">Laporan siap dibuka</h4>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{reportFileName}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setReportModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-blue-700"
                >
                  {reportFormat === 'xls' ? <FileSpreadsheet className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  Buka Pratinjau
                </button>
                <a
                  href={reportUrl}
                  download={reportFileName}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Download className="h-4 w-4" />
                  Unduh
                </a>
              </div>
            </div>
          )}

          {!reportUrl && !error && (
            <div className="bg-slate-100 dark:bg-slate-800/20 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center flex flex-col items-center justify-center min-h-[200px]">
              <div className="w-16 h-16 rounded-3xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700 text-slate-400 flex items-center justify-center shadow-xs">
                <FileText className="w-8 h-8" />
              </div>
              <h4 className="text-sm font-extrabold text-slate-700 dark:text-slate-300 mt-4">Belum Ada Laporan yang Di-generate</h4>
            </div>
          )}

          {/* Inline Error block */}
          {error && (
            <div className="bg-rose-50 dark:bg-rose-950/15 p-4 rounded-3xl border border-rose-100 dark:border-rose-900/30 text-rose-800 dark:text-rose-400 flex items-start gap-3 mt-4 animate-in fade-in duration-200">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-bold block">Gagal Menyiapkan Laporan:</span>
                <span className="mt-1 block text-slate-500 dark:text-slate-400 leading-relaxed">{error}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {reportModalOpen && reportBlob && reportUrl && (
        <div
          className={`report-modal-overlay modal-layer fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm ${
            reportModalFullscreen ? 'is-fullscreen p-0' : 'p-2 sm:p-4'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label={`Pratinjau laporan ${reportFormat === 'pdf' ? 'PDF' : 'spreadsheet'}`}
        >
          <div
            ref={reportModalRef}
            className={`report-viewer-panel relative flex w-full flex-col overflow-hidden border border-slate-200/60 bg-white shadow-2xl dark:border-slate-700/60 dark:bg-slate-900 ${
              reportModalFullscreen
                ? 'report-viewer-panel-fullscreen fixed inset-0 z-[101] h-[100dvh] max-w-none rounded-none'
                : 'h-[88dvh] max-w-6xl rounded-2xl sm:rounded-3xl'
            }`}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/80 sm:gap-3 sm:px-4 sm:py-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${reportFormat === 'xls' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <span className="truncate text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  {reportType.replace(/-/g, ' ')}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <a
                  href={reportUrl}
                  download={reportFileName}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 sm:px-3"
                  aria-label="Unduh laporan"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Unduh</span>
                </a>
                <button
                  type="button"
                  onClick={() => void toggleReportFullscreen()}
                  className="inline-flex items-center gap-1.5 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  aria-label={reportModalFullscreen ? 'Keluar dari layar penuh' : 'Layar penuh'}
                >
                  {reportModalFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  <span className="hidden sm:inline">{reportModalFullscreen ? 'Keluar layar penuh' : 'Layar penuh'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void closeReportModal()}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  aria-label="Tutup laporan"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <ReportDocumentPreview file={reportBlob} format={reportFormat} />
          </div>
        </div>
      )}

    </div>
  );
}
