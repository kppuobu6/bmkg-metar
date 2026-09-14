import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const results: any = {
    timestamp: new Date().toISOString(),
    env: {
      SKYLINK_API_KEY: process.env.SKYLINK_API_KEY ? 'SET' : 'NOT SET',
    },
    tests: [],
  };

  // Test: Direct BMKG GET via got-scraping
  try {
    const { fetchBMKGPage } = await import('@/lib/bmkg-fetcher');
    const html = await fetchBMKGPage({
      station: 'WIGG',
      from: '2026-09-13T00:00',
      to: '2026-09-13T23:59',
    });

    results.tests.push({
      name: 'bmkg-got-scraping',
      success: !!html,
      hasTable: html?.includes('<table') ?? false,
      hasMetar: html?.includes('METAR') ?? false,
      responseSnippet: html?.substring(0, 300) ?? 'null',
    });
  } catch (err: any) {
    results.tests.push({ name: 'bmkg-got-scraping', error: err.message });
  }

  return NextResponse.json(results);
}
