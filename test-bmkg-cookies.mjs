#!/usr/bin/env node
// Test: fetch BMKG with cookies (GET first, then POST)

async function testBMKG() {
  const BMKG_URL = 'https://web-aviation.bmkg.go.id/web/metar_speci.php';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  // Step 1: GET the page first to get cookies
  console.log('Step 1: GET page to collect cookies...');
  const getResp = await fetch(BMKG_URL, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });
  const cookies = getResp.headers.getSetCookie?.() || [];
  console.log('Status:', getResp.status);
  console.log('Cookies:', cookies.length, cookies.map(c => c.split(';')[0]).join('; '));
  
  const getHtml = await getResp.text();
  console.log('Has CF challenge:', getHtml.includes('Just a moment'));
  
  // Step 2: POST with cookies
  console.log('\nStep 2: POST with cookies...');
  const formData = new URLSearchParams();
  formData.append('stasiun', 'WIGG');
  formData.append('from', '2026-08-29T00:00');
  formData.append('to', '2026-08-29T23:59');
  formData.append('metar', 'SA');
  formData.append('speci', 'SP');
  
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');
  
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
  const metarCount = (postHtml.match(/METAR WIGG/g) || []).length;
  console.log('Status:', postResp.status);
  console.log('Has CF challenge:', postHtml.includes('Just a moment'));
  console.log('METAR WIGG count:', metarCount);
  if (metarCount > 0) {
    const matches = postHtml.match(/METAR WIGG[^<]*/g);
    if (matches) matches.slice(0, 3).forEach(m => console.log('  ', m));
  }
}

testBMKG().catch(console.error);
