import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Calendar, Clock, UploadCloud, Camera as CameraIcon, Image as ImageIcon, Send, CheckCircle, AlertTriangle, X, Search, User, Check, MapPin, Loader2, Info, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppContext } from '../context/AppContext';
import { sendRequest } from '../api';
import ImageLightbox from '../components/ui/ImageLightbox';
import { useBackButton } from '../hooks/useBackButton';
import { usePegawaiSearch } from '../hooks/usePegawaiSearch';
import { getTodayWIB } from '../lib/dateFormatter';
import { loadPegawaiDatabase, toPegawaiSearchList } from '../lib/pegawaiData';
import { dataLokasi } from '../data/data_lokasi';
import { downscaleTo } from '../lib/exif';
import { isProbablyImageFile, sniffImageKind, decodeImageUniversal } from '../lib/universalImage';
import { applyExifFinal, getExifSuntik } from '../lib/exifSuntik';

// Helper function to find matching location in dataLokasi
function findMatchingLocation(pegawai: any, locations: any[]) {
  if (!pegawai) return null;

  const pNamaLokasi = (pegawai.nama_lokasi || '').toLowerCase().trim();
  const pUnor = (pegawai.unor || '').toLowerCase().trim();
  const pInstansi = (pegawai.instansi || '').toLowerCase().trim();
  const pKodeInstansi = (pegawai.kode_instansi || '').trim();

  // 1. Match by exact id if pegawai has id_lokasi
  if (pegawai.id_lokasi) {
    const found = locations.find(l => l.id === pegawai.id_lokasi);
    if (found) return found;
  }

  // 2. Exact match on normalized nama_lokasi
  if (pNamaLokasi) {
    const found = locations.find(l => (l.nama || '').toLowerCase().trim() === pNamaLokasi);
    if (found) return found;
  }

  // 3. Exact match on normalized unor/instansi
  if (pUnor) {
    const found = locations.find(l => (l.nama || '').toLowerCase().trim() === pUnor);
    if (found) return found;
  }
  if (pInstansi) {
    const found = locations.find(l => (l.nama || '').toLowerCase().trim() === pInstansi);
    if (found) return found;
  }

  // 4. Substring match on nama_lokasi
  if (pNamaLokasi) {
    const found = locations.find(l => {
      const lNama = (l.nama || '').toLowerCase();
      return lNama.includes(pNamaLokasi) || pNamaLokasi.includes(lNama);
    });
    if (found) return found;
  }

  // 5. Substring match on unor/instansi
  if (pUnor) {
    const found = locations.find(l => {
      const lNama = (l.nama || '').toLowerCase();
      return lNama.includes(pUnor) || pUnor.includes(lNama);
    });
    if (found) return found;
  }

  // 6. Match by kode
  if (pKodeInstansi) {
    const found = locations.find(l => l.kode === pKodeInstansi);
    if (found) return found;
  }

  // Fallback: return first location with valid coordinates or null
  return locations.find(l => l.latitude && l.longitude) || null;
}

const getTargetEmployeeId = (employee: any, fallbackId = ''): string => {
  const id = employee?.id_pegawai || employee?.id || fallbackId;
  return id == null ? '' : String(id);
};

export default function Presensi() {
  const { pegawai, config, userRole, tabPermissions } = useAppContext();
  const [tanggal, _setTanggal] = useState(() => getTodayWIB());
  const [displayTanggal, setDisplayTanggal] = useState('');
  const [timeStr, setTimeStr] = useState(() => {
    const now = new Date();
    return now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }) + ' WIB';
  });
  const [fileInfo, setFileInfo] = useState('');
  const [base64Image, setBase64Image] = useState('');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<{ type: 'success'|'error', text: string } | null>(null);
  const [modalImg, setModalImg] = useState<{ src: string, title: string } | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // ── Jam Kerja & Status Absen state ──────────────────────────────────────────
  const [jamKerja, setJamKerja] = useState<any>(null);
  const [loadingJamKerja, setLoadingJamKerja] = useState(false);
  const [cekAbsen, setCekAbsen] = useState<any>(null);
  const [loadingCekAbsen, setLoadingCekAbsen] = useState(false);
  // Detail presensi terakhir dari response absen_mobile
  const [presensiDetail, setPresensiDetail] = useState<any>(null);

  const [pegawaiList, setPegawaiList] = useState<any[]>([]);
  const [loadingPegawai, setLoadingPegawai] = useState(false);
  const [pegawaiLoadError, setPegawaiLoadError] = useState(false);
  const [pegawaiLoadAttempt, setPegawaiLoadAttempt] = useState(0);
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
  const [selectedTargetLocation, setSelectedTargetLocation] = useState<any>(null); // Matched location from dataLokasi
  const canSearchPegawai = userRole === 'admin' || (tabPermissions.allowSearchPegawai ?? false);

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Hook up back button to close lightbox
  useBackButton(() => {
    setModalImg(null);
    return true;
  }, !!modalImg);

  // Hook up back button to stop camera
  useBackButton(() => {
    stopCamera();
    return true;
  }, isCameraActive);

  // Hook up back button to close confirm modal
  useBackButton(() => {
    setIsConfirmOpen(false);
    return true;
  }, isConfirmOpen);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tanggal) {
      const [year, month, day] = tanggal.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      setDisplayTanggal(d.toLocaleDateString('id-ID', options));
    }
  }, [tanggal]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }) + ' WIB');
    };
    tick(); // run once immediately
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // Cleanup camera when component unmounts
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // ── Fetch jam kerja + status absen saat pegawai/target berubah ──────────────
  const fetchInfoPresensi = useCallback(async (idPegawai: string) => {
    if (!idPegawai) return;

    // Ambil semua dari getJamKerjaPegawai karena sudah mengandung:
    // jam_mulai_scan_masuk, jam_akhir_scan_masuk, jam_mulai_scan_pulang,
    // jam_akhir_scan_pulang, jadwal_pulang, absen_masuk, absen_pulang, jam_kerja
    setLoadingJamKerja(true);
    setLoadingCekAbsen(true);
    try {
      const res = await sendRequest('/pegawai/getJamKerjaPegawai', { id_pegawai: idPegawai });
      let jamObj: any = null;

      if (Array.isArray(res))                              jamObj = res[0] ?? null;
      else if (Array.isArray(res?.data))                   jamObj = res.data[0] ?? null;
      else if (res?.data && typeof res.data === 'object')  jamObj = res.data;
      else if (res?.jam_mulai_scan_masuk || res?.jam_kerja || res?.id_pegawai) jamObj = res;
      else if (res && Object.keys(res).length > 2)         jamObj = res;

      setJamKerja(jamObj);

      // ── Derive status absen dari field absen_masuk / absen_pulang di jamKerja ──
      // Field ini berisi datetime string kalau sudah absen, null kalau belum
      if (jamObj) {
        const hasAbsenMasuk  = jamObj.absen_masuk  != null && jamObj.absen_masuk  !== '' && jamObj.absen_masuk  !== 'null';
        const hasAbsenPulang = jamObj.absen_pulang != null && jamObj.absen_pulang !== '' && jamObj.absen_pulang !== 'null';

        // Extract jam HH:mm dari datetime string "2026-09-21 07:34:14.132032"
        const extractJam = (dt: string | null): string | null => {
          if (!dt) return null;
          // Format datetime: "2026-09-21 07:34:14" — ambil jam setelah spasi/T
          const dtMatch = String(dt).match(/\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/);
          if (dtMatch) return dtMatch[1];
          // Format time only: "07:34"
          const tMatch = String(dt).match(/^(\d{2}:\d{2})/);
          return tMatch ? tMatch[1] : null;
        };

        setCekAbsen({
          absen_masuk:  hasAbsenMasuk,
          absen_pulang: hasAbsenPulang,
          jam_masuk:    hasAbsenMasuk  ? extractJam(jamObj.absen_masuk)  : null,
          jam_pulang:   hasAbsenPulang ? extractJam(jamObj.absen_pulang) : null,
          ijin_cuti:    jamObj.ijin_cuti ?? null,
          ada_roster:   jamObj.ada_roster ?? null,
          // jadwal mendahului = sebelum jam_mulai_scan_pulang
          jadwal_pulang: jamObj.jadwal_pulang || null,
        });
      } else {
        // Fallback ke cek_absen endpoint
        try {
          const r2 = await sendRequest('/Tupoksi/cek_absen', { id_pegawai: idPegawai });
          if (r2) {
            const normBool = (v: any) => {
              if (v == null || v === '' || v === 'null') return false;
              if (typeof v === 'boolean') return v;
              if (typeof v === 'number') return v !== 0;
              const s = String(v).toLowerCase();
              return s !== '0' && s !== 'false';
            };
            let o: any = Array.isArray(r2) ? r2[0] : (r2.data || r2);
            if (o) setCekAbsen({
              absen_masuk:  normBool(o.absen_masuk),
              absen_pulang: normBool(o.absen_pulang),
              jam_masuk:  o.jam_masuk  || null,
              jam_pulang: o.jam_pulang || null,
            });
          }
        } catch { /* silent */ }
      }
    } catch {
      setJamKerja(null);
      setCekAbsen(null);
    } finally {
      setLoadingJamKerja(false);
      setLoadingCekAbsen(false);
    }
  }, []);

  // Panggil saat mount atau saat pegawai target berubah
  useEffect(() => {
    const targetId = getTargetEmployeeId(selectedTargetPegawai || pegawai, config.idPegawai);
    if (targetId) fetchInfoPresensi(targetId);
    // Reset detail presensi sebelumnya saat ganti target
    setPresensiDetail(null);
    setOutput(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.idPegawai, selectedTargetPegawai, pegawai?.id, (pegawai as any)?.id_pegawai]);

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

  const handleSelectPegawai = (p: any) => {
    setSearchPegawai(`${p.nama} (${p.nip})`);
    setShowPegawaiDropdown(false);
    
    // Find full profile from database
    loadPegawaiDatabase().then(fullDb => {
      const fullUser = fullDb.find((item: any) => item.id === p.id || item.nip === p.nip);
      if (!fullUser) return;
      setSelectedTargetPegawai(fullUser);
      setSelectedTargetLocation(findMatchingLocation(fullUser, dataLokasi));
    });
  };

  const handleClearSelection = () => {
    setSearchPegawai('');
    setSelectedTargetPegawai(null);
    setSelectedTargetLocation(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) processFile(file);
  };

  // ── Kompresi foto presensi (meniru APK asli bkpsdm_presensi_ponorogo) ──────
  // APK asli memakai komponen kamera bawaan (plugin `camera`) dengan preset
  // resolusi RENDAH → hasil ± 320×240 (tampil 240×320 saat potret), lalu foto
  // di-upload APA ADANYA (raw camera JPEG: SELURUH EXIF + thumbnail tetap ada).
  // Karena itu rasio aspek tetap terjaga dan metadata tidak pernah hilang.
  //
  // Di web: semua format gambar didukung (JPEG/PNG/WebP/GIF/BMP/SVG/HEIC/TIFF/
  // AVIF/JXL — lihat src/lib/universalImage.ts). Piksel di-decode lalu
  // di-perkecil sampai sisi terpanjang 320 px dan EXIF sumber (bila JPEG)
  // dipertahankan, dinormalkan orientasinya, dimensinya diperbarui.
  // Bila pengguna mengaktifkan "Suntik EXIF — Presensi" di Pengaturan Jadhuman
  // dan sumber TIDAK punya EXIF, foto disuntik EXIF Make/Model/Software.
  const PRESENSI_LONG_SIDE = 320;

  const encodePresensi = (canvas: HTMLCanvasElement, sourceBytes: Uint8Array | null) => {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    if (dataUrl.length < 100) {
      // "data:," → encoder kanvas gagal.
      setFileInfo('❌ Gagal memproses foto.');
      return;
    }
    const finalUrl = applyExifFinal(dataUrl, {
      sourceBytes,
      inject: getExifSuntik('presensi'),
      stripThumbnail: false,
      width: canvas.width,
      height: canvas.height,
    });
    const byteLength = Math.round((finalUrl.length * 3) / 4);
    setBase64Image(finalUrl);
    setFileInfo(`${canvas.width}×${canvas.height} px · ${(byteLength / 1024).toFixed(1)} KB`);
  };

  const processFile = (file: File) => {
    if (!isProbablyImageFile(file)) {
      alert('Pilih file gambar!');
      return;
    }

    setFileInfo('🔄 Memproses & kompresi foto...');
    setBase64Image('');
    setOutput(null);

    void (async () => {
      try {
        const kind = await sniffImageKind(file);
        // Byte lengkap hanya perlu untuk JPEG (EXIF passthrough)
        const bytes = kind === 'jpeg'
          ? new Uint8Array(await file.arrayBuffer())
          : null;
        const source = await decodeImageUniversal(file, kind);
        const srcW = source.width, srcH = source.height;
        if (!srcW || !srcH) {
          setFileInfo('❌ Gagal memproses foto.');
          return;
        }
        const scale = Math.min(1, PRESENSI_LONG_SIDE / Math.max(srcW, srcH));
        const outW = Math.max(1, Math.round(srcW * scale));
        const outH = Math.max(1, Math.round(srcH * scale));
        const canvas = downscaleTo(source, srcW, srcH, outW, outH);
        encodePresensi(canvas, bytes);
      } catch (err: any) {
        console.error('Gagal memproses foto:', err);
        setFileInfo(`❌ ${err?.message || 'Foto tidak bisa dibaca.'}`);
      }
    })();
  };

  const userAgent = navigator.userAgent || '';
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)
    || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const startCamera = async () => {
    if (isMobile) {
      cameraInputRef.current?.click();
      return;
    }
    
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' }
      });
      streamRef.current = mediaStream;
      setIsCameraActive(true);
      
      // We need a slight delay to ensure the video element is rendered
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(console.error);
        }
      }, 100);
    } catch (err) {
      alert("Tidak dapat mengakses kamera. Pastikan izin kamera telah diberikan.");
      console.error(err);
    }
  };

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  const capturePhoto = () => {
    if (!videoRef.current) return;

    const srcW = videoRef.current.videoWidth  || videoRef.current.offsetWidth;
    const srcH = videoRef.current.videoHeight || videoRef.current.offsetHeight;
    if (!srcW || !srcH) return;

    // Ambil frame video APA ADANYA (resolusi native, tanpa crop), lalu serahkan
    // ke processFile yang akan memperkecil sambil mempertahankan rasio aspek —
    // sama seperti kamera asli yang menyerahkan JPEG mentah ke kompresor.
    const canvas = document.createElement('canvas');
    canvas.width  = srcW;
    canvas.height = srcH;
    const cx = canvas.getContext('2d');
    if (cx) {
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(videoRef.current, 0, 0, srcW, srcH);
    }

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
        processFile(file);
        stopCamera();
      }
    }, 'image/jpeg', 0.95);
  };

  const submitAbsen = async () => {
    if (!base64Image) return;
    
    setLoading(true);
    setOutput(null);
    
    const targetPegawai = selectedTargetPegawai || pegawai;
    const finalIdLokasi = selectedTargetPegawai
      ? (selectedTargetPegawai.id_lokasi || selectedTargetLocation?.id || '')
      : config.idLokasi;
    const finalLat = selectedTargetPegawai
      ? (selectedTargetPegawai.latitude || selectedTargetPegawai.lat || selectedTargetLocation?.latitude || '')
      : config.latitude;
    const finalLng = selectedTargetPegawai
      ? (selectedTargetPegawai.longitude || selectedTargetPegawai.long || selectedTargetLocation?.longitude || '')
      : config.longitude;
    const targetDeviceId = selectedTargetPegawai
      ? (selectedTargetPegawai.emei || selectedTargetPegawai.imei || selectedTargetPegawai.device_id || selectedTargetPegawai.sim_serial || '')
      : config.deviceId;

    const payload = {
      tanggal: tanggal,
      keterangan: "Presensi Reguler",
      lampiran: base64Image.split(',')[1],
      sim_serial: targetDeviceId,
      lattitude: finalLat,
      longitude: finalLng,
      imei: targetDeviceId,
      kode_instansi: selectedTargetPegawai ? (selectedTargetPegawai.kode_instansi || '') : config.kodeInstansi,
      kode_unor: selectedTargetPegawai ? (selectedTargetPegawai.kode_unor || selectedTargetPegawai.unor || '') : config.kodeUnor,
      id_lokasi: finalIdLokasi,
      work_mode: config.workMode,
      id_pegawai: getTargetEmployeeId(targetPegawai, config.idPegawai),
      nip: targetPegawai?.nip || '',
      bedgenumber: selectedTargetPegawai ? (selectedTargetPegawai.badgenumber || targetDeviceId) : config.deviceId,
      versi: config.versi
    };

    try {
      const data = await sendRequest("/login/absen_mobile", payload);
      
      if (data.success) {
        // ── Urai field detail dari response ─────────────────────────────
        setPresensiDetail({
          status_absen: data.status_absen || data.keterangan || null,
          jam_masuk:    data.jam_masuk    || data.waktu_masuk    || null,
          jam_pulang:   data.jam_pulang   || data.waktu_pulang   || null,
          ada_shift:    data.ada_shift    ?? null,
          belum_verifikasi: data.belum_verifikasi ?? null,
          message:      data.message     || null,
        });
        setOutput({ type: 'success', text: `✅ PRESENSI BERHASIL!\n${data.message || 'Sukses'}` });
        // Refresh status absen setelah berhasil
        const targetId = getTargetEmployeeId(targetPegawai, config.idPegawai);
        if (targetId) fetchInfoPresensi(targetId);
      } else {
        setPresensiDetail(null);
        setOutput({ type: 'error', text: `❌ GAGAL PRESENSI\n${data.message || 'Error'}` });
      }
    } catch (err: any) {
      setPresensiDetail(null);
      setOutput({ type: 'error', text: `❌ Network Error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  if (!pegawai) {
    return null; // App.tsx auto-redirect ke tabLogin
  }

  // Apakah user boleh mencari & memilih pegawai lain?
  // Admin selalu bisa. User hanya bisa jika allowSearchPegawai diaktifkan admin.

  return (
    <>
      <div className="w-full mx-auto bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700/60 relative z-20">
      
      <div className="flex items-center gap-3 mb-6 relative z-10">
        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
          <Calendar className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Presensi</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Unggah atau ambil foto untuk presensi</p>
        </div>
      </div>

      {/* Pegawai Search Section - hanya tampil jika canSearchPegawai */}
      {canSearchPegawai ? (
      <div className="bg-slate-50 dark:bg-slate-900/40 p-5 rounded-2xl border border-slate-100 dark:border-slate-700/60 mb-4 space-y-4 relative z-40">
        <div className="relative" ref={dropdownRef}>
          <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
            <User className="w-4 h-4 text-blue-500" /> Cari & Pilih Pegawai (Opsional)
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchPegawai}
              onChange={(e) => {
                setSearchPegawai(e.target.value);
                if (selectedTargetPegawai) {
                  setSelectedTargetPegawai(null);
                  setSelectedTargetLocation(null);
                }
                setShowPegawaiDropdown(true);
              }}
              onFocus={() => setShowPegawaiDropdown(true)}
              placeholder="Ketik nama atau NIP pegawai..."
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 font-medium placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-slate-100 shadow-sm"
            />
            <div className="absolute left-3 top-3.5 text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            {searchPegawai && (
              <button
                type="button"
                onClick={handleClearSelection}
                className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Autocomplete recommendations list */}
          {showPegawaiDropdown && (
            <div className="absolute left-0 right-0 mt-1.5 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 divide-y divide-slate-100 dark:divide-slate-700/50 custom-scrollbar">
              {loadingPegawai ? (
                <div className="p-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" /> Memuat database pegawai...
                </div>
              ) : pegawaiLoadError ? (
                <div className="p-4 text-center text-xs text-rose-500" role="alert">
                  <p>Database pegawai gagal dimuat.</p>
                  <button type="button" onClick={() => setPegawaiLoadAttempt(value => value + 1)} className="mt-2 inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400">
                    <RefreshCw className="h-3 w-3" /> Coba lagi
                  </button>
                </div>
              ) : filteredPegawai.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-xs font-medium">
                  {searchPegawai.trim() === '' ? 'Silakan ketik nama atau NIP untuk mencari' : 'Pegawai tidak ditemukan'}
                </div>
              ) : (
                filteredPegawai.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPegawai(p)}
                    className="w-full text-left p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex flex-col gap-0.5"
                  >
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

        {/* Selected Pegawai Details */}
        {selectedTargetPegawai ? (
          <div className="p-4 rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/40 dark:bg-blue-950/10 space-y-3 animate-fade-in">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-bold text-blue-500 dark:text-blue-400 uppercase tracking-widest">Pegawai Terpilih</span>
                <h4 className="text-sm font-bold text-slate-800 dark:text-white mt-0.5">{selectedTargetPegawai.nama}</h4>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">NIP: <span className="font-mono">{selectedTargetPegawai.nip}</span></p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{selectedTargetPegawai.unor || selectedTargetPegawai.instansi}</p>
              </div>
              <button
                type="button"
                onClick={handleClearSelection}
                className="text-xs font-bold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 border border-red-100 dark:border-red-950/30 transition-colors"
              >
                Reset ke Default
              </button>
            </div>

            <div className="h-px bg-slate-200/60 dark:bg-slate-700/50" />

            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Detail Lokasi Presensi</span>
                {selectedTargetLocation ? (
                  <div className="mt-0.5">
                    <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">{selectedTargetLocation.nama}</h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{selectedTargetLocation.alamat || 'Tidak ada alamat terdaftar'}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      <span>Lat: {selectedTargetLocation.latitude}</span>
                      <span>Lng: {selectedTargetLocation.longitude}</span>
                      <span>Radius: {selectedTargetLocation.radius}m</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-rose-500 font-semibold mt-0.5">
                    ⚠️ Lokasi "{selectedTargetPegawai.nama_lokasi || 'Tidak diketahui'}" tidak ditemukan di database lokasi. Menggunakan koordinat default Anda.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/20 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
            Akun login: <strong className="text-slate-700 dark:text-slate-300">{pegawai?.nama}</strong>.
          </div>
        )}
      </div>
      ) : (
      /* Info akun login (tampil saat pencarian pegawai disembunyikan) */
      <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 mb-4">
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/20 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0"></span>
          Presensi untuk: <strong className="text-slate-700 dark:text-slate-300">{pegawai?.nama}</strong>
        </div>
      </div>
      )}

      {/* Date & Time Section - Positioned underneath Pegawai selector */}
      <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-4 sm:p-5 mb-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-30">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <div className="flex-1 sm:flex-initial">
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Tanggal</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">{displayTanggal}</div>
          </div>
        </div>
        <div className="w-px h-10 bg-slate-200 dark:bg-slate-700 hidden sm:block"></div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Waktu</div>
            <div className="text-sm font-semibold font-mono text-slate-900 dark:text-slate-200">{timeStr}</div>
          </div>
        </div>
      </div>

      {/* ── Info Jam Kerja & Status Absen Hari Ini ─────────────────────────── */}
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3 relative z-20">

        {/* ── Card Jam Kerja ─────────────────────────────────────────────── */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Jam Kerja
            </span>
            <button
              type="button"
              onClick={() => {
                const id = getTargetEmployeeId(selectedTargetPegawai || pegawai, config.idPegawai);
                if (id) fetchInfoPresensi(id);
              }}
              className="text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors p-1 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-800/30"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${(loadingJamKerja || loadingCekAbsen) ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loadingJamKerja ? (
            <div className="flex items-center gap-2 text-xs text-blue-500 dark:text-blue-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Memuat...
            </div>
          ) : jamKerja ? (() => {
            // Helper: extract "HH:mm" dari datetime "2026-09-21 07:00:00" atau "07:00"
            const toJam = (dt: any): string => {
              if (!dt) return '-';
              const s = String(dt);
              // Format datetime: "2026-09-21 07:00:00" — ambil jam setelah spasi/T
              const dtMatch = s.match(/\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/);
              if (dtMatch) return dtMatch[1];
              // Format time only: "07:00"
              const tMatch = s.match(/^(\d{2}:\d{2})/);
              return tMatch ? tMatch[1] : s;
            };
            const jamMasukBuka  = toJam(jamKerja.jam_mulai_scan_masuk);
            const jamMasukTutup = toJam(jamKerja.jam_akhir_scan_masuk);
            const jamPulangBuka = toJam(jamKerja.jam_mulai_scan_pulang);
            const jamPulangTutup= toJam(jamKerja.jam_akhir_scan_pulang);
            const jadwalMasuk   = toJam(jamKerja.jadwal_masuk);
            const jadwalPulang  = toJam(jamKerja.jadwal_pulang);
            const jamKerjaStr   = jamKerja.jam_kerja || null; // "07:30-15:45"

            return (
              <div className="space-y-2.5">
                {/* Jam kerja ringkas jika ada */}
                {jamKerjaStr && (
                  <div className="text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-100/60 dark:bg-blue-800/30 rounded-lg px-2.5 py-1 inline-block">
                    {jamKerjaStr}
                  </div>
                )}

                {/* Window scan masuk */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Range Presensi Masuk</div>
                    {jadwalMasuk !== '-' && (
                      <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        Tepat waktu ≤ <span className="font-mono">{jadwalMasuk}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-700 dark:text-slate-200">
                    <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-md">{jamMasukBuka}</span>
                    <span className="text-slate-400">–</span>
                    <span className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-md">{jamMasukTutup}</span>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1">
                    {jamMasukBuka}–{jamMasukTutup} = bisa absen · Setelah {jadwalMasuk !== '-' ? jadwalMasuk : 'jadwal'} = terlambat
                  </p>
                </div>

                {/* Window scan pulang */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Range Presensi Pulang</div>
                    {jadwalPulang !== '-' && (
                      <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        Normal ≥ <span className="font-mono">{jadwalPulang}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-700 dark:text-slate-200">
                    <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-md">{jamPulangBuka}</span>
                    <span className="text-slate-400">–</span>
                    <span className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-md">{jamPulangTutup}</span>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1">
                    Sebelum {jadwalPulang !== '-' ? jadwalPulang : 'jadwal'} = mendahului · {jadwalPulang !== '-' ? jadwalPulang : 'jadwal'}–{jamPulangTutup} = normal
                  </p>
                </div>

                {jamKerja.nama_lokasi && (
                  <div className="flex items-center gap-1 text-[10px] text-blue-500 dark:text-blue-400 font-medium">
                    <MapPin className="w-3 h-3" /> {jamKerja.nama_lokasi}
                  </div>
                )}
              </div>
            );
          })() : (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">Data jam kerja tidak tersedia</p>
          )}

        </div>

        {/* ── Card Status Absen Hari Ini ─────────────────────────────────── */}
        <div className={`border rounded-2xl p-4 ${
          cekAbsen?.absen_masuk && cekAbsen?.absen_pulang
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/40'
            : cekAbsen?.absen_masuk
            ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800/40'
            : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/50'
        }`}>
          <div className="flex items-center gap-1.5 mb-3">
            <Info className={`w-3.5 h-3.5 ${
              cekAbsen?.absen_masuk && cekAbsen?.absen_pulang ? 'text-emerald-600 dark:text-emerald-400'
              : cekAbsen?.absen_masuk ? 'text-amber-600 dark:text-amber-400'
              : 'text-slate-400'
            }`} />
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status Hari Ini</span>
          </div>

          {loadingCekAbsen ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Memuat...
            </div>
          ) : cekAbsen ? (
            <div className="space-y-2">
              {/* Badge ringkas */}
              <div className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full ${
                cekAbsen.absen_masuk && cekAbsen.absen_pulang
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                  : cekAbsen.absen_masuk
                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  cekAbsen.absen_masuk && cekAbsen.absen_pulang ? 'bg-emerald-500'
                  : cekAbsen.absen_masuk ? 'bg-amber-500'
                  : 'bg-slate-400'
                }`} />
                {cekAbsen.absen_masuk && cekAbsen.absen_pulang
                  ? 'Sudah Masuk & Pulang'
                  : cekAbsen.absen_masuk
                  ? 'Sudah Masuk, Belum Pulang'
                  : 'Belum Presensi'}
              </div>

              {/* Baris masuk */}
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full inline-block ${cekAbsen.absen_masuk ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                  Masuk
                </span>
                <span className={`font-bold font-mono ${cekAbsen.absen_masuk ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                  {cekAbsen.absen_masuk ? (cekAbsen.jam_masuk ? `✓ ${cekAbsen.jam_masuk}` : '✓ Sudah') : '— Belum'}
                </span>
              </div>

              {/* Baris pulang */}
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full inline-block ${cekAbsen.absen_pulang ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                  Pulang
                </span>
                <span className={`font-bold font-mono ${cekAbsen.absen_pulang ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                  {cekAbsen.absen_pulang ? (cekAbsen.jam_pulang ? `✓ ${cekAbsen.jam_pulang}` : '✓ Sudah') : '— Belum'}
                </span>
              </div>

              {/* Info ijin cuti / tidak ada roster — hanya tampil jika belum ada presensi apapun */}
              {cekAbsen.ijin_cuti === true && (
                <div className="text-[10px] text-blue-600 dark:text-blue-400 font-medium pt-1 border-t border-slate-200/50 dark:border-slate-600/30">
                  📋 Hari ini: Izin / Cuti
                </div>
              )}
              {cekAbsen.ada_roster === false && !cekAbsen.absen_masuk && !cekAbsen.absen_pulang && (
                <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium pt-1 border-t border-slate-200/50 dark:border-slate-600/30">
                  ⚠ Tidak ada jadwal hari ini
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">Data status absen tidak tersedia</p>
          )}

        </div>
      </div>

      <div className="space-y-6 relative z-10">
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Foto Presensi</label>
          
          <div 
            className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 sm:p-12 text-center bg-slate-50 dark:bg-slate-900/30 hover:border-blue-400 dark:hover:border-blue-500/50 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all cursor-pointer group"
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <div className="mb-6 flex flex-col items-center justify-center gap-3">
              <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 flex items-center justify-center text-slate-400 group-hover:text-blue-500 group-hover:scale-110 transition-all">
                <UploadCloud className="w-8 h-8" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Tarik & lepas foto di sini</p>
              </div>
            </div>
            <div className="flex justify-center gap-3 flex-wrap">
              <button type="button" onClick={startCamera} className="bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-slate-700 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 border border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-800 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-all flex items-center gap-2 active:scale-95">
                <CameraIcon className="w-4 h-4" /> Buka Kamera
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 border border-slate-200 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-800 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-all flex items-center gap-2 active:scale-95">
                <ImageIcon className="w-4 h-4" /> Pilih File
              </button>
            </div>
          </div>
        </div>
        
        <input type="file" ref={fileInputRef} accept="image/*,.heic,.heif,.tif,.tiff,.dng,.bmp,.ico,.avif,.jxl" className="hidden" onChange={handleFileChange} />
        <input type="file" ref={cameraInputRef} accept="image/*,.heic,.heif,.tif,.tiff,.dng,.bmp,.ico,.avif,.jxl" capture="user" className="hidden" onChange={handleFileChange} />
        
        {/* Live Camera View */}
        {isCameraActive && (
          <div className="modal-layer fixed inset-0 z-50 bg-black flex flex-col">
            <div className="flex justify-between items-center p-4 bg-black text-white">
              <span className="font-medium">Ambil Foto Presensi</span>
              <button onClick={stopCamera} className="p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
              <video 
                ref={videoRef} 
                playsInline 
                autoPlay 
                muted
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="p-8 bg-black flex justify-center items-center pb-12">
              <button 
                onClick={capturePhoto} 
                className="w-20 h-20 bg-white rounded-full border-4 border-slate-300 shadow-lg active:scale-95 transition-transform flex items-center justify-center"
              >
                <div className="w-16 h-16 bg-white border-2 border-slate-200 rounded-full"></div>
              </button>
            </div>
          </div>
        )}

        {base64Image && !isCameraActive && (
          <div className="mt-8 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-slate-50 dark:bg-slate-900/30 flex flex-col items-center justify-center animate-fade-in-up">
            <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Pratinjau Foto Presensi</h4>
            
            <div className="relative rounded-2xl overflow-hidden shadow-md border border-slate-200 dark:border-slate-700 max-w-full max-h-[300px] flex justify-center bg-slate-100 dark:bg-slate-950">
              <img 
                src={base64Image} 
                alt="Pratinjau Foto" 
                className="max-w-full max-h-[300px] object-contain cursor-pointer transition-transform duration-300 hover:scale-[1.01]" 
                onClick={() => setModalImg({ src: base64Image, title: 'Pratinjau Foto Presensi' })}
              />
            </div>

            {/* Controls directly under photo */}
            <div className="flex justify-center gap-3 mt-4 w-full max-w-xs">
              <button 
                type="button" 
                onClick={() => setModalImg({ src: base64Image, title: 'Pratinjau Foto Presensi' })}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-850 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-slate-200/40 dark:border-slate-700/40 cursor-pointer"
              >
                <Search className="w-4 h-4" /> Lihat Detail
              </button>
              <button 
                type="button" 
                onClick={() => {
                  setBase64Image('');
                  setFileInfo('');
                  setOutput(null);
                }}
                className="flex-1 py-2.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-rose-100 dark:border-rose-950/30 cursor-pointer"
              >
                <X className="w-4 h-4" /> Hapus Foto
              </button>
            </div>

            {/* Tampilkan hanya rasio/dimensi dan ukuran file di bawah foto. */}
            <div className="mt-4 flex flex-col items-center text-center gap-1.5">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {fileInfo}
              </span>
            </div>
          </div>
        )}
        
        {/* Card Section for Kirim Presensi */}
        <div className="mt-8 p-6 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 shadow-md flex flex-col gap-4">
          <button 
            onClick={() => setIsConfirmOpen(true)}
            disabled={!base64Image || loading} 
            className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-4 px-4 rounded-xl transition-all text-base flex items-center justify-center gap-2 active:scale-[0.98] shadow-md cursor-pointer border border-blue-700 dark:border-blue-400"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <Send className="w-5 h-5" />
            )}
            {loading ? 'Mengirim Data Presensi...' : 'Kirim Presensi'}
          </button>
        </div>
        
        {output && (
          <div className={`mt-6 p-4 rounded-xl text-sm font-semibold shadow-sm ${output.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'}`}>
            <div className="flex items-center gap-3">
              {output.type === 'success' ? <CheckCircle className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0" /> : <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0" />}
              <span className="font-sans whitespace-pre-wrap leading-relaxed">{output.text}</span>
            </div>
          </div>
        )}

        {/* ── Detail Response Presensi ───────────────────────────────────── */}
        {presensiDetail && output?.type === 'success' && (
          <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/60 rounded-xl space-y-2 animate-fade-in">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> Detail Presensi
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {presensiDetail.status_absen && (
                <div>
                  <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-bold uppercase tracking-wide">Jenis Scan</span>
                  <span className="font-bold text-blue-600 dark:text-blue-400">{presensiDetail.status_absen}</span>
                </div>
              )}
              {presensiDetail.jam_masuk && (
                <div>
                  <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-bold uppercase tracking-wide">Jam Masuk</span>
                  <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">{presensiDetail.jam_masuk}</span>
                </div>
              )}
              {presensiDetail.jam_pulang && (
                <div>
                  <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-bold uppercase tracking-wide">Jam Pulang</span>
                  <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">{presensiDetail.jam_pulang}</span>
                </div>
              )}
              {presensiDetail.ada_shift !== null && presensiDetail.ada_shift !== undefined && (
                <div>
                  <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-bold uppercase tracking-wide">Shift</span>
                  <span className={`font-bold ${presensiDetail.ada_shift ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                    {presensiDetail.ada_shift ? 'Ada Shift' : 'Tidak Ada Shift'}
                  </span>
                </div>
              )}
              {presensiDetail.belum_verifikasi !== null && presensiDetail.belum_verifikasi !== undefined && (
                <div>
                  <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-bold uppercase tracking-wide">Verifikasi</span>
                  <span className={`font-bold ${presensiDetail.belum_verifikasi ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {presensiDetail.belum_verifikasi ? 'Belum Terverifikasi' : 'Terverifikasi'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
      
    {modalImg && (
      <ImageLightbox src={modalImg.src} title={modalImg.title} onClose={() => setModalImg(null)} />
    )}

    {/* Confirmation Modal */}
    <AnimatePresence>
      {isConfirmOpen && (
        <div className="modal-layer fixed inset-0 z-[150] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsConfirmOpen(false)}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
          />
          
          {/* Modal Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.3 }}
            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800/80 overflow-hidden flex flex-col z-10 animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="w-full flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-5">
              <span className="font-bold text-slate-800 dark:text-white text-sm">Konfirmasi Kirim Presensi</span>
              <button 
                onClick={() => setIsConfirmOpen(false)} 
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-400 p-4 rounded-2xl mb-5 border border-blue-100 dark:border-blue-900/30">
              <AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
              <p className="text-xs font-semibold leading-relaxed">
                Mohon periksa kembali detail presensi Anda di bawah ini sebelum mengirim data.
              </p>
            </div>

            {/* Info Table / Details */}
            <div className="space-y-3.5 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/80 mb-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nama Pegawai</span>
                <span className="text-sm font-bold text-slate-800 dark:text-white">{(selectedTargetPegawai || pegawai)?.nama || 'Tidak Tersedia'}</span>
              </div>
              <div className="h-px bg-slate-200/50 dark:bg-slate-800/60" />
              
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">NIP</span>
                <span className="text-sm font-semibold font-mono text-slate-700 dark:text-slate-300">{(selectedTargetPegawai || pegawai)?.nip || '-'}</span>
              </div>
              <div className="h-px bg-slate-200/50 dark:bg-slate-800/60" />

              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tanggal</span>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{displayTanggal}</span>
              </div>
              <div className="h-px bg-slate-200/50 dark:bg-slate-800/60" />

              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Waktu</span>
                <span className="text-sm font-semibold font-mono text-slate-700 dark:text-slate-300">{timeStr}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                className="w-full py-3 px-4 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors cursor-pointer text-center"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsConfirmOpen(false);
                  submitAbsen();
                }}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                Ya, Kirim
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  </>
  );
}
