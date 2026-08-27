"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { parseMetar, formatWindDirection, getWindCompass, formatVisibility, formatCloudHeight, type MetarData } from "@/lib/metar-parser";
import { getAirportName } from "@/lib/airports";

interface MetarRecord {
  station: string;
  raw: string;
  header: string;
  datetime: string;
  parsed: MetarData;
}

import { AIRPORT_NAMES } from "@/lib/airports";

const POPULAR_STATIONS = [
  { code: "WIII" },
  { code: "WADD" },
  { code: "WICC" },
  { code: "WARR" },
  { code: "WAHH" },
  { code: "WAMM" },
  { code: "WIMM" },
  { code: "WATT" },
  { code: "WAWS" },
  { code: "WARJ" },
  { code: "WIEE" },
  { code: "WIBB" },
];

function MetarCard({ record }: { record: MetarRecord }) {
  const { parsed } = record;
  const isSpeci = parsed.type === "SPECI";
  const airportName = getAirportName(parsed.station);
  
  return (
    <div className="metar-card rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className={`badge ${isSpeci ? "badge-speci" : "badge-metar"}`}>
              {parsed.type}
            </span>
            <span className="text-xl font-bold tracking-tight text-gray-900">
              {parsed.station}
            </span>
          </div>
          {airportName && (
            <p className="mt-1 text-xs text-gray-500">
              {airportName}
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="time-utc">{record.datetime} UTC</div>
          <div className="time-wib">{parsed.observationTimeWIB}</div>
        </div>
      </div>

      {/* Decoded Info Grid */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Wind */}
        {parsed.wind && (
          <div className="info-box">
            <div className="info-box-label">Wind</div>
            <div className="info-box-value">
              {formatWindDirection(parsed.wind.direction)} {parsed.wind.speed}
              <span className="text-xs font-normal text-gray-500">{parsed.wind.unit}</span>
              {parsed.wind.gusts && (
                <span className="ml-1 text-xs text-amber-600">G{parsed.wind.gusts}</span>
              )}
            </div>
            <div className="text-[10px] text-gray-400">{getWindCompass(parsed.wind.direction)}</div>
          </div>
        )}

        {/* Visibility */}
        {parsed.visibility && (
          <div className="info-box">
            <div className="info-box-label">Visibility</div>
            <div className="info-box-value">
              {formatVisibility(parsed.visibility.value)}
            </div>
          </div>
        )}

        {/* Temperature */}
        {parsed.temperature && (
          <div className="info-box">
            <div className="info-box-label">Temp / Dew</div>
            <div className="info-box-value">
              {parsed.temperature}°C <span className="text-gray-400">/</span> {parsed.dewpoint}°C
            </div>
          </div>
        )}

        {/* Altimeter */}
        {parsed.altimeter && (
          <div className="info-box">
            <div className="info-box-label">QNH</div>
            <div className="info-box-value">
              {parsed.altimeter.value} <span className="text-xs font-normal text-gray-500">{parsed.altimeter.unit}</span>
            </div>
          </div>
        )}
      </div>

      {/* Clouds */}
      {parsed.clouds.length > 0 && (
        <div className="mb-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Clouds</div>
          <div className="flex flex-wrap gap-1.5">
            {parsed.clouds.map((cloud, i) => (
              <span key={i} className="inline-flex items-center rounded-md bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
                {cloud.type} {formatCloudHeight(cloud.height)}
                {cloud.modifier && <span className="ml-1 text-amber-600">{cloud.modifier}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Weather Phenomena */}
      {parsed.weather.length > 0 && (
        <div className="mb-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Weather</div>
          <div className="flex flex-wrap gap-1.5">
            {parsed.weather.map((w, i) => (
              <span key={i} className="inline-flex items-center rounded-md bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                {w}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Trend */}
      {parsed.trend && parsed.trend !== "NOSIG" && (
        <div className="mb-3">
          <span className="inline-flex items-center rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
            {parsed.trend}
          </span>
        </div>
      )}

      {/* Raw METAR */}
      <details className="group mt-3">
        <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-600">
          <svg className="h-3 w-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Raw METAR
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-600 ring-1 ring-inset ring-gray-100">
          {parsed.raw}
        </pre>
      </details>
    </div>
  );
}

export default function Home() {
  const [stations, setStations] = useState("WIII");
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 12);
    return d.toISOString().slice(0, 16);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [records, setRecords] = useState<MetarRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [historyStation, setHistoryStation] = useState("");
  const [historyRecords, setHistoryRecords] = useState<MetarRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const stationInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    if (!stations.trim()) return;
    
    setLoading(true);
    setError(null);
    
    // Auto-update "To" time to current time
    const now = new Date();
    setTo(now.toISOString().slice(0, 16));
    
    try {
      const stationList = stations.split(/[\s,]+/).filter(Boolean);
      // Add timestamp to prevent caching
      const cacheBuster = Date.now();
      const params = new URLSearchParams({
        stations: stationList.join(","),
        from,
        to: now.toISOString().slice(0, 16),
        t: cacheBuster.toString(),
      });
      
      const response = await fetch(`/api/metar?${params}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch data");
      }
      
      setRecords(data.records || []);
      setLastRefresh(new Date());

      // Auto-save to history
      if (data.records?.length > 0) {
        await fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: data.records }),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [stations, from, to]);

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchData, refreshInterval * 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, refreshInterval, fetchData]);

  // Enter key handler for station input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fetchData();
    }
  };

  const loadHistory = async (station: string) => {
    if (!station.trim()) return;
    try {
      const params = new URLSearchParams({ station });
      const response = await fetch(`/api/history?${params}`);
      const data = await response.json();
      setHistoryRecords(data.records || []);
      setShowHistory(true);
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg text-white shadow-sm">
              ✈
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-gray-900">
                BMKG METAR Viewer
              </h1>
              <p className="text-xs text-gray-500">
                Real-time Indonesian aviation weather
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400"></span>
            <span className="text-xs font-medium text-gray-500">Live</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Search Form */}
        <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-sm font-semibold text-gray-700">Search METAR Data</span>
          </div>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            {/* Station Input */}
            <div className="flex-1">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                ICAO Station Code(s)
              </label>
              <div className="relative">
                <input
                  ref={stationInputRef}
                  type="text"
                  value={stations}
                  onChange={(e) => setStations(e.target.value.toUpperCase())}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. WIII WADD WICC"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-900 placeholder-gray-400 transition-colors focus:border-blue-500 focus:bg-white focus:ring-0"
                />
                <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
                  ↵ Enter
                </div>
              </div>
            </div>

            {/* From */}
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                From
              </label>
              <input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                onKeyDown={handleKeyDown}
                className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 focus:border-blue-500 focus:bg-white focus:ring-0"
              />
            </div>

            {/* To */}
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                To
              </label>
              <input
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                onKeyDown={handleKeyDown}
                className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 focus:border-blue-500 focus:bg-white focus:ring-0"
              />
            </div>

            {/* Search Button */}
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow-md disabled:opacity-50"
            >
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Loading...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search
                </>
              )}
            </button>
          </div>

          {/* Popular Stations */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Popular:</span>
            {POPULAR_STATIONS.map((s) => (
              <button
                key={s.code}
                onClick={() => {
                  setStations(s.code);
                  stationInputRef.current?.focus();
                }}
                className={`station-btn ${stations === s.code ? "active" : ""}`}
                title={AIRPORT_NAMES[s.code] || s.code}
              >
                {s.code}
              </button>
            ))}
          </div>
        </div>

        {/* Controls Bar */}
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-gray-100 bg-white px-6 py-4 shadow-sm">
          {/* Auto-refresh */}
          <label className="flex cursor-pointer items-center gap-2.5">
            <div className="relative">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="peer sr-only"
              />
              <div className="h-5 w-9 rounded-full bg-gray-200 transition-colors peer-checked:bg-blue-600"></div>
              <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4"></div>
            </div>
            <span className="text-sm font-medium text-gray-600">Auto-refresh</span>
          </label>

          {autoRefresh && (
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:ring-0"
            >
              <option value={15}>15 sec</option>
              <option value={30}>30 sec</option>
              <option value={60}>1 minute</option>
              <option value={120}>2 minutes</option>
              <option value={300}>5 minutes</option>
            </select>
          )}

          {lastRefresh && (
            <span className="ml-auto flex items-center gap-2 text-xs text-gray-400">
              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
              Updated: {lastRefresh.toLocaleTimeString("id-ID")}
            </span>
          )}

          {/* History */}
          <div className="flex items-center gap-2 border-l border-gray-100 pl-4">
            <input
              type="text"
              value={historyStation}
              onChange={(e) => setHistoryStation(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  loadHistory(historyStation);
                }
              }}
              placeholder="Station history"
              className="w-28 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 placeholder-gray-400 focus:border-blue-500 focus:ring-0"
            />
            <button
              onClick={() => loadHistory(historyStation)}
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              History
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-red-700">
            <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium">{error}</span>
          </div>
        )}

        {/* Results */}
        {records.length > 0 && (
          <div className="mb-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">
                Results
                <span className="ml-2 text-sm font-normal text-gray-400">({records.length} records)</span>
              </h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {records.map((record, i) => (
                <MetarCard key={`${record.raw}-${i}`} record={record} />
              ))}
            </div>
          </div>
        )}

        {/* History Modal */}
        {showHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm">
            <div className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">History</h2>
                  <p className="text-sm text-gray-500">Station: {historyStation}</p>
                </div>
                <button
                  onClick={() => setShowHistory(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {historyRecords.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="text-4xl">📭</div>
                  <p className="mt-3 text-sm text-gray-500">No historical data found for this station.</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {historyRecords.map((record, i) => (
                    <MetarCard key={`hist-${record.raw}-${i}`} record={record} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && records.length === 0 && !error && (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-16 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
              <svg className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
            </div>
            <h3 className="mt-4 text-base font-semibold text-gray-900">
              No METAR data yet
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Enter ICAO station codes above and press <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">Enter</kbd> or click Search
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white py-4 text-center text-[11px] text-gray-400">
        Data from <a href="https://web-aviation.bmkg.go.id" target="_blank" rel="noopener noreferrer" className="font-medium text-gray-500 hover:text-blue-600">BMKG Aviation</a> • Built with Next.js
      </footer>
    </div>
  );
}
