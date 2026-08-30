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

// BMKG form endpoint (direct access, no proxy)
const BMKG_DIRECT_URL = 'https://web-aviation.bmkg.go.id/web/metar_speci.php';

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


// Parse the CSRF _token from the BMKG page (Laravel form)
function extractCsrf(html: string): string | null {
  const m = html.match(/name="_token"\s+value="([^"]+)"/);
  return m ? m[1] : null;
}

// Collect cookies from a fetch Response (XSRF-TOKEN + aviation_session)
function collectCookies(response: Response): string {
  const cookies: string[] = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') cookies.push(value.split(';')[0]);
  });
  return cookies.join('; ');
}

// Fetch METAR for one station DIRECTLY from BMKG (no proxy).
// Same CSRF dance the worker does: GET page -> cookies + _token -> POST.
// Returns null when blocked (CF challenge) so the caller can fall back.
async function fetchBMKGDirectSingle(
  station: string,
  from: string,
  to: string,
  includeMetar: boolean,
  includeSpeci: boolean
): Promise<MetarRecord[] | null> {
  const cheerio = await import('cheerio');

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const getResp = await fetch(BMKG_DIRECT_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(30000),
      });
      const cookieHeader = collectCookies(getResp);
      const csrf = extractCsrf(await getResp.text());

      if (!cookieHeader || !csrf) {
        console.error(`BMKG direct ${station}: missing cookie/CSRF (challenge?) (attempt ${attempt})`);
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
        return null;
      }

      const formData = new URLSearchParams();
      formData.append('_token', csrf);
      formData.append('stasiun', station);
      formData.append('from', from);
      formData.append('to', to);
      if (includeMetar) formData.append('metar', 'SA');
      if (includeSpeci) formData.append('speci', 'SP');

      const postResp = await fetch(BMKG_DIRECT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': BMKG_DIRECT_URL,
          'Origin': 'https://web-aviation.bmkg.go.id',
          'Cookie': cookieHeader,
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(30000),
      });

      const html = await postResp.text();

      if (html.includes('Just a moment') || html.includes('cf-challenge') || html.includes('cf_chl_opt')) {
        console.error(`BMKG direct ${station}: CF challenge (attempt ${attempt})`);
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
        return null;
      }
      if (!postResp.ok || !html.includes('<table')) {
        console.error(`BMKG direct ${station}: HTTP ${postResp.status} / no table (attempt ${attempt})`);
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
        return null;
      }

      const records = parseBMKGHtml(html, cheerio.load(html));
      console.log(`BMKG direct ${station}: ${records.length} records`);
      return records;
    } catch (err) {
      console.error(`BMKG direct ${station}: ${err instanceof Error ? err.message : err} (attempt ${attempt})`);
      if (attempt < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
      return null;
    }
  }
  return null;
}

// Fetch METAR for a single station from BMKG via Cloudflare Worker proxy
async function fetchFromBMKGSingle(
  station: string,
  from: string,
  to: string,
  includeMetar: boolean,
  includeSpeci: boolean
): Promise<MetarRecord[]> {
  const cheerio = await import('cheerio');

  const formData = new URLSearchParams();
  formData.append('stasiun', station);
  formData.append('from', from);
  formData.append('to', to);
  if (includeMetar) formData.append('metar', 'SA');
  if (includeSpeci) formData.append('speci', 'SP');

  const body = formData.toString();

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(BMKG_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error(`BMKG proxy ${station}: ${response.status} (attempt ${attempt})`);
        if (attempt < 3) { await new Promise(r => setTimeout(r, 1000 * attempt)); continue; }
        return [];
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const jsonBody = await response.json().catch(() => null);
        console.error(`BMKG proxy ${station}: JSON error - ${jsonBody?.error} (attempt ${attempt})`);
        if (attempt < 3) { await new Promise(r => setTimeout(r, 1000 * attempt)); continue; }
        return [];
      }

      const html = await response.text();

      if (html.includes('Just a moment') || html.includes('cf-challenge') || html.includes('cf_chl_opt')) {
        console.error(`BMKG proxy ${station}: CF challenge (attempt ${attempt})`);
        if (attempt < 3) { await new Promise(r => setTimeout(r, 1000 * attempt)); continue; }
        return [];
      }

      if (!html.includes('<table') || !html.includes('<td')) {
        console.error(`BMKG proxy ${station}: no table data (attempt ${attempt})`);
        if (attempt < 3) { await new Promise(r => setTimeout(r, 1000 * attempt)); continue; }
        return [];
      }

      const $ = cheerio.load(html);
      const records = parseBMKGHtml(html, $);
      console.log(`BMKG proxy ${station}: ${records.length} records`);
      return records;
    } catch (err) {
      console.error(`BMKG proxy ${station}: ${err instanceof Error ? err.message : err} (attempt ${attempt})`);
      if (attempt < 3) { await new Promise(r => setTimeout(r, 1000 * attempt)); continue; }
      return [];
    }
  }

  return [];
}

// Fetch METAR from BMKG: try DIRECT first (no proxy), fall back to the
// Cloudflare Worker proxy when direct is blocked (e.g. CF challenge).
// Each station individually (parallel) to avoid BMKG timeout on multi-station requests.
async function fetchFromBMKG(
  stations: string[],
  from: string,
  to: string,
  includeMetar: boolean = true,
  includeSpeci: boolean = true
): Promise<MetarRecord[]> {
  console.log(`BMKG request: stations=${stations.join(',')} from=${from} to=${to}`);

  const results = await Promise.all(
    stations.map(async s => {
      // Worker first: proven to work from Vercel (CF blocks datacenter IPs on
      // direct). Direct is the fallback — it works from local dev and rescues
      // requests when the worker itself is down.
      if (BMKG_PROXY_URL) {
        const viaWorker = await fetchFromBMKGSingle(s, from, to, includeMetar, includeSpeci);
        if (viaWorker.length > 0) return viaWorker;
        console.log(`BMKG ${s}: worker empty/blocked, falling back to direct`);
      }
      const direct = await fetchBMKGDirectSingle(s, from, to, includeMetar, includeSpeci);
      return direct || [];
    })
  );

  const allRecords = results.flat();
  console.log(`BMKG total: ${allRecords.length} records from ${stations.length} stations`);

  if (allRecords.length === 0) {
    throw new Error('BMKG returned no data for any station');
  }

  return allRecords;
}

// Simple in-memory cache key
function getCacheKey(stations: string[], from: string, to: string): string {
  return `${stations.sort().join(',')}:${from}:${to}`;
}

// Get the latest observation time from a set of records
function getLatestObsTime(records: MetarRecord[]): number {
  let latest = 0;
  for (const r of records) {
    const t = r.parsed.observationTime ? new Date(r.parsed.observationTime).getTime() : 0;
    if (t > latest) latest = t;
  }
  return latest;
}

// Merge records from multiple sources, deduplicating by station + time
function mergeRecords(...sources: MetarRecord[][]): MetarRecord[] {
  const seen = new Map<string, MetarRecord>();
  for (const source of sources) {
    for (const record of source) {
      const key = `${record.station}:${record.parsed.time}`;
      if (!seen.has(key)) {
        seen.set(key, record);
      }
    }
  }
  return Array.from(seen.values());
}

// Main function: Fetch from all sources in parallel, return the freshest data
// opts.fresh skips the in-memory cache so every request hits live sources
export async function fetchMetarData(
  stations: string[],
  from: string, // YYYY-MM-DDTHH:MM
  to: string,   // YYYY-MM-DDTHH:MM
  includeMetar: boolean = true,
  includeSpeci: boolean = true,
  opts: { fresh?: boolean } = {}
): Promise<MetarRecord[]> {
  // Check in-memory cache first (same serverless instance, recent request)
  const cacheKey = getCacheKey(stations, from, to);
  if (!opts.fresh) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      console.log(`[Cache] Serving ${cached.data.length} records from in-memory cache`);
      return cached.data;
    }
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  const hoursDiff = Math.min(Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60)), 48);

  // Fetch from all sources in parallel for maximum freshness
  const [aviationResult, skylinkResult, bmkgResult] = await Promise.allSettled([
    fetchFromAviationWeather(stations, hoursDiff),
    SKYLINK_API_KEY ? fetchFromSkyLink(stations) : Promise.resolve([]),
    BMKG_PROXY_URL ? fetchFromBMKG(stations, from, to, includeMetar, includeSpeci) : Promise.resolve([]),
  ]);

  const aviationRecords = aviationResult.status === 'fulfilled' ? aviationResult.value : [];
  const skylinkRecords = skylinkResult.status === 'fulfilled' ? skylinkResult.value : [];
  const bmkgRecords = bmkgResult.status === 'fulfilled' ? bmkgResult.value : [];

  console.log(`[METAR] aviationweather.gov: ${aviationRecords.length}, SkyLink: ${skylinkRecords.length}, BMKG: ${bmkgRecords.length}`);

  // Determine which source has the freshest data
  const aviationLatest = getLatestObsTime(aviationRecords);
  const bmkgLatest = getLatestObsTime(bmkgRecords);

  let records: MetarRecord[];

  if (bmkgLatest > aviationLatest && bmkgRecords.length > 0) {
    // BMKG has fresher data — use BMKG as primary, merge any extras from aviation
    console.log(`[METAR] BMKG is fresher (${new Date(bmkgLatest).toISOString()} vs ${new Date(aviationLatest).toISOString()})`);
    records = mergeRecords(bmkgRecords, aviationRecords, skylinkRecords);
  } else if (aviationRecords.length > 0) {
    // aviationweather.gov has fresher or equal data
    console.log(`[METAR] aviationweather.gov is primary source`);
    records = mergeRecords(aviationRecords, bmkgRecords, skylinkRecords);
  } else if (bmkgRecords.length > 0) {
    // Only BMKG has data
    records = bmkgRecords;
  } else if (skylinkRecords.length > 0) {
    // Only SkyLink has data
    records = skylinkRecords;
  } else {
    // No data from any source
    const errors: string[] = [];
    if (aviationResult.status === 'rejected') errors.push(`aviationweather.gov: ${aviationResult.reason?.message || 'unknown'}`);
    if (skylinkResult.status === 'rejected') errors.push(`SkyLink: ${skylinkResult.reason?.message || 'unknown'}`);
    if (bmkgResult.status === 'rejected') errors.push(`BMKG: ${bmkgResult.reason?.message || 'unknown'}`);
    
    throw new Error(`No METAR data available. Errors: ${errors.join('; ') || 'all sources returned empty'}`);
  }

  console.log(`[METAR] Final: ${records.length} records for ${stations.join(',')}`);

  // Sort by time (newest first)
  records.sort((a, b) => {
    const timeA = a.parsed.observationTime ? new Date(a.parsed.observationTime).getTime() : 0;
    const timeB = b.parsed.observationTime ? new Date(b.parsed.observationTime).getTime() : 0;
    return timeB - timeA;
  });

  // Cache the result
  responseCache.set(cacheKey, { data: records, expiry: Date.now() + CACHE_TTL_MS });

  return records;
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
  { code: 'WIKT', name: 'Tanjung Pandan (H.A.S. Hanandjoeddin)' },
];
