// SENSE layer — Polymarket adapter (the underused crowd-forecast signal).
// Polymarket's Gamma API is public (no key), so this path is fully real.
// Docs: https://docs.polymarket.com  (gamma-api.polymarket.com)
//
// Polymarket rarely runs single-stock markets, so we match THEMATICALLY: the
// company/people behind a ticker first (Nvidia, Musk, OpenAI…), then tech
// themes (AI, chips), then macro markets that move all equities (Fed, rate
// cuts, recession, Bitcoin). We pick the highest-volume real match per ticker.

import type { PolyPoint } from "@/lib/types";

const GAMMA = "https://gamma-api.polymarket.com";

// Cache the markets list so all watchlist tickers reuse one fetch per loop.
const MARKETS_TTL = 3 * 60 * 1000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let marketsCache: { data: any[]; at: number } | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMarkets(): Promise<any[]> {
  if (marketsCache && Date.now() - marketsCache.at < MARKETS_TTL) return marketsCache.data;
  const url = `${GAMMA}/markets?closed=false&active=true&limit=500&order=volume24hr&ascending=false`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`gamma ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markets = (await res.json()) as any[];
  marketsCache = { data: markets, at: Date.now() };
  return markets;
}

// Matched in tiers, most specific first: company/people -> AI/tech -> macro.
const COMPANY: Record<string, string[]> = {
  NVDA: ["nvidia", "jensen huang"],
  TSLA: ["tesla", "musk", "elon", "robotaxi", "spacex"],
  AAPL: ["apple", "iphone", "tim cook", "vision pro"],
  MSFT: ["microsoft", "copilot"],
  AMD: ["amd"],
  META: ["meta", "zuckerberg", "facebook", "instagram"],
};
const TECH = ["openai", "agi", "artificial intelligence", "ai", "gpu", "chip", "semiconductor"];
const MACRO = ["fed", "interest rate", "rate cut", "recession", "bitcoin", "nasdaq", "stock market", "s&p"];

// A market is a live "forecast" only if the crowd is still uncertain — exclude
// effectively-resolved markets (lead outcome >= 93%), which carry no signal.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isLiveForecast(m: any): boolean {
  const p = leadProbability(m);
  return p > 0 && p <= 0.93;
}

export async function polymarketFor(ticker: string): Promise<PolyPoint[]> {
  try {
    const markets = await getMarkets();
    const now = Date.now();

    const tiers = [COMPANY[ticker] ?? [ticker.toLowerCase()], TECH, MACRO];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chosen: any[] = [];
    for (const terms of tiers) {
      const ms = markets
        .filter((m) => isLiveForecast(m) && matchesAny(marketText(m), terms))
        .sort((a, b) => vol(b) - vol(a));
      if (ms.length) {
        chosen = ms.slice(0, 2);
        break;
      }
    }
    if (!chosen.length) return fallbackPoly(ticker);

    return chosen.map((m) => ({
      ticker,
      ts: now,
      marketId: String(m.id ?? m.conditionId ?? m.slug ?? ""),
      question: m.question ?? m.title ?? "",
      prob: leadProbability(m),
      url: m.slug ? `https://polymarket.com/event/${m.slug}` : "https://polymarket.com",
    }));
  } catch (e) {
    console.error("[polymarket] live call failed, using fallback:", e);
    return fallbackPoly(ticker);
  }
}

// Pick the single best live market for a ticker (company -> tech -> macro).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function chosenMarket(ticker: string): Promise<any | null> {
  const markets = await getMarkets();
  const tiers = [COMPANY[ticker] ?? [ticker.toLowerCase()], TECH, MACRO];
  for (const terms of tiers) {
    const ms = markets.filter((m) => isLiveForecast(m) && matchesAny(marketText(m), terms)).sort((a, b) => vol(b) - vol(a));
    if (ms.length) return ms[0];
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clobTokenId(m: any): string | null {
  try {
    const raw = m.clobTokenIds;
    const arr: string[] = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(arr) && arr.length ? String(arr[0]) : null; // "Yes" outcome token
  } catch {
    return null;
  }
}

// Real 5-day daily odds history for the matched market (CLOB /prices-history).
export async function polymarketHistory(ticker: string, days = 5): Promise<{ date: string; prob: number; question: string }[]> {
  try {
    const m = await chosenMarket(ticker);
    if (!m) return [];
    const token = clobTokenId(m);
    if (!token) return [];
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - (days + 1) * 86400;
    const url = `https://clob.polymarket.com/prices-history?market=${token}&startTs=${startTs}&endTs=${endTs}&fidelity=1440`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`clob ${res.status}`);
    const data = (await res.json()) as { history?: { t: number; p: number }[] };
    const byDay = new Map<string, number>();
    for (const h of data.history ?? []) {
      if (typeof h.t === "number" && typeof h.p === "number") byDay.set(new Date(h.t * 1000).toISOString().slice(0, 10), h.p);
    }
    const question = m.question ?? m.title ?? "";
    return [...byDay.entries()].map(([date, prob]) => ({ date, prob, question })).sort((a, b) => (a.date < b.date ? -1 : 1));
  } catch (e) {
    console.error("[polymarket:history]", e);
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function marketText(m: any): string {
  return `${m.question ?? ""} ${m.title ?? ""} ${m.slug ?? ""}`.replace(/-/g, " ");
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function vol(m: any): number {
  return Number(m.volumeNum ?? m.volume ?? m.volume24hr ?? 0) || 0;
}
function matchesAny(text: string, terms: string[]): boolean {
  return terms.some((t) => {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${esc}\\b`, "i").test(text);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function leadProbability(m: any): number {
  try {
    const raw = m.outcomePrices;
    const arr: string[] = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(arr) && arr.length) {
      const nums = arr.map((x) => Number(x)).filter((x) => !Number.isNaN(x));
      if (nums.length) return Math.max(...nums);
    }
  } catch {
    /* ignore */
  }
  if (typeof m.lastTradePrice === "number") return m.lastTradePrice;
  return 0.5;
}

function fallbackPoly(ticker: string): PolyPoint[] {
  const seed = (Date.now() / 60000) | 0;
  const prob = 0.4 + ((seed + ticker.length) % 50) / 100;
  return [
    {
      ticker,
      ts: Date.now(),
      marketId: `sample-${ticker}`,
      question: `[sample] Will ${ticker} make a major move this quarter?`,
      prob: Number(prob.toFixed(2)),
      url: "https://polymarket.com",
    },
  ];
}
