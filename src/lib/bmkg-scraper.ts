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

// Simple in-memory cache to reduce redundant API calls within the same serverless instance
// This helps when multiple users search the same station around the same time
const responseCache = new Map<string, { data: MetarRecord[]; expiry: number }>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

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
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

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


// Detect which column contains what by content pattern
function detectColumns($: any, headerRow: any): { raw: number; header: number; station: number; datetime: number } | null {
  const ths = $(headerRow).find('th, td');
  if (ths.length < 2) return null;

  const cols = { raw: -1, header: -1, station: -1, datetime: -1 };
  
  ths.each((_: number, el: any) => {
    const text = $(el).text().trim().toLowerCase();
    // Match by header text keywords
    if (text.includes('metar') || text.includes('speci') || text.includes('raw') || text.includes('data')) {
      cols.raw = _;
    } else if (text.includes('header') || text.includes('tipe') || text.includes('type') || text.includes('jenis')) {
      cols.header = _;
    } else if (text.includes('stasiun') || text.includes('station') || text.includes('icao') || text.includes('bandara')) {
      cols.station = _;
    } else if (text.includes('tanggal') || text.includes('date') || text.includes('waktu') || text.includes('time') || text.includes('datetime')) {
      cols.datetime = _;
    }
  });

  // If we couldn't detect by header text, try by content pattern on first data row
  return cols;
}

// Try to detect columns by examining cell content patterns
function detectColumnsFromBody($: any, firstRow: any): { raw: number; header: number; station: number; datetime: number } | null {
  const tds = $(firstRow).find('td');
  if (tds.length < 2) return null;

  const cols = { raw: -1, header: -1, station: -1, datetime: -1 };
  
  tds.each((i: number, el: any) => {
    const text = $(el).text().trim();
    
    // METAR raw starts with METAR or SPECI
    if (cols.raw === -1 && /^(METAR|SPECI)\s+\w{4}/.test(text)) {
      cols.raw = i;
    }
    // Station is a 4-letter ICAO code (standalone)
    else if (cols.station === -1 && /^[WA]{2}[A-Z]{2}$/.test(text)) {
      cols.station = i;
    }
    // Datetime pattern: contains date-like text (YYYY-MM-DD, DD/MM/YYYY, or common date formats)
    else if (cols.datetime === -1 && /\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4}|\d{2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text)) {
      cols.datetime = i;
    }
  });

  // Header is usually the remaining column
  if (cols.raw !== -1 && cols.station !== -1 && cols.datetime !== -1) {
    for (let i = 0; i < tds.length; i++) {
      if (i !== cols.raw && i !== cols.station && i !== cols.datetime) {
        cols.header = i;
        break;
      }
    }
  }

  // Only return if we found at least raw + station
  if (cols.raw !== -1 && cols.station !== -1) {
    return cols;
  }

  return null;
}

// Parse METAR records from BMKG HTML
function parseBMKGHtml(html: string, $: any): MetarRecord[] {
  const records: MetarRecord[] = [];

  // Find the data table — look for table with most rows (likely the METAR table)
  let bestTable: any = null;
  let maxRows = 0;
  
  $('table').each((_: number, table: any) => {
    const rowCount = $(table).find('tr').length;
    if (rowCount > maxRows) {
      maxRows = rowCount;
      bestTable = table;
    }
  });

  if (!bestTable) {
    console.log('BMKG HTML: no table found');
    return [];
  }

  const $table = $(bestTable);
  const rows = $table.find('tr');
  
  if (rows.length < 2) {
    console.log('BMKG HTML: table has < 2 rows');
    return [];
  }

  // Try to detect columns from header row
  let cols = detectColumns($, rows[0]);
  
  // If header detection failed, try from first data row
  if (!cols || cols.raw === -1) {
    cols = detectColumnsFromBody($, rows[1]);
  }

  // Fallback: assume old column order (0=raw, 1=header, 2=station, 3=datetime)
  if (!cols) {
    console.log('BMKG HTML: could not detect columns, using fallback order');
    cols = { raw: 0, header: 1, station: 2, datetime: 3 };
  }

  console.log('BMKG HTML: detected columns:', cols);

  // Parse data rows (skip header)
  const startRow = (cols.raw !== -1 && cols.header !== -1) ? 1 : 0;
  
  for (let r = startRow; r < rows.length; r++) {
    const tds = $(rows[r]).find('td');
    if (tds.length < 2) continue;

    const rawCell = cols.raw >= 0 && cols.raw < tds.length ? $(tds[cols.raw]).text().trim() : '';
    const headerCell = cols.header >= 0 && cols.header < tds.length ? $(tds[cols.header]).text().trim() : '';
    const stationCell = cols.station >= 0 && cols.station < tds.length ? $(tds[cols.station]).text().trim() : '';
    const datetimeCell = cols.datetime >= 0 && cols.datetime < tds.length ? $(tds[cols.datetime]).text().trim() : '';

    // Must have a METAR/SPECI raw string
    if (!rawCell || !/^(METAR|SPECI)/.test(rawCell)) continue;

    // Validate raw looks like a real METAR (at least 3 parts)
    const rawParts = rawCell.split(/\s+/);
    if (rawParts.length < 3) {
      console.log(`BMKG HTML: skipping malformed row (only ${rawParts.length} parts): ${rawCell.substring(0, 60)}`);
      continue;
    }

    try {
      const parsed = parseMetar(rawCell);
      records.push({
        station: stationCell || parsed.station,
        raw: rawCell,
        header: headerCell,
        datetime: datetimeCell,
        parsed,
      });
    } catch (err) {
      console.error(`BMKG HTML: failed to parse METAR "${rawCell.substring(0, 60)}...":`, err instanceof Error ? err.message : err);
    }
  }

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

      // Check if response is JSON error (e.g. 503 cached miss)
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const jsonBody = await response.json().catch(() => null);
        const errMsg = jsonBody?.error || 'Unknown error from BMKG proxy';
        console.error(`BMKG proxy returned JSON error on attempt ${attempt}:`, errMsg);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
        throw new Error(`BMKG proxy error: ${errMsg}`);
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

// Simple in-memory cache key
function getCacheKey(stations: string[], from: string, to: string): string {
  return `${stations.sort().join(',')}:${from}:${to}`;
}

// Main function: Try aviationweather.gov → SkyLink → BMKG
export async function fetchMetarData(
  stations: string[],
  from: string, // YYYY-MM-DDTHH:MM
  to: string,   // YYYY-MM-DDTHH:MM
  includeMetar: boolean = true,
  includeSpeci: boolean = true
): Promise<MetarRecord[]> {
  // Check in-memory cache first (same serverless instance, recent request)
  const cacheKey = getCacheKey(stations, from, to);
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    console.log(`[Cache] Serving ${cached.data.length} records from in-memory cache`);
    return cached.data;
  }

  const errors: string[] = [];
  const debugInfo: string[] = [];
  
  // Step 1: Try aviationweather.gov (free, reliable)
  try {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const hoursDiff = Math.min(Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60)), 48);
    
    debugInfo.push('Trying aviationweather.gov...');
    const records = await fetchFromAviationWeather(stations, hoursDiff);
    
    if (records.length > 0) {
      debugInfo.push(`aviationweather.gov: ${records.length} records`);
      console.log(`[METAR] aviationweather.gov returned ${records.length} records for ${stations.join(',')}`);
      
      // Cache the result
      responseCache.set(cacheKey, { data: records, expiry: Date.now() + CACHE_TTL_MS });
      return records;
    }
    
    debugInfo.push('aviationweather.gov: no records (empty response)');
    console.log('No records from aviationweather for these stations, trying SkyLink...');
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'unknown';
    errors.push(`aviationweather.gov: ${errMsg}`);
    debugInfo.push(`aviationweather.gov: FAILED - ${errMsg}`);
    console.error('Aviation Weather API failed, trying SkyLink:', error);
  }
  
  // Step 2: Try SkyLink API (free tier: 1,000/month)
  try {
    debugInfo.push('Trying SkyLink...');
    const records = await fetchFromSkyLink(stations);
    
    if (records.length > 0) {
      debugInfo.push(`SkyLink: ${records.length} records`);
      console.log(`SkyLink returned ${records.length} records`);
      
      // Cache the result
      responseCache.set(cacheKey, { data: records, expiry: Date.now() + CACHE_TTL_MS });
      return records;
    }
    
    debugInfo.push('SkyLink: no records (empty response)');
    console.log('No records from SkyLink for these stations, trying BMKG...');
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'unknown';
    errors.push(`SkyLink: ${errMsg}`);
    debugInfo.push(`SkyLink: FAILED - ${errMsg}`);
    console.error('SkyLink API failed, trying BMKG:', error);
  }
  
  // Step 3: Try BMKG as final fallback
  try {
    debugInfo.push('Trying BMKG proxy...');
    const records = await fetchFromBMKG(stations, from, to, includeMetar, includeSpeci);
    
    if (records.length > 0) {
      debugInfo.push(`BMKG: ${records.length} records`);
      console.log(`[METAR] BMKG returned ${records.length} records for ${stations.join(',')}`);
      
      // Cache the result
      responseCache.set(cacheKey, { data: records, expiry: Date.now() + CACHE_TTL_MS });
      return records;
    }
    
    debugInfo.push('BMKG: no records (empty table)');
  } catch (bmkgError) {
    const bmkgMsg = bmkgError instanceof Error ? bmkgError.message : 'unknown';
    errors.push(`BMKG: ${bmkgMsg}`);
    debugInfo.push(`BMKG: FAILED - ${bmkgMsg}`);
  }
  
  // All sources failed — throw with detailed error info
  const errorDetail = [
    `All APIs failed for stations: ${stations.join(',')}`,
    `Time range: ${from} to ${to}`,
    `Debug trace:`,
    ...debugInfo.map(d => `  - ${d}`),
    `Errors:`,
    ...errors.map(e => `  - ${e}`),
  ].join('; ');
  
  console.error(errorDetail);
  throw new Error(errorDetail);
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
