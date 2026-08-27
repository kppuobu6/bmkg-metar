import { NextRequest, NextResponse } from 'next/server';
import { saveMetarHistory, getMetarHistory } from '@/lib/history-store';
import { type MetarRecord } from '@/lib/bmkg-scraper';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const station = searchParams.get('station');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  if (!station) {
    return NextResponse.json(
      { error: 'Missing required parameter: station' },
      { status: 400 }
    );
  }

  try {
    const records = await getMetarHistory(station, startDate || undefined, endDate || undefined);
    return NextResponse.json({ records, count: records.length });
  } catch (error) {
    console.error('Error fetching history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch history' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { records } = body;

    if (!records?.length) {
      return NextResponse.json(
        { error: 'No records to save' },
        { status: 400 }
      );
    }

    await saveMetarHistory(records as MetarRecord[]);
    return NextResponse.json({ success: true, count: records.length });
  } catch (error) {
    console.error('Error saving history:', error);
    return NextResponse.json(
      { error: 'Failed to save history' },
      { status: 500 }
    );
  }
}
