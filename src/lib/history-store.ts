import { promises as fs } from 'fs';
import path from 'path';
import { type MetarRecord } from './bmkg-scraper';

const HISTORY_DIR = path.join(process.cwd(), 'data', 'history');
const MAX_RECORDS_PER_FILE = 1000;

async function ensureDir() {
  try {
    await fs.access(HISTORY_DIR);
  } catch {
    await fs.mkdir(HISTORY_DIR, { recursive: true });
  }
}

function getDateKey(date: Date): string {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

export async function saveMetarHistory(records: MetarRecord[]): Promise<void> {
  await ensureDir();
  
  // Group records by date
  const grouped = new Map<string, MetarRecord[]>();
  for (const record of records) {
    const dateKey = record.datetime ? getDateKey(new Date(record.datetime)) : getDateKey(new Date());
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    grouped.get(dateKey)!.push(record);
  }

  for (const [dateKey, dateRecords] of grouped) {
    const filePath = path.join(HISTORY_DIR, `${dateKey}.json`);
    let existing: MetarRecord[] = [];
    
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      existing = JSON.parse(data);
    } catch {
      // File doesn't exist yet
    }

    // Merge and deduplicate by raw string + datetime
    const combined = [...existing, ...dateRecords];
    const seen = new Set<string>();
    const unique = combined.filter(r => {
      const key = `${r.raw}|${r.datetime}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Keep only the most recent records
    const trimmed = unique.slice(-MAX_RECORDS_PER_FILE);
    await fs.writeFile(filePath, JSON.stringify(trimmed, null, 2));
  }
}

export async function getMetarHistory(
  station: string,
  startDate?: string,
  endDate?: string
): Promise<MetarRecord[]> {
  await ensureDir();
  
  const records: MetarRecord[] = [];
  
  try {
    const files = await fs.readdir(HISTORY_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
    
    for (const file of jsonFiles) {
      const dateKey = file.replace('.json', '');
      
      // Filter by date range if provided
      if (startDate && dateKey < startDate) continue;
      if (endDate && dateKey > endDate) continue;
      
      const data = await fs.readFile(path.join(HISTORY_DIR, file), 'utf-8');
      const fileRecords: MetarRecord[] = JSON.parse(data);
      
      // Filter by station
      const stationRecords = fileRecords.filter(r => 
        r.station === station || r.parsed?.station === station
      );
      
      records.push(...stationRecords);
    }
  } catch (error) {
    console.error('Error reading history:', error);
  }
  
  return records;
}
