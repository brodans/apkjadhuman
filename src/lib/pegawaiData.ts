type PegawaiRecord = Record<string, any>;

let databasePromise: Promise<PegawaiRecord[]> | null = null;
let searchListPromise: Promise<ReturnType<typeof toPegawaiSearchList>> | null = null;

const RETRY_DELAYS_MS = [500, 1500, 4000, 10000, 30000];

export function loadPegawaiDatabase(): Promise<PegawaiRecord[]> {
  if (!databasePromise) {
    databasePromise = (async () => {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        let dataPegawai: PegawaiRecord[];
        try {
          ({ dataPegawai } = await import('../data/data_pegawai'));
        } catch (error) {
          if (attempt === RETRY_DELAYS_MS.length) {
            console.error('[pegawaiData] Data pegawai gagal dimuat setelah percobaan ulang.', error);
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
          continue;
        }

        if (!Array.isArray(dataPegawai) || dataPegawai.length === 0) {
          throw new Error('Database pegawai kosong atau tidak valid.');
        }
        return dataPegawai;
      }

      throw new Error('Database pegawai tidak dapat dimuat.');
    })()
      .catch(error => {
        databasePromise = null;
        throw error;
      });
  }
  return databasePromise;
}

export function toPegawaiSearchList(records: PegawaiRecord[]) {
  return records
    .map(item => ({
      id: item?.id || item?.id_pegawai || '',
      nip: item?.nip || '',
      nama: item?.nama || '',
      nama_instansi: item?.nama_instansi || item?.unor || item?.nama_unit_kerja || '',
      kode_unor: item?.kode_unor || item?.unor || '',
    }))
    .filter(item => item.id && item.nama);
}

export async function loadPegawaiSearchList() {
  if (!searchListPromise) {
    searchListPromise = loadPegawaiDatabase()
      .then(records => {
        const list = toPegawaiSearchList(records);
        if (list.length === 0) {
          throw new Error('Daftar pencarian pegawai kosong atau tidak valid.');
        }
        return list;
      })
      .catch(error => {
        searchListPromise = null;
        throw error;
      });
  }
  return searchListPromise;
}