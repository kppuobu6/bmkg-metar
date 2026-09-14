// BMKG METAR fetcher using native https with browser-like headers
// Handles CSRF dance: GET page → extract cookies + _token → POST with token

import https from 'node:https';
import http from 'node:http';

const BMKG_URL = 'https://web-aviation.bmkg.go.id/web/metar_speci.php';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

function extractCsrf(html: string): string | null {
  const m = html.match(/name="_token"\s+value="([^"]+)"/);
  return m ? m[1] : null;
}

function isCloudflareChallenge(html: string): boolean {
  return html.includes('Just a moment') || html.includes('cf-challenge') || html.includes('cf_chl_opt');
}

function collectCookies(headers: http.IncomingHttpHeaders): string {
  const raw = headers['set-cookie'];
  if (!raw) return '';
  return (Array.isArray(raw) ? raw : [raw])
    .map(h => h.split(';')[0])
    .join('; ');
}

function httpsRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    // Don't send br (brotli) unless we can decompress it
    const headers = { ...options.headers };
    if (headers['Accept-Encoding']) {
      headers['Accept-Encoding'] = 'gzip, deflate';
    }

    const reqOptions: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers,
    };

    const req = https.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const encoding = res.headers['content-encoding'];
        let data = Buffer.concat(chunks);

        if (encoding === 'gzip') {
          const zlib = require('node:zlib');
          try { data = zlib.gunzipSync(data); } catch { /* ignore */ }
        } else if (encoding === 'deflate') {
          const zlib = require('node:zlib');
          try { data = zlib.inflateSync(data); } catch { /* ignore */ }
        }

        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: data.toString('utf-8'),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// Follow redirects and return final response
async function httpGetFollowRedirects(
  url: string,
  headers: Record<string, string>,
  maxRedirects = 5
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  let currentUrl = url;
  let currentHeaders = { ...headers };

  for (let i = 0; i <= maxRedirects; i++) {
    const resp = await httpsRequest(currentUrl, { headers: currentHeaders });
    const location = resp.headers.location;

    if (resp.statusCode >= 300 && resp.statusCode < 400 && location) {
      // Follow redirect
      currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
      // Don't send cookies on cross-origin redirects
      if (new URL(currentUrl).hostname !== new URL(url).hostname) {
        const { Cookie, ...rest } = currentHeaders;
        currentHeaders = rest;
      }
      continue;
    }

    return resp;
  }

  throw new Error('Too many redirects');
}

export interface BmkgFetchOptions {
  station: string;
  from: string;
  to: string;
  includeMetar?: boolean;
  includeSpeci?: boolean;
}

export async function fetchBMKGPage(options: BmkgFetchOptions): Promise<string | null> {
  const { station, from, to, includeMetar = true, includeSpeci = true } = options;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Step 1: GET the page to obtain cookies + CSRF token (follow redirects)
      const getResp = await httpGetFollowRedirects(BMKG_URL, {
        ...BROWSER_HEADERS,
        'sec-fetch-site': 'none',
      });

      console.log(`BMKG ${station} GET: status=${getResp.statusCode} len=${getResp.body.length} hasCF=${isCloudflareChallenge(getResp.body)} hasCsrf=${!!extractCsrf(getResp.body)}`);

      if (isCloudflareChallenge(getResp.body)) {
        console.error(`BMKG fetch ${station}: CF challenge on GET (attempt ${attempt})`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }

      const csrf = extractCsrf(getResp.body);
      if (!csrf) {
        console.error(`BMKG fetch ${station}: no CSRF token. Body preview: ${getResp.body.substring(0, 300)}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      const cookies = collectCookies(getResp.headers);

      // Step 2: POST with cookies + CSRF token
      const formData = new URLSearchParams();
      formData.append('_token', csrf);
      formData.append('stasiun', station);
      formData.append('from', from);
      formData.append('to', to);
      if (includeMetar) formData.append('metar', 'SA');
      if (includeSpeci) formData.append('speci', 'SP');

      const postResp = await httpsRequest(BMKG_URL, {
        method: 'POST',
        headers: {
          ...BROWSER_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': BMKG_URL,
          'Origin': 'https://web-aviation.bmkg.go.id',
          'sec-fetch-site': 'same-origin',
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body: formData.toString(),
      });

      console.log(`BMKG ${station} POST: status=${postResp.statusCode} len=${postResp.body.length} hasCF=${isCloudflareChallenge(postResp.body)} hasTable=${postResp.body.includes('<table')}`);

      if (isCloudflareChallenge(postResp.body)) {
        console.error(`BMKG fetch ${station}: CF challenge on POST (attempt ${attempt})`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }

      if (!postResp.body.includes('<table')) {
        console.error(`BMKG fetch ${station}: no table. Body preview: ${postResp.body.substring(0, 300)}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      return postResp.body;
    } catch (err) {
      console.error(`BMKG fetch ${station}: ${err instanceof Error ? err.message : err} (attempt ${attempt})`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }

  return null;
}
