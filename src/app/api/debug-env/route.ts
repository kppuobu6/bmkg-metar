import { NextResponse } from 'next/server';

export async function GET() {
  const BMKG_URL = 'https://web-aviation.bmkg.go.id/web/metar_speci.php';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  // Step 1: GET to collect cookies
  const getResp = await fetch(BMKG_URL, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  const setCookies = getResp.headers.getSetCookie?.() || [];
  const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');
  const getHtml = await getResp.text();
  const getHasCF = getHtml.includes('Just a moment');

  // Step 2: POST with cookies
  const formData = new URLSearchParams();
  formData.append('stasiun', 'WIGG');
  formData.append('from', '2026-08-29T00:00');
  formData.append('to', '2026-08-29T23:59');
  formData.append('metar', 'SA');
  formData.append('speci', 'SP');

  const postResp = await fetch(BMKG_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': BMKG_URL,
      'Origin': 'https://web-aviation.bmkg.go.id',
      ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
    },
    body: formData.toString(),
  });

  const postHtml = await postResp.text();
  const postHasCF = postHtml.includes('Just a moment');
  const metarCount = (postHtml.match(/METAR WIGG/g) || []).length;

  return NextResponse.json({
    step1_get: { status: getResp.status, cookies: setCookies.length, hasCF: getHasCF },
    step2_post: { status: postResp.status, hasCF: postHasCF, metarCount },
    cookieHeader: cookieHeader.substring(0, 200),
  });
}
