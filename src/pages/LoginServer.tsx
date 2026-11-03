import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Key, User, Lock, Eye, EyeOff, LogIn as LogInIcon, Search, Briefcase, Building2, MapPin, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Copy, Check, Camera, Trash2, X, CreditCard, Clock, UserCheck, Smartphone, Send } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { sendRequest } from '../api';
import ImageLightbox from '../components/ui/ImageLightbox';
import { db } from '../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useBackButton } from '../hooks/useBackButton';
import { useResolvedImageSource } from '../hooks/useResolvedImageSource';
import { encryptPayload } from '../lib/encryption';
import {
  fetchServerLoginSettings,
  getServerLoginSettingsDocumentId,
} from '../lib/serverLoginSettings';
import { loadPegawaiDatabase, loadPegawaiSearchList } from '../lib/pegawaiData';
import {
  setServerLoginCache,
  updateServerLoginCacheFoto,
} from '../lib/cacheManager';

const sanitizeText = (text?: string): string => {
  if (!text) return '';
  return text.trim().replace(/^\*+|\*+$/g, '').trim();
};

export default function LoginServer() {
  const { pegawai, setPegawai, config, setConfig, loginForm, setLoginForm, currentUser, autoLoginTrigger, tabPermissions, userRole } = useAppContext();
  const accountKey = currentUser ? `${currentUser.id}:${currentUser.username}` : null;
  const currentAccountKeyRef = useRef(accountKey);
  currentAccountKeyRef.current = accountKey;

  // ✅ canEdit logic:
  // - Belum login (pegawai kosong)   → SELALU bisa edit (agar bisa isi NIP/password pertama kali)
  // - Sudah login (pegawai ada)      → ikut permission allowEditLoginCredentials
  // - Admin                          → selalu bisa edit
  const canEdit = !pegawai || userRole === 'admin' || (tabPermissions.allowEditLoginCredentials ?? false);
  const [modalImg, setModalImg] = useState<{ src: string, title: string } | null>(null);
  const [isAutoLoginRunning, setIsAutoLoginRunning] = useState(false);
  const pegawaiIndexRef = useRef<any[] | null>(null);

  // Custom Profile Photo States
  const [isProfilePhotoViewerOpen, setIsProfilePhotoViewerOpen] = useState(false);
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [cropperImageSrc, setCropperImageSrc] = useState<string | null>(null);
  const [cropperImageObj, setCropperImageObj] = useState<HTMLImageElement | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffsetX, setCropOffsetX] = useState(0);
  const [cropOffsetY, setCropOffsetY] = useState(0);
  const [isCropDragging, setIsCropDragging] = useState(false);
  const [cropDragStart, setCropDragStart] = useState({ x: 0, y: 0 });
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoActionMessage, setPhotoActionMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const cropperCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Hook up back button handlers
  useBackButton(() => {
    if (isCropperOpen) {
      setIsCropperOpen(false);
      return true;
    }
    if (isProfilePhotoViewerOpen) {
      setIsProfilePhotoViewerOpen(false);
      return true;
    }
    setModalImg(null);
    return true;
  }, !!modalImg || isProfilePhotoViewerOpen || isCropperOpen);

  const autoLoginAttempted = useRef(false);
  // Simpan trigger terakhir yang sudah diproses agar tidak double-fire
  const lastHandledTrigger = useRef(-1);
  
  const [showPass, setShowPass] = useState(false);
  
  const [pwdNow, setPwdNow] = useState('');
  const [pwdNew, setPwdNew] = useState('');
  const [showPwdNow, setShowPwdNow] = useState(false);
  const [showPwdNew, setShowPwdNew] = useState(false);
  const [isUbahPasswordOpen, setIsUbahPasswordOpen] = useState(false);
  const [isKredensialOpen, setIsKredensialOpen] = useState(false);
  
  const [loginOutput, setLoginOutput] = useState<{ type: 'success'|'error', text: string, data?: any } | null>(null);
  const [changePwdOutput, setChangePwdOutput] = useState<{ type: 'success'|'error', text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  // ── Modal Update IMEI ────────────────────────────────────────────────────────
  const [isUpdateImeiOpen, setIsUpdateImeiOpen] = useState(false);
  const [imeiInput, setImeiInput] = useState('');
  const [imeiLoading, setImeiLoading] = useState(false);
  const [imeiOutput, setImeiOutput] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [fullPegawaiInfo, setFullPegawaiInfo] = useState<any>(null);

  useEffect(() => {
    const targetId = config.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai;
    if (!targetId) {
      setFullPegawaiInfo(null);
      return;
    }
    let cancelled = false;
    loadPegawaiDatabase().then(dataPegawai => {
      if (!cancelled) setFullPegawaiInfo(dataPegawai.find((p: any) => p.id === targetId) || null);
    }).catch(error => console.error('Gagal memuat profil pegawai:', error));
    return () => { cancelled = true; };
  }, [pegawai, config.idPegawai]);

  const loadPegawaiIndex = async () => {
    if (!pegawaiIndexRef.current) {
      pegawaiIndexRef.current = await loadPegawaiSearchList();
    }
    return pegawaiIndexRef.current;
  };

  const handleCopyId = (idToCopy: string) => {
    if (!idToCopy || idToCopy === '-') return;
    navigator.clipboard.writeText(idToCopy);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  // Recommendations state
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowRecommendations(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const handleUsernameChange = async (val: string) => {
    if (val === '') {
      setLoginForm(prev => ({ ...prev, username: '' }));
      setRecommendations([]);
      setShowRecommendations(false);
      return;
    }

    let cleanVal = val;
    // Check if the input contains any letters (a-z, A-Z)
    const hasLetters = /[a-zA-Z]/.test(val);

    if (hasLetters) {
      // If it has letters, allow letters, numbers, and spaces, but remove other special characters
      cleanVal = val.replace(/[^a-zA-Z0-9\s]/g, '');
    } else {
      // If it contains only numbers/digits, strip spaces and any other non-digit characters
      cleanVal = val.replace(/[^0-9]/g, '');
    }

    setLoginForm(prev => ({ ...prev, username: cleanVal }));

    const searchStr = cleanVal.trim();
    if (searchStr.length > 2) {
      const pegawaiIndex = (await loadPegawaiIndex()) ?? [];
      const filtered = pegawaiIndex.filter((p: any) => 
        (p.nip || '').toLowerCase().includes(searchStr.toLowerCase()) || 
        (p.nama || '').toLowerCase().includes(searchStr.toLowerCase())
      ).slice(0, 5); // Limit to 5 results
      
      setRecommendations(filtered);
      setShowRecommendations(filtered.length > 0);
    } else {
      setShowRecommendations(false);
    }
  };

  const selectRecommendation = (peg: any) => {
    setLoginForm(prev => ({ ...prev, username: peg.nip }));
    setShowRecommendations(false);
  };

  const doLogin = async (userToLogin = loginForm.username, passToLogin = loginForm.password) => {
    const loginAccountKey = accountKey;
    setLoading(true);
    setLoginOutput(null);

    // Auto-resolve NIP from name if it matches an entry in the database
    let resolvedUsername = userToLogin;
    const pegawaiIndex = (await loadPegawaiIndex()) ?? [];
    if (pegawaiIndex.length > 0) {
      const matched = pegawaiIndex.find((p: any) => 
        (p.nama || '').toLowerCase() === userToLogin.toLowerCase() || 
        (p.nip || '') === userToLogin
      );
      if (matched && matched.nip) {
        resolvedUsername = matched.nip;
      }
    }

    const payload = { 
      username: resolvedUsername, 
      password: passToLogin, 
      versi: config.versi 
    };
    try {
      const data = await sendRequest("/login/do_LoginMobile", payload);
      if (currentAccountKeyRef.current !== loginAccountKey) return;
      
      if (data.success) {
        setPegawai({ ...data, password: passToLogin });
        setConfig(prev => {
          const newConfig = {
            ...prev,
            idPegawai: data.id || data.id_pegawai || prev.idPegawai,
            deviceId: data.emai || data.imei || data.device_id || data.deviceId || data.sim_serial || data.simserial || prev.deviceId,
            latitude: data.lat || data.latitude || prev.latitude,
            longitude: data.long || data.longitude || data.longtitude || data.lng || prev.longitude,
            idLokasi: data.id_lokasi || data.idLokasi || prev.idLokasi,
            kodeInstansi: data.kode_instansi || data.kodeInstansi || prev.kodeInstansi,
            kodeUnor: data.kode_unor || data.kodeUnor || prev.kodeUnor
          };

          // ─── Simpan cache sesi server (instan, no network) ────────────
          const jadhumanUsername = currentUser?.username ?? 'default_admin';
          setServerLoginCache(jadhumanUsername, {
            serverUsername: resolvedUsername,
            serverPassword: passToLogin,
            pegawai: { ...data, password: passToLogin },
            config: {
              idPegawai:    newConfig.idPegawai,
              deviceId:     newConfig.deviceId,
              latitude:     newConfig.latitude,
              longitude:    newConfig.longitude,
              idLokasi:     newConfig.idLokasi,
              kodeInstansi: newConfig.kodeInstansi,
              kodeUnor:     newConfig.kodeUnor,
            },
          });

          // ─── Simpan ke Firestore (background, untuk cross-device) ────
          const payloadToEncrypt = {
            username: resolvedUsername,
            password: passToLogin,
            timestamp: new Date().toISOString(),
            idPegawai: newConfig.idPegawai,
            deviceId: newConfig.deviceId,
            latitude: newConfig.latitude,
            longitude: newConfig.longitude,
            idLokasi: newConfig.idLokasi,
            kodeInstansi: newConfig.kodeInstansi,
            kodeUnor: newConfig.kodeUnor
          };
          const encryptedStr = encryptPayload(payloadToEncrypt);
          setDoc(doc(db, 'settings', getServerLoginSettingsDocumentId(jadhumanUsername)), {
            encrypted: encryptedStr
          }, { merge: true }).catch(dbErr => {
            console.error("Gagal menyimpan login terakhir ke Firestore:", dbErr);
          });

          return newConfig;
        });
        setPwdNow(passToLogin);
        setLoginOutput({ type: 'success', text: 'LOGIN BERHASIL', data });
      } else {
        setPegawai(null);
        setLoginOutput({ type: 'error', text: `LOGIN GAGAL: ${data.message || 'Error'}`, data });
        // ── Deteksi error IMEI → buka modal update_imei otomatis ─────────
        const msg = (data.message || '').toLowerCase();
        if (msg.includes('imei') || msg.includes('device') || msg.includes('perangkat') || msg.includes('id direset') || msg.includes('reset') || msg.includes('tidak dikenali') || msg.includes('tidak terdaftar')) {
          setImeiOutput(null);
          setImeiInput('');
          setIsUpdateImeiOpen(true);
        }
      }
    } catch (err: any) {
      setLoginOutput({ type: 'error', text: `Network Error / Timeout: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  // ─── Handler Update IMEI ─────────────────────────────────────────────────
  const handleUpdateImei = async () => {
    if (!imeiInput.trim()) {
      setImeiOutput({ type: 'error', text: 'Device ID / IMEI tidak boleh kosong.' });
      return;
    }
    setImeiLoading(true);
    setImeiOutput(null);
    const payload = {
      username: loginForm.username,
      password: loginForm.password,
      imei: imeiInput.trim(),
    };
    try {
      const data = await sendRequest('/login/update_imei', payload);
      if (data && (data.success || data.status === 'success' || data.code === 200 || data.code === '200')) {
        setImeiOutput({ type: 'success', text: data.message || 'Device ID berhasil diperbarui. Silakan login ulang.' });
        // Update config deviceId setelah berhasil
        setConfig(prev => ({ ...prev, deviceId: imeiInput.trim() }));
        // Auto-close setelah 2 detik dan coba login ulang
        setTimeout(() => {
          setIsUpdateImeiOpen(false);
          setImeiOutput(null);
        }, 2000);
      } else {
        setImeiOutput({ type: 'error', text: data.message || data.error || 'Update gagal. Coba lagi.' });
      }
    } catch (err: any) {
      setImeiOutput({ type: 'error', text: `Network Error: ${err.message}` });
    } finally {
      setImeiLoading(false);
    }
  };

  // ─── Auto-login ke server pusat ──────────────────────────────────
  // Dijalankan setiap kali login akun Jadhuman berhasil (autoLoginTrigger berubah)
  // ATAU saat komponen pertama kali mount (trigger = 0, handled = -1).
  //
  // Kredensial server selalu dimuat dari dokumen Firestore akun aktif.
  useEffect(() => {
    if (lastHandledTrigger.current === autoLoginTrigger) return;
    if (!currentUser && autoLoginTrigger === 0) return;
    lastHandledTrigger.current = autoLoginTrigger;
    let active = true;

    const runAutoLogin = async () => {
      if (pegawai) return; // sudah login ke server, skip

      setIsAutoLoginRunning(true);
      try {
        const jadhumanUsername = currentUser?.username ?? 'default_admin';
        const stored = await fetchServerLoginSettings(jadhumanUsername);
        if (!active || !stored) return;

        setLoginForm({ username: stored.username, password: stored.password });
        await doLogin(stored.username, stored.password);
        if (!active) return;

        setConfig(prev => ({
          ...prev,
          idPegawai:    prev.idPegawai    || stored.idPegawai    || '',
          deviceId:     prev.deviceId     || stored.deviceId     || '',
          latitude:     prev.latitude     || stored.latitude     || '',
          longitude:    prev.longitude    || stored.longitude    || '',
          idLokasi:     prev.idLokasi     || stored.idLokasi     || '',
          kodeInstansi: prev.kodeInstansi || stored.kodeInstansi || '',
          kodeUnor:     prev.kodeUnor     || stored.kodeUnor     || '',
        }));
      } catch (err) {
        if (active) console.error('Auto-login error:', err);
      } finally {
        if (active) {
          setIsAutoLoginRunning(false);
          autoLoginAttempted.current = true;
        }
      }
    };

    runAutoLogin();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoginTrigger]);

  const doUbahPassword = async () => {
    if (!pwdNow || !pwdNew) {
      setChangePwdOutput({ type: 'error', text: '❌ Password tidak boleh kosong!' });
      return;
    }
    
    setLoading(true);
    const payload = {
      id_pegawai: config.idPegawai,
      password_sekarang: pwdNow,
      password_baru: pwdNew
    };
    try {
      const data = await sendRequest("/login/Ubah_PasswordMobile", payload);
      
      if (data.success) {
        setLoginForm(prev => ({ ...prev, password: pwdNew }));
        setPwdNow(pwdNew);
        setPwdNew('');
        setChangePwdOutput({ type: 'success', text: `✅ PASSWORD BERHASIL DIUBAH!\n${data.message}` });
      } else {
        setChangePwdOutput({ type: 'error', text: `❌ GAGAL MENGUBAH PASSWORD\n${data.message}` });
      }
    } catch (err: any) {
      setChangePwdOutput({ type: 'error', text: `❌ Network Error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  // Draw cropper canvas
  useEffect(() => {
    if (!isCropperOpen || !cropperImageSrc || !cropperImageObj || !cropperCanvasRef.current) return;
    
    const canvas = cropperCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const cw = canvas.width;
    const ch = canvas.height;
    
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    
    const imgW = cropperImageObj.width;
    const imgH = cropperImageObj.height;
    const ratio = Math.min(cw / imgW, ch / imgH);
    const baseW = imgW * ratio;
    const baseH = imgH * ratio;
    
    const w = baseW * cropZoom;
    const h = baseH * cropZoom;
    
    const cx = cw / 2;
    const cy = ch / 2;
    
    // Draw image centered with drag offsets
    ctx.drawImage(cropperImageObj, cx - w / 2 + cropOffsetX, cy - h / 2 + cropOffsetY, w, h);
    
    // Draw semi-transparent dark mask with a circular crop cutout
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    const cropRadius = 110;
    ctx.arc(cx, cy, cropRadius, 0, Math.PI * 2, true);
    ctx.fill();
    
    // Draw dashed circular border
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, cropRadius, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.restore();
  }, [isCropperOpen, cropperImageSrc, cropperImageObj, cropZoom, cropOffsetX, cropOffsetY]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      setCropperImageSrc(src);
      
      const img = new Image();
      img.onload = () => {
        setCropperImageObj(img);
        setCropZoom(1);
        setCropOffsetX(0);
        setCropOffsetY(0);
        setIsCropperOpen(true);
        setPhotoActionMessage(null);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleDragStart = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    setIsCropDragging(true);
    setCropDragStart({ x: clientX - cropOffsetX, y: clientY - cropOffsetY });
  };

  const handleDragMove = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isCropDragging) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    setCropOffsetX(clientX - cropDragStart.x);
    setCropOffsetY(clientY - cropDragStart.y);
  };

  const handleDragEnd = () => {
    setIsCropDragging(false);
  };

  const handleCropAndSave = async () => {
    if (!cropperImageObj || !cropperCanvasRef.current) return;
    
    setIsUploadingPhoto(true);
    setPhotoActionMessage(null);
    
    try {
      const cw = 300;
      const ch = 300;
      const cropRadius = 110;
      
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = 400;
      finalCanvas.height = 400;
      const finalCtx = finalCanvas.getContext('2d');
      if (!finalCtx) throw new Error("Gagal membuat konteks gambar");
      
      const imgW = cropperImageObj.width;
      const imgH = cropperImageObj.height;
      const ratio = Math.min(cw / imgW, ch / imgH);
      const baseW = imgW * ratio;
      const baseH = imgH * ratio;
      
      const w = baseW * cropZoom;
      const h = baseH * cropZoom;
      
      const scaleFactor = finalCanvas.width / (cropRadius * 2);
      const cropCx = finalCanvas.width / 2;
      const cropCy = finalCanvas.height / 2;
      
      const finalW = w * scaleFactor;
      const finalH = h * scaleFactor;
      
      finalCtx.save();
      finalCtx.drawImage(
        cropperImageObj,
        cropCx - finalW / 2 + cropOffsetX * scaleFactor,
        cropCy - finalH / 2 + cropOffsetY * scaleFactor,
        finalW,
        finalH
      );
      finalCtx.restore();
      
      const croppedBase64 = finalCanvas.toDataURL('image/jpeg', 0.85);
      const rawBase64 = croppedBase64.split(',')[1];
      
      const payload = {
        id_pegawai: config.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai,
        foto: rawBase64
      };
      
      const response = await sendRequest("/login/do_Simpan_Ubah_Foto", payload);
      
      if (response.success) {
        setPegawai((prev: any) => {
          if (!prev) return null;
          return {
            ...prev,
            foto: response.foto || response.path || croppedBase64
          };
        });
        
          // ── Perbarui foto di cache sesi server ──────────────────────
        const jadhumanUsername = currentUser?.username ?? 'default_admin';
        updateServerLoginCacheFoto(jadhumanUsername, response.foto || response.path || croppedBase64);

        setPhotoActionMessage({ type: 'success', text: 'Foto profil berhasil disimpan!' });
        setTimeout(() => {
          setIsCropperOpen(false);
          setCropperImageSrc(null);
          setCropperImageObj(null);
          setIsProfilePhotoViewerOpen(false);
        }, 1500);
      } else {
        setPhotoActionMessage({ type: 'error', text: response.message || 'Gagal menyimpan foto profil.' });
      }
    } catch (err: any) {
      console.error(err);
      setPhotoActionMessage({ type: 'error', text: err.message || 'Terjadi kesalahan sistem.' });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleDeletePhoto = async () => {
    if (!window.confirm("Apakah Anda yakin ingin menghapus foto profil?")) return;
    
    setIsUploadingPhoto(true);
    setPhotoActionMessage(null);
    
    try {
      const payload = {
        id_pegawai: config.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai,
        foto: "null"
      };
      
      const response = await sendRequest("/login/do_Simpan_Ubah_Foto", payload);
      
      if (response.success) {
        setPegawai((prev: any) => {
          if (!prev) return null;
          return {
            ...prev,
            foto: ''
          };
        });

        // ── Bersihkan foto di cache sesi server ──────────────────────
        const jadhumanUsername = currentUser?.username ?? 'default_admin';
        updateServerLoginCacheFoto(jadhumanUsername, '');

        setPhotoActionMessage({ type: 'success', text: 'Foto profil berhasil dihapus!' });
        setTimeout(() => {
          setIsProfilePhotoViewerOpen(false);
        }, 1500);
      } else {
        setPhotoActionMessage({ type: 'error', text: response.message || 'Gagal menghapus foto profil.' });
      }
    } catch (err: any) {
      console.error(err);
      setPhotoActionMessage({ type: 'error', text: err.message || 'Terjadi kesalahan sistem.' });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const fotoUrl = pegawai?.foto 
    ? (pegawai.foto.startsWith('data:') 
        ? pegawai.foto 
        : `/api/proxy-image?path=${encodeURIComponent(pegawai.foto)}`)
    : 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
  const resolvedFotoUrl = useResolvedImageSource(fotoUrl);

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
      {/* Form Login */}
      <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700/60 relative overflow-hidden">
        
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Key className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Login Server</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {canEdit ? 'Masukkan NIP dan Password akun Anda' : 'Informasi kredensial login (hanya lihat)'}
            </p>
          </div>
          {!canEdit && (
            <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold border border-amber-200 dark:border-amber-700/50">
              <Eye className="w-3.5 h-3.5" />
              View Only
            </span>
          )}
        </div>
        
        <div className="space-y-4 relative z-10">
          <div ref={wrapperRef} className="relative">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Username / NIP</label>
            <input 
              type="text" 
              value={loginForm.username}
              name="server-login-username"
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              onChange={e => canEdit ? handleUsernameChange(e.target.value) : undefined}
              onFocus={() => { if (canEdit && recommendations.length > 0) setShowRecommendations(true) }}
              readOnly={!canEdit}
              className={`w-full px-4 py-3 border rounded-xl outline-none transition-colors ${
                canEdit
                  ? 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500'
                  : 'border-slate-200 dark:border-slate-700/50 bg-slate-100 dark:bg-slate-900/70 text-slate-600 dark:text-slate-400 cursor-default select-none'
              }`}
              placeholder={canEdit ? "Masukkan NIP atau Nama..." : "—"}
            />
            {canEdit && showRecommendations && (
              <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden max-h-60 overflow-y-auto">
                <div className="px-3 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <Search className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Rekomendasi dari Database</span>
                </div>
                {recommendations.map((peg, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => selectRecommendation(peg)}
                    className="w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
                  >
                    <div className="font-bold text-sm text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">{peg.nama}</div>
                    <div className="text-xs text-blue-600 dark:text-blue-400 font-mono mt-0.5 opacity-80">{peg.nip}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Password</label>
            <div className="relative">
              <input 
                type={showPass ? "text" : "password"} 
                value={loginForm.password}
                name="server-login-password"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                onChange={e => canEdit ? setLoginForm(prev => ({ ...prev, password: e.target.value })) : undefined}
                readOnly={!canEdit}
                placeholder={canEdit ? "Masukkan Password..." : "••••••••"}
                className={`w-full px-4 py-3 border rounded-xl outline-none transition-colors pr-10 ${
                  canEdit
                    ? 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500'
                    : 'border-slate-200 dark:border-slate-700/50 bg-slate-100 dark:bg-slate-900/70 text-slate-600 dark:text-slate-400 cursor-default select-none'
                }`}
              />
              <button 
                type="button" 
                onClick={() => setShowPass(!showPass)}
                disabled={!canEdit && !loginForm.password}
                className={`absolute right-3 top-3 transition-colors ${
                  canEdit || loginForm.password
                    ? 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    : 'text-slate-300 dark:text-slate-700 cursor-default'
                }`}
              >
                {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          {canEdit ? (
          <button 
            onClick={() => doLogin()}
            disabled={loading || isAutoLoginRunning}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-xl transition-all active:scale-[0.98] shadow-sm mt-4 flex justify-center items-center gap-2"
          >
            {isAutoLoginRunning || loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <LogInIcon className="w-5 h-5" />
            )}
            {isAutoLoginRunning ? 'Mengautentikasi otomatis...' : loading ? 'Menghubungi server...' : 'Cek Status Login'}
          </button>
          ) : (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 flex items-center gap-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 dark:text-amber-400 shrink-0">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              Login Info hanya bisa dilihat. Hubungi admin untuk mengubah NIP atau password.
            </p>
          </div>
          )}
        </div>
        {loginOutput && (
          <div className={`mt-4 p-4 rounded-xl text-sm font-semibold shadow-sm ${loginOutput.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30' : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30'}`}>
            <div className="flex items-center gap-2 font-sans text-xs md:text-sm">
              {loginOutput.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <span>{loginOutput.text}</span>
            </div>
          </div>
        )}
      </div>

      {/* Profil */}
      <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700/60 relative overflow-hidden">
        <div className="flex items-center gap-3 mb-6 relative z-10">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Profil Pegawai</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Data kredensial yang tersimpan</p>
          </div>
        </div>
        
        {!pegawai ? (
          <div className="min-h-[150px] flex items-center justify-center bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 relative z-10">
            <p className="text-slate-500 dark:text-slate-400 text-sm font-medium text-center">Silakan login untuk memuat profil.</p>
          </div>
        ) : (
          <>
            <div className="text-center mb-8 relative z-10">
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-blue-500 rounded-full blur-md opacity-20"></div>
                <img 
                  src={resolvedFotoUrl || undefined}
                  alt="Foto Profil" 
                  onClick={() => setIsProfilePhotoViewerOpen(true)}
                  className={`relative w-28 h-28 rounded-full border-4 border-white dark:border-slate-800 object-cover shadow-lg mx-auto transition-all duration-300 z-10 ${
                    canEdit
                      ? 'cursor-pointer hover:scale-105 active:scale-95'
                      : 'cursor-default'
                  }`}
                  title={canEdit ? "Klik untuk melihat & ubah foto" : "Foto profil (view only)"}
                />
              </div>
              <h4 className="mt-4 text-xl font-bold text-slate-900 dark:text-white tracking-tight">{sanitizeText(pegawai.nama) || 'Data tidak tersedia'}</h4>
              <div className="mt-1.5 flex items-center justify-center gap-2">
                <span className="text-xs font-mono font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900/50 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700">NIP. {sanitizeText(pegawai.nip) || 'Belum diatur'}</span>
              </div>
            </div>
            
            <div className="space-y-4 relative z-10">
              <div className="grid gap-3">
                <div className="bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-2xl flex items-center gap-3 sm:gap-4 border border-slate-100 dark:border-slate-800/80">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                    <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium">Jabatan {pegawai.kelas_jabatan ? `(Kelas ${sanitizeText(String(pegawai.kelas_jabatan))})` : ''}</p>
                    <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-200 leading-snug line-clamp-2 break-words">{sanitizeText(pegawai.nama_jabatan) || 'Tidak tersedia'}</p>
                  </div>
                </div>
 
                <div className="bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-2xl flex items-center gap-3 sm:gap-4 border border-slate-100 dark:border-slate-800/80">
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium">OPD</p>
                    <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-200 leading-snug line-clamp-2 break-words">{sanitizeText(pegawai.nama_instansi) || 'Tidak tersedia'}</p>
                  </div>
                </div>
 
                <div className="bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-2xl flex items-center gap-3 sm:gap-4 border border-slate-100 dark:border-slate-800/80">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium">Unit Kerja</p>
                    <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-200 leading-snug line-clamp-2 break-words">{sanitizeText(pegawai.unor || pegawai.nama_unit_kerja) || 'Tidak tersedia'}</p>
                  </div>
                </div>
 
                <div className="bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-2xl flex items-center gap-3 sm:gap-4 border border-slate-100 dark:border-slate-800/80">
                  <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium">Alamat Kantor</p>
                    <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-200 leading-snug line-clamp-2 break-words">{sanitizeText(pegawai.alamat || pegawai.alamat_kantor) || 'Tidak tersedia'}</p>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-2xl flex items-center gap-3 sm:gap-4 border border-slate-100 dark:border-slate-800/80">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                    <CreditCard className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium">No. Rekening Bank Jatim</p>
                    <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-200 leading-snug line-clamp-2 break-words">
                      {fullPegawaiInfo?.norekening || (pegawai as any)?.norekening || 'Tidak tersedia'}
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-2xl flex items-center gap-3 sm:gap-4 border border-slate-100 dark:border-slate-800/80">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                    <UserCheck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium">Status Pegawai</p>
                    <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-200 leading-snug line-clamp-2 break-words">
                      {fullPegawaiInfo?.status_pegawai || (pegawai as any)?.status_pegawai || 'Tidak tersedia'}
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-2xl flex items-center gap-3 sm:gap-4 border border-slate-100 dark:border-slate-800/80">
                  <div className="w-10 h-10 rounded-xl bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center shrink-0">
                    <Clock className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium">Jam Kerja</p>
                    <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-200 leading-snug line-clamp-2 break-words">
                      {fullPegawaiInfo?.jam_kerja || (pegawai as any)?.jam_kerja || 'Tidak tersedia'}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setIsKredensialOpen(!isKredensialOpen)}
                  className="w-full flex justify-between items-center text-left px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors border border-slate-200/50 dark:border-slate-700/50 cursor-pointer shadow-sm"
                >
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                    Informasi Kredensial
                  </span>
                  {isKredensialOpen ? (
                    <ChevronUp className="w-4 h-4 opacity-70 shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 opacity-70 shrink-0" />
                  )}
                </button>

                <AnimatePresence initial={false}>
                  {isKredensialOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-2 gap-3 text-xs sm:text-sm pt-4">
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 col-span-2">
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">ID Pegawai:</span>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{config.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai || 'Tidak tersedia'}</span>
                            {(config.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai) && (
                              <button
                                onClick={() => handleCopyId(config.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai)}
                                className="p-1.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors shrink-0"
                                title="Salin ID Pegawai"
                              >
                                {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 col-span-2">
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">IMEI / Device ID:</span>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{config.deviceId || (pegawai as any)?.emai || (pegawai as any)?.imei || (pegawai as any)?.device_id || (pegawai as any)?.sim_serial || 'Tidak tersedia'}</span>
                            <button
                              type="button"
                              onClick={() => { setImeiInput(''); setImeiOutput(null); setIsUpdateImeiOpen(true); }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800/50 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-[10px] font-bold transition-colors shrink-0 whitespace-nowrap"
                              title="Update Device ID"
                            >
                              <Smartphone className="w-3.5 h-3.5" /> Update
                            </button>
                          </div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80">
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Latitude:</span>
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{config.latitude || (pegawai as any)?.lat || (pegawai as any)?.latitude || 'Tidak tersedia'}</span>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80">
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Longitude:</span>
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{config.longitude || (pegawai as any)?.long || (pegawai as any)?.longitude || (pegawai as any)?.longtitude || 'Tidak tersedia'}</span>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 col-span-2 sm:col-span-1">
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">ID Lokasi:</span>
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{config.idLokasi || (pegawai as any)?.id_lokasi || 'Tidak tersedia'}</span>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 col-span-2 sm:col-span-1">
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Kode Instansi:</span>
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{config.kodeInstansi || (pegawai as any)?.kode_instansi || 'Tidak tersedia'}</span>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 col-span-2">
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Kode Unit:</span>
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{config.kodeUnor || (pegawai as any)?.kode_unor || 'Tidak tersedia'}</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Ubah Password — hanya tampil jika canEdit */}
            {canEdit ? (
            <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setIsUbahPasswordOpen(!isUbahPasswordOpen)}
                className="w-full flex justify-between items-center text-left px-5 py-4 rounded-xl bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors border border-slate-200/50 dark:border-slate-700/50 cursor-pointer group shadow-sm"
              >
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Lock className="w-4 h-4 text-slate-500 dark:text-slate-400" /> Ubah Password Mobile
                </h3>
                {isUbahPasswordOpen ? (
                  <ChevronUp className="w-5 h-5 opacity-70" />
                ) : (
                  <ChevronDown className="w-5 h-5 opacity-70" />
                )}
              </button>

              <AnimatePresence initial={false}>
                {isUbahPasswordOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden space-y-4 pt-4"
                  >
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Password Sekarang</label>
                      <div className="relative">
                        <input 
                          type={showPwdNow ? "text" : "password"} 
                          value={pwdNow}
                          onChange={e => setPwdNow(e.target.value)}
                          className="w-full px-4 py-3 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none pr-10 transition-colors" 
                        />
                        <button type="button" onClick={() => setShowPwdNow(!showPwdNow)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                          {showPwdNow ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Password Baru</label>
                      <div className="relative">
                        <input 
                          type={showPwdNew ? "text" : "password"} 
                          value={pwdNew}
                          onChange={e => setPwdNew(e.target.value)}
                          className="w-full px-4 py-3 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none pr-10 transition-colors" 
                        />
                        <button type="button" onClick={() => setShowPwdNew(!showPwdNew)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                          {showPwdNew ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>
                    <button onClick={doUbahPassword} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl transition-all shadow-sm cursor-pointer active:scale-[0.98]">
                      {loading ? 'Menyimpan...' : 'Simpan Password Baru'}
                    </button>
                    {changePwdOutput && (
                      <div className={`mt-4 p-4 rounded-xl text-sm font-semibold shadow-sm ${changePwdOutput.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30' : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30'}`}>
                        <div className="font-sans text-xs md:text-sm">{changePwdOutput.text}</div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            ) : (
            /* View-only mode: tampilkan info bahwa password tidak bisa diubah */
            <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 dark:text-slate-500 shrink-0">
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  Ubah Password Mobile tidak tersedia dalam mode view-only.
                </p>
              </div>
            </div>
            )}
          </>
        )}
      </div>
    </div>
      
    {modalImg && (
      <ImageLightbox src={modalImg.src} title={modalImg.title} onClose={() => setModalImg(null)} />
    )}

    {/* Profile Photo Viewer Modal */}
    <AnimatePresence>
      {isProfilePhotoViewerOpen && (
        <div className="modal-layer fixed inset-0 z-[150] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsProfilePhotoViewerOpen(false)}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
          />
          
          {/* Modal Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.3 }}
            className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800/80 overflow-hidden flex flex-col items-center text-center z-10 animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="w-full flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-5">
              <span className="font-bold text-slate-800 dark:text-white text-sm">Foto Profil</span>
              <button 
                onClick={() => setIsProfilePhotoViewerOpen(false)} 
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Profile Image View */}
            <div className="relative w-52 h-52 sm:w-56 sm:h-56 rounded-full border-4 border-slate-100 dark:border-slate-800 object-cover overflow-hidden shadow-xl mb-6 group">
              <img 
                src={resolvedFotoUrl || undefined}
                alt="Foto Profil Besar" 
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                referrerPolicy="no-referrer"
              />
            </div>

            {/* Photo Actions */}
            <div className="w-full space-y-3">
              {/* Hidden input file */}
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />

              {canEdit ? (
                <>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingPhoto}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 text-sm cursor-pointer active:scale-[0.98]"
                  >
                    <Camera className="w-4 h-4" />
                    Ubah Foto Profil
                  </button>

                  {/* Show Delete Button only if the photo is not default */}
                  {pegawai?.foto && (
                    <button
                      onClick={handleDeletePhoto}
                      disabled={isUploadingPhoto}
                      className="w-full bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 text-sm border border-rose-200/50 dark:border-rose-900/40 cursor-pointer active:scale-[0.98]"
                    >
                      <Trash2 className="w-4 h-4" />
                      Hapus Foto Profil
                    </button>
                  )}
                </>
              ) : (
                /* View-only: tampilkan info foto tidak bisa diubah */
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 dark:text-slate-500 shrink-0">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    Foto profil tidak dapat diubah (view only).
                  </p>
                </div>
              )}
            </div>

            {/* Feedback Alert */}
            {photoActionMessage && (
              <div className={`w-full mt-4 p-3.5 rounded-xl text-xs font-semibold shadow-sm border ${
                photoActionMessage.type === 'success' 
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30' 
                  : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30'
              }`}>
                {photoActionMessage.text}
              </div>
            )}

            {/* Loading Spinner Overlays */}
            {isUploadingPhoto && (
              <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px] flex items-center justify-center z-20">
                <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-xl flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Memproses...</span>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {/* Image Cropper Modal */}
    <AnimatePresence>
      {isCropperOpen && (
        <div className="modal-layer fixed inset-0 z-[160] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm"
          />

          {/* Cropper Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 z-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="w-full flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3 mb-5">
              <span className="font-bold text-slate-800 dark:text-white text-sm">Sesuaikan Foto</span>
              <button 
                onClick={() => setIsCropperOpen(false)} 
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Cropper Canvas Workspace */}
            <div className="relative overflow-hidden bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-700 w-[300px] h-[300px] mb-4 shadow-inner flex items-center justify-center">
              <canvas 
                ref={cropperCanvasRef} 
                width={300} 
                height={300}
                onMouseDown={handleDragStart}
                onMouseMove={handleDragMove}
                onMouseUp={handleDragEnd}
                onMouseLeave={handleDragEnd}
                onTouchStart={handleDragStart}
                onTouchMove={handleDragMove}
                onTouchEnd={handleDragEnd}
                className="cursor-move touch-none"
              />
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mb-5 text-center leading-normal">
              Gunakan gestur seret / geser untuk memposisikan bagian foto di dalam lingkaran biru.
            </p>

            {/* Slider for Zoom */}
            <div className="w-full px-2 mb-6">
              <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 mb-2 font-semibold">
                <span>Zoom</span>
                <span className="font-mono">{Math.round(cropZoom * 100)}%</span>
              </div>
              <input 
                type="range" 
                min="1" 
                max="3" 
                step="0.05" 
                value={cropZoom} 
                onChange={e => setCropZoom(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600" 
              />
            </div>

            {/* Buttons */}
            <div className="w-full grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsCropperOpen(false)}
                className="w-full py-3 px-4 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors cursor-pointer text-center"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleCropAndSave}
                disabled={isUploadingPhoto}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                {isUploadingPhoto ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Memproses...
                  </>
                ) : (
                  'Pangkas & Simpan'
                )}
              </button>
            </div>

            {/* Error messages in Cropper */}
            {photoActionMessage && photoActionMessage.type === 'error' && (
              <div className="w-full mt-4 p-3.5 bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30 rounded-xl text-xs font-semibold shadow-sm">
                {photoActionMessage.text}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {/* ── Modal Update IMEI / Device ID ──────────────────────────────────── */}
    <AnimatePresence>
      {isUpdateImeiOpen && (
        <div className="modal-layer fixed inset-0 z-[200] flex items-center justify-center p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => !imeiLoading && setIsUpdateImeiOpen(false)}
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="relative w-full max-w-md my-auto bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-10 max-h-[min(90vh,560px)] flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-device-id-title"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                  <Smartphone className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="min-w-0">
                  <span id="update-device-id-title" className="font-bold text-slate-800 dark:text-white text-sm block truncate">Update Device ID</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">IMEI / ID perangkat baru</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !imeiLoading && setIsUpdateImeiOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                aria-label="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 overflow-y-auto custom-scrollbar flex-1 space-y-4">
              <div className="flex items-start gap-2.5 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                  Masukkan Device ID baru (IMEI, ID perangkat, atau kode dari admin) jika login gagal karena perangkat tidak dikenali.
                </p>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-xs">
                <span className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wide text-[10px]">Akun</span>
                <p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5 truncate">{loginForm.username || '-'}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wide">
                  Device ID / IMEI Baru <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={imeiInput}
                  onChange={e => setImeiInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleUpdateImei()}
                  placeholder="Masukkan Device ID atau IMEI..."
                  className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-3 text-sm font-mono text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                  autoFocus
                />
              </div>

              {imeiOutput && (
                <div className={`p-3 rounded-xl text-xs font-semibold flex items-start gap-2 ${
                  imeiOutput.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/40'
                }`}>
                  {imeiOutput.type === 'success'
                    ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  }
                  <span className="leading-relaxed">{imeiOutput.text}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-3 shrink-0 bg-slate-50/80 dark:bg-slate-900/80">
              <button
                type="button"
                onClick={() => setIsUpdateImeiOpen(false)}
                disabled={imeiLoading}
                className="py-2.5 px-4 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleUpdateImei}
                disabled={imeiLoading || !imeiInput.trim()}
                className="py-2.5 px-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                {imeiLoading ? (
                  <><Smartphone className="w-4 h-4 animate-pulse" /> Mengupdate...</>
                ) : (
                  <><Send className="w-4 h-4" /> Update</>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  </>
  );
}
