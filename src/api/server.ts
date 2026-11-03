import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import https from "https";
import { URL as NodeURL } from "url";

// IP/base URL server absensi — bisa di-override lewat env variable
const ABSENSI_BASE_HOST = process.env.ABSENSI_BASE_HOST || '103.109.206.102';
const ABSENSI_API_URL   = `http://${ABSENSI_BASE_HOST}:8089/Ponorogo-absensApi/index.php`;
const ABSENSI_IMG_URL   = `http://${ABSENSI_BASE_HOST}:8087`;
// IP server untuk endpoint HTTPS presensi.ponorogo.go.id (bypass Cloudflare)
const PRESENSI_DIRECT_IP = process.env.PRESENSI_DIRECT_IP || '103.109.206.102';

// Regex: tanggal YYYY-MM-DD
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Melakukan HTTPS GET langsung ke IP server (bypass Cloudflare/DNS),
 * dengan menyertakan Host header agar virtual host routing tetap benar.
 * rejectUnauthorized: false hanya berlaku untuk koneksi ini saja, tidak global.
 */
function httpsGetDirect(
  urlStr: string,
  customHeaders: Record<string, string>,
  timeoutMs = 25000
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new NodeURL(urlStr);
      const options: https.RequestOptions = {
        hostname: PRESENSI_DIRECT_IP,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          ...customHeaders,
          'Host': parsed.hostname, // pastikan virtual host terbaca benar
        },
        rejectUnauthorized: false, // scoped: hanya untuk koneksi ini
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode || 500, body: data }));
      });

      req.on('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout ${timeoutMs}ms`)));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // CORS — hanya izinkan origin yang terdaftar
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  app.use(cors({
    origin: (origin, callback) => {
      // Izinkan requests tanpa origin (server-to-server, curl, Electron, dll)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin "${origin}" tidak diizinkan`));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
    "Dart/3.0 (dart:io)"
  ];

  function getObfuscatedHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    
    const headers: Record<string, string> = {
      "User-Agent": randomUserAgent,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache"
    };

    for (const [key, value] of Object.entries(customHeaders)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === 'x-forwarded-for' || 
        lowerKey === 'x-real-ip' || 
        lowerKey === 'client-ip' || 
        lowerKey === 'referer' || 
        lowerKey === 'origin' ||
        lowerKey === 'host'
      ) {
        continue;
      }
      headers[key] = value;
    }

    return headers;
  }

  async function fetchWithRetryAndTimeout(
    url: string,
    options: RequestInit = {},
    retries = 2,
    timeoutMs = 30000
  ): Promise<Response> {
    // Obfuscate outgoing headers to protect client IP and device identity
    const incomingHeaders = (options.headers || {}) as Record<string, string>;
    const obfuscated = getObfuscatedHeaders(incomingHeaders);
    const cleanOptions = {
      ...options,
      headers: obfuscated
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          ...cleanOptions,
          signal: controller.signal
        });
        clearTimeout(id);
        return response;
      } catch (err: any) {
        clearTimeout(id);
        const isTimeout = err.name === 'AbortError';
        
        if (attempt === retries) {
          if (isTimeout) {
            throw new Error(`Timeout ${timeoutMs}ms saat menghubungi server pusat. Silakan coba lagi.`);
          }
          throw err;
        }
        console.warn(`Percobaan proxy ke-${attempt} gagal. Mencoba kembali... (${err.message})`);
        await new Promise(resolve => setTimeout(resolve, attempt * 800));
      }
    }
    throw new Error("Gagal menghubungi server tujuan.");
  }

  app.post("/api/proxy", async (req, res) => {
    try {
      const { endpoint, payload } = req.body;
      const url = `${ABSENSI_API_URL}${endpoint}`;
      
      const params = new URLSearchParams();
      if (payload) {
        for (const key in payload) {
          if (payload[key] !== undefined && payload[key] !== null) {
            params.append(key, payload[key]);
          }
        }
      }

      const response = await fetchWithRetryAndTimeout(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Dart/3.0 (dart:io)",
          "Accept": "application/json",
          "Authorization": "Bearer null"
        },
        body: params.toString(),
      }, 2, 25000);

      const data = await response.text();
      try {
        const jsonData = JSON.parse(data);
        res.json(jsonData);
      } catch (e) {
        res.status(500).json({ error: "Gagal memproses JSON dari server pusat", text: data });
      }
    } catch (err: any) {
      console.error("Proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Endpoint proxy multipart/form-data untuk pengajuan izin dengan lampiran ──
  // Menerima: endpoint (string), fields (JSON object), file (base64 + metadata)
  // Meneruskan ke ABSENSI_API_URL sebagai multipart/form-data (native Node.js 18+)
  app.post("/api/proxy-multipart", express.json({ limit: '20mb' }), async (req, res) => {
    try {
      const { endpoint, fields, file } = req.body;

      if (!endpoint || typeof endpoint !== 'string') {
        return res.status(400).json({ error: 'endpoint wajib diisi.' });
      }

      const url = `${ABSENSI_API_URL}${endpoint}`;
      const form = new FormData();

      // Tambahkan semua field teks
      if (fields && typeof fields === 'object') {
        for (const [key, value] of Object.entries(fields)) {
          if (value !== undefined && value !== null) {
            form.append(key, String(value));
          }
        }
      }

      // Tambahkan file jika ada (base64 encoded dari frontend)
      if (file && file.base64 && file.filename) {
        const buffer = Buffer.from(file.base64, 'base64');
        const blob = new Blob([buffer], { type: file.mimeType || 'application/octet-stream' });
        form.append('lampiran', blob, file.filename);
      }

      const response = await fetchWithRetryAndTimeout(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'Dart/3.0 (dart:io)',
          'Accept': 'application/json',
          'Authorization': 'Bearer null',
        },
        body: form as unknown as BodyInit,
      }, 2, 30000);

      const data = await response.text();
      try {
        const jsonData = JSON.parse(data);
        res.json(jsonData);
      } catch {
        res.status(500).json({ error: 'Gagal memproses JSON dari server pusat', text: data });
      }
    } catch (err: any) {
      console.error('Proxy multipart error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/absensi-log-proxy", async (req, res) => {
    try {
      const { unor, dateStart, dateEnd, page, size, nama, nip } = req.query;

      // Validasi format tanggal
      const start = String(dateStart || '').trim();
      const end   = String(dateEnd   || '').trim();
      if (start && !DATE_RE.test(start)) return res.status(400).json({ error: 'Format dateStart tidak valid (YYYY-MM-DD).' });
      if (end   && !DATE_RE.test(end))   return res.status(400).json({ error: 'Format dateEnd tidak valid (YYYY-MM-DD).' });

      const finalStart = start || new Date().toISOString().split('T')[0];
      const finalEnd   = end   || new Date().toISOString().split('T')[0];

      const requestedPage = Math.max(1, parseInt(String(page || '1'), 10));
      const s = Math.min(100, Math.max(1, parseInt(String(size || '10'), 10)));

      // Strip karakter berbahaya dari string filter
      const stripDanger = (v: unknown) => String(v || '').replace(/[^a-zA-Z0-9 ._\-]/g, '').trim();

      const unorVal = unor && String(unor).trim() !== '' ? stripDanger(unor) : 'null';
      const namaVal = nama ? encodeURIComponent(stripDanger(nama)) : 'null';
      const nipVal  = nip  ? encodeURIComponent(stripDanger(nip))  : 'null';

      if (unorVal === 'null' && namaVal === 'null' && nipVal === 'null') {
        return res.status(400).json({ error: 'Pilih instansi atau masukkan nama/NIP untuk melakukan pencarian.' });
      }

      const targetUrl = `https://presensi.ponorogo.go.id/api/absensi-log/unor/${unorVal}/${finalStart}/${finalEnd}/${namaVal}/${nipVal}?page.page=${requestedPage}&page.size=${s}&page=${requestedPage}&size=${s}`;
      
      console.log("Proxying absensi log request to:", targetUrl);
      
      const response = await httpsGetDirect(targetUrl, {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://presensi.ponorogo.go.id/",
        "Origin": "https://presensi.ponorogo.go.id",
        "Cache-Control": "no-cache",
      }, 25000);

      if (response.status !== 200) {
        console.error(`[absensi-log-proxy] Upstream returned HTTP ${response.status}:`, response.body.substring(0, 300));
        return res.status(response.status).json({
          error: `Server pusat mengembalikan HTTP ${response.status}`,
          detail: response.body.substring(0, 500)
        });
      }

      try {
        const jsonData = JSON.parse(response.body);
        res.json(jsonData);
      } catch (e) {
        console.error("[absensi-log-proxy] Failed to parse JSON:", response.body.substring(0, 300));
        res.status(500).json({ error: "Gagal memproses JSON dari server absensi log", text: response.body.substring(0, 500) });
      }
    } catch (err: any) {
      console.error("Proxy absensi-log error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/report-pdf", async (req, res) => {
    try {
      const { reportType, idp, idu, t1, t2, status, format } = req.query;
      
      const fileExt = format === 'xls' ? 'xls' : 'pdf';
      
      let targetUrl = '';
      if (reportType === 'per-pegawai') {
        targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/sby/per-pegawai.${fileExt}?idp=${idp}&t1=${t1}&t2=${t2}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
      } else if (reportType === 'per-pegawai-aktivitas') {
        targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/prg/per-pegawai-aktivitas.${fileExt}?idp=${idp}&t1=${t1}&t2=${t2}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
      } else if (reportType === 'rekap-instansi') {
        targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/sby/rekap-instansi.${fileExt}?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'all'}`;
      } else if (reportType === 'skor-per-instansi') {
        if (fileExt === 'xls') {
          targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/sby/skor-per-instansi2026-new.xls?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}`;
        } else {
          targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/sby/skor-per-instansi2026-new.pdf?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
        }
      } else if (reportType === 'aktivitas-per-instansi') {
        if (fileExt === 'xls') {
          targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/prg/aktivitas-per-instansi2026-new.xls?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}`;
        } else {
          targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/prg/aktivitas-per-instansi2026-new.pdf?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
        }
      } else if (reportType === 'rekap-tpp-aktivitas') {
        if (fileExt === 'xls') {
          targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/prg/rekap-tpp-aktivitas2026-new.xls?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}`;
        } else {
          targetUrl = `https://presensi.ponorogo.go.id/api/report/absensi/prg/rekap-tpp-aktivitas2026-new.pdf?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
        }
      } else {
        return res.status(400).json({ error: "reportType tidak valid atau tidak didukung" });
      }

      console.log(`Proxying report ${fileExt.toUpperCase()} (${reportType}) request to:`, targetUrl);

      const response = await fetchWithRetryAndTimeout(targetUrl, {
        method: "GET",
        headers: {
          "Accept": fileExt === 'xls' ? "application/vnd.ms-excel, application/octet-stream, */*" : "application/pdf, application/octet-stream, */*",
          "Accept-Language": "en-US,en;q=0.9,id;q=0.8,ms;q=0.7",
        },
      }, 2, 60000);

      if (response.redirected) {
        return res.status(401).json({ error: "Sesi Kedaluwarsa / Dialihkan oleh server pusat", isRedirected: true });
      }

      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("html")) {
        const text = await response.text();
        if (text.includes("login.html") || text.includes("login-form")) {
          return res.status(401).json({ error: "Sesi Kedaluwarsa (Menerima Halaman Login)", isRedirected: true });
        } else {
          return res.status(500).json({ error: `Gagal mengunduh report ${fileExt.toUpperCase()}. Server mengembalikan halaman non-${fileExt.toUpperCase()}.`, textSnippet: text.substring(0, 500) });
        }
      }

      if (!response.ok) {
        return res.status(response.status).json({ error: `Gagal memuat report ${fileExt.toUpperCase()}. Status server: ${response.status}` });
      }

      if (fileExt === 'xls') {
        res.setHeader("Content-Type", "application/vnd.ms-excel");
      } else {
        res.setHeader("Content-Type", "application/pdf");
      }
      
      const filename = `${reportType}-${t1}-ke-${t2}.${fileExt}`;
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.send(buffer);
    } catch (err: any) {
      console.error("Proxy report-pdf error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/proxy-image", async (req, res) => {
    try {
      const { path, use_base_url } = req.query;
      if (!path || typeof path !== 'string') {
        return res.status(400).json({ error: "Path is required" });
      }
      
      let cleanPath = path.trim();
      // Bersihkan format path
      if (!cleanPath.startsWith('http://') && !cleanPath.startsWith('https://')) {
        cleanPath = cleanPath.replace(/\/+/g, '/');
        if (!cleanPath.startsWith('/')) {
          cleanPath = '/' + cleanPath;
        }
      }

      let primaryUrl = '';
      let fallbackUrl = '';

      if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
        let absoluteUrl: URL;
        try {
          absoluteUrl = new URL(cleanPath);
        } catch {
          return res.status(400).json({ error: 'URL gambar tidak valid' });
        }

        const isImageServer = absoluteUrl.protocol === 'http:'
          && absoluteUrl.hostname === ABSENSI_BASE_HOST
          && absoluteUrl.port === '8087';
        const isPresensiServer = absoluteUrl.protocol === 'https:'
          && [PRESENSI_DIRECT_IP, 'presensi.ponorogo.go.id'].includes(absoluteUrl.hostname)
          && !absoluteUrl.port;
        if (!isImageServer && !isPresensiServer) {
          return res.status(400).json({ error: 'Host gambar tidak diizinkan' });
        }
        primaryUrl = absoluteUrl.toString();
      } else {
        const port8087Url = `${ABSENSI_IMG_URL}${cleanPath}`;
        const port80Url = `https://presensi.ponorogo.go.id${cleanPath}`;
        
        if (use_base_url === 'true') {
          primaryUrl = port80Url;
          fallbackUrl = port8087Url;
        } else {
          primaryUrl = port8087Url;
          fallbackUrl = port80Url;
        }
      }
      
      let response;
      try {
        console.log(`[Proxy Image] Fetching primary URL: ${primaryUrl}`);
        response = await fetchWithRetryAndTimeout(primaryUrl, {
          method: "GET",
          redirect: 'error',
        }, 2, 15000);
        
        if (!response.ok && fallbackUrl) {
          console.warn(`[Proxy Image] Primary URL returned HTTP ${response.status}. Trying fallback: ${fallbackUrl}`);
          const fallbackResponse = await fetchWithRetryAndTimeout(fallbackUrl, {
            method: "GET",
            redirect: 'error',
          }, 2, 15000);
          
          if (fallbackResponse.ok) {
            response = fallbackResponse;
          }
        }
      } catch (err: any) {
        if (fallbackUrl) {
          console.warn(`[Proxy Image] Primary URL threw error: ${err.message}. Trying fallback: ${fallbackUrl}`);
          try {
            response = await fetchWithRetryAndTimeout(fallbackUrl, {
              method: "GET",
              redirect: 'error',
            }, 2, 15000);
          } catch (fallbackErr: any) {
            throw new Error(`Both primary and fallback image fetches failed. Primary error: ${err.message}. Fallback error: ${fallbackErr.message}`);
          }
        } else {
          throw err;
        }
      }
      
      if (!response || !response.ok) {
        const status = response ? response.status : 500;
        return res.status(status).json({ error: "Gagal memuat gambar dari kedua server" });
      }

      const contentType = response.headers.get("content-type");
      if (contentType) {
        res.setHeader("Content-Type", contentType);
      }
      
      // Tambahkan Cache-Control untuk menghemat kuota data dan mempercepat loading
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache 24 jam
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.send(buffer);
    } catch (err: any) {
      console.error("Proxy image error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
    console.log(`Absensi API: ${ABSENSI_API_URL}`);
  });
}

startServer();
