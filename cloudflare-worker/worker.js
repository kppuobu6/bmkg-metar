// Cloudflare Worker: BMKG METAR Proxy
// Deploy this to Cloudflare Workers (free tier: 100k requests/day)
// Usage: POST https://your-worker.workers.dev/metar with form data

const BMKG_URL = 'https://web-aviation.bmkg.go.id/web/metar_speci.php';
const ALLOWED_ORIGINS = ['*']; // Ganti dengan domain production kamu untuk keamanan

export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Hanya terima POST
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      // Ambil body dari request
      const body = await request.text();

      // Forward ke BMKG dengan headers yang tepat
      const bmkgResponse = await fetch(BMKG_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
          Referer: BMKG_URL,
          Origin: 'https://web-aviation.bmkg.go.id',
        },
        body,
      });

      // Return response dari BMKG
      const html = await bmkgResponse.text();

      return new Response(html, {
        status: bmkgResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8',
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
