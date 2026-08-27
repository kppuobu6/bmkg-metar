export interface MetarData {
  raw: string;
  type: 'METAR' | 'SPECI';
  station: string;
  time: string; // DDHHmmZ format
  observationTime: string; // ISO string
  observationTimeWIB: string; // WIB time string (UTC+7)
  wind: {
    direction: string;
    speed: string;
    gusts?: string;
    unit: string;
    variable?: boolean;
    variation?: { from: string; to: string };
  } | null;
  visibility: {
    value: string;
    unit: string;
  } | null;
  weather: string[];
  clouds: Array<{
    type: string;
    height: string;
    modifier?: string;
  }>;
  temperature: string | null;
  dewpoint: string | null;
  altimeter: {
    value: string;
    unit: string;
  } | null;
  trend: string;
  auto: boolean;
  Remarks: string[];
}

const CLOUD_TYPES = ['SKC', 'CLR', 'FEW', 'SCT', 'BKN', 'OVC', 'VV'];

export function parseMetar(raw: string): MetarData {
  const parts = raw.trim().replace('=', '').split(/\s+/);
  
  const result: MetarData = {
    raw,
    type: 'METAR',
    station: '',
    time: '',
    observationTime: '',
    wind: null,
    visibility: null,
    weather: [],
    clouds: [],
    temperature: null,
    dewpoint: null,
    altimeter: null,
    observationTimeWIB: '',
    trend: 'NOSIG',
    auto: false,
    Remarks: [],
  };

  let i = 0;

  // Type
  if (parts[i] === 'SPECI') {
    result.type = 'SPECI';
    i++;
  } else if (parts[i] === 'METAR') {
    i++;
  }

  // Handle COR (correction) modifier
  if (parts[i] === 'COR') {
    i++;
  }

  // Station
  result.station = parts[i] || '';
  i++;

  // Time
  result.time = parts[i] || '';
  i++;

  // Observation time (basic conversion)
  if (result.time) {
    try {
      const day = parseInt(result.time.substring(0, 2));
      const hour = parseInt(result.time.substring(2, 4));
      const min = parseInt(result.time.substring(4, 6));
      const now = new Date();
      const obsDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour, min));
      result.observationTime = obsDate.toISOString();

      // Convert UTC to WIB (UTC+7)
      const wibDate = new Date(obsDate.getTime() + 7 * 60 * 60 * 1000);
      const wibYear = wibDate.getUTCFullYear();
      const wibMonth = String(wibDate.getUTCMonth() + 1).padStart(2, '0');
      const wibDay = String(wibDate.getUTCDate()).padStart(2, '0');
      const wibHour = String(wibDate.getUTCHours()).padStart(2, '0');
      const wibMin = String(wibDate.getUTCMinutes()).padStart(2, '0');
      result.observationTimeWIB = `${wibYear}-${wibMonth}-${wibDay} ${wibHour}:${wibMin} WIB`;
    } catch {
      result.observationTime = '';
      result.observationTimeWIB = '';
    }
  }

  // Parse remaining tokens
  while (i < parts.length) {
    const token = parts[i];

    // Auto
    if (token === 'AUTO') {
      result.auto = true;
      i++;
      continue;
    }

    // Wind: dddssKT or dddssGggKT or VRBssKT
    if (/^(VRB|\d{3})\d{2,3}(G\d{2,3})?KT$/.test(token)) {
      const match = token.match(/^(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?KT$/);
      if (match) {
        result.wind = {
          direction: match[1],
          speed: match[2],
          gusts: match[4],
          unit: 'KT',
          variable: match[1] === 'VRB',
        };
      }
      i++;
      // Check for wind variation
      if (i < parts.length && /^\d{3}V\d{3}$/.test(parts[i]) && result.wind) {
        const varMatch = parts[i].match(/(\d{3})V(\d{3})/);
        if (varMatch) {
          result.wind.variation = { from: varMatch[1], to: varMatch[2] };
        }
        i++;
      }
      continue;
    }

    // Wind with MPS
    if (/^(VRB|\d{3})\d{2,3}(G\d{2,3})?MPS$/.test(token)) {
      const match = token.match(/^(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?MPS$/);
      if (match) {
        result.wind = {
          direction: match[1],
          speed: match[2],
          gusts: match[4],
          unit: 'MPS',
          variable: match[1] === 'VRB',
        };
      }
      i++;
      continue;
    }

    // Visibility (4 digits)
    if (/^\d{4}$/.test(token) && !result.visibility) {
      result.visibility = { value: token, unit: 'm' };
      i++;
      continue;
    }

    // Visibility with M prefix (less than)
    if (/^M\d{4}$/.test(token)) {
      result.visibility = { value: token.substring(1), unit: 'm', };
      i++;
      continue;
    }

    // Cavok
    if (token === 'CAVOK') {
      result.visibility = { value: '9999', unit: 'm' };
      i++;
      continue;
    }

    // Clouds
    if (CLOUD_TYPES.includes(token.substring(0, 3))) {
      const cloudType = token.substring(0, 3);
      const cloudHeight = token.substring(3, 6);
      const modifier = token.substring(6) || undefined;
      result.clouds.push({ type: cloudType, height: cloudHeight, modifier });
      i++;
      continue;
    }

    // Weather phenomena (e.g., -RA, +TSRA, VCSH, etc.)
    if (/^[-+]?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP)?(BR|FG|FU|VA|DU|SA|HZ|PY)?(PO|SQ|FC|SS|DS)?$/.test(token) && token.length > 1) {
      result.weather.push(token);
      i++;
      continue;
    }

    // Temperature: TT/DD
    if (/^-?\d{2}\/-?\d{2}$/.test(token)) {
      const [temp, dew] = token.split('/');
      result.temperature = temp;
      result.dewpoint = dew;
      i++;
      continue;
    }

    // Altimeter: QNHhHHH or Ahhhh
    if (/^Q\d{3,4}$/.test(token)) {
      result.altimeter = { value: token.substring(1), unit: 'hPa' };
      i++;
      continue;
    }
    if (/^A\d{4}$/.test(token)) {
      result.altimeter = { value: token.substring(1), unit: 'inHg' };
      i++;
      continue;
    }

    // Trend
    if (['NOSIG', 'BECMG', 'TEMPO', 'INTER'].includes(token)) {
      result.trend = token;
      i++;
      continue;
    }

    // RMK section
    if (token === 'RMK') {
      result.Remarks = parts.slice(i + 1);
      i = parts.length;
      continue;
    }

    i++;
  }

  return result;
}

export function formatWindDirection(degrees: string): string {
  if (degrees === 'VRB') return 'VRB';
  return `${degrees}°`;
}

export function getWindCompass(degrees: string): string {
  if (degrees === 'VRB') return 'Variable';
  const d = parseInt(degrees);
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return directions[Math.round(d / 22.5) % 16];
}

export function formatVisibility(meters: string): string {
  const m = parseInt(meters);
  if (m >= 10000) return `${(m / 1000).toFixed(0)} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${m} m`;
}

export function formatCloudHeight(hundreds: string): string {
  const h = parseInt(hundreds) * 100;
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k ft`;
  return `${h} ft`;
}
