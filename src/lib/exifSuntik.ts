// ─────────────────────────────────────────────────────────────────────────────
// Suntik EXIF — pengaturan terpusat (disimpan di appStorage / IndexedDB).
// Dipakai oleh: Preset Automasi, Presensi, Produktivitas Harian.
//
// Pengguna mengatur Make / Model / Software di:
//   Pengaturan Jadhuman → tab Pengaturan → kartu "Suntik EXIF"
// (di bawah toggle Mode Developer). Tiap fitur punya konfigurasi sendiri.
// ─────────────────────────────────────────────────────────────────────────────

import { appStorage } from './appStorage';
import {
  findExifApp1, patchExifDimensions, normalizeOrientation, stripExifThumbnail,
  dataUrlToBytes, bytesToDataUrl, insertExifApp1,
} from './exif';

export interface ExifSuntikConfig {
  aktif: boolean;
  make: string;
  model: string;
  software: string;
}

export const EXIF_SUNTIK_DEFAULT: ExifSuntikConfig = {
  aktif: false,
  make: 'samsung',
  model: 'SM-A546E',
  software: 'A546EXXU6CYA1',
};

export type ExifSuntikTarget = 'preset' | 'presensi' | 'produktivitas';

export const EXIF_SUNTIK_LABEL: Record<ExifSuntikTarget, { judul: string; deskripsi: string }> = {
  preset: {
    judul: 'Preset Automasi',
    deskripsi: 'Foto stock presensi terjadwal otomatis',
  },
  presensi: {
    judul: 'Presensi',
    deskripsi: 'Foto lampiran absen masuk / pulang',
  },
  produktivitas: {
    judul: 'Produktivitas Harian',
    deskripsi: 'Foto lampiran aktivitas produktivitas',
  },
};

const storageKey = (target: ExifSuntikTarget) => `exif_suntik_${target}`;

function sanitizeConfig(raw: unknown): ExifSuntikConfig {
  if (!raw || typeof raw !== 'object') return { ...EXIF_SUNTIK_DEFAULT };
  const p = raw as Partial<Record<keyof ExifSuntikConfig, unknown>>;
  const str = (v: unknown, fallback: string) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : fallback;
  return {
    aktif: !!p.aktif,
    make: str(p.make, EXIF_SUNTIK_DEFAULT.make),
    model: str(p.model, EXIF_SUNTIK_DEFAULT.model),
    software: str(p.software, EXIF_SUNTIK_DEFAULT.software),
  };
}

/** Baca konfigurasi suntik EXIF untuk satu fitur (sinkron — dari cache appStorage). */
export function getExifSuntik(target: ExifSuntikTarget): ExifSuntikConfig {
  try {
    const raw = appStorage.getItem(storageKey(target));
    if (!raw) return { ...EXIF_SUNTIK_DEFAULT };
    return sanitizeConfig(JSON.parse(raw));
  } catch {
    return { ...EXIF_SUNTIK_DEFAULT };
  }
}

/** Simpan konfigurasi suntik EXIF untuk satu fitur. */
export function setExifSuntik(target: ExifSuntikTarget, cfg: ExifSuntikConfig): void {
  try {
    appStorage.setItem(storageKey(target), JSON.stringify(sanitizeConfig(cfg)));
  } catch {
    // abaikan — konfigurasi tidak krusial
  }
}

// ─── Builder segmen APP1/Exif sintetis (meniru EXIF kamera sungguhan) ──────────
export function buildExifSuntik(make: string, model: string, sw: string, w: number, h: number): Uint8Array {
  const enc = (s: string) => { const b = new Uint8Array(s.length + 1); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };
  const mb = enc(make), mdb = enc(model), sb = enc(sw);
  const N = 7, i0 = 8, iSz = 2 + N * 12 + 4, dO = i0 + iSz;
  const mO = dO, mdO = mO + mb.length, sO = mdO + mdb.length;
  const tiff = new Uint8Array(i0 + iSz + mb.length + mdb.length + sb.length);
  const dv = new DataView(tiff.buffer), le = true;
  tiff[0] = 0x49; tiff[1] = 0x49; dv.setUint16(2, 42, le); dv.setUint32(4, i0, le);
  let o = i0; dv.setUint16(o, N, le); o += 2;
  const e = (t: number, ty: number, c: number, v: number) => { dv.setUint16(o, t, le); dv.setUint16(o + 2, ty, le); dv.setUint32(o + 4, c, le); dv.setUint32(o + 8, v, le); o += 12; };
  e(0x0100, 3, 1, w); e(0x0101, 3, 1, h); e(0x0112, 3, 1, 1);
  e(0x010f, 2, mb.length, mO); e(0x0110, 2, mdb.length, mdO); e(0x0131, 2, sb.length, sO); e(0x8769, 4, 1, 0);
  dv.setUint32(o, 0, le); tiff.set(mb, mO); tiff.set(mdb, mdO); tiff.set(sb, sO);
  const pl = new Uint8Array(6 + tiff.length); pl[0] = 0x45; pl[1] = 0x78; pl[2] = 0x69; pl[3] = 0x66; pl.set(tiff, 6);
  const sl = 2 + pl.length, seg = new Uint8Array(2 + sl);
  seg[0] = 0xff; seg[1] = 0xe1; seg[2] = (sl >> 8) & 0xff; seg[3] = sl & 0xff; seg.set(pl, 4);
  return seg;
}

/** Sisipkan EXIF sintetis Make/Model/Software ke dalam JPEG (dataUrl). */
export function injectSyntheticExif(jpegDataUrl: string, cfg: ExifSuntikConfig, w: number, h: number): string {
  return bytesToDataUrl(
    insertExifApp1(
      dataUrlToBytes(jpegDataUrl),
      buildExifSuntik(cfg.make || EXIF_SUNTIK_DEFAULT.make, cfg.model || EXIF_SUNTIK_DEFAULT.model, cfg.software || EXIF_SUNTIK_DEFAULT.software, w, h),
    ),
    'image/jpeg',
  );
}

export interface ApplyExifFinalOptions {
  /** Byte lengkap file asli — hanya dicek bila file adalah JPEG (EXIF passthrough). */
  sourceBytes?: Uint8Array | null;
  /** Konfigurasi suntik untuk fitur ini — dipakai bila sumber TIDAK punya EXIF. */
  inject?: ExifSuntikConfig | null;
  /** Lepas thumbnail IFD1 (meniru lampiran aktivitas APK asli). */
  stripThumbnail?: boolean;
  width: number;
  height: number;
}

/**
 * Terapkan EXIF pada JPEG hasil encode:
 *   1) Bila bytes sumber JPEG dan punya EXIF → passthrough (orientasi
 *      dinormalisasi, dimensi diperbarui, thumbnail opsional dilepas).
 *   2) Bila tidak & suntik aktif → suntik EXIF sintetis make/model/software.
 * Mengembalikan dataUrl akhir (selalu JPEG).
 */
export function applyExifFinal(jpegDataUrl: string, opts: ApplyExifFinalOptions): string {
  const { sourceBytes, inject, stripThumbnail = false, width, height } = opts;
  if (sourceBytes) {
    const ori = findExifApp1(sourceBytes);
    if (ori) {
      try {
        const s = ori.slice();
        normalizeOrientation(s);
        if (stripThumbnail) stripExifThumbnail(s);
        patchExifDimensions(s, width, height);
        return bytesToDataUrl(insertExifApp1(dataUrlToBytes(jpegDataUrl), s), 'image/jpeg');
      } catch {
        // EXIF sumber rusak — jatuh ke suntik bila aktif
      }
    }
  }
  if (inject?.aktif) {
    try {
      return injectSyntheticExif(jpegDataUrl, inject, width, height);
    } catch {
      // abaikan — kembalikan JPEG apa adanya
    }
  }
  return jpegDataUrl;
}
