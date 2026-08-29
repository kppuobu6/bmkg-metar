// Cloudflare Worker: BMKG METAR Proxy
// Always fetches fresh data; caches only as fallback when BMKG is blocked

const BMKG_URL = 'https://web-aviation.bmkg.go.id/web/metar_speci.php';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function normalizeBody(rawBody) {
  try {
    return decodeURIComponent(rawBody).replace(/\+/g, ' ');
  } catch {
    return rawBody;
  }
}

function extractStationsAndDate(body) {
  const params = new URLSearchParams(body);
  const stasiun = params.get('stasiun') || '';
  const from = params.get('from') || '';
  const today = from.substring(0, 10);
  return { stations: stasiun.trim(), date: today };
}

async function fetchBMKGWithCookies(body) {
  const getResp = await fetch(BMKG_URL, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  const setCookieValues = [];
  for (const [key, value] of getResp.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') {
      setCookieValues.push(value.split(';')[0]);
    }
  }
  const cookieHeader = setCookieValues.join('; ');

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

function isCloudflareChallenge(html) {
  return html.includes('Just a moment') || html.includes('cf-challenge') || html.includes('cf_chl_opt');
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
      const { stations, date } = extractStationsAndDate(body);
      const broadKey = `metar:${stations}:${date}`;

      // Step 1: ALWAYS try fresh from BMKG first
      try {
        const resp = await fetchBMKGWithCookies(body);
        const html = await resp.text();

        if (!isCloudflareChallenge(html) && resp.ok && html.includes('<table')) {
          // Fresh data! Cache as fallback (30 min) and return
          if (env.BMKG_CACHE) {
            ctx.waitUntil(env.BMKG_CACHE.put(broadKey, html, { expirationTtl: 1800 }));
          }
          return new Response(html, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'text/html; charset=utf-8',
              'X-Cache': 'MISS',
              'X-Source': 'live',
            },
          });
        }
      } catch (err) {
        // BMKG fetch failed, fall through to cache
      }

      // Step 2: BMKG failed — serve cached data as fallback
      if (env.BMKG_CACHE) {
        const cached = await env.BMKG_CACHE.get(broadKey);
        if (cached) {
          return new Response(cached, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'text/html; charset=utf-8',
              'X-Cache': 'HIT',
              'X-Source': 'cached',
            },
          });
        }
      }

      // No cache and BMKG failed
      return new Response(
        JSON.stringify({ error: 'BMKG temporarily unavailable' }),
        {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
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
