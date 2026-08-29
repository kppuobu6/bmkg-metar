import { parseMetar, type MetarData } from './metar-parser';

export interface MetarRecord {
  station: string;
  raw: string;
  header: string;
  datetime: string;
  parsed: MetarData;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Cloudflare Worker proxy URL (set in .env.local as BMKG_PROXY_URL)
// Contoh: https://bmkg-proxy.your-name.workers.dev/metar
const BMKG_PROXY_URL = process.env.BMKG_PROXY_URL || '';

// Fetch METAR from aviationweather.gov API (official NOAA API - free, no Cloudflare)
async function fetchFromAviationWeather(
  stations: string[],
  hours: number = 12
): Promise<MetarRecord[]> {
  const ids = stations.join(',');
  const url = `https://aviationweather.gov/api/data/metar?ids=${ids}&hours=${hours}&format=json`;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });

  // 204 means no data available (valid request but no METARs)
  if (response.status === 204) {
    console.log('No METAR data available from aviationweather.gov');
    return [];
  }

  if (!response.ok) {
    throw new Error(`Aviation Weather API error: ${response.status}`);
  }

  const text = await response.text();
  
  // Handle empty or invalid response
  if (!text || text.trim() === '') {
    console.log('Empty response from aviationweather.gov');
    return [];
  }

  let data: any[];
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse aviationweather.gov response:', text.substring(0, 200));
    throw new Error('Invalid JSON response from aviationweather.gov');
  }

  if (!Array.isArray(data)) {
    console.log('Unexpected response format from aviationweather.gov');
    return [];
  }

  const records: MetarRecord[] = [];

  for (const item of data) {
    const raw = item.rawOb || '';
    if (!raw) continue;

    const parsed = parseMetar(raw);
    
    // Convert observation time to WIB
    const obsTime = item.reportTime ? new Date(item.reportTime) : new Date();
    const wibTime = new Date(obsTime.getTime() + 7 * 60 * 60 * 1000);
    
    const year = wibTime.getUTCFullYear();
    const month = String(wibTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(wibTime.getUTCDate()).padStart(2, '0');
    const hour = String(wibTime.getUTCHours()).padStart(2, '0');
    const min = String(wibTime.getUTCMinutes()).padStart(2, '0');
    
    parsed.observationTimeWIB = `${year}-${month}-${day} ${hour}:${min} WIB`;
    parsed.observationTime = obsTime.toISOString();

    records.push({
      station: item.icaoId || parsed.station,
      raw,
      header: `${item.rawOb ? 'SA' : 'SP'} ${item.icaoId || ''} ${parsed.time}`,
      datetime: `${obsTime.toISOString().replace('T', ' ').replace('Z', '').slice(0, 16)}`,
      parsed,
    });
  }

  return records;
}

// Fetch METAR data from BMKG HTML page
async function fetchBMKGRaw(
  stations: string[],
  from: string,
  to: string,
  includeMetar: boolean = true,
  includeSpeci: boolean = true
): Promise<string> {
  const formData = new URLSearchParams();
  formData.append('stasiun', stations.join(' '));
  formData.append('from', from);
  formData.append('to', to);
  if (includeMetar) formData.append('metar', 'SA');
  if (includeSpeci) formData.append('speci', 'SP');

  const BMKG_URL = 'https://web-aviation.bmkg.go.id/web/metar_speci.php';
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': BMKG_URL,
    'Origin': 'https://web-aviation.bmkg.go.id',
  };

  const response = await fetch(BMKG_URL, {
    method: 'POST',
    headers,
    body: formData.toString(),
  });

  if (!response.ok) {
    throw new Error(`BMKG error: ${response.status}`);
  }

  return response.text();
}

// Parse METAR records from BMKG HTML
function parseBMKGHtml(html: string, $: any): MetarRecord[] {
  const records: MetarRecord[] = [];

  $('table tbody tr').each((_: number, row: any) => {
    const tds = $(row).find('td');
    if (tds.length >= 4) {
      const raw = $(tds[0]).text().trim();
      const header = $(tds[1]).text().trim();
      const station = $(tds[2]).text().trim();
      const datetime = $(tds[3]).text().trim();

      if (raw && (raw.startsWith('METAR') || raw.startsWith('SPECI'))) {
        const parsed = parseMetar(raw);
        records.push({ station, raw, header, datetime, parsed });
      }
    }
  });

  return records;
}

// Fallback: Fetch from BMKG
// Tries direct first, then proxy if direct fails with Cloudflare challenge
async function fetchFromBMKG(
  stations: string[],
  from: string,
  to: string,
  includeMetar: boolean = true,
  includeSpeci: boolean = true
): Promise<MetarRecord[]> {
  const cheerio = await import('cheerio');
  
  // Try direct BMKG first
  try {
    console.log('Trying direct BMKG...');
    const html = await fetchBMKGRaw(stations, from, to, includeMetar, includeSpeci);
    
    // Check if response is Cloudflare challenge page
    if (html.includes('Just a moment') || html.includes('cf-challenge')) {
      console.log('BMKG returned Cloudflare challenge, trying proxy...');
    } else {
      const $ = cheerio.load(html);
      const records = parseBMKGHtml(html, $);
      if (records.length > 0) return records;
      console.log('BMKG returned no records from direct, trying proxy...');
    }
  } catch (err) {
    console.error('Direct BMKG failed:', err instanceof Error ? err.message : err);
  }

  // Fallback to proxy
  if (BMKG_PROXY_URL) {
    console.log('Trying BMKG via proxy...');
    const formData = new URLSearchParams();
    formData.append('stasiun', stations.join(' '));
    formData.append('from', from);
    formData.append('to', to);
    if (includeMetar) formData.append('metar', 'SA');
    if (includeSpeci) formData.append('speci', 'SP');

    const response = await fetch(BMKG_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    if (!response.ok) {
      throw new Error(`BMKG proxy error: ${response.status}`);
    }

    const html = await response.text();
    if (html.includes('Just a moment') || html.includes('cf-challenge')) {
      throw new Error('BMKG proxy also blocked by Cloudflare challenge');
    }

    const $ = cheerio.load(html);
    return parseBMKGHtml(html, $);
  }

  throw new Error('All BMKG sources failed');
}

// Main function: Try aviationweather.gov first, fallback to BMKG
export async function fetchMetarData(
  stations: string[],
  from: string, // YYYY-MM-DDTHH:MM
  to: string,   // YYYY-MM-DDTHH:MM
  includeMetar: boolean = true,
  includeSpeci: boolean = true
): Promise<MetarRecord[]> {
  let aviationError: string | null = null;
  
  try {
    // Calculate hours difference for aviationweather.gov API
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const hoursDiff = Math.min(Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60)), 48);
    
    console.log('Fetching from aviationweather.gov API...');
    const records = await fetchFromAviationWeather(stations, hoursDiff);
    
    if (records.length > 0) {
      return records;
    }
    
    // aviationweather returned empty (no data for this station), not an error
    console.log('No records from aviationweather for these stations, trying BMKG...');
  } catch (error) {
    aviationError = error instanceof Error ? error.message : 'unknown';
    console.error('Aviation Weather API failed, trying BMKG:', error);
  }
  
  // Try BMKG as fallback
  try {
    return await fetchFromBMKG(stations, from, to, includeMetar, includeSpeci);
  } catch (bmkgError) {
    const bmkgMsg = bmkgError instanceof Error ? bmkgError.message : 'unknown';
    const aviationMsg = aviationError || 'No data available';
    throw new Error(`Both APIs failed. Aviation Weather: ${aviationMsg}, BMKG: ${bmkgMsg}`);
  }
}

// Popular Indonesian airport ICAO codes
export const POPULAR_STATIONS = [
  { code: 'WIII', name: 'Jakarta (Soekarno-Hatta)' },
  { code: 'WADD', name: 'Bali (Ngurah Rai)' },
  { code: 'WICC', name: 'Bandung (Husein Sastranegara)' },
  { code: 'WARR', name: 'Surabaya (Juanda)' },
  { code: 'WAHH', name: 'Yogyakarta (Adisucipto)' },
  { code: 'WAMD', name: 'Makassar (Sultan Hasanuddin)' },
  { code: 'WIMM', name: 'Medan (Kualanamu)' },
  { code: 'WATT', name: 'Balikpapan (Sepinggan)' },
  { code: 'WAWS', name: 'Semarang (Ahmad Yani)' },
  { code: 'WARJ', name: 'Surabaya (Abdul Rachman Saleh)' },
  { code: 'WIGG', name: 'Bengkulu (Fatmawati Soekarno)' },
  { code: 'WIJJ', name: 'Jambi (Sultan Thaha)' },
];
