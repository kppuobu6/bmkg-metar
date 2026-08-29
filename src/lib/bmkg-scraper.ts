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
const BMKG_PROXY_URL = process.env.BMKG_PROXY_URL || '';

// SkyLink API key (set in .env.local as SKYLINK_API_KEY)
// Using direct API via polar.sh: https://data.skylinkapi.com
const SKYLINK_API_KEY = process.env.SKYLINK_API_KEY || '';
const SKYLINK_BASE_URL = 'https://data.skylinkapi.com/v3.1';

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


// Fetch METAR from SkyLink API (via polar.sh direct API)
// Free tier: 1,000 requests/month
async function fetchFromSkyLink(
  stations: string[]
): Promise<MetarRecord[]> {
  if (!SKYLINK_API_KEY) {
    throw new Error('SKYLINK_API_KEY not configured');
  }

  const records: MetarRecord[] = [];

  // SkyLink only supports one station per request
  for (const station of stations) {
    try {
      const url = `${SKYLINK_BASE_URL}/weather/metar/${station}`;
      
      const response = await fetch(url, {
        headers: {
          'x-api-key': SKYLINK_API_KEY,
        },
      });

      if (!response.ok) {
        console.error(`SkyLink API error for ${station}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      
      // Check if data is available
      if (!data.raw || data.detail) {
        console.log(`SkyLink: No data for ${station} - ${data.detail || 'empty'}`);
        continue;
      }

      const parsed = parseMetar(data.raw);
      
      // SkyLink returns ISO time, convert to WIB
      const obsTime = data.timestamp ? new Date(data.timestamp) : new Date();
      const wibTime = new Date(obsTime.getTime() + 7 * 60 * 60 * 1000);
      
      const year = wibTime.getUTCFullYear();
      const month = String(wibTime.getUTCMonth() + 1).padStart(2, '0');
      const day = String(wibTime.getUTCDate()).padStart(2, '0');
      const hour = String(wibTime.getUTCHours()).padStart(2, '0');
      const min = String(wibTime.getUTCMinutes()).padStart(2, '0');
      
      parsed.observationTimeWIB = `${year}-${month}-${day} ${hour}:${min} WIB`;
      parsed.observationTime = obsTime.toISOString();

      records.push({
        station: data.icao || station,
        raw: data.raw,
        header: `SA ${data.icao || station} ${parsed.time}`,
        datetime: `${obsTime.toISOString().replace('T', ' ').replace('Z', '').slice(0, 16)}`,
        parsed,
      });

      console.log(`SkyLink: Got METAR for ${station}`);
    } catch (err) {
      console.error(`SkyLink failed for ${station}:`, err instanceof Error ? err.message : err);
    }
  }

  return records;
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

// Fetch METAR from BMKG via Cloudflare Worker proxy
// The proxy handles cookie management and caching
async function fetchFromBMKG(
  stations: string[],
  from: string,
  to: string,
  includeMetar: boolean = true,
  includeSpeci: boolean = true
): Promise<MetarRecord[]> {
  const cheerio = await import('cheerio');

  if (!BMKG_PROXY_URL) {
    throw new Error('BMKG_PROXY_URL not configured');
  }

  const formData = new URLSearchParams();
  formData.append('stasiun', stations.join(' '));
  formData.append('from', from);
  formData.append('to', to);
  if (includeMetar) formData.append('metar', 'SA');
  if (includeSpeci) formData.append('speci', 'SP');

  const body = formData.toString();
  console.log('BMKG proxy request:', { station: stations, from, to, proxyUrl: BMKG_PROXY_URL });

  // Try up to 3 times with exponential backoff
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`BMKG proxy attempt ${attempt}/3...`);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const response = await fetch(BMKG_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error(`BMKG proxy returned ${response.status} on attempt ${attempt}:`, errText.substring(0, 200));
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
        throw new Error(`BMKG proxy error: ${response.status}`);
      }

      const html = await response.text();
      
      // Check for Cloudflare challenge
      if (html.includes('Just a moment') || html.includes('cf-challenge') || html.includes('cf_chl_opt')) {
        console.error(`BMKG proxy returned Cloudflare challenge on attempt ${attempt}`);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
        throw new Error('BMKG proxy blocked by Cloudflare challenge');
      }

      // Check for table data
      if (!html.includes('<table') || !html.includes('<td')) {
        console.error(`BMKG proxy returned HTML without table data on attempt ${attempt}`);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
        throw new Error('BMKG proxy returned empty data');
      }

      const $ = cheerio.load(html);
      const records = parseBMKGHtml(html, $);
      console.log(`BMKG proxy returned ${records.length} records`);
      
      if (records.length === 0) {
        console.error('BMKG proxy returned 0 records from table');
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
      }
      
      return records;
    } catch (err) {
      console.error(`BMKG proxy attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw err;
    }
  }

  throw new Error('All BMKG sources failed');
}

// Main function: Try aviationweather.gov → SkyLink → BMKG
export async function fetchMetarData(
  stations: string[],
  from: string, // YYYY-MM-DDTHH:MM
  to: string,   // YYYY-MM-DDTHH:MM
  includeMetar: boolean = true,
  includeSpeci: boolean = true
): Promise<MetarRecord[]> {
  let aviationError: string | null = null;
  let skylinkError: string | null = null;
  
  // Step 1: Try aviationweather.gov (free, reliable)
  try {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const hoursDiff = Math.min(Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60)), 48);
    
    console.log('Fetching from aviationweather.gov API...');
    const records = await fetchFromAviationWeather(stations, hoursDiff);
    
    if (records.length > 0) {
      return records;
    }
    
    console.log('No records from aviationweather for these stations, trying SkyLink...');
  } catch (error) {
    aviationError = error instanceof Error ? error.message : 'unknown';
    console.error('Aviation Weather API failed, trying SkyLink:', error);
  }
  
  // Step 2: Try SkyLink API (free tier: 1,000/month)
  try {
    console.log('Fetching from SkyLink API...');
    const records = await fetchFromSkyLink(stations);
    
    if (records.length > 0) {
      console.log(`SkyLink returned ${records.length} records`);
      return records;
    }
    
    console.log('No records from SkyLink for these stations, trying BMKG...');
  } catch (error) {
    skylinkError = error instanceof Error ? error.message : 'unknown';
    console.error('SkyLink API failed, trying BMKG:', error);
  }
  
  // Step 3: Try BMKG as final fallback
  try {
    return await fetchFromBMKG(stations, from, to, includeMetar, includeSpeci);
  } catch (bmkgError) {
    const bmkgMsg = bmkgError instanceof Error ? bmkgError.message : 'unknown';
    const aviationMsg = aviationError || 'No data available';
    const skylinkMsg = skylinkError || 'No data available';
    throw new Error(`All APIs failed. Aviation Weather: ${aviationMsg}, SkyLink: ${skylinkMsg}, BMKG: ${bmkgMsg}`);
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
