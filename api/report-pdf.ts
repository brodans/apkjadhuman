import https from 'https';
import { URL } from 'url';

function httpsGetBuffer(urlStr: string, customHeaders: Record<string, string>): Promise<{ status: number; headers: any; body: Buffer }> {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname, // '103.109.206.102'
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          ...customHeaders,
          'Host': 'presensi.ponorogo.go.id' // Explicit Host header to bypass Cloudflare
        },
        rejectUnauthorized: false // Ignore cert verification
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => {
          chunks.push(chunk as Buffer);
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      // Timeout 60s for report generation
      req.setTimeout(60000, () => {
        req.destroy(new Error('Timeout'));
      });

      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

export default async function handler(req: any, res: any) {
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
    const { reportType, idp, idu, t1, t2, status, format } = req.query;
    const fileExt = format === 'xls' ? 'xls' : 'pdf';
    
    let targetUrl = '';
    if (reportType === 'per-pegawai') {
      targetUrl = `https://103.109.206.102/api/report/absensi/sby/per-pegawai.${fileExt}?idp=${idp}&t1=${t1}&t2=${t2}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
    } else if (reportType === 'per-pegawai-aktivitas') {
      targetUrl = `https://103.109.206.102/api/report/absensi/prg/per-pegawai-aktivitas.${fileExt}?idp=${idp}&t1=${t1}&t2=${t2}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
    } else if (reportType === 'rekap-instansi') {
      targetUrl = `https://103.109.206.102/api/report/absensi/sby/rekap-instansi.${fileExt}?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'all'}`;
    } else if (reportType === 'skor-per-instansi') {
      if (fileExt === 'xls') {
        targetUrl = `https://103.109.206.102/api/report/absensi/sby/skor-per-instansi2026-new.xls?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}`;
      } else {
        targetUrl = `https://103.109.206.102/api/report/absensi/sby/skor-per-instansi2026-new.pdf?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
      }
    } else if (reportType === 'aktivitas-per-instansi') {
      if (fileExt === 'xls') {
        targetUrl = `https://103.109.206.102/api/report/absensi/prg/aktivitas-per-instansi2026-new.xls?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}`;
      } else {
        targetUrl = `https://103.109.206.102/api/report/absensi/prg/aktivitas-per-instansi2026-new.pdf?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
      }
    } else if (reportType === 'rekap-tpp-aktivitas') {
      if (fileExt === 'xls') {
        targetUrl = `https://103.109.206.102/api/report/absensi/prg/rekap-tpp-aktivitas2026-new.xls?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}`;
      } else {
        targetUrl = `https://103.109.206.102/api/report/absensi/prg/rekap-tpp-aktivitas2026-new.pdf?idu=${idu}&t1=${t1}&t2=${t2}&status=${status || 'pns'}&protocol=https:&host=presensi.ponorogo.go.id&pathname=/&origin=https://presensi.ponorogo.go.id`;
      }
    } else {
      return res.status(400).json({ error: "reportType tidak valid atau tidak didukung" });
    }

    console.log(`Proxying serverless report ${fileExt.toUpperCase()} (${reportType}) via native https to direct IP:`, targetUrl);
    
    const customHeaders = {
      "Accept": fileExt === 'xls' ? "application/vnd.ms-excel, application/octet-stream, */*" : "application/pdf, application/octet-stream, */*",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8,ms;q=0.7",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://presensi.ponorogo.go.id/",
      "Origin": "https://presensi.ponorogo.go.id"
    };

    const response = await httpsGetBuffer(targetUrl, customHeaders);

    // Redirect detection
    if (response.status === 302 || response.status === 301) {
      return res.status(401).json({ error: "Sesi Kedaluwarsa / Dialihkan oleh server pusat", isRedirected: true });
    }
    
    const contentType = response.headers["content-type"];
    if (contentType && contentType.includes("html")) {
      const text = response.body.toString('utf-8');
      if (text.includes("login.html") || text.includes("login-form")) {
        return res.status(401).json({ error: "Sesi Kedaluwarsa (Menerima Halaman Login)", isRedirected: true });
      } else {
        return res.status(500).json({ error: `Gagal mengunduh report ${fileExt.toUpperCase()}. Server mengembalikan halaman HTML.`, textSnippet: text.substring(0, 500) });
      }
    }

    if (response.status !== 200) {
      return res.status(response.status).json({ error: `Gagal memuat report ${fileExt.toUpperCase()}. Status server: ${response.status}` });
    }

    if (fileExt === 'xls') {
      res.setHeader("Content-Type", "application/vnd.ms-excel");
    } else {
      res.setHeader("Content-Type", "application/pdf");
    }
    
    const filename = `${reportType}-${t1}-ke-${t2}.${fileExt}`;
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.status(200).send(response.body);
  } catch (err: any) {
    console.error("Proxy report-pdf error:", err);
    res.status(500).json({ error: err.message });
  }
}
