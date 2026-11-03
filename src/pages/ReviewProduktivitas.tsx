import { useState, useEffect, useRef } from 'react';
import { 
  BarChart3, Search, User, Key, ShieldAlert, Layers, CheckCircle, 
  Clock, FileText, Check, X, Eye, RefreshCw, Briefcase, ChevronRight, AlertCircle, Edit3, Loader2
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { sendRequest } from '../api';
import ImageLightbox from '../components/ui/ImageLightbox';
import { usePegawaiSearch } from '../hooks/usePegawaiSearch';
import { loadPegawaiDatabase, toPegawaiSearchList } from '../lib/pegawaiData';
import { useResolvedImageSource } from '../hooks/useResolvedImageSource';

// Helper function to find the immediate supervisor (atasan langsung / Kabid / Kasubag / Kepala Dinas)
function findAtasanLangsung(currentUser: any, list: any[]) {
  if (!currentUser) return null;
  const userUnor = currentUser.kode_unor || currentUser.unor;
  if (!userUnor) return null;

  // 1. Look for a STRUKTURAL leader in the same EXACT kode_unor/unor first
  const sameUnorStruktural = list.filter((p: any) => 
    p.id !== currentUser.id && 
    p.tipe_jabatan === "STRUKTURAL" && 
    (p.kode_unor === userUnor || p.unor === userUnor)
  );
  if (sameUnorStruktural.length > 0) {
    // Return the one with the highest kelas_jabatan
    return sameUnorStruktural.reduce((prev, curr) => {
      const prevKelas = parseInt(prev.kelas_jabatan || '0', 10);
      const currKelas = parseInt(curr.kelas_jabatan || '0', 10);
      return currKelas > prevKelas ? curr : prev;
    });
  }

  // 2. Shorten the kode_unor segments to find parent unit structural leaders (progressive search up the tree)
  const segments = userUnor.split('.');
  if (segments.length >= 2) {
    for (let i = segments.length - 1; i >= 1; i--) {
      const parentSegments = [...segments];
      for (let j = i; j < segments.length; j++) {
        parentSegments[j] = "00";
      }
      const parentUnor = parentSegments.join('.');
      if (parentUnor === userUnor) continue;

      const parentStruktural = list.filter((p: any) => 
        p.id !== currentUser.id && 
        p.tipe_jabatan === "STRUKTURAL" && 
        (p.kode_unor === parentUnor || p.unor === parentUnor)
      );

      if (parentStruktural.length > 0) {
        return parentStruktural.reduce((prev, curr) => {
          const prevKelas = parseInt(prev.kelas_jabatan || '0', 10);
          const currKelas = parseInt(curr.kelas_jabatan || '0', 10);
          return currKelas > prevKelas ? curr : prev;
        });
      }
    }
  }

  // 3. Fallback: Search for any STRUKTURAL in the same instansi or department
  const sameInstansiStruktural = list.filter((p: any) => 
    p.id !== currentUser.id && 
    p.tipe_jabatan === "STRUKTURAL" && 
    (p.instansi === currentUser.instansi || p.nama_instansi === currentUser.nama_instansi || p.unor === currentUser.unor)
  );
  if (sameInstansiStruktural.length > 0) {
    // Prefer higher kelas_jabatan
    return sameInstansiStruktural.reduce((prev, curr) => {
      const prevKelas = parseInt(prev.kelas_jabatan || '0', 10);
      const currKelas = parseInt(curr.kelas_jabatan || '0', 10);
      return currKelas > prevKelas ? curr : prev;
    });
  }

  return null;
}

// Skeleton loading photo wrapper — dengan retry otomatis dan loading stabil
function PhotoWithSkeleton({ imgUrl, title, onOpen }: {
  imgUrl: string;
  title: string;
  onOpen: (src: string, title: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retrySrc, setRetrySrc] = useState(imgUrl);
  const resolvedRetrySrc = useResolvedImageSource(retrySrc);
  const retryCountRef = useRef(0);
  const maxRetries = 2;

  // Reset saat imgUrl berubah
  useEffect(() => {
    setLoaded(false);
    setError(false);
    setRetrySrc(imgUrl);
    retryCountRef.current = 0;
  }, [imgUrl]);

  const handleError = () => {
    if (retryCountRef.current < maxRetries) {
      retryCountRef.current += 1;
      // Tunggu sebentar lalu retry dengan cache-bust
      const delay = 1200 * retryCountRef.current;
      setTimeout(() => {
        const sep = imgUrl.includes('?') ? '&' : '?';
        setRetrySrc(`${imgUrl}${sep}_r=${retryCountRef.current}`);
      }, delay);
    } else {
      setError(true);
    }
  };

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold tracking-wide">Foto Lampiran</span>
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-900 flex justify-center items-center relative min-h-[200px]">

        {/* Skeleton shimmer — tampil saat loading */}
        {!loaded && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="w-full h-full relative overflow-hidden bg-slate-800">
              {/* Shimmer wave */}
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s infinite linear',
                }}
              />
              {/* Centered camera icon placeholder */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 select-none">
                <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600 opacity-50">
                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
                  <circle cx="12" cy="13" r="3"/>
                </svg>
                {retryCountRef.current > 0 ? (
                  <span className="text-[11px] text-amber-400 font-medium animate-pulse">Mencoba lagi ({retryCountRef.current}/{maxRetries})...</span>
                ) : (
                  <span className="text-[11px] text-slate-500 font-medium animate-pulse">Memuat foto...</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Error state — dengan tombol retry manual */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500 p-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-40">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span className="text-[11px] text-center">Foto tidak dapat dimuat</span>
            <button
              onClick={() => {
                retryCountRef.current = 0;
                setError(false);
                setLoaded(false);
                const sep = imgUrl.includes('?') ? '&' : '?';
                setRetrySrc(`${imgUrl}${sep}_r=m`);
              }}
              className="text-[10px] font-bold text-blue-400 hover:text-blue-300 border border-blue-700/40 px-3 py-1 rounded-lg transition-colors"
            >
              Coba Lagi
            </button>
          </div>
        )}

        {/* Actual image */}
        <img
          src={resolvedRetrySrc || undefined}
          alt="Foto Kegiatan"
          loading="lazy"
          decoding="async"
          className="max-h-[350px] w-full object-contain rounded-xl cursor-pointer transition-all duration-500"
          style={{ opacity: loaded ? 1 : 0, transform: loaded ? 'scale(1)' : 'scale(0.98)' }}
          referrerPolicy="no-referrer"
          onClick={() => { if (loaded) onOpen(imgUrl, title); }}
          onLoad={() => setLoaded(true)}
          onError={handleError}
        />
      </div>

      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
}

export default function ReviewProduktivitas() {

  const { pegawai, config, tabPermissions, userRole } = useAppContext();

  // Review produktivitas dan pemilihan pegawai selalu tersedia.
  const canSearchReview = userRole === 'admin' || tabPermissions.allowSearchReview;

  // Default ID for review productivity
  const [idPegawai, setIdPegawai] = useState('9d196ee2-e34c-11e8-bad3-28924a31c25f');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Pegawai Autocomplete Search state
  const [pegawaiList, setPegawaiList] = useState<any[]>([]);
  const [loadingPegawai, setLoadingPegawai] = useState(false);
  const {
    searchPegawai,
    setSearchPegawai,
    showPegawaiDropdown,
    setShowPegawaiDropdown,
    selectedPegawai,
    setSelectedPegawai,
    pegawaiDropdownRef,
    filteredPegawai,
  } = usePegawaiSearch(pegawaiList);

  // Local editable parameters (default to login config values)
  const [localKodeInstansi, setLocalKodeInstansi] = useState(config.kodeInstansi || '');
  const [localNomor, setLocalNomor] = useState(pegawai?.message || '5002');

  // Sync localNomor when pegawai message is retrieved from server response
  useEffect(() => {
    if (pegawai?.message) {
      setLocalNomor(pegawai.message);
    }
  }, [pegawai?.message]);

  // Edit states to show inline input instead of plain text
  const [isEditingKodeInstansi, setIsEditingKodeInstansi] = useState(false);
  const [isEditingNomor, setIsEditingNomor] = useState(false);

  // Load pegawais on mount / and when current pegawai changes to auto select supervisor (atasan)
  useEffect(() => {
    let cancelled = false;
    setLoadingPegawai(true);
    loadPegawaiDatabase().then(dbList => {
      if (cancelled) return;
      const reviewPegawaiList = toPegawaiSearchList(dbList);
      setPegawaiList(reviewPegawaiList);

      // Auto select atasan langsung from the logged-in user
      let targetId = '9d196ee2-e34c-11e8-bad3-28924a31c25f'; // fallback default if not found

      if (pegawai) {
        // Find full profile data in database to get the code hierarchy attributes
        const fullUser = dbList.find((p: any) => p.id === pegawai.id || p.nip === pegawai.nip);
        const currentUser = fullUser || pegawai;

        const atasan = findAtasanLangsung(currentUser, dbList);
        if (atasan && atasan.id) {
          targetId = atasan.id;
        }
      }

      setIdPegawai(targetId);

      // Auto select default or found supervisor if matched
      const found = reviewPegawaiList.find((p: any) => p.id === targetId);
      if (found) {
        setSelectedPegawai(found);
        if (found.kode_unor) {
          setLocalKodeInstansi(found.kode_unor);
        }
      }
    }).catch(err => {
      console.error('Failed loading pegawais', err);
    }).finally(() => {
      if (!cancelled) setLoadingPegawai(false);
    });

    return () => { cancelled = true; };
  }, [pegawai]);

  // Sync selectedPegawai if idPegawai changes manually (e.g. initial load or reset)
  useEffect(() => {
    if (pegawaiList.length > 0) {
      const found = pegawaiList.find(p => p.id === idPegawai);
      if (found) {
        setSelectedPegawai(found);
      } else {
        setSelectedPegawai(null);
      }
    }
  }, [idPegawai, pegawaiList]);

  useEffect(() => {
    if (config.kodeInstansi) {
      setLocalKodeInstansi(config.kodeInstansi);
    }
  }, [config.kodeInstansi]);
  
  // Loaded review data
  const [unorData, setUnorData] = useState<any>(null);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PENDING' | 'DISETUJUI' | 'DITOLAK'>('ALL');

  // Search filter for the loaded activities list
  const [searchQuery, setSearchQuery] = useState('');

  // Modals / Details states
  const [selectedActivity, setSelectedActivity] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailedKegiatan, setDetailedKegiatan] = useState<any>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [updatingStatusVal, setUpdatingStatusVal] = useState<number | null>(null);
  const [updateMessage, setUpdateMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // Batch states
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchPhase, setBatchPhase] = useState<'confirm' | 'processing' | 'done'>('confirm');
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchItems, setBatchItems] = useState<{ id: string; tugas: string; status: 'waiting' | 'processing' | 'success' | 'failed' }[]>([]);

  // Image lightbox
  const [modalImg, setModalImg] = useState<{src: string, title: string} | null>(null);



  const handleFetchReview = async (
    targetId = idPegawai,
    targetKodeInstansi = localKodeInstansi,
    targetNomor = localNomor,
  ) => {
    if (!targetId) {
      setError('ID Pegawai harus diisi');
      return;
    }

    setLoading(true);
    setError('');
    setUnorData(null);
    setDashboardData(null);
    setActivities([]);
    setUpdateMessage(null);

    const payload = {
      kode_instansi: targetKodeInstansi,
      nomor: targetNomor,
      id_pegawai: targetId
    };

    try {
      // Fetch Unor, Dashboard Stats, and Activities list in parallel
      const [unorRes, dashboardRes, activitiesRes] = await Promise.all([
        sendRequest("/Tupoksi/get_unor1", payload).catch(err => ({ error: err.message })),
        sendRequest("/Tupoksi/ambil_data_dashboard", payload).catch(err => ({ error: err.message })),
        sendRequest("/Tupoksi/get_aktifitas", payload).catch(err => ({ error: err.message }))
      ]);

      // Handle Unor response
      if (unorRes && !unorRes.error) {
        setUnorData(unorRes);
      }

      // Handle Dashboard response
      if (dashboardRes && !dashboardRes.error) {
        setDashboardData(dashboardRes);
      }

      // Handle Activities response
      if (activitiesRes && !activitiesRes.error) {
        if (activitiesRes.data && Array.isArray(activitiesRes.data)) {
          setActivities(activitiesRes.data);
        } else if (Array.isArray(activitiesRes)) {
          setActivities(activitiesRes);
        }
      }

      if (!unorRes && !dashboardRes && !activitiesRes) {
        setError('Gagal memuat seluruh data review produktivitas.');
      }
    } catch (err: any) {
      setError(`Gagal memuat review produktivitas: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // View specific activity details
  const handleViewDetail = async (activity: any) => {
    setSelectedActivity(activity);
    setDetailedKegiatan(null);
    setDetailLoading(true);

    const actId = activity.id || activity.id_aktifitas;
    if (!actId) {
      setDetailLoading(false);
      return;
    }

    // Extract YYYY-MM-DD date from tgl_mulai or default to today's date
    let dateStr = new Date().toISOString().split('T')[0];
    if (activity.tgl_mulai) {
      const match = activity.tgl_mulai.match(/^\d{4}-\d{2}-\d{2}/);
      if (match) {
        dateStr = match[0];
      }
    }

    const payload = {
      id: actId,
      id_pegawai: activity.id_pegawai || config.idPegawai,
      tgl_awal: dateStr,
      tgl_akhir: dateStr
    };

    try {
      const res = await sendRequest("/Tupoksi/detailKegiatan", payload);
      if (res && res.success && res.data && res.data.length > 0) {
        setDetailedKegiatan(res.data[0]);
      } else if (res && res.data && res.data.length > 0) {
        setDetailedKegiatan(res.data[0]);
      } else {
        // Fallback to basic activity info if API fails to yield detail array
        setDetailedKegiatan(activity);
      }
    } catch (err) {
      // Fallback
      setDetailedKegiatan(activity);
    } finally {
      setDetailLoading(false);
    }
  };

  // Update status (1 = Setujui, 2 = Tolak)
  const handleUpdateStatus = async (activity: any, statusValue: number) => {
    const actId = activity.id || activity.id_aktifitas;
    if (!actId) return;

    setUpdatingStatusId(actId);
    setUpdatingStatusVal(statusValue);
    setUpdateMessage(null);

    const payload = {
      id: actId,
      status: statusValue, // 1: Approve, 2: Reject
      nama: activity.nama || activity.nama_pegawai || pegawai?.nama || ''
    };

    const actionText = statusValue === 1 ? 'menyetujui' : 'menolak';
    const finalStatus = statusValue === 1 ? 'DISETUJUI' : 'DITOLAK';

    try {
      const res = await sendRequest("/Tupoksi/updateStatus", payload);
      if (res && res.success) {
        setUpdateMessage({ type: 'success', text: `Berhasil ${actionText} aktivitas: "${activity.tugas || 'Aktivitas'}"` });
        
        // Auto-update locally to save requests, or trigger automatic reload
        setActivities(prev => 
          prev.map((item: any) => {
            const itemId = item.id || item.id_aktifitas;
            if (itemId === actId) {
              return { ...item, status: finalStatus };
            }
            return item;
          })
        );

        // Update dashboard statistics locally if they exist
        if (dashboardData && dashboardData.dashboard && dashboardData.dashboard.length > 0) {
          const stats = { ...dashboardData.dashboard[0] };
          let approvedCount = parseInt(stats.disetujui || '0');
          let rejectedCount = parseInt(stats.ditolak || '0');
          let pendingCount = Math.max(0, parseInt(stats.belum_verifikasi || '0') - 1);

          if (statusValue === 1) {
            approvedCount += 1;
          } else {
            rejectedCount += 1;
          }
          
          setDashboardData({
            ...dashboardData,
            dashboard: [{
              ...stats,
              disetujui: String(approvedCount),
              belum_verifikasi: String(pendingCount),
              ditolak: String(rejectedCount)
            }]
          });
        }
      } else {
        setUpdateMessage({ type: 'error', text: res?.message || `Gagal ${actionText} aktivitas.` });
      }
    } catch (err: any) {
      setUpdateMessage({ type: 'error', text: `Gagal memperbarui status: ${err.message}` });
    } finally {
      setUpdatingStatusId(null);
      setUpdatingStatusVal(null);
    }
  };

  const handleOpenBatchModal = () => {
    const pendingActs = activities.filter(a => {
      const s = String(a.status || '').toUpperCase();
      return s === 'PENDING' || s === 'BELUM DIAKHIRI' || s === '0' || s === 'BELUM_VERIFIKASI' || s === '';
    });

    if (pendingActs.length === 0) {
      setUpdateMessage({ type: 'error', text: 'Tidak ada aktivitas pending yang perlu disetujui.' });
      return;
    }

    setBatchProgress({ current: 0, total: pendingActs.length });
    const initialItems = pendingActs.map(act => ({
      id: act.id || act.id_aktifitas || '',
      tugas: act.tugas || 'Aktivitas Kerja',
      status: 'waiting' as const
    }));
    setBatchItems(initialItems);
    setBatchPhase('confirm');
    setBatchModalOpen(true);
  };

  // Setujui Semua / Batch approve (Sequential automated with progress tracking)
  const handleApproveAllPending = async () => {
    const pendingActs = activities.filter(a => {
      const s = String(a.status || '').toUpperCase();
      return s === 'PENDING' || s === 'BELUM DIAKHIRI' || s === '0' || s === 'BELUM_VERIFIKASI' || s === '';
    });

    if (pendingActs.length === 0) {
      setBatchModalOpen(false);
      return;
    }

    setBatchPhase('processing');
    setUpdateMessage(null);
    setBatchProgress({ current: 0, total: pendingActs.length });

    let successCount = 0;
    let failCount = 0;
    const approvedIds = new Set<string>();

    // Process sequentially (one by one, automatically mimicking pressing approve manually)
    for (let i = 0; i < pendingActs.length; i++) {
      const act = pendingActs[i];
      const actId = act.id || act.id_aktifitas;

      // Update state to current item
      setBatchProgress({ current: i + 1, total: pendingActs.length });
      setBatchItems(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'processing' } : item));

      if (!actId) {
        setBatchItems(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'failed' } : item));
        failCount++;
        continue;
      }

      const payload = {
        id: actId,
        status: 1, // 1 is for Approval
        nama: act.nama || act.nama_pegawai || pegawai?.nama || ''
      };

      try {
        const res = await sendRequest("/Tupoksi/updateStatus", payload);
        if (res && res.success) {
          successCount++;
          approvedIds.add(actId);
          setBatchItems(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'success' } : item));
        } else {
          failCount++;
          setBatchItems(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'failed' } : item));
        }
      } catch (err) {
        failCount++;
        setBatchItems(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'failed' } : item));
      }

      // 400ms delay to let the user see the visual transition progress
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    // Finished all
    setBatchProgress({ current: pendingActs.length, total: pendingActs.length });
    setBatchPhase('done');

    if (successCount > 0) {
      // Auto-update locally to save requests
      setActivities(prev => 
        prev.map((item: any) => {
          const itemId = item.id || item.id_aktifitas;
          if (itemId && approvedIds.has(itemId)) {
            return { ...item, status: 'DISETUJUI' };
          }
          return item;
        })
      );

      // Update dashboard statistics locally if they exist
      if (dashboardData && dashboardData.dashboard && dashboardData.dashboard.length > 0) {
        const stats = { ...dashboardData.dashboard[0] };
        const approvedCount = parseInt(stats.disetujui || '0') + successCount;
        const pendingCount = Math.max(0, parseInt(stats.belum_verifikasi || '0') - successCount);
        
        setDashboardData({
          ...dashboardData,
          dashboard: [{
            ...stats,
            disetujui: String(approvedCount),
            belum_verifikasi: String(pendingCount)
          }]
        });
      }
    }

    setUpdateMessage({ 
      type: successCount === pendingActs.length ? 'success' : 'error', 
      text: `Proses persetujuan massal selesai. Berhasil menyetujui ${successCount} dari ${pendingActs.length} aktivitas.` 
    });
  };

  if (!pegawai) {
    return null; // App.tsx will auto-redirect to tabLogin
  }

  // Filter activities based on selected tab and search query
  const filteredActivities = activities.filter(act => {
    // 1. Filter by Status
    if (filterStatus !== 'ALL') {
      const actStatus = String(act.status || '').toUpperCase();
      if (filterStatus === 'PENDING' && actStatus !== 'PENDING' && actStatus !== 'BELUM DIAKHIRI' && actStatus !== '0' && actStatus !== 'BELUM_VERIFIKASI' && actStatus !== '') {
        return false;
      }
      if (filterStatus === 'DISETUJUI' && actStatus !== 'DISETUJUI' && actStatus !== '1' && actStatus !== 'SUDAH_VERIFIKASI' && actStatus !== 'APPROVED') {
        return false;
      }
      if (filterStatus === 'DITOLAK' && actStatus !== 'DITOLAK' && actStatus !== '2' && actStatus !== 'REJECTED') {
        return false;
      }
    }

    // 2. Filter by search text
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNama = (act.nama || '').toLowerCase().includes(q);
      const matchTugas = (act.tugas || '').toLowerCase().includes(q);
      const matchKet = (act.keterangan || act.ket || '').toLowerCase().includes(q);
      const matchUnor = (act.unor || '').toLowerCase().includes(q);
      return matchNama || matchTugas || matchKet || matchUnor;
    }

    return true;
  });

  // Calculate stats from actual activities if dashboard API lacks
  const localStats = {
    total: activities.length,
    pending: activities.filter(a => {
      const s = String(a.status || '').toUpperCase();
      return s === 'PENDING' || s === 'BELUM DIAKHIRI' || s === '0' || s === 'BELUM_VERIFIKASI' || s === '';
    }).length,
    disetujui: activities.filter(a => {
      const s = String(a.status || '').toUpperCase();
      return s === 'DISETUJUI' || s === '1' || s === 'SUDAH_VERIFIKASI' || s === 'APPROVED';
    }).length,
    ditolak: activities.filter(a => {
      const s = String(a.status || '').toUpperCase();
      return s === 'DITOLAK' || s === '2' || s === 'REJECTED';
    }).length,
  };

  // Dashboard stats derived from data if needed in future

  const formatDateTime = (str: string) => {
    if (!str) return '-';
    try {
      const date = new Date(str.replace(/-/g, '/'));
      if (isNaN(date.getTime())) return str;
      return date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return str;
    }
  };

  return (
    <div className="w-full mx-auto space-y-5 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm relative">
      
      {/* Tab Title */}
      <h3 className="text-lg font-bold text-slate-800 dark:text-white border-b-2 border-blue-500 pb-2 mb-4 flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-blue-500 animate-pulse" /> Review Produktivitas Pegawai
      </h3>

      {/* Input Section */}
      <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-4">
        <div className={`space-y-2 relative ${showPegawaiDropdown ? 'z-[60]' : 'z-20'}`} ref={pegawaiDropdownRef}>
          <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
            <User className="w-4 h-4 text-blue-500" /> {canSearchReview ? 'Cari & Pilih Atasan' : 'Atasan Langsung (Terkunci)'}
          </label>
          {canSearchReview ? (
          <>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                <Search className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={searchPegawai}
                onChange={(e) => {
                  setSearchPegawai(e.target.value);
                  setShowPegawaiDropdown(true);
                }}
                onFocus={() => setShowPegawaiDropdown(true)}
                placeholder={selectedPegawai ? `${selectedPegawai.nama} (NIP: ${selectedPegawai.nip})` : "Ketik nama atau NIP pegawai..."}
                className="w-full pl-10 pr-12 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-bold focus:ring-2 focus:ring-blue-500/50 outline-none transition-all shadow-sm"
              />
              {selectedPegawai && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPegawai(null);
                    setIdPegawai('');
                    setSearchPegawai('');
                  }}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">Batal</span>
                </button>
              )}
            </div>
            
            <button
              onClick={() => handleFetchReview()}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer text-sm"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span>{loading ? 'Memuat...' : 'Cek Produktivitas'}</span>
            </button>
          </div>

          {/* Autocomplete recommendations list */}
          {showPegawaiDropdown && (
            <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-[70] divide-y divide-slate-100 dark:divide-slate-700/50 custom-scrollbar">
              {loadingPegawai ? (
                <div className="p-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Memuat database...
                </div>
              ) : filteredPegawai.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-xs">
                  Pegawai tidak ditemukan.
                </div>
              ) : (
                filteredPegawai.slice(0, 50).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedPegawai(p);
                      setIdPegawai(p.id);
                      setSearchPegawai('');
                      setShowPegawaiDropdown(false);
                      if (p.kode_unor) {
                        setLocalKodeInstansi(p.kode_unor);
                      }
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer block"
                  >
                    <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{p.nama}</span>
                    <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">NIP: {p.nip || '-'}</span>
                  </button>
                ))
              )}
            </div>
          )}
          </>
          ) : (
            /* Jika tidak ada izin, tampilkan info atasan langsung (terkunci) + tombol langsung */
            <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
              <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/50 rounded-xl">
                {selectedPegawai ? (
                  <div>
                    <p className="text-[10px] font-bold text-blue-500 dark:text-blue-400 uppercase tracking-wide">Atasan Langsung</p>
                    <p className="text-xs font-extrabold text-slate-800 dark:text-slate-100">{selectedPegawai.nama}</p>
                    <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">NIP: {selectedPegawai.nip || '-'}</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic">Mendeteksi atasan langsung...</p>
                )}
              </div>
              <button
                onClick={() => handleFetchReview()}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer text-sm"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>{loading ? 'Memuat...' : 'Cek Produktivitas'}</span>
              </button>
            </div>
          )}

          {/* Detailed chosen pegawai info */}
          {selectedPegawai && (
            <div className="p-3 bg-blue-50/40 dark:bg-slate-900/30 border border-blue-100/50 dark:border-slate-700/50 rounded-xl mt-2 flex flex-col sm:flex-row justify-between sm:items-center gap-2 animate-fade-in">
              <div>
                <span className="text-[10px] font-bold text-blue-500 dark:text-blue-400 uppercase tracking-wide block">Terpilih:</span>
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100 block">{selectedPegawai.nama}</span>
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 block">NIP: {selectedPegawai.nip || '-'}</span>
              </div>
              {selectedPegawai.nama_instansi && (
                <div className="text-left sm:text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block">Instansi/Unit Kerja:</span>
                  <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 block">{selectedPegawai.nama_instansi}</span>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Hidden Auto Parameters Visualizer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div className="flex items-center justify-between px-3.5 py-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700 min-h-[44px]">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 shrink-0">
              <Layers className="w-3.5 h-3.5 text-blue-500" /> Kode Instansi:
            </span>
            
            {isEditingKodeInstansi ? (
              <div className="flex items-center gap-1 ml-2 flex-1 justify-end">
                <input
                  type="text"
                  value={localKodeInstansi}
                  onChange={(e) => setLocalKodeInstansi(e.target.value)}
                  className="w-full max-w-[120px] px-2 py-0.5 text-xs font-mono font-bold border border-blue-500 rounded bg-slate-50 dark:bg-slate-950 text-slate-950 dark:text-white focus:outline-none"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setIsEditingKodeInstansi(false);
                    if (e.key === 'Escape') {
                      setLocalKodeInstansi(config.kodeInstansi || '');
                      setIsEditingKodeInstansi(false);
                    }
                  }}
                />
                <button
                  onClick={() => setIsEditingKodeInstansi(false)}
                  className="p-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded"
                  title="Simpan"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 ml-2 overflow-hidden">
                <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200 truncate" title={localKodeInstansi || '-'}>
                  {localKodeInstansi || '-'}
                </span>
                <button
                  onClick={() => setIsEditingKodeInstansi(true)}
                  className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded transition-colors shrink-0"
                  title="Ubah Kode Instansi"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                {localKodeInstansi !== (config.kodeInstansi || '') && (
                  <button
                    onClick={() => setLocalKodeInstansi(config.kodeInstansi || '')}
                    className="text-[10px] text-blue-500 hover:underline hover:text-blue-600 shrink-0 font-medium"
                    title="Reset ke Default Login Info"
                  >
                    Reset
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-3.5 py-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700 min-h-[44px]">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 shrink-0">
              <Key className="w-3.5 h-3.5 text-blue-500" /> Nomor:
            </span>
            
            {isEditingNomor ? (
              <div className="flex items-center gap-1 ml-2 flex-1 justify-end">
                <input
                  type="text"
                  value={localNomor}
                  onChange={(e) => setLocalNomor(e.target.value)}
                  className="w-full max-w-[120px] px-2 py-0.5 text-xs font-mono font-bold border border-blue-500 rounded bg-slate-50 dark:bg-slate-950 text-slate-950 dark:text-white focus:outline-none"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setIsEditingNomor(false);
                    if (e.key === 'Escape') {
                      setLocalNomor(pegawai?.message || '5002');
                      setIsEditingNomor(false);
                    }
                  }}
                />
                <button
                  onClick={() => setIsEditingNomor(false)}
                  className="p-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded"
                  title="Simpan"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 ml-2 overflow-hidden">
                <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200 truncate" title={localNomor || '-'}>
                  {localNomor || '-'}
                </span>
                <button
                  onClick={() => setIsEditingNomor(true)}
                  className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded transition-colors shrink-0"
                  title="Ubah Nomor"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                {localNomor !== (pegawai?.message || '5002') && (
                  <button
                    onClick={() => {
                      const defaultNomor = pegawai?.message || '5002';
                      setLocalNomor(defaultNomor);
                      void handleFetchReview(idPegawai, localKodeInstansi, defaultNomor);
                    }}
                    className="text-[10px] text-blue-500 hover:underline hover:text-blue-600 shrink-0 font-medium"
                    title="Reset ke Default Login Info"
                  >
                    Reset
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20 rounded-xl text-sm font-semibold flex items-start gap-2">
          <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {/* Update message notification */}
      {updateMessage && (
        <div className={`p-4 rounded-xl text-sm font-semibold flex items-center justify-between shadow-sm animate-fade-in border ${
          updateMessage.type === 'success' 
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' 
            : 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20'
        }`}>
          <div className="flex items-center gap-2">
            {updateMessage.type === 'success' ? <CheckCircle className="w-5 h-5 text-emerald-500" /> : <AlertCircle className="w-5 h-5 text-red-500" />}
            <span>{updateMessage.text}</span>
          </div>
          <button 
            onClick={() => setUpdateMessage(null)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Review Dashboard Section (Only shows if unorData, dashboardData, or activities loaded) */}
      {(unorData || dashboardData || activities.length > 0) && (
        <div className="space-y-6 animate-fade-in pt-2">
          
          {/* 1. Unor Banner Info */}
          {unorData && (
            <div className="bg-gradient-to-r from-blue-500/10 to-indigo-500/10 dark:from-blue-500/5 dark:to-indigo-500/5 border border-blue-100 dark:border-blue-900/20 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Unit Kerja Pegawai</span>
                <h4 className="text-md font-bold text-slate-800 dark:text-white leading-snug">
                  {unorData.data?.[0]?.nama || unorData.nama || 'Detail Unor'}
                </h4>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1 font-mono">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Kode:</span> {unorData.data?.[0]?.kode || '-'}
                  </span>
                  <span className="flex items-center gap-1 font-mono">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Parent ID:</span> {unorData.data?.[0]?.parent_id || '-'}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-2 self-start md:self-center">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Status Data:</span>
                <span className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold px-2 py-1 rounded-md uppercase">
                  {unorData.message || 'Sukses'}
                </span>
              </div>
            </div>
          )}

          {/* 3. Filter and Activity List Section */}
          <div className="space-y-4">
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h4 className="text-md font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-blue-500" /> Daftar Aktivitas Kerja ({filteredActivities.length})
              </h4>

              {/* Status Filters & Batch Approve Button */}
              <div className="flex flex-wrap items-center gap-2">
                {localStats.pending > 0 && (
                  <button
                    onClick={handleOpenBatchModal}
                    disabled={batchModalOpen && batchPhase === 'processing'}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-3.5 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-sm shadow-emerald-600/10 transition-all cursor-pointer"
                    title="Setujui semua aktivitas pending secara massal"
                  >
                    {batchModalOpen && batchPhase === 'processing' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {batchModalOpen && batchPhase === 'processing'
                        ? `Memproses (${batchProgress.current}/${batchProgress.total})...` 
                        : `Setujui Semua Pending (${localStats.pending})`
                      }
                    </span>
                  </button>
                )}

                <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
                  <button
                    onClick={() => setFilterStatus('ALL')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      filterStatus === 'ALL' 
                        ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-sm' 
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    Semua ({activities.length})
                  </button>
                  <button
                    onClick={() => setFilterStatus('PENDING')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      filterStatus === 'PENDING' 
                        ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20' 
                        : 'text-amber-600 dark:text-amber-500 hover:bg-amber-500/5'
                    }`}
                  >
                    Pending ({localStats.pending})
                  </button>
                  <button
                    onClick={() => setFilterStatus('DISETUJUI')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      filterStatus === 'DISETUJUI' 
                        ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20' 
                        : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600/5'
                    }`}
                  >
                    Disetujui ({localStats.disetujui})
                  </button>
                  <button
                    onClick={() => setFilterStatus('DITOLAK')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      filterStatus === 'DITOLAK' 
                        ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/20' 
                        : 'text-rose-600 dark:text-rose-400 hover:bg-rose-600/5'
                    }`}
                  >
                    Ditolak ({localStats.ditolak})
                  </button>
                </div>
              </div>
            </div>

            {/* In-list search bar */}
            <div className="relative">
              <input
                type="text"
                placeholder="Cari aktivitas berdasarkan nama, tugas, keterangan, atau unit..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Activities Cards View */}
            {filteredActivities.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {filteredActivities.map((act, i) => {
                  const actId = act.id || act.id_aktifitas;
                  const actStatus = String(act.status || '').toUpperCase();
                  const isApproved = actStatus === 'DISETUJUI' || actStatus === '1' || actStatus === 'SUDAH_VERIFIKASI' || actStatus === 'APPROVED';
                  const isRejected = actStatus === 'DITOLAK' || actStatus === '2' || actStatus === 'REJECTED';
                  const isPending = actStatus === 'PENDING' || actStatus === 'BELUM DIAKHIRI' || actStatus === '0' || actStatus === 'BELUM_VERIFIKASI' || actStatus === '';

                  return (
                    <div 
                      key={actId || i}
                      className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 p-5 rounded-2xl hover:border-blue-500/40 dark:hover:border-blue-500/40 transition-all shadow-sm flex flex-col md:flex-row md:items-start justify-between gap-4"
                    >
                      <div className="space-y-3 flex-1">
                        {/* Title and Metadata */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase ${
                            isApproved ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' :
                            isRejected ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400' :
                            'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'
                          }`}>
                            {isApproved ? 'DISETUJUI' : isRejected ? 'DITOLAK' : 'PENDING'}
                          </span>

                          <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold px-2 py-1 rounded-md uppercase">
                            {act.jenis || 'TUPOKSI'}
                          </span>

                          {act.nip && (
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                              NIP: {act.nip}
                            </span>
                          )}
                        </div>

                        {/* Nama & Tugas */}
                        <div>
                          <h5 className="text-sm font-extrabold text-slate-800 dark:text-slate-200">
                            {act.nama || act.nama_pegawai || 'Pegawai'}
                          </h5>
                          <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mt-1 leading-relaxed">
                            {act.tugas || '-'}
                          </p>
                        </div>

                        {/* Keterangan */}
                        {(act.keterangan || act.ket) && (
                          <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 leading-relaxed italic">
                            <span className="font-bold block text-[10px] text-slate-500 uppercase not-italic mb-1">Catatan Pekerjaan:</span>
                            "{act.keterangan || act.ket}"
                          </div>
                        )}

                        {/* Waktu */}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-y-1 gap-x-4 text-xs text-slate-500 dark:text-slate-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            Mulai: <span className="font-semibold text-slate-600 dark:text-slate-400">{formatDateTime(act.tgl_mulai)}</span>
                          </span>
                          {act.tgl_selesai && (
                            <span className="flex items-center gap-1">
                              <ChevronRight className="w-3 h-3 text-slate-400 hidden sm:inline" />
                              Selesai: <span className="font-semibold text-slate-600 dark:text-slate-400">{formatDateTime(act.tgl_selesai)}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons (Detail + Setujui) */}
                      <div className="flex items-center sm:justify-end gap-2 shrink-0 self-end md:self-start">
                        <button
                          onClick={() => handleViewDetail(act)}
                          className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold p-2.5 sm:px-4 sm:py-2 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Lihat Detail & Foto Lampiran"
                        >
                          <Eye className="w-4 h-4" />
                          <span className="hidden sm:inline">Detail</span>
                        </button>

                        {isPending && (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleUpdateStatus(act, 2)}
                              disabled={updatingStatusId === actId}
                              className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold p-2 py-1.5 sm:px-3 sm:py-2 rounded-xl text-xs flex items-center gap-1 shadow-sm shadow-rose-600/10 transition-colors cursor-pointer"
                              title="Tolak Aktivitas"
                            >
                              {updatingStatusId === actId && updatingStatusVal === 2 ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <X className="w-3.5 h-3.5" />
                              )}
                              <span>{updatingStatusId === actId && updatingStatusVal === 2 ? '...' : 'Tolak'}</span>
                            </button>

                            <button
                              onClick={() => handleUpdateStatus(act, 1)}
                              disabled={updatingStatusId === actId}
                              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold p-2 py-1.5 sm:px-3 sm:py-2 rounded-xl text-xs flex items-center gap-1 shadow-sm shadow-emerald-600/10 transition-colors cursor-pointer"
                              title="Setujui Aktivitas"
                            >
                              {updatingStatusId === actId && updatingStatusVal === 1 ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              <span>{updatingStatusId === actId && updatingStatusVal === 1 ? '...' : 'Setujui'}</span>
                            </button>
                          </div>
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-900/20 text-slate-500 dark:text-slate-400">
                <FileText className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                <p className="text-sm font-semibold">Tidak ada aktivitas ditemukan</p>
                <p className="text-xs text-slate-400 mt-1">Coba sesuaikan tab filter atau kata pencarian Anda.</p>
              </div>
            )}

          </div>

        </div>
      )}

      {/* 4. DETAIL MODAL DIALOG */}
      {selectedActivity && (
        <div className="modal-layer fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-500" />
                <h4 className="font-bold text-slate-800 dark:text-white">Rincian Kegiatan Kerja</h4>
              </div>
              <button 
                onClick={() => {
                  setSelectedActivity(null);
                  setDetailedKegiatan(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 flex-1">
              
              {detailLoading ? (
                <div className="text-center py-12 space-y-2">
                  <RefreshCw className="w-8 h-8 mx-auto text-blue-500 animate-spin" />
                  <p className="text-xs text-slate-500 dark:text-slate-400">Memuat rincian dari server...</p>
                </div>
              ) : detailedKegiatan ? (
                <div className="space-y-4">
                  
                  {/* Status Badge */}
                  <div className="flex flex-wrap items-center gap-2">
                    {(() => {
                      const detStatus = String(detailedKegiatan.status || '').toUpperCase();
                      const isDetApproved = detStatus === 'DISETUJUI' || detStatus === '1' || detStatus === 'SUDAH_VERIFIKASI' || detStatus === 'APPROVED';
                      const isDetRejected = detStatus === 'DITOLAK' || detStatus === '2' || detStatus === 'REJECTED';
                      return (
                        <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase ${
                          isDetApproved ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' :
                          isDetRejected ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400' :
                          'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'
                        }`}>
                          {isDetApproved ? 'DISETUJUI' : isDetRejected ? 'DITOLAK' : 'PENDING'}
                        </span>
                      );
                    })()}
                    <span className="text-[10px] bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold px-2.5 py-1 rounded-md uppercase border border-blue-100 dark:border-blue-900/30">
                      {detailedKegiatan.jenis || 'TUPOKSI'}
                    </span>
                  </div>

                  {/* General Info list */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                    <div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold">Nama Pegawai</span>
                      <span className="text-sm font-bold text-slate-800 dark:text-white block">{detailedKegiatan.nama || detailedKegiatan.nama_pegawai || '-'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold">NIP Pegawai</span>
                      <span className="text-sm font-mono text-slate-700 dark:text-slate-300 block">{detailedKegiatan.nip || '-'}</span>
                    </div>
                    {detailedKegiatan.instansi && (
                      <div className="md:col-span-2 border-t border-slate-100 dark:border-slate-800 pt-2 mt-1">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold">Instansi</span>
                        <span className="text-xs text-slate-700 dark:text-slate-300 block">{detailedKegiatan.instansi}</span>
                      </div>
                    )}
                    {detailedKegiatan.unor && (
                      <div className="md:col-span-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold">Unit Kerja (Unor)</span>
                        <span className="text-xs text-slate-700 dark:text-slate-300 block">{detailedKegiatan.unor}</span>
                      </div>
                    )}
                  </div>

                  {/* Tugas & Keterangan */}
                  <div className="space-y-3">
                    <div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold">Tugas Pokok (Tupoksi)</span>
                      <p className="text-sm font-semibold text-slate-800 dark:text-white bg-slate-50/50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                        {detailedKegiatan.tugas || '-'}
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold">Uraian / Keterangan</span>
                      <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 bg-slate-50/50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800 italic">
                        "{detailedKegiatan.keterangan || detailedKegiatan.ket || '-'}"
                      </p>
                    </div>
                  </div>

                  {/* Time frame */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-slate-900/30 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800">
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 block">Waktu Mulai:</span>
                      <span className="font-bold text-slate-800 dark:text-white">{formatDateTime(detailedKegiatan.tgl_mulai)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 block">Waktu Selesai:</span>
                      <span className="font-bold text-slate-800 dark:text-white">{detailedKegiatan.tgl_selesai ? formatDateTime(detailedKegiatan.tgl_selesai) : '-'}</span>
                    </div>
                  </div>

                  {/* Photo Section if any */}
                  {(() => {
                    const lamp = detailedKegiatan.lampiran || detailedKegiatan.foto || detailedKegiatan.file_lampiran;
                    if (!lamp || lamp === 'no_image.png' || lamp.includes('no_image')) {
                      return (
                        <div className="p-4 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/20 text-center text-xs text-slate-500 dark:text-slate-400">
                          Tidak ada foto lampiran aktivitas.
                        </div>
                      );
                    }

                    let imgUrl = '';
                    if (lamp.startsWith('/9j/') || lamp.startsWith('iVBOR')) {
                      imgUrl = `data:image/jpeg;base64,${lamp}`;
                    } else if (lamp.startsWith('http')) {
                      imgUrl = lamp;
                    } else {
                      imgUrl = `/api/proxy-image?path=${encodeURIComponent(lamp)}`;
                    }

                    return (
                      <PhotoWithSkeleton
                        imgUrl={imgUrl}
                        title={detailedKegiatan.nama || 'Foto Lampiran Kegiatan'}
                        onOpen={(src, title) => setModalImg({ src, title })}
                      />
                    );
                  })()}


                </div>
              ) : (
                <div className="text-center py-6 text-slate-500 italic">Gagal melampirkan rincian kegiatan.</div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex items-center justify-end gap-3 bg-slate-50 dark:bg-slate-900/20">
              <button
                onClick={() => {
                  setSelectedActivity(null);
                  setDetailedKegiatan(null);
                }}
                className="bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs sm:text-sm cursor-pointer"
              >
                Tutup
              </button>

              {selectedActivity && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      handleUpdateStatus(selectedActivity, 2);
                      setSelectedActivity(null);
                      setDetailedKegiatan(null);
                    }}
                    disabled={updatingStatusId === (selectedActivity.id || selectedActivity.id_aktifitas)}
                    className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs sm:text-sm flex items-center gap-1.5 shadow-md shadow-rose-600/15 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                    <span>Tolak</span>
                  </button>

                  <button
                    onClick={() => {
                      handleUpdateStatus(selectedActivity, 1);
                      setSelectedActivity(null);
                      setDetailedKegiatan(null);
                    }}
                    disabled={updatingStatusId === (selectedActivity.id || selectedActivity.id_aktifitas)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs sm:text-sm flex items-center gap-1.5 shadow-md shadow-emerald-600/15 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>Setujui</span>
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* 5. BATCH PROGRESS MODAL */}
      {batchModalOpen && (
        <div className="modal-layer fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col">
            
            {/* Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
              <div className="flex items-center gap-2.5">
                <RefreshCw className={`w-5 h-5 text-emerald-600 ${batchPhase === 'processing' ? 'animate-spin' : ''}`} />
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-white text-sm sm:text-base">
                    {batchPhase === 'confirm' && 'Konfirmasi Persetujuan Massal'}
                    {batchPhase === 'processing' && 'Memproses Persetujuan Massal'}
                    {batchPhase === 'done' && 'Persetujuan Massal Selesai'}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {batchPhase === 'confirm' && `Anda akan menyetujui ${batchProgress.total} aktivitas yang masih pending.`}
                    {batchPhase === 'processing' && 'Harap tunggu, sistem sedang menyetujui aktivitas secara otomatis.'}
                    {batchPhase === 'done' && 'Semua proses persetujuan massal telah selesai diproses.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5">
              
              {/* Progress Bar (Only during processing or done) */}
              {batchPhase !== 'confirm' && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-bold text-slate-700 dark:text-slate-300">
                    <span>Progres Persetujuan</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                      {batchProgress.current} dari {batchProgress.total} ({batchProgress.total > 0 ? Math.round((batchProgress.current / batchProgress.total) * 100) : 0}%)
                    </span>
                  </div>
                  
                  {/* Visual Progress Bar */}
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3.5 overflow-hidden border border-slate-200/50 dark:border-slate-700/50">
                    <div 
                      className="bg-emerald-600 h-full rounded-full transition-all duration-300"
                      style={{ width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Items List (shows all items with their status) */}
              <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar border border-slate-100 dark:border-slate-700 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-900/10">
                <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold tracking-wider block mb-2">
                  {batchPhase === 'confirm' ? 'Aktivitas yang akan Disetujui:' : 'Antrean Aktivitas:'}
                </span>
                
                <div className="space-y-1.5">
                  {batchItems.map((item, index) => {
                    const isProcessing = item.status === 'processing';
                    const isSuccess = item.status === 'success';
                    const isFailed = item.status === 'failed';
                    
                    return (
                      <div 
                        key={item.id + '-' + index}
                        className={`flex items-center justify-between text-xs p-2 rounded-lg transition-all ${
                          isProcessing ? 'bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30' :
                          isSuccess ? 'bg-emerald-50/60 dark:bg-emerald-950/10 border border-emerald-100/40 dark:border-emerald-900/20' :
                          isFailed ? 'bg-rose-50/60 dark:bg-rose-950/10 border border-rose-100/40 dark:border-rose-900/20' :
                          'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate max-w-[70%]">
                          <span className="font-mono text-[10px] text-slate-400">#{index + 1}</span>
                          <span className={`font-semibold truncate ${
                            isProcessing ? 'text-blue-700 dark:text-blue-400 font-bold' :
                            isSuccess ? 'text-emerald-700 dark:text-emerald-400' :
                            isFailed ? 'text-rose-700 dark:text-rose-400' :
                            ''
                          }`}>
                            {item.tugas}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-1.5 font-bold text-[10px] uppercase">
                          {isProcessing && (
                            <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1">
                              <RefreshCw className="w-3 h-3 animate-spin" /> Memproses
                            </span>
                          )}
                          {isSuccess && (
                            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <Check className="w-3 h-3" /> Berhasil
                            </span>
                          )}
                          {isFailed && (
                            <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                              <X className="w-3 h-3" /> Gagal
                            </span>
                          )}
                          {item.status === 'waiting' && (
                            <span className="text-slate-400">Menunggu</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-end bg-slate-50 dark:bg-slate-900/20 gap-2">
              {batchPhase === 'confirm' && (
                <>
                  <button
                    onClick={() => setBatchModalOpen(false)}
                    className="border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-350 font-bold px-4 py-2.5 rounded-xl text-xs sm:text-sm cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    Batal
                  </button>
                  <button
                    onClick={handleApproveAllPending}
                    className="bg-emerald-600 hover:bg-emerald-750 text-white font-bold px-5 py-2.5 rounded-xl text-xs sm:text-sm cursor-pointer shadow-md shadow-emerald-600/15 flex items-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    <span>Ya, Setujui Semua</span>
                  </button>
                </>
              )}

              {batchPhase === 'processing' && (
                <span className="text-xs text-slate-400 italic">Harap jangan menutup halaman ini...</span>
              )}

              {batchPhase === 'done' && (
                <button
                  onClick={() => setBatchModalOpen(false)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs sm:text-sm cursor-pointer shadow-md shadow-emerald-600/15"
                >
                  Selesai & Tutup
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Image Lightbox */}
      {modalImg && (
        <ImageLightbox src={modalImg.src} title={modalImg.title} onClose={() => setModalImg(null)} />
      )}

    </div>
  );
}
