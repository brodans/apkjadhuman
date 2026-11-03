import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { decryptPayload } from './encryption';

export interface ServerLoginSettings {
  username: string;
  password: string;
  versi?: string;
  idPegawai?: string;
  deviceId?: string;
  latitude?: string;
  longitude?: string;
  idLokasi?: string;
  kodeInstansi?: string;
  kodeUnor?: string;
}

export function getServerLoginSettingsDocumentId(jadhumanUsername: string): string {
  const username = jadhumanUsername.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  if (!username) throw new Error('Username akun Jadhuman tidak valid.');
  return `login_${username}`;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

export async function fetchServerLoginSettings(
  jadhumanUsername: string,
): Promise<ServerLoginSettings | null> {
  const snapshot = await getDoc(doc(
    db,
    'settings',
    getServerLoginSettingsDocumentId(jadhumanUsername),
  ));
  if (!snapshot.exists()) return null;

  const raw = snapshot.data();
  const settings = typeof raw.encrypted === 'string'
    ? decryptPayload(raw.encrypted)
    : raw;
  if (
    typeof settings.username !== 'string'
    || !settings.username
    || typeof settings.password !== 'string'
    || !settings.password
  ) {
    return null;
  }

  return {
    username: settings.username,
    password: settings.password,
    versi: asOptionalString(settings.versi),
    idPegawai: asOptionalString(settings.idPegawai),
    deviceId: asOptionalString(settings.deviceId),
    latitude: asOptionalString(settings.latitude),
    longitude: asOptionalString(settings.longitude),
    idLokasi: asOptionalString(settings.idLokasi),
    kodeInstansi: asOptionalString(settings.kodeInstansi),
    kodeUnor: asOptionalString(settings.kodeUnor),
  };
}
