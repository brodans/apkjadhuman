import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Building2, Search, X, ChevronRight, ChevronDown,
  Users, Layers, Filter, Info, MapPin, AlertCircle,
  Map as MapIcon, Check, ExternalLink
} from 'lucide-react';
import type { DataInstansi } from '../data/data_instansi';
import type { DataUnor } from '../data/data_unor';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAppContext } from '../context/AppContext';
import { loadPegawaiDatabase } from '../lib/pegawaiData';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TreeNode {
  kode: string;
  nama: string;
  displayNama: string;
  tipeSkpd: string | null;
  instansiData: DataInstansi | null;
  unorList: DataUnor[];
  children: TreeNode[];
  level: number;
  totalUnit: number;
  isSynthetic?: boolean;  // node buatan (grup Kecamatan, Dinkes, Disdik)
}

// ─── Helper: clean nama instansi ─────────────────────────────────────────────
function cleanNama(nama: string): string {
  return nama
    .replace(/^-+\s*\{+\s*/g, '')
    .replace(/\s*\}+\s*-*$/g, '')
    .trim();
}

// ─── Helper: ekstrak kode parent dari field parentInstansi ─────────────────
function extractParentKodeFromField(parentInstansi: string | null): string | null {
  if (!parentInstansi) return null;
  const m = parentInstansi.match(/'kode'\s*:\s*'([^']+)'/);
  return m ? m[1] : null;
}

// ─── Klasifikasi Instansi ─────────────────────────────────────────────────────
// Beberapa entri Dinas Pendidikan juga pakai prefix 9.xx (SMP, SD individual, Pengawas)
// Bedakan dari Dinkes berdasarkan nama instansi atau parentInstansi
function getGolongan(kode: string, nama?: string, parentInstansi?: string | null): string {
  const nameLower = (nama || '').toLowerCase();
  const parentKode = parentInstansi ? extractParentKodeFromField(parentInstansi) : null;

  // Semua unit yang terhubung ke induk Disdik tetap berada di grup Dinas Pendidikan,
  // termasuk data sekolah yang memakai kode 8.xx atau 9.xx.
  if (parentKode === '5.09.00.00.00') return 'DISDIK_SD';
  if (nameLower.includes('dinas pendidikan')) {
    if (/^7\./.test(kode)) return 'DISDIK_KORWIL';
    if (/^8\.|^9\./.test(kode)) return 'DISDIK_SD';
  }

  if (kode === '1.00.00.00.00') return 'SETDA';
  if (kode === '1.00.11.00.00') return 'STAF_AHLI';
  if (/^1\.(0[1-5])\.\d\d\.\d\d\.\d\d$/.test(kode)) return 'BAGIAN_SETDA';
  if (kode === '2.00.00.00.00') return 'SEKRETARIAT_DPRD';
  if (/^3\.\d\d\.00\.00\.00$/.test(kode) || kode.startsWith('5.08')) return 'BADAN';
  if (kode === '5.06.00.00.00') return 'DINKES_INDUK';
  if (kode === '5.09.00.00.00') return 'DISDIK_INDUK';
  if (/^7\.\d+\.00\.00\.00$/.test(kode)) return 'DISDIK_KORWIL';
  if (/^8\.\d+\./.test(kode)) return 'DISDIK_SD';

  // 9.xx — bisa PKM (Dinkes) atau Sekolah/Pengawas (Disdik)
  // PKM Dinkes: kode 9.71–9.99.xx, atau nama mengandung "Dinas Kesehatan"
  // Pendidikan: parentInstansi ke Disdik, atau nama mengandung "Dinas Pendidikan"
  if (/^9\.\d+\./.test(kode)) {
    // Jika parent ke Disdik → DISDIK_SD
    // Jika nama mengandung "kesehatan" atau kode 9.71+ → DINKES_PKM
    if (nameLower.includes('kesehatan') || nameLower.includes('pkm') || nameLower.includes('puskesmas')) return 'DINKES_PKM';
    // Jika nama mengandung pendidikan → DISDIK_SD
    if (nameLower.includes('pendidikan') || nameLower.includes('smp') || nameLower.includes('sma') || nameLower.includes('smk') || nameLower.includes('sd ') || nameLower.includes('sdn') || nameLower.includes('pengawas')) return 'DISDIK_SD';
    // Fallback: kode 9.71–9.99 adalah Dinkes PKM berdasarkan data
    const subNum = parseInt(kode.split('.')[1] || '0');
    if (subNum >= 71) return 'DINKES_PKM';
    return 'DISDIK_SD';
  }

  if (/^5\.\d\d\.00\.00\.00$/.test(kode)) return 'DINAS';
  if (kode === '6.00.00.00.00') return 'DINPEMAS';
  if (/^6\.(0[1-9]|1[0-9]|2[0-1])\.00\.00\.00$/.test(kode)) return 'KECAMATAN';
  return 'LAINNYA';
}

// ─── Build tree dengan hierarki manual ───────────────────────────────────────
function buildTree(searchTerm: string, tipeFilter: string, dataInstansi: DataInstansi[], dataUnor: DataUnor[]): TreeNode[] {
  const term = searchTerm.toLowerCase().trim();

  // 1. Deduplikasi kode
  const seenKode = new Set<string>();
  const instansiUnique: DataInstansi[] = [];
  for (const inst of dataInstansi) {
    if (!seenKode.has(inst.kode)) {
      seenKode.add(inst.kode);
      instansiUnique.push(inst);
    }
  }

  // 2. Filter tipe
  const instansiFilt = tipeFilter
    ? instansiUnique.filter(i => i.tipeSkpd === tipeFilter)
    : instansiUnique;

  // 3. Peta unor per instansiKode
  const unorByInstansi = new Map<string, DataUnor[]>();
  dataUnor.forEach(u => {
    const k = u.instansiKode || '';
    if (!unorByInstansi.has(k)) unorByInstansi.set(k, []);
    unorByInstansi.get(k)!.push(u);
  });

  // 4. Buat node map
  const nodeMap = new Map<string, TreeNode>();
  for (const inst of instansiFilt) {
    const unors = unorByInstansi.get(inst.kode) || [];
    nodeMap.set(inst.kode, {
      kode: inst.kode,
      nama: inst.nama,
      displayNama: cleanNama(inst.nama),
      tipeSkpd: inst.tipeSkpd,
      instansiData: inst,
      unorList: unors,
      children: [],
      level: 1,
      totalUnit: unors.length,
    });
  }

  // 5. Buat node synthetic helper
  function makeSynth(kode: string, nama: string, level = 1): TreeNode {
    return {
      kode, nama, displayNama: nama,
      tipeSkpd: null, instansiData: null,
      unorList: [], children: [], level, totalUnit: 0,
      isSynthetic: true,
    };
  }

  // ── 6. Bangun hierarki SETDA ──────────────────────────────────────────────
  const setdaNode = nodeMap.get('1.00.00.00.00');
  if (setdaNode) {
    // Bagian-bagian Setda langsung jadi anak Setda
    nodeMap.forEach((node, kode) => {
      if (getGolongan(kode, node.nama, node.instansiData?.parentInstansi) === 'BAGIAN_SETDA') {
        node.level = 2;
        setdaNode.children.push(node);
        setdaNode.totalUnit += node.totalUnit;
      }
    });
    // Staf Ahli
    const stafAhli = nodeMap.get('1.00.11.00.00');
    if (stafAhli) {
      stafAhli.level = 2;
      setdaNode.children.push(stafAhli);
    }
    setdaNode.children.sort((a, b) => a.kode.localeCompare(b.kode));
  }

  // ── 7. Bangun grup DINAS PENDIDIKAN ───────────────────────────────────────
  const disdikInduk = nodeMap.get('5.09.00.00.00');
  if (disdikInduk) {
    // KORWIL jadi anak Disdik
    nodeMap.forEach((node, kode) => {
      if (getGolongan(kode, node.nama, node.instansiData?.parentInstansi) === 'DISDIK_KORWIL') {
        node.level = 2;
        disdikInduk.children.push(node);
      }
    });
    // SD/SMP/SMA/Pengawas individual (parentInstansi mengarah ke Disdik, atau deteksi dari nama)
    nodeMap.forEach((node, kode) => {
      if (getGolongan(kode, node.nama, node.instansiData?.parentInstansi) === 'DISDIK_SD') {
        node.level = 2;
        disdikInduk.children.push(node);
      }
    });
    disdikInduk.children.sort((a, b) => a.kode.localeCompare(b.kode));
  }

  // ── 8. Bangun grup DINAS KESEHATAN ────────────────────────────────────────
  const dinkesInduk = nodeMap.get('5.06.00.00.00');
  if (dinkesInduk) {
    nodeMap.forEach((node, kode) => {
      if (getGolongan(kode, node.nama, node.instansiData?.parentInstansi) === 'DINKES_PKM') {
        node.level = 2;
        dinkesInduk.children.push(node);
      }
    });
    dinkesInduk.children.sort((a, b) => a.kode.localeCompare(b.kode));
  }

  // ── 9. Bangun grup KECAMATAN (synthetic parent) ───────────────────────────
  const kecamatanGrup = makeSynth('__KECAMATAN__', 'Kecamatan');
  nodeMap.forEach((node, kode) => {
    if (getGolongan(kode, node.nama, node.instansiData?.parentInstansi) === 'KECAMATAN') {
      node.level = 2;
      kecamatanGrup.children.push(node);
      kecamatanGrup.totalUnit += node.totalUnit;
    }
  });
  kecamatanGrup.children.sort((a, b) => a.kode.localeCompare(b.kode));

  // ── 9b. Grup RSUD Dr. Harjono ───────────────────────────────────────────
  const rsudGrup = makeSynth('__RSUD_HARJONO__', 'RSUD Dr. Harjono');
  nodeMap.forEach(node => {
    if (node.displayNama.toLowerCase().startsWith('rsud dr. harjono')) {
      node.level = 2;
      rsudGrup.children.push(node);
      rsudGrup.totalUnit += node.totalUnit;
    }
  });
  rsudGrup.children.sort((a, b) => a.kode.localeCompare(b.kode));

  // ── 10. Tentukan node yang hanya boleh jadi CHILD (tidak boleh jadi root) ──
  const childOnly = new Set<string>();
  nodeMap.forEach((node, kode) => {
    const g = getGolongan(kode, node.nama, node.instansiData?.parentInstansi);
    if (
      g === 'BAGIAN_SETDA' || g === 'STAF_AHLI' ||
      g === 'DISDIK_KORWIL' || g === 'DISDIK_SD' ||
      g === 'DINKES_PKM' ||
      g === 'KECAMATAN' ||
      node.displayNama.toLowerCase().startsWith('rsud dr. harjono')
    ) {
      childOnly.add(kode);
    }
  });

  // ── 11. Susun root dengan urutan hierarki ────────────────────────────────
  const addedToRoots = new Set<string>();
  const roots: TreeNode[] = [];

  const pushRoot = (kode: string) => {
    const node = nodeMap.get(kode);
    if (node && !addedToRoots.has(kode)) {
      roots.push(node);
      addedToRoots.add(kode);
    }
  };

  // 1. Setda
  pushRoot('1.00.00.00.00');
  // 2. Sekretariat DPRD
  pushRoot('2.00.00.00.00');
  // 3. Badan-badan
  const badanKodes: string[] = [];
  nodeMap.forEach((node, kode) => { if (getGolongan(kode, node.nama, node.instansiData?.parentInstansi) === 'BADAN') badanKodes.push(kode); });
  badanKodes.sort().forEach(pushRoot);
  // 4. Dinas-dinas termasuk Dinkes & Disdik induk
  const dinasKodes: string[] = [];
  nodeMap.forEach((node, kode) => {
    const g = getGolongan(kode, node.nama, node.instansiData?.parentInstansi);
    if (g === 'DINAS' || g === 'DINKES_INDUK' || g === 'DISDIK_INDUK') dinasKodes.push(kode);
  });
  dinasKodes.sort().forEach(pushRoot);
  // 5. Dinas Pemberdayaan Masyarakat & Desa
  pushRoot('6.00.00.00.00');
  // 6. Grup Kecamatan (synthetic)
  if (kecamatanGrup.children.length > 0) {
    roots.push(kecamatanGrup);
    addedToRoots.add('__KECAMATAN__');
  }
  // 6b. Grup RSUD Dr. Harjono
  if (rsudGrup.children.length > 0) {
    roots.push(rsudGrup);
    addedToRoots.add('__RSUD_HARJONO__');
  }
  // 7. Sisa yang belum masuk dan bukan childOnly
  nodeMap.forEach((node, kode) => {
    if (!addedToRoots.has(kode) && !childOnly.has(kode)) {
      roots.push(node);
      addedToRoots.add(kode);
    }
  });

  // ── 12. Filter pencarian ──────────────────────────────────────────────────
  if (!term) return roots;

  const matchNode = (node: TreeNode): boolean => {
    const inName = node.displayNama.toLowerCase().includes(term) || node.kode.toLowerCase().includes(term);
    const inUnor = node.unorList.some(u =>
      (u.nama || '').toLowerCase().includes(term) || (u.srcNama || '').toLowerCase().includes(term)
    );
    const childMatch = node.children.some(c => matchNode(c));
    return inName || inUnor || childMatch;
  };

  const filterTree = (nodes: TreeNode[]): TreeNode[] =>
    nodes.filter(matchNode).map(n => ({ ...n, children: filterTree(n.children) }));

  return filterTree(roots);
}

// ─── Tipe SKPD unik ──────────────────────────────────────────────────────────
function useStructureData(enabled: boolean) {
  const [data, setData] = useState<{ instansi: DataInstansi[]; unor: DataUnor[] }>({ instansi: [], unor: [] });
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (data.instansi.length > 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    let active = true;
    Promise.all([import('../data/data_instansi'), import('../data/data_unor')]).then(([instansiModule, unorModule]) => {
      if (active) setData({ instansi: instansiModule.dataInstansi, unor: unorModule.dataUnor });
    }).catch(error => console.error('Gagal memuat struktur organisasi:', error))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [enabled, data.instansi.length]);

  return { ...data, loading };
}

function useLocationData(enabled: boolean) {
  const [locations, setLocations] = useState<any[]>([]);

  useEffect(() => {
    if (!enabled || locations.length > 0) return;
    let active = true;
    import('../data/data_lokasi').then(({ dataLokasi }) => {
      if (active) setLocations(dataLokasi);
    }).catch(error => console.error('Gagal memuat data lokasi:', error));
    return () => { active = false; };
  }, [enabled, locations.length]);

  return locations;
}

// ─── Badge tipe SKPD ─────────────────────────────────────────────────────────
function TipeBadge({ tipe }: { tipe: string | null }) {
  if (!tipe) return null;
  const colors: Record<string, string> = {
    'Tipe A': 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    'Tipe A2': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    'Tipe B': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    'Tipe C': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${colors[tipe] || 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
      {tipe}
    </span>
  );
}

// ─── MapView (Leaflet) ───────────────────────────────────────────────────────
function MapView({ latitude, longitude, radius, nama, alamat }: {
  latitude: number; longitude: number; radius: number;
  nama: string; alamat?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [tileType, setTileType] = useState<'hybrid' | 'roadmap' | 'satellite'>('hybrid');
  const [showTilesMenu, setShowTilesMenu] = useState(false);
  const tileUrls = {
    hybrid: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    roadmap: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    satellite: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  };
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) { mapRef.current.remove(); }
    const map = L.map(containerRef.current, { center: [latitude, longitude], zoom: 16, zoomControl: true });
    mapRef.current = map;
    tileLayerRef.current = L.tileLayer(tileUrls[tileType], { attribution: '&copy; Google Maps', maxZoom: 21 }).addTo(map);
    const icon = L.divIcon({
      html: `<div class="relative flex items-center justify-center"><span class="absolute inline-flex h-10 w-10 rounded-full bg-red-400/50 opacity-75 animate-ping"></span><span class="relative inline-flex rounded-full h-6 w-6 bg-red-600 border-2 border-white shadow-lg items-center justify-center"><span class="h-2 w-2 rounded-full bg-white"></span></span></div>`,
      className: '', iconSize: [40, 40], iconAnchor: [20, 20],
    });
    L.marker([latitude, longitude], { icon }).addTo(map)
      .bindPopup(`<div class="p-1 text-xs"><b>${nama}</b><br/>${alamat || ''}<br/><span class="text-emerald-600 font-bold">Radius: ${radius}m</span></div>`, { maxWidth: 260 }).openPopup();
    const circle = L.circle([latitude, longitude], { color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.15, radius, weight: 2 }).addTo(map);
    map.fitBounds(circle.getBounds(), { padding: [40, 40] });
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => { clearTimeout(t); if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [latitude, longitude, radius, nama, alamat]);
  useEffect(() => { if (tileLayerRef.current) tileLayerRef.current.setUrl(tileUrls[tileType]); }, [tileType]);
  return (
    <div className="relative w-full flex flex-col flex-1 min-h-[380px]">
      <div className="absolute top-3 right-3 z-[1000] flex flex-col items-end gap-1.5">
        <button onClick={() => setShowTilesMenu(p => !p)} className="flex items-center gap-1.5 px-3 py-2 bg-white/95 dark:bg-slate-800/95 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl shadow-lg border border-slate-200/80 dark:border-slate-700/80 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer transition-all">
          <Layers className="w-3.5 h-3.5 text-blue-500" /> Tipe Peta <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTilesMenu ? 'rotate-180' : ''}`} />
        </button>
        {showTilesMenu && (
          <div className="bg-white/95 dark:bg-slate-800/95 p-1 rounded-xl shadow-2xl border border-slate-200/80 dark:border-slate-700/80 flex flex-col gap-0.5 min-w-[130px]">
            {(['hybrid', 'roadmap', 'satellite'] as const).map(t => (
              <button key={t} onClick={() => { setTileType(t); setShowTilesMenu(false); }} className={`px-3 py-2 rounded-lg text-left text-xs font-bold cursor-pointer flex items-center justify-between transition-all ${tileType === t ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                <span>{t === 'hybrid' ? 'Hibrida' : t === 'roadmap' ? 'Peta Jalan' : 'Satelit'}</span>
                {tileType === t && <Check className="w-3.5 h-3.5 text-white" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={containerRef} className="w-full flex-1 rounded-xl overflow-hidden shadow-inner border border-slate-200 dark:border-slate-700" />
    </div>
  );
}

// ─── Lokasi Panel ─────────────────────────────────────────────────────────────
function LokasiPanel() {
  const { userRole, tabPermissions } = useAppContext();
  const canSearchUnor = userRole === 'admin' || tabPermissions.allowSearchUnor;
  const dataLokasi = useLocationData(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const [selectedMap, setSelectedMap] = useState<any | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setVisibleCount(50); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const filtered = useMemo(() => {
    const term = debouncedSearch.toLowerCase().trim();
    if (!term) return dataLokasi;
    return dataLokasi.filter(item =>
      (item.kode || '').toLowerCase().includes(term) ||
      (item.nama || '').toLowerCase().includes(term) ||
      (item.alamat || '').toLowerCase().includes(term) ||
      (item.kota?.nama || '').toLowerCase().includes(term)
    );
  }, [dataLokasi, debouncedSearch]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 80 && visibleCount < filtered.length)
      setVisibleCount(p => p + 50);
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} disabled={!canSearchUnor}
          placeholder="Cari nama lokasi, kode, alamat, atau kota..."
          className="w-full pl-10 pr-9 py-2.5 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
        />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"><X className="w-4 h-4" /></button>}
      </div>
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_80px] sm:grid-cols-[100px_1fr_1.5fr_100px_90px] px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
          <div className="hidden sm:block">Kode</div>
          <div>Nama Lokasi</div>
          <div className="hidden sm:block">Alamat & Kota</div>
          <div className="hidden sm:block text-right">Radius</div>
          <div className="text-center">Aksi</div>
        </div>
        <div className="overflow-y-auto max-h-[500px] bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-700/50" onScroll={handleScroll}>
          {dataLokasi.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">Memuat data lokasi...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">Tidak ada lokasi ditemukan.</div>
          ) : filtered.slice(0, visibleCount).map(item => (
            <div key={item.id} className="grid grid-cols-[1fr_80px] sm:grid-cols-[100px_1fr_1.5fr_100px_90px] px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors items-center text-xs sm:text-sm">
              <div className="hidden sm:block font-mono text-slate-400 dark:text-slate-500 text-[11px]">{item.kode || '-'}</div>
              <div className="font-semibold text-slate-900 dark:text-white leading-snug">
                {item.nama}
                <div className="sm:hidden text-[10px] font-mono text-slate-400 mt-0.5">Kode: {item.kode} • Radius: {item.radius}m</div>
              </div>
              <div className="hidden sm:block text-xs text-slate-500 dark:text-slate-400">
                <div className="truncate max-w-[280px]">{item.alamat || '-'}</div>
                {item.kota && <div className="text-[10px] text-slate-400 mt-0.5 font-semibold">{item.kota.nama}, {item.kota.propinsi?.nama || 'JAWA TIMUR'}</div>}
              </div>
              <div className="hidden sm:block text-right font-bold text-emerald-600 dark:text-emerald-400 font-mono">{item.radius}m</div>
              <div className="flex items-center justify-center">
                <button onClick={() => setSelectedMap(item)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold text-xs cursor-pointer shadow-sm hover:scale-[1.03] transition-all">
                  <MapPin className="w-3.5 h-3.5" /><span>Peta</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 font-semibold px-1">
        <span>Menampilkan {Math.min(visibleCount, filtered.length)} dari {filtered.length} lokasi</span>
        <span>Total: {dataLokasi.length} lokasi</span>
      </div>
      {selectedMap && (
        <div className="modal-layer fixed inset-0 bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <MapPin className="w-5 h-5 animate-bounce" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-white text-sm md:text-base">{selectedMap.nama}</h3>
                  <p className="text-[10px] text-slate-500">Kode: {selectedMap.kode} • Radius: {selectedMap.radius}m</p>
                </div>
              </div>
              <button onClick={() => setSelectedMap(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-700 p-2 rounded-full cursor-pointer transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-900 flex-1 flex flex-col min-h-0 overflow-y-auto">
              <MapView latitude={selectedMap.latitude} longitude={selectedMap.longitude} radius={selectedMap.radius} nama={selectedMap.nama} alamat={selectedMap.alamat} />
            </div>
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 shrink-0 text-xs text-slate-600 dark:text-slate-400">
              <div>
                <p className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[400px]">Alamat: {selectedMap.alamat || '-'}</p>
                {selectedMap.kota && <p className="text-slate-500">{selectedMap.kota.nama}, {selectedMap.kota.propinsi?.nama || 'JAWA TIMUR'}</p>}
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <a href={`https://www.google.com/maps/search/?api=1&query=${selectedMap.latitude},${selectedMap.longitude}`} target="_blank" rel="noopener noreferrer"
                  className="flex-1 sm:flex-none px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-1.5 cursor-pointer">
                  <ExternalLink className="w-4 h-4" /> Google Maps
                </a>
                <button onClick={() => setSelectedMap(null)} className="flex-1 sm:flex-none px-4 py-2.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-150 font-bold rounded-xl text-sm cursor-pointer">
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TreeRow ─────────────────────────────────────────────────────────────────
function TreeRow({
  node, expandedSet, onToggle, onSelect, selectedKode,
}: {
  node: TreeNode;
  expandedSet: Set<string>;
  onToggle: (kode: string) => void;
  onSelect: (node: TreeNode) => void;
  selectedKode: string | null;
}) {
  const isExpanded = expandedSet.has(node.kode);
  const hasChildren = node.children.length > 0;
  const isSelected = node.kode === selectedKode;
  const indent = Math.max(0, node.level - 1) * 16;
  const isSynth = node.isSynthetic;

  // Warna khusus per grup
  let iconColor = isSelected
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-slate-400 dark:text-slate-500 group-hover:text-blue-500';
  let labelColor = isSelected
    ? 'text-blue-700 dark:text-blue-300 font-semibold'
    : 'text-slate-700 dark:text-slate-200 font-medium';
  let rowBg = isSelected
    ? 'bg-blue-50 dark:bg-blue-900/30 border-l-2 border-l-blue-500'
    : 'hover:bg-slate-50 dark:hover:bg-slate-700/30';

  // Node synthetic (grup kecamatan) styling berbeda
  if (isSynth) {
    iconColor = 'text-violet-500 dark:text-violet-400';
    labelColor = isSelected
      ? 'text-blue-700 dark:text-blue-300 font-bold'
      : 'text-violet-700 dark:text-violet-300 font-bold';
  }

  return (
    <>
      <div
        className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-all text-sm border-b border-slate-100 dark:border-slate-700/50 group ${rowBg}`}
        style={{ paddingLeft: `${indent + 12}px` }}
        onClick={() => !isSynth && onSelect(node)}
      >
        <button
          className={`shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer
            ${hasChildren ? 'text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20' : 'opacity-0 pointer-events-none'}`}
          onClick={(e) => { e.stopPropagation(); onToggle(node.kode); }}
        >
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {isSynth
          ? <MapPin className={`w-4 h-4 shrink-0 ${iconColor}`} />
          : <Building2 className={`w-4 h-4 shrink-0 ${iconColor}`} />
        }

        <span className={`flex-1 truncate leading-tight ${labelColor}`}>
          {node.displayNama}
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          {hasChildren && (
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 font-mono">
              {node.children.length}
            </span>
          )}
          {node.totalUnit > 0 && !hasChildren && (
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 font-mono">
              {node.totalUnit} unit
            </span>
          )}
          {!isSynth && <TipeBadge tipe={node.tipeSkpd} />}
        </div>
      </div>

      {isExpanded && hasChildren && node.children.map(child => (
        <TreeRow
          key={child.kode}
          node={child}
          expandedSet={expandedSet}
          onToggle={onToggle}
          onSelect={onSelect}
          selectedKode={selectedKode}
        />
      ))}
    </>
  );
}

// ─── DetailPanel ─────────────────────────────────────────────────────────────
function DetailPanel({ node }: { node: TreeNode }) {
  const { userRole, tabPermissions } = useAppContext();
  const canSearchUnor = userRole === 'admin' || tabPermissions.allowSearchUnor;
  const [unorSearch, setUnorSearch] = useState('');
  const [pegawaiSearch, setPegawaiSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'unit' | 'pegawai'>(node.unorList.length > 0 ? 'unit' : 'pegawai');
  const [visibleUnor, setVisibleUnor] = useState(30);
  const [visiblePegawai, setVisiblePegawai] = useState(30);
  const [mapModal, setMapModal] = useState<any | null>(null);
  const [pegawaiData, setPegawaiData] = useState<any[]>([]);
  const inst = node.instansiData;

  useEffect(() => {
    if (activeTab !== 'pegawai' || pegawaiData.length > 0) return;
    let active = true;
    loadPegawaiDatabase().then(dataPegawai => {
      if (active) setPegawaiData(dataPegawai);
    }).catch(error => console.error('Gagal memuat data pegawai:', error));
    return () => { active = false; };
  }, [activeTab, pegawaiData.length]);

  React.useEffect(() => {
    setUnorSearch(''); setVisibleUnor(30);
    setPegawaiSearch(''); setVisiblePegawai(30);
    setActiveTab(node.unorList.length > 0 ? 'unit' : 'pegawai');
  }, [node.kode, node.unorList.length]);

  // Pegawai aktif di instansi ini
  const pegawaiInstansi = useMemo(() => {
    return pegawaiData.filter((p: any) =>
      p.kode_instansi === node.kode
    );
  }, [node.kode, pegawaiData]);

  const filteredPegawai = useMemo(() => {
    const t = pegawaiSearch.toLowerCase().trim();
    if (!t) return pegawaiInstansi;
    return pegawaiInstansi.filter((p: any) =>
      (p.nama || '').toLowerCase().includes(t) ||
      (p.nip || '').toLowerCase().includes(t) ||
      (p.jabatan || '').toLowerCase().includes(t) ||
      (p.nama_jabatan || '').toLowerCase().includes(t) ||
      (p.status_pegawai || '').toLowerCase().includes(t)
    );
  }, [pegawaiInstansi, pegawaiSearch]);

  const filteredUnor = useMemo(() => {
    const t = unorSearch.toLowerCase().trim();
    if (!t) return node.unorList;
    return node.unorList.filter(u =>
      (u.nama || '').toLowerCase().includes(t) ||
      (u.srcNama || '').toLowerCase().includes(t) ||
      (u.kode || '').toLowerCase().includes(t) ||
      (u.eselon || '').toLowerCase().includes(t)
    );
  }, [node.unorList, unorSearch]);

  const lokasiInduk = inst?.lokasi?.find(l => l.induk === true)?.lokasi ?? inst?.lokasi?.[0]?.lokasi ?? null;

  // Badge warna status pegawai
  function statusBadge(status: string) {
    const s = (status || '').toLowerCase();
    if (s === 'pns') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    if (s.includes('pppk') || s.includes('p3k')) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
    if (s.includes('honorer') || s.includes('non')) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header instansi */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 rounded-xl p-4 border border-blue-100 dark:border-blue-900/50">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 dark:bg-blue-500 flex items-center justify-center shrink-0 shadow">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-slate-900 dark:text-white text-base leading-tight">
              {node.displayNama}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">Kode: {node.kode}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <TipeBadge tipe={node.tipeSkpd} />
              {node.children.length > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                  <Layers className="w-2.5 h-2.5" /> {node.children.length} sub-instansi
                </span>
              )}
              {pegawaiInstansi.length > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                  <Users className="w-2.5 h-2.5" /> {pegawaiInstansi.length} pegawai
                </span>
              )}
              {node.totalUnit > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <Layers className="w-2.5 h-2.5" /> {node.totalUnit} unit kerja
                </span>
              )}
            </div>
          </div>
        </div>

        {inst && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {inst.namaTdd && (
              <div className="bg-white/60 dark:bg-slate-800/40 rounded-lg px-3 py-2">
                <p className="text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wide text-[10px]">TTD / Pejabat</p>
                <p className="text-slate-700 dark:text-slate-200 font-semibold mt-0.5">{inst.namaTdd}</p>
                {inst.pangkatTdd && <p className="text-slate-400 dark:text-slate-500 text-[10px]">{inst.pangkatTdd}</p>}
              </div>
            )}
            {inst.namaAnggaran && (
              <div className="bg-white/60 dark:bg-slate-800/40 rounded-lg px-3 py-2">
                <p className="text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wide text-[10px]">Pengguna Anggaran</p>
                <p className="text-slate-700 dark:text-slate-200 font-semibold mt-0.5">{inst.namaAnggaran}</p>
                {inst.jabatanAnggaran && <p className="text-slate-400 dark:text-slate-500 text-[10px]">{inst.jabatanAnggaran}</p>}
              </div>
            )}
            {lokasiInduk && (
              <div className="bg-white/60 dark:bg-slate-800/40 rounded-lg px-3 py-2 sm:col-span-2">
                <p className="text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wide text-[10px] flex items-center gap-1 mb-0.5">
                  <MapPin className="w-2.5 h-2.5" /> Lokasi Induk
                </p>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-slate-700 dark:text-slate-200 font-semibold">{lokasiInduk.nama}</p>
                    {lokasiInduk.alamat && <p className="text-slate-400 dark:text-slate-500 text-[10px]">{lokasiInduk.alamat}</p>}
                  </div>
                  {lokasiInduk.latitude && lokasiInduk.longitude && (
                    <button onClick={() => setMapModal(lokasiInduk)}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 font-bold text-[11px] cursor-pointer shadow-sm transition-all">
                      <MapPin className="w-3 h-3" /> Lihat Peta
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab switcher: Pegawai / Unit Kerja */}
      {(pegawaiInstansi.length > 0 || node.unorList.length > 0) && (
        <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800/60 rounded-xl w-fit">
          {pegawaiInstansi.length > 0 && (
            <button onClick={() => setActiveTab('pegawai')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeTab === 'pegawai' ? 'bg-white dark:bg-slate-700 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}>
              <Users className="w-3.5 h-3.5" /> Pegawai ({pegawaiInstansi.length})
            </button>
          )}
          {node.unorList.length > 0 && (
            <button onClick={() => setActiveTab('unit')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeTab === 'unit' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}>
              <Layers className="w-3.5 h-3.5" /> Unit Kerja ({node.unorList.length})
            </button>
          )}
        </div>
      )}

      {/* Tab: Pegawai */}
      {activeTab === 'pegawai' && pegawaiInstansi.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input type="text" value={pegawaiSearch} disabled={!canSearchUnor}
              onChange={e => { setPegawaiSearch(e.target.value); setVisiblePegawai(30); }}
              placeholder="Cari nama, NIP, jabatan..."
              className="w-full pl-9 pr-8 py-2 text-xs border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700/50 text-slate-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none transition-all"
            />
            {pegawaiSearch && (
              <button onClick={() => setPegawaiSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden flex-1" style={{ minHeight: 0 }}>
            <div className="grid grid-cols-[1fr_64px] sm:grid-cols-[1fr_90px_76px] text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
              <div>Nama &amp; Jabatan</div>
              <div className="text-center">Status</div>
              <div className="hidden sm:block text-center">Mulai</div>
            </div>
            <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/50 bg-white dark:bg-slate-900" style={{ maxHeight: 400 }}
              onScroll={e => {
                const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
                if (scrollHeight - scrollTop <= clientHeight + 60 && visiblePegawai < filteredPegawai.length)
                  setVisiblePegawai(p => p + 30);
              }}>
              {filteredPegawai.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-slate-400">Tidak ada pegawai ditemukan.</div>
              ) : filteredPegawai.slice(0, visiblePegawai).map((p: any, i: number) => (
                <div key={p.nip || i} className="grid grid-cols-[1fr_64px] sm:grid-cols-[1fr_90px_76px] px-3 py-2.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors items-start gap-1">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 dark:text-slate-200 leading-snug break-words">{p.nama}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 break-words mt-0.5">{p.nama_jabatan || p.jabatan || '-'}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{p.nip}</span>
                      <span className="sm:hidden text-[9px] font-mono text-slate-400">{p.tgl_mulai ? p.tgl_mulai.slice(0, 7) : ''}</span>
                    </div>
                  </div>
                  <div className="text-center pt-0.5">
                    <span className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold leading-tight ${statusBadge(p.status_pegawai)}`}>
                      {(p.status_pegawai || '-').replace('PPPK', 'P3K')}
                    </span>
                  </div>
                  <div className="hidden sm:block text-center pt-0.5">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                      {p.tgl_mulai ? p.tgl_mulai.slice(0, 7) : '-'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-3 py-1.5 text-[10px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 font-mono">
              {Math.min(visiblePegawai, filteredPegawai.length)} / {filteredPegawai.length} pegawai ditampilkan
            </div>
          </div>
        </div>
      )}

      {/* Tab: Unit Kerja */}
      {activeTab === 'unit' && node.unorList.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input type="text" value={unorSearch} disabled={!canSearchUnor}
              onChange={e => { setUnorSearch(e.target.value); setVisibleUnor(30); }}
              placeholder="Cari unit kerja..."
              className="w-full pl-9 pr-8 py-2 text-xs border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700/50 text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
            {unorSearch && (
              <button onClick={() => setUnorSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden flex-1" style={{ minHeight: 0 }}>
            <div className="grid grid-cols-[1fr_64px] sm:grid-cols-[80px_1fr_76px] text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
              <div className="hidden sm:block">Kode</div>
              <div>Nama Unit</div>
              <div className="text-center">Status</div>
            </div>
            <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/50 bg-white dark:bg-slate-900" style={{ maxHeight: 380 }}
              onScroll={e => {
                const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
                if (scrollHeight - scrollTop <= clientHeight + 60 && visibleUnor < filteredUnor.length)
                  setVisibleUnor(p => p + 30);
              }}>
              {filteredUnor.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-slate-400">Tidak ada unit kerja ditemukan.</div>
              ) : filteredUnor.slice(0, visibleUnor).map(u => (
                <div key={u.kode} className="grid grid-cols-[1fr_64px] sm:grid-cols-[80px_1fr_76px] px-3 py-2.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors items-start gap-1">
                  <div className="hidden sm:block font-mono text-slate-400 dark:text-slate-500 text-[10px] leading-tight pt-0.5 break-all">{u.kode}</div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-700 dark:text-slate-200 leading-snug break-words">
                      {(u.nama && u.nama !== '-') ? u.nama : (u.srcNama || '-')}
                    </p>
                    <p className="sm:hidden text-[10px] font-mono text-slate-400 mt-0.5">{u.kode}</p>
                    {u.eselon && (
                      <span className="inline-block mt-0.5 text-[9px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400 font-bold">
                        {u.eselon}
                      </span>
                    )}
                  </div>
                  <div className="text-center pt-0.5">
                    <span className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold leading-tight ${u.aktif ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                      {u.aktif ? 'Aktif' : 'Non'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-3 py-1.5 text-[10px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 font-mono">
              {Math.min(visibleUnor, filteredUnor.length)} / {filteredUnor.length} unit ditampilkan
            </div>
          </div>
        </div>
      )}

      {pegawaiInstansi.length === 0 && node.unorList.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs text-slate-400 dark:text-slate-500">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Tidak ada data pegawai maupun unit kerja untuk instansi ini.
        </div>
      )}

      {/* Map Modal */}
      {mapModal && (
        <div className="modal-layer fixed inset-0 bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-4 z-[60]">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <MapPin className="w-4 h-4 animate-bounce" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-white text-sm">{mapModal.nama}</h3>
                  <p className="text-[10px] text-slate-500">Radius: {mapModal.radius ?? '-'}m</p>
                </div>
              </div>
              <button onClick={() => setMapModal(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-700 p-2 rounded-full cursor-pointer transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-900 flex-1 flex flex-col min-h-0 overflow-y-auto">
              <MapView latitude={mapModal.latitude} longitude={mapModal.longitude} radius={mapModal.radius ?? 50} nama={mapModal.nama} alamat={mapModal.alamat} />
            </div>
            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 shrink-0 text-xs">
              <div className="text-slate-600 dark:text-slate-400">
                {mapModal.alamat && <p className="font-semibold truncate max-w-[320px]">{mapModal.alamat}</p>}
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <a href={`https://www.google.com/maps/search/?api=1&query=${mapModal.latitude},${mapModal.longitude}`} target="_blank" rel="noopener noreferrer"
                  className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer">
                  <ExternalLink className="w-3.5 h-3.5" /> Google Maps
                </a>
                <button onClick={() => setMapModal(null)} className="flex-1 sm:flex-none px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold rounded-xl text-xs cursor-pointer">
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Unor() {
  const { userRole, tabPermissions } = useAppContext();
  const canSearchUnor = userRole === 'admin' || tabPermissions.allowSearchUnor;
  const [activeView, setActiveView] = useState<'struktur' | 'lokasi'>('struktur');
  const { instansi: dataInstansi, unor: dataUnor, loading: loadingStructure } = useStructureData(activeView === 'struktur');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [tipeFilter, setTipeFilter] = useState('');
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());
  const [selectedKode, setSelectedKode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const tree = useMemo(
    () => buildTree(debouncedSearch, tipeFilter, dataInstansi, dataUnor),
    [debouncedSearch, tipeFilter, dataInstansi, dataUnor]
  );

  const tipeOptions = useMemo(
    () => Array.from(new Set(dataInstansi.map(item => item.tipeSkpd).filter(Boolean))).sort() as string[],
    [dataInstansi]
  );

  const handleToggle = useCallback((kode: string) => {
    setExpandedSet(prev => {
      const next = new Set(prev);
      next.has(kode) ? next.delete(kode) : next.add(kode);
      return next;
    });
  }, []);

  const handleSelect = useCallback((node: TreeNode) => {
    setSelectedKode(node.kode);
    setSelectedNode(node);
  }, []);

  const handleExpandAll = () => {
    const all = new Set<string>();
    const collect = (nodes: TreeNode[]) =>
      nodes.forEach(n => { if (n.children.length > 0) { all.add(n.kode); collect(n.children); } });
    collect(tree);
    setExpandedSet(all);
  };

  const handleCollapseAll = () => setExpandedSet(new Set());

  const activeFilters = (tipeFilter ? 1 : 0) + (debouncedSearch ? 1 : 0);

  return (
    <div className="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-500" />
            Organisasi &amp; Lokasi Instansi
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Hierarki SKPD, unit kerja, pegawai, dan peta lokasi Pemerintah Kabupaten Ponorogo
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-900/60 rounded-xl" role="tablist" aria-label="Struktur dan lokasi">
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'struktur'}
          onClick={() => setActiveView('struktur')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold transition-all duration-200 ${activeView === 'struktur' ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-400' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
        >
          <Building2 className="w-4 h-4" /> Struktur
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'lokasi'}
          onClick={() => setActiveView('lokasi')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold transition-all duration-200 ${activeView === 'lokasi' ? 'bg-white text-teal-600 shadow-sm dark:bg-slate-700 dark:text-teal-400' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
        >
          <MapIcon className="w-4 h-4" /> Lokasi
        </button>
      </div>

      {/* Tab Lokasi */}
      {activeView === 'lokasi' && <LokasiPanel />}

      {/* Tab Struktur */}
      {activeView === 'struktur' && (
        <>
          {/* Search & Filter */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} disabled={!canSearchUnor}
                placeholder="Cari nama instansi, kode, unit kerja, atau pegawai..."
                className="w-full pl-10 pr-9 py-2.5 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <div className="relative">
                <button type="button" aria-haspopup="menu" aria-expanded={showFilter} onClick={() => setShowFilter(p => !p)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold border transition-all cursor-pointer ${activeFilters > 0 ? 'bg-blue-600 text-white border-blue-700 shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                  <Filter className="w-4 h-4" /> Filter
                  {activeFilters > 0 && <span className="bg-white text-blue-600 rounded-full w-4 h-4 text-[10px] font-bold flex items-center justify-center">{activeFilters}</span>}
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilter ? 'rotate-180' : ''}`} />
                </button>
                {showFilter && (
                  <div role="menu" aria-label="Filter tipe SKPD" className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-2 z-20 w-52 space-y-1">
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Tipe SKPD</p>
                    {tipeOptions.map(t => (
                      <button key={t} type="button" role="menuitemradio" aria-checked={tipeFilter === t}
                        onClick={() => { setTipeFilter(current => current === t ? '' : t); setShowFilter(false); }}
                        className={`w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-sm text-left cursor-pointer transition-colors ${tipeFilter === t ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-semibold' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                        {t}
                        {tipeFilter === t && <Check className="w-4 h-4" />}
                      </button>
                    ))}
                    {activeFilters > 0 && (
                      <button onClick={() => { setTipeFilter(''); setSearch(''); setShowFilter(false); }}
                        className="w-full text-xs text-red-500 hover:text-red-700 font-semibold text-left py-1 cursor-pointer">
                        Hapus semua filter
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button onClick={handleExpandAll} title="Expand semua"
                className="px-3 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600 cursor-pointer transition-all">
                <ChevronDown className="w-4 h-4" />
              </button>
              <button onClick={handleCollapseAll} title="Collapse semua"
                className="px-3 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600 cursor-pointer transition-all">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Split Layout - desktop side-by-side, mobile stacked */}
          <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-4">
            {/* Left: Tree */}
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden flex flex-col">
              <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-blue-500" /> Pohon Instansi
                </span>
                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{tree.length} root</span>
              </div>
              <div className="overflow-y-auto bg-white dark:bg-slate-900 flex-1"
                style={{ maxHeight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 400 : 580 }}>
                {loadingStructure ? (
                  <div className="px-6 py-12 text-center text-xs text-slate-400">
                    <div className="mx-auto mb-3 h-6 w-6 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
                    Memuat struktur organisasi...
                  </div>
                ) : tree.length === 0 ? (
                  <div className="px-6 py-12 text-center text-xs text-slate-400">
                    Tidak ada instansi ditemukan.
                    {debouncedSearch && <button onClick={() => setSearch('')} className="block mx-auto mt-2 text-blue-500 hover:underline cursor-pointer">Hapus pencarian</button>}
                  </div>
                ) : (
                  tree.map(node => (
                    <TreeRow key={node.kode} node={node} expandedSet={expandedSet} onToggle={handleToggle} onSelect={handleSelect} selectedKode={selectedKode} />
                  ))
                )}
              </div>
              <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-700 text-[10px] text-slate-400 font-mono">
                {dataInstansi.length} instansi • {dataUnor.length} unit • Pegawai dimuat saat detail dibuka
              </div>
            </div>

            {/* Right: Detail */}
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden flex flex-col min-h-[300px]">
              <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-blue-500" /> Detail Instansi, Pegawai &amp; Unit Kerja
                </span>
                {selectedNode && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[160px]">{selectedNode.displayNama}</span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-white dark:bg-slate-900"
                style={{ maxHeight: typeof window !== 'undefined' && window.innerWidth < 1024 ? 520 : 580 }}>
                {selectedNode ? (
                  <DetailPanel node={selectedNode} />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500 py-10">
                    <Building2 className="w-10 h-10 opacity-20" />
                    <p className="text-sm font-medium text-center">Pilih instansi dari pohon instansi</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
