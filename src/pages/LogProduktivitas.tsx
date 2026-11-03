import React, { useEffect, useState } from 'react';
import { Activity, Search, AlertTriangle } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { sendRequest } from '../api';
import DatePicker from '../components/ui/DatePicker';
import { formatBeautifulDateTime, getTodayWIB } from '../lib/dateFormatter';
import ImageLightbox from '../components/ui/ImageLightbox';
import { useBackButton } from '../hooks/useBackButton';
import { usePegawaiSearch } from '../hooks/usePegawaiSearch';
import LazyImage from '../components/ui/LazyImage';
import { loadPegawaiSearchList } from '../lib/pegawaiData';

export default function LogProduktivitas() {
  const { pegawai, config, tabPermissions, userRole } = useAppContext();

  // Boleh cari pegawai lain jika admin atau permission allowSearchProduktivitas aktif
  const canSearchProduktivitas = userRole === 'admin' || tabPermissions.allowSearchProduktivitas;
  const [pegawaiList, setPegawaiList] = useState<any[]>([]);

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
    if (!canSearchProduktivitas || pegawaiList.length > 0) return;
    let cancelled = false;
    loadPegawaiSearchList().then(list => { if (!cancelled) setPegawaiList(list); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [canSearchProduktivitas, pegawaiList.length]);
  
  const [tglAwal, setTglAwal] = useState(() => getTodayWIB());
  const [tglAkhir, setTglAkhir] = useState(getTodayWIB());
  
  const [loading, setLoading] = useState(false);
  const [dataJam, setDataJam] = useState<any>(null);
  const [dataAkt, setDataAkt] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [modalImg, setModalImg] = useState<{ src: string; title: string; images?: { src: string; title: string }[]; currentIndex?: number } | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const aktivitasRequestId = React.useRef(0);

  // Pre-calculate all images in dataAkt
  const allImages = React.useMemo(() => {
    if (!dataAkt) return [];
    return dataAkt.slice(0, visibleCount).map((item) => {
      let lamp = item.lampiran || item.foto || item.file_lampiran;
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

      return {
        src: imgUrl,
        title: item.tugas || 'Foto Aktivitas'
      };
    }).filter((img): img is { src: string; title: string } => img !== null);
  }, [dataAkt, visibleCount]);

  // Hook up back button to close lightbox
  useBackButton(() => {
    setModalImg(null);
    return true;
  }, !!modalImg);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      if (dataAkt && visibleCount < dataAkt.length) {
        setVisibleCount(prev => prev + 50);
      }
    }
  };

  const fetchAktivitas = async (
    tanggalAwal = tglAwal,
    tanggalAkhir = tglAkhir,
    targetPegawaiId = selectedPegawai?.id,
  ) => {
    const requestId = ++aktivitasRequestId.current;
    setLoading(true);
    setError('');
    setDataJam(null);
    setDataAkt(null);
    setVisibleCount(50);
    // Jika tidak punya izin search, selalu gunakan id sendiri
    const targetId = canSearchProduktivitas
      ? (targetPegawaiId || config.idPegawai || pegawai?.id)
      : (config.idPegawai || pegawai?.id);
    const pJam = { id_pegawai: targetId, tgl_awal: tanggalAwal, tgl_akhir: tanggalAkhir };
    const pAkt = { id_pegawai: targetId, tgl_mulai: tanggalAwal, tgl_akhir: tanggalAkhir };
    try {
      const [resJam, resAkt] = await Promise.all([
        sendRequest("/Tupoksi/ambil_jam_aktifitas", pJam),
        sendRequest("/Tupoksi/ambilDataAktivitas", pAkt),
      ]);
      if (requestId !== aktivitasRequestId.current) return;

      if (resJam?.success && resJam?.jumlah?.length) {
        setDataJam(resJam.jumlah[0]);
      }
      
      if (resAkt?.success && resAkt?.data?.length) {
        setDataAkt(resAkt.data);
      } else {
        setError('Detail aktivitas kosong.');
      }
    } catch (err: any) {
      if (requestId === aktivitasRequestId.current) {
        setError(`Network Error: ${err.message}`);
      }
    } finally {
      if (requestId === aktivitasRequestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!pegawai) return;
    void fetchAktivitas(tglAwal, tglAkhir, selectedPegawai?.id);
    return () => { aktivitasRequestId.current += 1; };
  }, [pegawai?.id, config.idPegawai, tglAwal, tglAkhir, selectedPegawai?.id, canSearchProduktivitas]);

  if (!pegawai) {
    return null; // App.tsx auto-redirect ke tabLogin
  }

  return (
    <div className="w-full mx-auto space-y-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
      <h3 className="text-lg font-bold text-slate-800 dark:text-white border-b-2 border-orange-500 pb-2 mb-4 flex items-center gap-2">
        <Activity className="w-5 h-5 text-orange-500" /> Tarik Log Produktivitas
      </h3>

      {/* Search Pegawai Section - hanya tampil jika punya izin */}
      {canSearchProduktivitas ? (
      <div className={`mb-6 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200/60 dark:border-slate-700/50 relative ${showPegawaiDropdown ? 'z-[60]' : 'z-30'}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">
              Cek History Produktivitas
            </span>
            <h4 className="text-sm font-bold text-slate-850 dark:text-slate-200 flex items-center gap-1.5">
              {selectedPegawai ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-500 animate-pulse inline-block" />
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
                className="w-full bg-white dark:bg-slate-800 text-slate-850 dark:text-white placeholder-slate-400 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-14 py-2 text-xs font-bold focus:outline-none focus:border-orange-500 shadow-sm"
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
        <div className="mb-6 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-2xl border border-orange-200/60 dark:border-orange-700/50 flex items-center gap-3">
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
        onClick={() => { void fetchAktivitas(); }}
        disabled={loading}
        className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl shadow-sm transition-colors mt-6 flex items-center justify-center gap-2"
      >
        <Search className="w-5 h-5" /> {loading ? 'Menarik Data...' : 'Tarik Data'}
      </button>

      {(dataJam || dataAkt || error) && (
        <>
          {/* ── Summary Card di luar container scroll ───────────────────── */}
          {dataJam && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 rounded-xl p-3 text-center">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total Jam</div>
                <div className="font-bold text-blue-600 dark:text-blue-400 text-sm">{dataJam.total_aktivitas || '-'}</div>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40 rounded-xl p-3 text-center">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Disetujui</div>
                <div className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">{dataJam.total_disetujui || '-'}</div>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/40 rounded-xl p-3 text-center">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Batal/Ditolak</div>
                <div className="font-bold text-red-600 dark:text-red-400 text-sm">{dataJam.total_batal || '-'}</div>
              </div>
            </div>
          )}

          <div 
            className="mt-3 p-4 bg-white dark:bg-slate-900/50 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800/80 text-sm rounded-xl overflow-x-auto max-h-[500px] custom-scrollbar shadow-sm"
            onScroll={handleScroll}
          >
          {error ? (
             <div className="p-4 bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20 font-medium text-sm rounded-xl flex items-start gap-3">
               <AlertTriangle className="w-5 h-5 shrink-0" />
               <span className="leading-relaxed">{error}</span>
             </div>
          ) : dataAkt ? (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] sm:text-sm">
                <tr>
                  <th className="p-1.5 sm:p-3 font-semibold rounded-tl-lg whitespace-nowrap">Waktu Pelaksanaan</th>
                  <th className="p-1.5 sm:p-3 font-semibold whitespace-nowrap">Jenis & Tugas</th>
                  <th className="p-1.5 sm:p-3 font-semibold whitespace-nowrap">Keterangan</th>
                  <th className="p-1.5 sm:p-3 font-semibold whitespace-nowrap">Status</th>
                  <th className="p-1.5 sm:p-3 font-semibold text-center rounded-tr-lg whitespace-nowrap">Foto Lampiran</th>
                </tr>
              </thead>
              <tbody className="text-slate-700 dark:text-slate-300">
                {dataAkt.slice(0, visibleCount).map((item, i) => {
                  let statusClass = 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400';
                  if (item.status === 'DISETUJUI') statusClass = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400';
                  else if (item.status === 'BELUM DIAKHIRI') statusClass = 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400';
                  
                  let lamp = item.lampiran || item.foto || item.file_lampiran;
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

                  return (
                    <tr key={i} className="border-b border-slate-200 dark:border-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-[10px] sm:text-sm transition-colors">
                      <td className="p-1.5 sm:p-3 align-top whitespace-nowrap leading-tight">
                        <span className="block text-slate-800 dark:text-slate-300 font-medium">Mulai: {formatBeautifulDateTime(item.tgl_mulai)}</span>
                        <span className="block text-slate-500 dark:text-slate-500 text-[9px] sm:text-xs mt-1">Selesai: {item.tgl_selesai ? formatBeautifulDateTime(item.tgl_selesai) : '-'}</span>
                      </td>
                      <td className="p-1.5 sm:p-3 align-top text-slate-800 dark:text-slate-300 font-medium min-w-[120px] sm:min-w-[150px] max-w-[200px] whitespace-normal break-words leading-tight">
                        <span className="text-[9px] sm:text-xs font-bold text-blue-600 dark:text-blue-400 block mb-1">[{item.jenis || 'TUPOKSI'}]</span>
                        <div className="line-clamp-3">{item.tugas || '-'}</div>
                      </td>
                      <td className="p-1.5 sm:p-3 align-top text-slate-600 dark:text-slate-300 min-w-[120px] sm:min-w-[150px] whitespace-normal break-words leading-tight">
                        {item.keterangan || item.ket || item.deskripsi || item.uraian || '-'}
                      </td>
                      <td className="p-1.5 sm:p-3 align-top">
                        <span className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[9px] sm:text-xs font-bold whitespace-nowrap inline-block leading-none ${statusClass}`}>{item.status}</span>
                      </td>
                      <td className="p-1.5 sm:p-3 align-top text-center">
                        <div className="flex justify-center items-center">
                           {hasImage ? (
                            <LazyImage 
                              src={imgUrl} 
                              alt="Aktivitas"
                              onClick={() => {
                                const idx = allImages.findIndex((img) => img.src === imgUrl);
                                setModalImg({
                                  src: imgUrl,
                                  title: item.tugas || 'Foto Aktivitas',
                                  images: allImages,
                                  currentIndex: idx !== -1 ? idx : 0
                                });
                              }}
                              containerClassName="w-12 h-12 sm:w-24 sm:h-24 min-w-[3rem] min-h-[3rem] sm:min-w-[6rem] sm:min-h-[6rem] max-w-[3rem] max-h-[3rem] sm:max-w-[6rem] sm:max-h-[6rem] rounded-lg cursor-pointer border-2 border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 hover:scale-105 transition-all shadow-md shrink-0"
                              className="w-full h-full object-cover aspect-square"
                            />
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500 italic text-[10px] sm:text-xs">No Image</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : null}
        </div>
        </>
      )}

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
