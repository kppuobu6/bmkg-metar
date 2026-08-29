import { NextResponse } from 'next/server';

export async function GET() {
  const proxyUrl = process.env.BMKG_PROXY_URL || 'NOT SET';
  
  // Test proxy call
  let proxyStatus = 'N/A';
  let metarCount = 0;
  let error = '';
  
  if (proxyUrl && proxyUrl !== 'NOT SET') {
    try {
      const formData = new URLSearchParams();
      formData.append('stasiun', 'WIGG');
      formData.append('from', '2026-08-29T00:00');
      formData.append('to', '2026-08-29T23:59');
      formData.append('metar', 'SA');
      formData.append('speci', 'SP');
      
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });
      
      proxyStatus = `${response.status}`;
      const text = await response.text();
      metarCount = (text.match(/METAR WIGG/g) || []).length;
    } catch (err) {
      error = err instanceof Error ? err.message : 'unknown';
    }
  }

  return NextResponse.json({
    BMKG_PROXY_URL: proxyUrl,
    proxyStatus,
    metarCount,
    error,
  });
}
