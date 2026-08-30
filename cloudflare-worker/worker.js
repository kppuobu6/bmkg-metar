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

// BMKG is a Laravel app: POST requires the CSRF _token from the GET page,
// in addition to the session cookies (XSRF-TOKEN + aviation_session).
function extractCsrfToken(html) {
  const match = html.match(/name="_token"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}

// Inject/replace the _token field into the form body
function withCsrfToken(body, token) {
  const params = new URLSearchParams(body);
  params.set('_token', token);
  return params.toString();
}

async function fetchBMKGWithCookies(body) {
  // GET first to get cookies + CSRF token
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

  const getHtml = await getResp.text();
  const csrfToken = extractCsrfToken(getHtml);
  if (!csrfToken) {
    console.error('BMKG: could not extract CSRF _token from GET page');
    // Continue anyway — maybe the site changed and no longer needs it
  }

  // POST with cookies + CSRF token
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
    body: csrfToken ? withCsrfToken(body, csrfToken) : body,
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
// ICAO codes here start with W or A followed by 3 letters (e.g. WIKK, WIII, WAAA)
function hasValidMetarContent(html) {
  // Must have at least one METAR or SPECI record
  return /METAR\s+[WA][A-Z]{3}/.test(html) || /SPECI\s+[WA][A-Z]{3}/.test(html);
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

      // Step 1: Try fresh from BMKG (with retry — each attempt re-does GET for
      // fresh cookies + CSRF token, which is what usually clears a transient
      // Cloudflare challenge; longer backoff gives the challenge time to pass)
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const resp = await fetchBMKGWithCookies(body);
          const html = await resp.text();

          if (!resp.ok) {
            console.error(`BMKG returned ${resp.status} on attempt ${attempt}`);
            if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
            continue;
          }

          if (isCloudflareChallenge(html)) {
            console.error(`BMKG returned Cloudflare challenge on attempt ${attempt}`);
            if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
            continue;
          }

          if (isErrorPage(html)) {
            console.error(`BMKG returned error page on attempt ${attempt}`);
            if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
            continue;
          }

          if (!hasTableData(html)) {
            console.error(`BMKG returned HTML without table on attempt ${attempt}`);
            if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
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

          // Fresh valid data! Cache briefly — long TTLs make obs stale since
          // BMKG serves stale-while-revalidate anyway (cache is only a fallback).
          // Also keep a per-station snapshot with a 1h TTL as a rescue copy.
          if (env.BMKG_CACHE) {
            const station = cacheKeys[0].split(':')[1] || 'unknown';
            const puts = [
              ...cacheKeys.map(key =>
                env.BMKG_CACHE.put(key, html, { expirationTtl: 180 })
              ),
              env.BMKG_CACHE.put(`snapshot:${station}`, html, { expirationTtl: 3600 }),
            ];
            await Promise.all(puts);
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
          if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
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

      // BMKG failed and exact key cache empty/invalid — serve the per-station
      // snapshot (1h TTL rescue copy) instead of erroring with an empty 503
      if (env.BMKG_CACHE) {
        const station = (cacheKeys[0] || '').split(':')[1] || '';
        const snapshot = station ? await env.BMKG_CACHE.get(`snapshot:${station}`) : null;
        if (snapshot && hasTableData(snapshot) && !isCloudflareChallenge(snapshot) && !isErrorPage(snapshot)) {
          console.error(`Serving snapshot:${station} after BMKG failure`);
          return new Response(snapshot, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'text/html; charset=utf-8',
              'X-Cache': 'STALE',
              'X-Source': 'snapshot',
            },
          });
        }
      }

      // Truly nothing to serve
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
