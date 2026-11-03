// ─────────────────────────────────────────────────────────────────────────────
// EXIF passthrough + orientasi — agar hasil web identik dengan APK asli.
//
// APK asli TIDAK membuang metadata:
//   • Presensi  : meng-upload JPEG kamera apa adanya (seluruh EXIF + thumbnail).
//   • Aktivitas : me-re-encode kualitas 50 lalu mempertahankan EXIF sumber.
// Browser menghapus EXIF setiap kali kanvas menulis ulang gambar, jadi di sini
// segmen APP1/Exif milik file sumber disalin kembali (byte-per-byte) ke hasil
// kanvas, dengan hanya dimensi piksel yang diperbarui.
//
// Selain itu browser otomatis memutar piksel sesuai tag Orientation. APK asli
// menyimpan piksel MENTAH (sesuai sensor) + tag Orientation. Agar EXIF tetap
// sama persis, piksel dikembalikan ke orientasi mentah sebelum di-encode.
// ─────────────────────────────────────────────────────────────────────────────

/** Byte awal penanda payload Exif di dalam segmen APP1. */
const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

/** iOS Safari handles camera-photo EXIF more consistently through HTMLImageElement. */
export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
}

/** Posisi segmen APP1/Exif pertama pada sebuah JPEG (indeks awal & akhir). */
export function findExifApp1Range(bytes: Uint8Array): { start: number; end: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Marker tanpa panjang.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // SOS / EOI — berhenti.

    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) break;

    if (marker === 0xe1) {
      let isExif = true;
      for (let k = 0; k < EXIF_PREFIX.length; k++) {
        if (bytes[i + 4 + k] !== EXIF_PREFIX[k]) {
          isExif = false;
          break;
        }
      }
      if (isExif) return { start: i, end: i + 2 + length };
    }
    i += 2 + length;
  }
  return null;
}

/** Salinan segmen APP1/Exif pertama pada sebuah JPEG (atau null). */
export function findExifApp1(bytes: Uint8Array): Uint8Array | null {
  const range = findExifApp1Range(bytes);
  return range ? bytes.slice(range.start, range.end) : null;
}

interface TiffView {
  dv: DataView;
  le: boolean;
  tiffStart: number;
  ifd0: number;
}

/** Baca header TIFF di dalam payload Exif. */
function readTiff(segment: Uint8Array): TiffView | null {
  // 2 (marker) + 2 (panjang) + 6 ("Exif\0\0") = 10.
  const tiffStart = 10;
  if (segment.length < tiffStart + 8) return null;

  const b0 = segment[tiffStart];
  const b1 = segment[tiffStart + 1];
  let le: boolean;
  if (b0 === 0x49 && b1 === 0x49) le = true;
  else if (b0 === 0x4d && b1 === 0x4d) le = false;
  else return null;

  const dv = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
  if (dv.getUint16(tiffStart + 2, le) !== 0x2a) return null;

  const ifd0 = tiffStart + dv.getUint32(tiffStart + 4, le);
  if (ifd0 + 2 > segment.length) return null;
  return { dv, le, tiffStart, ifd0 };
}

type EntryCallback = (entryOffset: number, tag: number, type: number, count: number) => void;

function forEachEntry(view: TiffView, ifdOffset: number, cb: EntryCallback): void {
  const { dv, le } = view;
  if (ifdOffset <= 0 || ifdOffset + 2 > dv.byteLength) return;
  const count = dv.getUint16(ifdOffset, le);
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > dv.byteLength) break;
    cb(entry, dv.getUint16(entry, le), dv.getUint16(entry + 2, le), dv.getUint32(entry + 4, le));
  }
}

function findIfdOffset(view: TiffView, pointerTag: number): number {
  let result = 0;
  forEachEntry(view, view.ifd0, (entry, tag) => {
    if (tag === pointerTag) {
      result = view.tiffStart + view.dv.getUint32(entry + 8, view.le);
    }
  });
  return result;
}

function setOrientation(segment: Uint8Array, orientation: number): void {
  const view = readTiff(segment);
  if (!view) return;
  forEachEntry(view, view.ifd0, (entry, tag, type, count) => {
    if (tag === 0x0112 && type === 3 && count >= 1) {
      view.dv.setUint16(entry + 8, orientation, view.le);
    }
  });
}

function writeDimension(view: TiffView, ifdOffset: number, tag: number, value: number): void {
  if (ifdOffset <= 0) return;
  forEachEntry(view, ifdOffset, (entry, entryTag, type, count) => {
    if (entryTag !== tag || count !== 1) return;
    if (type === 3) {
      // SHORT (nilai inline di 2 byte pertama).
      if (value <= 0xffff) view.dv.setUint16(entry + 8, value, view.le);
    } else if (type === 4 || type === 9) {
      // LONG / SLONG.
      view.dv.setUint32(entry + 8, value, view.le);
    }
  });
}

/**
 * Perbarui tag dimensi gambar (ImageWidth/Length & ExifImageWidth/Height) agar
 * cocok dengan ukuran piksel hasil. Tidak mengubah struktur/panjang segmen.
 */
export function patchExifDimensions(segment: Uint8Array, width: number, height: number): void {
  const view = readTiff(segment);
  if (!view) return;

  writeDimension(view, view.ifd0, 0x0100, width); // ImageWidth
  writeDimension(view, view.ifd0, 0x0101, height); // ImageLength
  writeDimension(view, view.ifd0, 0xa002, width); // fallback non-standar
  writeDimension(view, view.ifd0, 0xa003, height);

  const exifIfd = findIfdOffset(view, 0x8769);
  if (exifIfd > 0) {
    writeDimension(view, exifIfd, 0xa002, width); // ExifImageWidth
    writeDimension(view, exifIfd, 0xa003, height); // ExifImageHeight
  }
}

/** Setel Orientation agar konsisten dengan piksel yang sudah diputar browser. */
export function normalizeOrientation(segment: Uint8Array): void {
  setOrientation(segment, 1);
}

/**
 * Lepas thumbnail (IFD1) dengan mengosongkan penunjuk IFD berikutnya pada IFD0.
 * APK asli menyimpan lampiran aktivitas tanpa thumbnail, sedangkan presensi
 * (upload kamera apa adanya) tetap menyimpannya.
 */
export function stripExifThumbnail(segment: Uint8Array): void {
  const view = readTiff(segment);
  if (!view) return;
  const { dv, le, ifd0 } = view;
  if (ifd0 + 2 > dv.byteLength) return;
  const count = dv.getUint16(ifd0, le);
  const nextPointer = ifd0 + 2 + count * 12;
  if (nextPointer + 4 <= dv.byteLength) dv.setUint32(nextPointer, 0, le);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitas data URL ↔ byte
// ─────────────────────────────────────────────────────────────────────────────

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const binary = atob(dataUrl.slice(comma + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToDataUrl(bytes: Uint8Array, mime = 'image/jpeg'): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    let part = '';
    for (let j = 0; j < slice.length; j++) part += String.fromCharCode(slice[j]);
    binary += part;
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Sisipkan segmen APP1/Exif tepat setelah SOI, membuang Exif lama bila ada. */
export function insertExifApp1(jpeg: Uint8Array, app1: Uint8Array): Uint8Array {
  const existing = findExifApp1Range(jpeg);
  let base = jpeg;
  if (existing) {
    base = new Uint8Array(jpeg.length - (existing.end - existing.start));
    base.set(jpeg.subarray(0, existing.start), 0);
    base.set(jpeg.subarray(existing.end), existing.start);
  }

  const result = new Uint8Array(base.length + app1.length);
  result.set(base.subarray(0, 2), 0); // SOI (0xFF 0xD8)
  result.set(app1, 2);
  result.set(base.subarray(2), 2 + app1.length);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orientasi piksel (kanvas)
// ─────────────────────────────────────────────────────────────────────────────

/** Perkecil (progresif, maks 50% per langkah) ke ukuran tepat targetW × targetH. */
export function downscaleTo(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
): HTMLCanvasElement {
  let current: CanvasImageSource = source;
  let curW = srcW;
  let curH = srcH;

  while (curW > targetW * 1.5 || curH > targetH * 1.5) {
    const nextW = Math.max(Math.round(curW * 0.5), targetW);
    const nextH = Math.max(Math.round(curH * 0.5), targetH);
    const step = document.createElement('canvas');
    step.width = nextW;
    step.height = nextH;
    const ctx = step.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(current, 0, 0, curW, curH, 0, 0, nextW, nextH);
    }
    current = step;
    curW = nextW;
    curH = nextH;
  }

  const final = document.createElement('canvas');
  final.width = targetW;
  final.height = targetH;
  const ctx = final.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, curW, curH, 0, 0, targetW, targetH);
  }
  return final;
}
