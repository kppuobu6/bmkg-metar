// BMKG METAR fetcher using got-scraping for Cloudflare bypass
// Handles CSRF dance: GET page → extract cookies + _token → POST with token

const BMKG_URL = 'https://web-aviation.bmkg.go.id/web/metar_speci.php';

function extractCsrf(html: string): string | null {
  const m = html.match(/name="_token"\s+value="([^"]+)"/);
  return m ? m[1] : null;
}

function isCloudflareChallenge(html: string): boolean {
  return html.includes('Just a moment') || html.includes('cf-challenge') || html.includes('cf_chl_opt');
}

function collectCookies(setCookieHeaders: string[]): string {
  return setCookieHeaders
    .map(h => h.split(';')[0])
    .join('; ');
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

  // Dynamic import because got-scraping is ESM-only
  const { gotScraping } = await import('got-scraping');

  const client = gotScraping.extend({
    useHeaderGenerator: false,
    http2: true,
    timeout: { request: 30_000 },
    retry: { limit: 2, statusCodes: [403, 429, 500, 502, 503] },
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Step 1: GET the page to obtain cookies + CSRF token
      const getResp = await client.get(BMKG_URL, {
        headers: {
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
        },
      });

      const getHtml = getResp.body;

      // Detect Cloudflare challenge
      if (isCloudflareChallenge(getHtml)) {
        console.error(`BMKG fetch ${station}: CF challenge on GET (attempt ${attempt})`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }

      // Extract CSRF token
      const csrf = extractCsrf(getHtml);
      if (!csrf) {
        console.error(`BMKG fetch ${station}: no CSRF token found (attempt ${attempt})`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      // Collect cookies from GET response
      const getCookieHeaders = getResp.headers['set-cookie'];
      const cookies = Array.isArray(getCookieHeaders)
        ? collectCookies(getCookieHeaders)
        : '';

      // Step 2: POST with cookies + CSRF token
      const formData = new URLSearchParams();
      formData.append('_token', csrf);
      formData.append('stasiun', station);
      formData.append('from', from);
      formData.append('to', to);
      if (includeMetar) formData.append('metar', 'SA');
      if (includeSpeci) formData.append('speci', 'SP');

      const postResp = await client.post(BMKG_URL, {
        form: Object.fromEntries(formData),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': BMKG_URL,
          'Origin': 'https://web-aviation.bmkg.go.id',
          'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
          ...(cookies ? { 'Cookie': cookies } : {}),
        },
      });

      const postHtml = postResp.body;

      if (isCloudflareChallenge(postHtml)) {
        console.error(`BMKG fetch ${station}: CF challenge on POST (attempt ${attempt})`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }

      if (!postHtml.includes('<table')) {
        console.error(`BMKG fetch ${station}: no table in response (attempt ${attempt})`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      return postHtml;
    } catch (err) {
      console.error(`BMKG fetch ${station}: ${err instanceof Error ? err.message : err} (attempt ${attempt})`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }

  return null;
}
