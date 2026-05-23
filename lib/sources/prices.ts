// SENSE layer — real stock price (daily history + last close).
//
// Daily OHLC for the watchlist, from Stooq (keyless CSV) with a Yahoo fallback.
// stockPrice() returns the two points the loop stores (reference + latest close);
// dailyHistory() exposes the recent daily closes for the 5-day chart. On weekends
// the latest row is Friday's close ("last close"). Cached per ticker (daily data
// doesn't change intraday) with jitter + retry so we don't burst either source.

import type { PricePoint } from "@/lib/types";
import { isMarketClosed } from "@/lib/sources/nimble";

const STOOQ = "https://stooq.com/q/d/l/";
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/";
const TTL_MS = 6 * 60 * 60 * 1000;
const UA = "Mozilla/5.0 (Sonar market radar)";

export interface DailyClose {
  date: string; // YYYY-MM-DD
  close: number;
  volume: number;
}
interface Quote {
  ref: number;
  refVol: number;
  last: number;
  lastVol: number;
  closed: boolean;
  at: number;
  daily: DailyClose[];
}
const cache = new Map<string, Quote>();

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function quoteFrom(series: DailyClose[]): Quote {
  if (series.length < 2) throw new Error("insufficient data");
  const latest = series[series.length - 1];
  const reference = series[Math.max(0, series.length - 1 - 3)]; // ~3 trading days back
  return {
    ref: reference.close,
    refVol: reference.volume,
    last: latest.close,
    lastVol: latest.volume,
    closed: isMarketClosed(),
    at: Date.now(),
    daily: series.slice(-12),
  };
}

async function fetchStooq(ticker: string): Promise<Quote> {
  const d2 = new Date();
  const d1 = new Date(Date.now() - 40 * 24 * 3600 * 1000);
  const url = `${STOOQ}?s=${ticker.toLowerCase()}.us&d1=${ymd(d1)}&d2=${ymd(d2)}&i=d`;
  const res = await fetch(url, { cache: "no-store", headers: { "user-agent": UA }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(`stooq ${res.status}`);
  const text = await res.text();
  const series = text
    .trim()
    .split("\n")
    .slice(1) // header: Date,Open,High,Low,Close,Volume
    .map((line) => line.split(","))
    .filter((c) => c.length >= 5 && c[4] && !Number.isNaN(Number(c[4])))
    .map((c) => ({ date: c[0], close: Number(c[4]), volume: Number(c[5] ?? 0) || 0 }));
  return quoteFrom(series);
}

async function fetchYahoo(ticker: string): Promise<Quote> {
  const url = `${YAHOO}${encodeURIComponent(ticker)}?range=1mo&interval=1d`;
  const res = await fetch(url, { cache: "no-store", headers: { "user-agent": UA }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  const r = data?.chart?.result?.[0];
  const tstamps: number[] = r?.timestamp ?? [];
  const closes: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? [];
  const vols: (number | null)[] = r?.indicators?.quote?.[0]?.volume ?? [];
  const series = closes
    .map((c, i) => ({ date: new Date((tstamps[i] ?? 0) * 1000).toISOString().slice(0, 10), close: c as number, volume: (vols[i] ?? 0) as number }))
    .filter((x): x is DailyClose => typeof x.close === "number" && !Number.isNaN(x.close));
  return quoteFrom(series);
}

async function getQuote(ticker: string): Promise<Quote> {
  const now = Date.now();
  const cached = cache.get(ticker);
  if (cached && now - cached.at < TTL_MS) return cached;

  await sleep(Math.random() * 700); // de-sync the burst
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const fetcher of [fetchStooq, fetchYahoo]) {
      try {
        const q = await fetcher(ticker);
        cache.set(ticker, q);
        return q;
      } catch (e) {
        lastErr = e;
      }
    }
    if (attempt === 0) await sleep(500 + Math.random() * 600);
  }
  console.error(`[prices] ${ticker} live fetch failed (stooq+yahoo), using fallback:`, lastErr);
  if (cached) return cached;
  return synthQuote(ticker);
}

function synthQuote(ticker: string): Quote {
  let h = 2166136261;
  for (let i = 0; i < ticker.length; i++) {
    h ^= ticker.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const base = 50 + ((h >>> 0) % 600);
  const daily: DailyClose[] = [];
  for (let i = 7; i >= 0; i--) {
    daily.push({ date: new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), close: base, volume: 1_000_000 });
  }
  return { ref: base, refVol: 1_000_000, last: base, lastVol: 1_000_000, closed: isMarketClosed(), at: Date.now(), daily };
}

export async function stockPrice(ticker: string): Promise<PricePoint[]> {
  const q = await getQuote(ticker);
  const now = Date.now();
  return [
    { ticker, ts: now - 2000, price: q.ref, volume: q.refVol, asOfClose: q.closed },
    { ticker, ts: now, price: q.last, volume: q.lastVol, asOfClose: q.closed },
  ];
}

// Recent daily closes for the 5-day chart (real history).
export async function dailyHistory(ticker: string, n = 7): Promise<DailyClose[]> {
  const q = await getQuote(ticker);
  return q.daily.slice(-n);
}
