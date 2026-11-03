import { dataBiodata, type BiodataRecord, type PasanganRecord, type AnakRecord } from './data_biodata';

// -----------------------------------------------------------------------
// Biodata helpers — data lengkap per pegawai (NIK, TTL, agama, alamat, dll)
// -----------------------------------------------------------------------

/**
 * Ambil biodata lengkap berdasarkan NIP.
 * @example
 *   const bio = getBiodataByNip('196804131988091002');
 *   bio?.nik  // "3502140511030002"
 *   bio?.ttl  // "KABUPATEN PONOROGO, 05 November 2003"
 */
export const getBiodataByNip = (nip: string): BiodataRecord | null => {
  return dataBiodata[nip] ?? null;
};

export type { BiodataRecord, PasanganRecord, AnakRecord };
