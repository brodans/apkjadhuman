// ─────────────────────────────────────────────────────────────────────────────
// Universal image decode — SATU jalur decode untuk semua foto di aplikasi
// (Preset Automasi, Presensi, Produktivitas Harian):
//
//   • native browser (JPEG/PNG/WebP/GIF/BMP/ICO/SVG/AVIF) — createImageBitmap
//     atau fallback <img> + blob URL
//   • HEIC/HEIF — dikonversi ke JPEG dulu via heic2any (WASM libheif)
//   • TIFF (dan TIFF-like lain) — UTIF
//
// sniffImageKind memakai magic bytes karena MIME file dari picker HP sering
// kosong / salah. Decode selalu mengembalikan canvas full-resolution;
// pemanggil yang men-resize & encode.
// ─────────────────────────────────────────────────────────────────────────────

export type ImageKind =
  | 'jpeg' | 'png' | 'gif' | 'bmp' | 'webp' | 'svg'
  | 'ico'  | 'avif' | 'heic' | 'tiff' | 'jxl' | 'unknown';

const RAW_IMAGE_EXT_RE = /\.(dng|cr2|nef|arw|orf|rw2)$/i;

export async function sniffImageKind(file: File): Promise<ImageKind> {
  if (RAW_IMAGE_EXT_RE.test(file.name)) return 'unknown';

  try {
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const eq = (sig: number[], off = 0) => sig.every((b, i) => head[off + i] === b);
    if (eq([0xff, 0xd8, 0xff])) return 'jpeg';
    if (eq([0xff, 0x0a])) return 'jxl';                        // JXL codestream
    if (eq([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return 'jxl';  // JXL container
    if (eq([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
    if (eq([0x47, 0x49, 0x46, 0x38])) return 'gif';            // GIF87a / GIF89a
    if (eq([0x42, 0x4d])) return 'bmp';                        // BM…
    if (eq([0x00, 0x00, 0x01, 0x00]) || eq([0x00, 0x00, 0x02, 0x00])) return 'ico';
    if (eq([0x52, 0x49, 0x46, 0x46]) && eq([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';  // RIFF…WEBP
    if (eq([0x49, 0x49, 0x2a, 0x00]) || eq([0x4d, 0x4d, 0x00, 0x2a])
      || eq([0x49, 0x49, 0x2b, 0x00]) || eq([0x4d, 0x4d, 0x00, 0x2b])) return 'tiff';     // TIFF / BigTIFF
    if (eq([0x66, 0x74, 0x79, 0x70], 4)) {                      // ISO-BMFF: ....ftyp<brand>
      const brand = String.fromCharCode(head[8] || 0, head[9] || 0, head[10] || 0, head[11] || 0).trim().toLowerCase();
      return brand.startsWith('avi') ? 'avif' : 'heic';         // avif/avis → avif; heic/heix/mif1/… → HEIC
    }
    const text = String.fromCharCode(...head).toLowerCase();
    if (text.includes('<svg')) return 'svg';
    if (/\.(heic|heif)$/i.test(file.name)) return 'heic';
    if (/\.tiff?$/i.test(file.name)) return 'tiff';
    if (file.type === 'image/avif') return 'avif';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif|avif|svg|ico|jxl)$/i;

/** Apakah file ini kemungkinan besar gambar? (untuk validasi input file) */
export function isProbablyImageFile(file: File): boolean {
  if (RAW_IMAGE_EXT_RE.test(file.name)) return false;
  if (file.type.startsWith('image/')) return true;
  return IMAGE_EXT_RE.test(file.name);
}

export interface DecodedImage {
  canvas: HTMLCanvasElement;
}

// ─── Resize ke maksimum sisi tertentu (aspek dipertahankan) ───────────────────
export function scaleCanvasMaxSide(src: HTMLCanvasElement, maxSide: number): { canvas: HTMLCanvasElement; w: number; h: number } {
  const w = src.width, h = src.height;
  const sc = Math.min(1, maxSide / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * sc));
  const outH = Math.max(1, Math.round(h * sc));
  if (sc >= 1) return { canvas: src, w, h };
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('No canvas ctx');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h, 0, 0, outW, outH);
  return { canvas: out, w: outW, h: outH };
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): string {
  let url = canvas.toDataURL('image/jpeg', quality);
  if (!url || url === 'data:,' || url.length < 100) url = canvas.toDataURL('image/jpeg', 0.8);
  if (!url || url === 'data:,' || url.length < 100) throw new Error('toDataURL gagal (canvas ditolak browser).');
  return url;
}

// ─── Decode cara native browser (JPEG/PNG/WebP/GIF/BMP/ICO/SVG/AVIF/JXL) ──────
async function nativeDecode(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      if (bmp.width > 0 && bmp.height > 0) {
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext('2d');
        if (!ctx) { bmp.close(); throw new Error('No canvas ctx'); }
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        return { canvas: c };
      }
      bmp.close();
    } catch (err) {
      console.warn('[foto] createImageBitmap gagal, coba <img>…', err);
    }
  }
  // Fallback klasik: <img> + blob URL
  const blobUrl = URL.createObjectURL(file);
  try {
    return await new Promise<DecodedImage>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const sw = img.naturalWidth, sh = img.naturalHeight;
          if (!sw || !sh) { reject(new Error('Dimensi gambar 0')); return; }
          const c = document.createElement('canvas');
          c.width = sw; c.height = sh;
          const ctx = c.getContext('2d');
          if (!ctx) { reject(new Error('No canvas ctx')); return; }
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sw, sh);
          ctx.drawImage(img, 0, 0);
          resolve({ canvas: c });
        } catch (ex) { reject(ex); }
      };
      img.onerror = () => reject(new Error('Format gambar ini tidak bisa dibuka browser ini.'));
      img.src = blobUrl;
    });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

// ─── HEIC/HEIF → JPEG via heic2any (libheif WASM) ─────────────────────────────
async function heicDecode(file: File): Promise<DecodedImage> {
  try {
    const heic2any = (await import('heic2any')).default as (o: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>;
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const blob = Array.isArray(out) ? out[0] ?? null : out;
    if (!blob) throw new Error('hasil konversi kosong');
    const converted = new File([blob], 'heic-converted.jpg', { type: 'image/jpeg' });
    return nativeDecode(converted);
  } catch (err: any) {
    console.error('[foto] HEIC konversi gagal', err);
    throw new Error('HEIC/HEIF tidak bisa dikonversi oleh browser.');
  }
}

// ─── TIFF (dan TIFF-like lain) → RGBA via UTIF ────────────────────────────────
async function tiffDecode(file: File): Promise<DecodedImage> {
  const mod: any = await import('utif');
  const UTIF: any = mod.default ?? mod;
  const buffer = await file.arrayBuffer();
  let ifds: any[] | null = null;
  try { ifds = UTIF.decode(buffer); } catch (e) { console.error('[foto] TIFF decode gagal', e); }
  if (!Array.isArray(ifds) || ifds.length === 0) throw new Error('TIFF rusak / tidak terbaca.');
  const ifd = ifds[0];
  try { UTIF.decodeImage(buffer, ifd); }
  catch { throw new Error('Data piksel TIFF tidak bisa didekompresi.'); }
  const rgba: Uint8Array | undefined = UTIF.toRGBA8(ifd);
  const w = ifd.width, h = ifd.height;
  if (!rgba || !w || !h || rgba.length !== w * h * 4) {
    throw new Error('TIFF/RAW menyimpan data sensor mentah (bukan gambar tampilan). Konversi dulu ke JPG/PNG/TIFF biasa.');
  }
  const raw = document.createElement('canvas');
  raw.width = w; raw.height = h;
  const ctx = raw.getContext('2d');
  if (!ctx) throw new Error('No canvas ctx');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return { canvas: raw };
}

/**
 * Decode gambar universal — coba semua jalur sampai berhasil.
 * Lempar Error dengan pesan ramah jika semua gagal.
 */
export async function decodeImageUniversal(file: File, kindHint?: ImageKind): Promise<HTMLCanvasElement> {
  const kind = kindHint ?? (await sniffImageKind(file));
  const attempts: Array<() => Promise<DecodedImage>> = [];
  if (kind === 'heic') attempts.push(() => heicDecode(file));
  else if (kind === 'tiff') attempts.push(() => tiffDecode(file));
  else attempts.push(() => nativeDecode(file));
  // Fallback lintas format (magic bytes kadang menyesatkan / peramban beda-beda)
  if (kind !== 'heic') attempts.push(() => heicDecode(file));
  if (kind !== 'tiff') attempts.push(() => tiffDecode(file));
  if (kind === 'heic' || kind === 'tiff') attempts.push(() => nativeDecode(file));

  let firstErr: Error | null = null;
  for (const attempt of attempts) {
    try { return (await attempt()).canvas; } catch (e: any) {
      if (!firstErr) firstErr = e;
    }
  }
  const desk = firstErr?.message ? ` (${firstErr.message})` : '';
  throw new Error(`Gambar tidak bisa dibuka${desk} — konversi dulu ke JPG/PNG.`);
}
