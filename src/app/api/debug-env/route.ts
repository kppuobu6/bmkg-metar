import { NextResponse } from 'next/server';

export async function GET() {
  const proxyUrl = process.env.BMKG_PROXY_URL || 'NOT SET';
  return NextResponse.json({
    BMKG_PROXY_URL: proxyUrl,
    isSet: proxyUrl !== 'NOT SET' && proxyUrl !== '',
  });
}
