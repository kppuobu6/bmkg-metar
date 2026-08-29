// Cloudflare Worker: BMKG METAR Proxy
// Strategy: Cache per station per day, serve stale on failure, background refresh

const BMKG_URL = 'https://web-aviation.bmkg.go.id/web/metar_speci.php';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function normalizeBody(rawBody) {
  try {
    return decodeURIComponent(rawBody).replace(/\+/g, ' ');
  } catch {
    return rawBody;
  }
}

// Extract stations and date for cache key
// Cache key: "metar:WIGG:2026-08-29" (per station per day)
function extractCacheKey(body) {
  const params = new URLSearchParams(body);
  const stasiun = (params.get('stasiun') || '').trim();
  const from = params.get('from') || '';
  const today = from.substring(0, 10);
  
  // If multiple stations, create separate keys
  const stations = stasiun.split(/\s+/).filter(Boolean);
  return stations.map(s => `metar:${s}:${today}`);
}

async function fetchBMKGWithCookies(body) {
  // GET first to get cookies
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

  // POST with cookies
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

function hasTableData(html) {
  return html.includes('<table') && html.includes('<td');
}

// Validate that HTML contains actual METAR/SPECI data, not just an empty table
function hasValidMetarContent(html) {
  // Must have at least one METAR or SPECI record
  return /METAR\s+[WA]{2}[A-Z]{2}/.test(html) || /SPECI\s+[WA]{2}[A-Z]{2}/.test(html);
}

// Check if HTML looks like an error page or redirect
function isErrorPage(html) {
  const lower = html.toLowerCase();
  return (
    lower.includes('error') && lower.includes('not found') ||
    lower.includes('404') && lower.includes('page') ||
    lower.includes('maintenance') ||
    lower.includes('sedang perbaikan') ||
    lower.includes('server error') ||
    lower.includes('502 bad gateway') ||
    lower.includes('503 service')
  );
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
      const cacheKeys = extractCacheKey(body);

      // Step 1: Try fresh from BMKG (with retry)
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const resp = await fetchBMKGWithCookies(body);
          const html = await resp.text();

          if (!resp.ok) {
            console.error(`BMKG returned ${resp.status} on attempt ${attempt}`);
            if (attempt < 2) await new Promise(r => setTimeout(r, 500));
            continue;
          }

          if (isCloudflareChallenge(html)) {
            console.error(`BMKG returned Cloudflare challenge on attempt ${attempt}`);
            if (attempt < 2) await new Promise(r => setTimeout(r, 500));
            continue;
          }

          if (isErrorPage(html)) {
            console.error(`BMKG returned error page on attempt ${attempt}`);
            if (attempt < 2) await new Promise(r => setTimeout(r, 500));
            continue;
          }

          if (!hasTableData(html)) {
            console.error(`BMKG returned HTML without table on attempt ${attempt}`);
            if (attempt < 2) await new Promise(r => setTimeout(r, 500));
            continue;
          }

          if (!hasValidMetarContent(html)) {
            console.error(`BMKG returned table but no METAR/SPECI content on attempt ${attempt}`);
            // Still cache this — it might be a valid "no data" response for this time range
            // But mark it with a shorter TTL
            if (env.BMKG_CACHE) {
              const putPromises = cacheKeys.map(key =>
                env.BMKG_CACHE.put(key, html, { expirationTtl: 300 }) // 5 min for empty results
              );
              await Promise.all(putPromises);
            }
            return new Response(html, {
              status: 200,
              headers: {
                ...corsHeaders,
                'Content-Type': 'text/html; charset=utf-8',
                'X-Cache': 'MISS',
                'X-Source': 'live-empty',
              },
            });
          }

          // Fresh valid data! Cache for 1 hour
          if (env.BMKG_CACHE) {
            const putPromises = cacheKeys.map(key =>
              env.BMKG_CACHE.put(key, html, { expirationTtl: 3600 })
            );
            await Promise.all(putPromises);
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
        } catch (err) {
          console.error(`BMKG fetch attempt ${attempt} failed:`, err.message);
          if (attempt < 2) await new Promise(r => setTimeout(r, 500));
        }
      }

      // Step 2: BMKG failed — serve cached data (stale-while-revalidate)
      if (env.BMKG_CACHE) {
        for (const key of cacheKeys) {
          const cached = await env.BMKG_CACHE.get(key);
          if (cached) {
            // Validate cached content before serving
            if (isCloudflareChallenge(cached) || isErrorPage(cached)) {
              console.error(`Cached content for ${key} is invalid (challenge/error page), skipping`);
              await env.BMKG_CACHE.delete(key);
              continue;
            }
            if (!hasTableData(cached)) {
              console.error(`Cached content for ${key} has no table data, skipping`);
              await env.BMKG_CACHE.delete(key);
              continue;
            }
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
