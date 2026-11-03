import https from 'https';
import { URL } from 'url';

function httpsGet(urlStr: string, customHeaders: Record<string, string>): Promise<{ status: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname, // This will be the IP address '103.109.206.102'
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          ...customHeaders,
          'Host': 'presensi.ponorogo.go.id' // Explicit host header to route to the correct virtual host
        },
        rejectUnauthorized: false // Disable SSL cert check
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: data
          });
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      // Add a timeout of 25 seconds
      req.setTimeout(25000, () => {
        req.destroy(new Error('Timeout'));
      });

      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

export default async function handler(req: any, res: any) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { unor, dateStart, dateEnd, page, size, nama, nip } = req.query;
    
    const start = dateStart || new Date().toISOString().split('T')[0];
    const end = dateEnd || new Date().toISOString().split('T')[0];
    const p = Number(page) || 1;
    const s = Number(size) || 10;
    
    const unorVal = (unor && String(unor).trim() !== "") ? String(unor).trim() : "null";
    const namaVal = nama ? encodeURIComponent(String(nama).trim()) : "null";
    const nipVal = nip ? encodeURIComponent(String(nip).trim()) : "null";
    
    if (unorVal === "null" && namaVal === "null" && nipVal === "null") {
      return res.status(400).json({ error: "Pilih instansi atau masukkan nama/NIP untuk melakukan pencarian." });
    }
    
    // Direct IP HTTPS bypass for Cloudflare
    const targetUrl = `https://103.109.206.102/api/absensi-log/unor/${unorVal}/${start}/${end}/${namaVal}/${nipVal}?page.page=${p}&page.size=${s}&page=${p}&size=${s}`;
    
    console.log("Proxying serverless absensi log request via native https to direct IP:", targetUrl);
    
    const customHeaders = {
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://presensi.ponorogo.go.id/",
      "Origin": "https://presensi.ponorogo.go.id",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    };

    const response = await httpsGet(targetUrl, customHeaders);

    if (response.status !== 200) {
      console.error(`Upstream returned HTTP ${response.status}:`, response.body.substring(0, 300));
      return res.status(response.status).json({ 
        error: `Server pusat mengembalikan HTTP ${response.status}`,
        detail: response.body.substring(0, 500)
      });
    }
    
    try {
      const jsonData = JSON.parse(response.body);
      res.status(200).json(jsonData);
    } catch (e) {
      console.error("Failed to parse JSON. Response body:", response.body.substring(0, 300));
      res.status(500).json({ error: "Gagal memproses JSON dari server absensi log", text: response.body.substring(0, 500) });
    }
  } catch (err: any) {
    console.error("Proxy absensi-log error:", err);
    if (err.message === 'Timeout') {
      return res.status(504).json({ error: "Request ke server pusat timeout (>25 detik). Coba lagi nanti." });
    }
    res.status(500).json({ error: err.message || "Internal server error" });
  }
}
