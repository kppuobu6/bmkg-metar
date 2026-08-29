// Cloudflare Worker: BMKG METAR Proxy with KV Cache
// Caches METAR data to avoid hitting BMKG's Cloudflare protection repeatedly

const BMKG_URL = 'https://web-aviation.bmkg.go.id/web/metar_speci.php';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function normalizeBody(rawBody) {
  // Normalize: decode URL-encoded characters to ensure consistent cache keys
  // URLSearchParams.toString() encodes colons as %3A, but literal colons should match
  try {
    return decodeURIComponent(rawBody).replace(/\+/g, ' ');
  } catch {
    return rawBody;
  }
}

async function fetchBMKGWithCookies(body) {
  // Step 1: GET to collect session cookies
  const getResp = await fetch(BMKG_URL, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  // Parse Set-Cookie manually
  const setCookieValues = [];
  for (const [key, value] of getResp.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') {
      setCookieValues.push(value.split(';')[0]);
    }
  }
  const cookieHeader = setCookieValues.join('; ');

  // Step 2: POST with cookies
  const postResp = await fetch(BMKG_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': BMKG_URL,
      'Origin': 'https://web-aviation.bmkg.go.id',
      ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
    },
    body,
  });

  return postResp;
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const rawBody = await request.text();
      const body = normalizeBody(rawBody);

      // Check cache first (KV) using normalized body
      const cacheKey = `metar:${body}`;
      if (env.BMKG_CACHE) {
        const cached = await env.BMKG_CACHE.get(cacheKey);
        if (cached) {
          return new Response(cached, {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8', 'X-Cache': 'HIT' },
          });
        }
      }

      // Fetch from BMKG with cookies
      const resp = await fetchBMKGWithCookies(body);
      const html = await resp.text();

      // Check for Cloudflare challenge
      const isChallenge = html.includes('Just a moment') || html.includes('cf-challenge');

      if (!isChallenge && resp.ok && env.BMKG_CACHE) {
        // Cache for 5 minutes
        ctx.waitUntil(env.BMKG_CACHE.put(cacheKey, html, { expirationTtl: 300 }));
      }

      return new Response(html, {
        status: isChallenge ? 503 : resp.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8',
          'X-Cache': 'MISS',
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: `Proxy error: ${error.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  },
};
