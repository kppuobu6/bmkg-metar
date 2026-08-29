import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const proxyUrl = process.env.BMKG_PROXY_URL || 'NOT SET';
  const results: any = {
    BMKG_PROXY_URL: proxyUrl,
    timestamp: new Date().toISOString(),
    tests: [],
  };

  if (proxyUrl && proxyUrl !== 'NOT SET') {
    // Test 1: Call proxy with URLSearchParams body
    try {
      const formData = new URLSearchParams();
      formData.append('stasiun', 'WIGG');
      formData.append('from', '2026-08-29T00:00');
      formData.append('to', '2026-08-29T23:59');
      formData.append('metar', 'SA');
      formData.append('speci', 'SP');
      const body = formData.toString();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await response.text();
      results.tests.push({
        name: 'proxy-call',
        status: response.status,
        cacheHeader: response.headers.get('X-Cache'),
        metarCount: (text.match(/METAR WIGG/g) || []).length,
        hasChallenge: text.includes('Just a moment') || text.includes('cf-challenge'),
        responseSnippet: text.substring(0, 300),
      });
    } catch (err: any) {
      results.tests.push({ name: 'proxy-call', error: err.message });
    }
  }

  // Test 2: Direct BMKG GET from Vercel
  try {
    const BMKG_URL = 'https://web-aviation.bmkg.go.id/web/metar_speci.php';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const getResp = await fetch(BMKG_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await getResp.text();
    results.tests.push({
      name: 'direct-bmkg-get',
      status: getResp.status,
      hasChallenge: text.includes('Just a moment') || text.includes('cf-challenge'),
      responseSnippet: text.substring(0, 200),
    });
  } catch (err: any) {
    results.tests.push({ name: 'direct-bmkg-get', error: err.message });
  }

  return NextResponse.json(results, { pretty: true });
}
