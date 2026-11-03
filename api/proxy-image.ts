import https from 'https';

function fetchHttpsImage(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; contentType: string | undefined; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const request = https.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers,
      servername: 'presensi.ponorogo.go.id',
      rejectUnauthorized: false,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode || 500,
        contentType: response.headers['content-type'],
        body: Buffer.concat(chunks),
      }));
    });

    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Timeout 15000ms')));
    request.end();
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
    const { path, use_base_url } = req.query;
    if (!path || typeof path !== 'string') {
      return res.status(400).json({ error: "Path is required" });
    }

    let useBaseUrl = use_base_url === 'true';
    let cleanPath = path.trim();
    if (/^https?:\/\//i.test(cleanPath)) {
      let sourceUrl: URL;
      try {
        sourceUrl = new URL(cleanPath);
      } catch {
        return res.status(400).json({ error: 'URL gambar tidak valid' });
      }

      const isImageServer = sourceUrl.protocol === 'http:'
        && sourceUrl.hostname === '103.109.206.102'
        && sourceUrl.port === '8087';
      const isPresensiServer = sourceUrl.protocol === 'https:'
        && ['103.109.206.102', 'presensi.ponorogo.go.id'].includes(sourceUrl.hostname)
        && !sourceUrl.port;
      if (!isImageServer && !isPresensiServer) {
        return res.status(400).json({ error: 'Host gambar tidak diizinkan' });
      }
      useBaseUrl = isPresensiServer;
      cleanPath = `${sourceUrl.pathname}${sourceUrl.search}`;
    }

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(cleanPath.split('?')[0]);
    } catch {
      return res.status(400).json({ error: 'Path gambar tidak valid' });
    }
    if (decodedPath.replace(/\\/g, '/').split('/').includes('..')) {
      return res.status(400).json({ error: 'Path gambar tidak diizinkan' });
    }

    const normalizedPath = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
    const baseUrl = useBaseUrl ? 'https://103.109.206.102' : 'http://103.109.206.102:8087';
    const imageUrl = `${baseUrl}${normalizedPath}`;
    
    const USER_AGENTS = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
    ];
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    const headers: Record<string, string> = {
      "User-Agent": randomUserAgent,
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache"
    };

    if (use_base_url === 'true') {
      headers["Host"] = "presensi.ponorogo.go.id";
    }

    const response = useBaseUrl
      ? await fetchHttpsImage(imageUrl, { ...headers, Host: 'presensi.ponorogo.go.id' })
      : await fetch(imageUrl, { method: 'GET', headers, redirect: 'error' }).then(async result => ({
          status: result.status,
          contentType: result.headers.get('content-type') || undefined,
          body: Buffer.from(await result.arrayBuffer()),
        }));

    if (response.status < 200 || response.status >= 300) {
      return res.status(response.status).json({ error: "Failed to fetch image" });
    }

    const contentType = response.contentType;
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(response.body);
  } catch (err: any) {
    console.error("Proxy image error:", err);
    res.status(500).json({ error: err.message });
  }
}
