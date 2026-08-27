import * as cheerio from 'cheerio';
import { parseMetar, type MetarData } from './metar-parser';

export interface MetarRecord {
  station: string;
  raw: string;
  header: string;
  datetime: string;
  parsed: MetarData;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function fetchMetarData(
  stations: string[],
  from: string, // YYYY-MM-DDTHH:MM
  to: string,   // YYYY-MM-DDTHH:MM
  includeMetar: boolean = true,
  includeSpeci: boolean = true
): Promise<MetarRecord[]> {
  const formData = new URLSearchParams();
  formData.append('stasiun', stations.join(' '));
  formData.append('from', from);
  formData.append('to', to);
  if (includeMetar) formData.append('metar', 'SA');
  if (includeSpeci) formData.append('speci', 'SP');

  const response = await fetch('https://web-aviation.bmkg.go.id/web/metar_speci.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Origin': 'https://web-aviation.bmkg.go.id',
      'Referer': 'https://web-aviation.bmkg.go.id/web/metar_speci.php',
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch METAR data: ${response.status}`);
  }

  const html = await response.text();
  
  // Check for Cloudflare challenge
  if (html.includes('challenge-platform') && !html.includes('<tbody>')) {
    throw new Error('Cloudflare protection detected. Please try again or use a different network.');
  }

  const $ = cheerio.load(html);
  const records: MetarRecord[] = [];

  $('table tbody tr').each((_, row) => {
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
  { code: 'WIII', name: 'Jakarta (Halim Perdanakusuma)' },
  { code: 'WARJ', name: 'Surabaya (Abdul Rachman Saleh)' },
  { code: 'WADY', name: 'Yogyakarta (New Yogyakarta)' },
];
