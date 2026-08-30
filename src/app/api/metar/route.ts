import { NextRequest, NextResponse } from 'next/server';
import { fetchMetarData } from '@/lib/bmkg-scraper';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const stations = searchParams.get('stations')?.split(',').map(s => s.trim()) || [];
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!stations.length || !from || !to) {
    return NextResponse.json(
      { error: 'Missing required parameters: stations, from, to' },
      { status: 400 }
    );
  }

  try {
    // `t` is the frontend cache-buster: when present, always hit live sources
    const fresh = searchParams.has('t');
    const records = await fetchMetarData(stations, from, to, true, true, { fresh });
    const response = NextResponse.json({
      records,
      count: records.length,
      fetchedAt: new Date().toISOString(),
      // Include debug info in non-production for troubleshooting
      ...(process.env.NODE_ENV !== 'production' ? {
        debug: {
          stations,
          from,
          to,
          bmkgProxyConfigured: !!process.env.BMKG_PROXY_URL,
          skylinkConfigured: !!process.env.SKYLINK_API_KEY,
        },
      } : {}),
    });
    // Disable caching
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    return response;
  } catch (error) {
    console.error('Error fetching METAR data:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch METAR data';
    return NextResponse.json(
      { error: message, stations, from, to },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stations, from, to, includeMetar = true, includeSpeci = true } = body;

    if (!stations?.length || !from || !to) {
      return NextResponse.json(
        { error: 'Missing required parameters: stations, from, to' },
        { status: 400 }
      );
    }

    const records = await fetchMetarData(stations, from, to, includeMetar, includeSpeci);
    return NextResponse.json({
      records,
      count: records.length,
      ...(process.env.NODE_ENV !== 'production' ? {
        debug: {
          stations,
          from,
          to,
          bmkgProxyConfigured: !!process.env.BMKG_PROXY_URL,
          skylinkConfigured: !!process.env.SKYLINK_API_KEY,
        },
      } : {}),
    });
  } catch (error) {
    console.error('Error fetching METAR data:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch METAR data';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
