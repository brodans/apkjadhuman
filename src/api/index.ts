import { invoke } from '@tauri-apps/api/core';

export interface ApiTrafficEntry {
  id: number;
  endpoint: string;
  payload: Record<string, any>;
  response?: any;
  error?: string;
  status?: number;
  duration: number;
  timestamp: string;
}

type ApiTrafficListener = (entry: ApiTrafficEntry) => void;
const trafficListeners = new Set<ApiTrafficListener>();
let trafficSequence = 0;

export const subscribeToApiTraffic = (listener: ApiTrafficListener) => {
  trafficListeners.add(listener);
  return () => trafficListeners.delete(listener);
};

const publishApiTraffic = (entry: Omit<ApiTrafficEntry, 'id'>) => {
  const completeEntry = { ...entry, id: ++trafficSequence };
  trafficListeners.forEach(listener => listener(completeEntry));
};

export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
};

const ABSENSI_DIRECT_BASE = "http://103.109.206.102:8089/Ponorogo-absensApi/index.php";

/**
 * Kirim request POST ke server presensi.
 * Jika berjalan di dalam Tauri (APK / AppImage), menggunakan Rust HTTP client native
 * sehingga 100% bebas hambatan CORS browser dan tanpa server proxy luar sama sekali.
 */
export const sendRequest = async (
  endpoint: string,
  payload: Record<string, any>,
  options: { signal?: AbortSignal } = {}
): Promise<any> => {
  const startedAt = performance.now();
  const requestTimestamp = new Date().toISOString();

  // 1. Jalur Utama Tauri Native (Rust HTTP Client)
  if (isTauri()) {
    try {
      const data: any = await invoke('absensi_proxy', { endpoint, payload });
      publishApiTraffic({
        endpoint,
        payload,
        response: data,
        status: 200,
        duration: Math.round(performance.now() - startedAt),
        timestamp: requestTimestamp
      });
      return data;
    } catch (rustErr: any) {
      const message = typeof rustErr === 'string' ? rustErr : (rustErr?.message || 'Error Rust HTTP');
      publishApiTraffic({
        endpoint,
        payload,
        error: message,
        status: 500,
        duration: Math.round(performance.now() - startedAt),
        timestamp: requestTimestamp
      });
      throw new Error(message);
    }
  }

  // 2. Jalur Dev / Web Server (/api/proxy)
  try {
    const res = await fetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, payload }),
      signal: options.signal,
    });

    const responseText = await res.text();
    if (res.ok) {
      const data = JSON.parse(responseText);
      publishApiTraffic({
        endpoint,
        payload,
        response: data,
        status: res.status,
        duration: Math.round(performance.now() - startedAt),
        timestamp: requestTimestamp
      });
      return data;
    }
  } catch (_) {
    // Abaikan jika dev server tidak tersedia, lanjut ke fallback direct
  }

  // 3. Fallback Direct (persis seperti jathilan-panel/index.html)
  try {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const directUrl = `${ABSENSI_DIRECT_BASE}${cleanEndpoint}`;
    const bodyParams = new URLSearchParams();
    for (const k in payload) {
      if (payload[k] !== undefined && payload[k] !== null) {
        bodyParams.append(k, String(payload[k]));
      }
    }

    const res = await fetch(directUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json, text/plain, */*",
      },
      body: bodyParams.toString(),
      signal: options.signal,
    });

    const text = await res.text();
    const data = JSON.parse(text);
    publishApiTraffic({
      endpoint,
      payload,
      response: data,
      status: res.status,
      duration: Math.round(performance.now() - startedAt),
      timestamp: requestTimestamp
    });
    return data;
  } catch (err: any) {
    const message = `Koneksi gagal: ${err.message}`;
    publishApiTraffic({
      endpoint,
      payload,
      error: message,
      duration: Math.round(performance.now() - startedAt),
      timestamp: requestTimestamp
    });
    throw new Error(message);
  }
};

/**
 * Kirim request multipart/form-data (misal pengajuan izin dengan lampiran file)
 */
export const sendMultipart = async (
  endpoint: string,
  fields: Record<string, string>,
  file?: { filename: string; base64: string; mimeType: string }
): Promise<any> => {
  if (isTauri()) {
    const filePayload = file ? {
      filename: file.filename,
      base64: file.base64,
      mime_type: file.mimeType
    } : null;
    return await invoke('absensi_multipart', { endpoint, fields, file: filePayload });
  }

  // Web / Dev Server
  try {
    const res = await fetch('/api/proxy-multipart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, fields, file })
    });
    return await res.json();
  } catch {
    // Direct multipart fallback
    const form = new FormData();
    for (const k in fields) {
      form.append(k, fields[k]);
    }
    if (file && file.base64) {
      const bytes = atob(file.base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: file.mimeType || 'application/octet-stream' });
      form.append('lampiran', blob, file.filename || 'lampiran.jpg');
    }
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const directUrl = `${ABSENSI_DIRECT_BASE}${cleanEndpoint}`;
    const res = await fetch(directUrl, { method: 'POST', body: form });
    return await res.json();
  }
};

/**
 * Fetch log presensi per instansi
 */
export const fetchAbsensiLog = async (queryParams: URLSearchParams): Promise<any> => {
  if (isTauri()) {
    const unor = queryParams.get('unor') || 'null';
    const start = queryParams.get('dateStart') || queryParams.get('start') || '';
    const end = queryParams.get('dateEnd') || queryParams.get('end') || '';
    const nama = queryParams.get('nama') || 'null';
    const nip = queryParams.get('nip') || 'null';
    const page = parseInt(queryParams.get('page') || '0', 10);
    const size = parseInt(queryParams.get('size') || '25', 10);

    return await invoke('absensi_log_proxy', { unor, start, end, nama, nip, page, size });
  }

  // Web / dev server fallback
  const res = await fetch(`/api/absensi-log-proxy?${queryParams.toString()}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return await res.json();
};

/**
 * Download laporan PDF / XLS
 */
export const fetchReport = async (pathQuery: string): Promise<string> => {
  if (isTauri()) {
    const params = new URLSearchParams(pathQuery);
    return await invoke('absensi_report_proxy', {
      reportType: params.get('reportType') || '',
      idp: params.get('idp') || '',
      idu: params.get('idu') || '',
      t1: params.get('t1') || '',
      t2: params.get('t2') || '',
      status: params.get('status') || '',
      format: params.get('format') || 'pdf',
    });
  }
  return `/api/report-pdf?${pathQuery}`;
};

