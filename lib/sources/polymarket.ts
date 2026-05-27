// SENSE layer — Polymarket adapter (the underused crowd-forecast signal).
// Gamma + CLOB are public (no key), so this path is fully real.
// Docs: https://docs.polymarket.com/market-data/fetching-markets
//
// Polymarket runs single-stock markets, but in two shapes:
//   1. A clean binary forecast ("Will Meta ...?") — mid-range Yes odds.
//   2. A THRESHOLD LADDER ("Will NVIDIA (NVDA) hit $232 / $236 / $240 ...?") —
//      each rung is P(price >= strike). Individually they look pinned at 0/1,
//      but together they ARE a real implied-confidence curve over the price.
// We search per ticker (Gamma public-search) and pick that stock's most
// informative LIVE market: a mid-range binary if one exists, otherwise the
// "at-the-money" rung of the ladder (the strike nearest the current price),
// whose odds carry the most signal. Only if neither exists do we fall back to a
// clearly-labeled sample — never a shared macro number for all six.

import type { PolyPoint } from "@/lib/types";
import { stockPrice } from "@/lib/sources/prices";

const GAMMA = "https://gamma-api.polymarket.com";

// Search query per ticker (company name matches the market titles).
const SEARCH_Q: Record<string, string> = {
  NVDA: "NVIDIA",
  TSLA: "Tesla",
  AAPL: "Apple",
  MSFT: "Microsoft",
  AMD: "AMD",
  META: "Meta",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Choice = { market: any; prob: number; kind: "live" | "ladder" };

// Cache the chosen market per ticker so prob + history reuse one search.
const marketCache = new Map<string, { choice: Choice | null; at: number }>();
const MARKET_TTL = 5 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function searchMarkets(q: string): Promise<any[]> {
  const url = `${GAMMA}/public-search?q=${encodeURIComponent(q)}&limit_per_type=20`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`gamma search ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];
  const events = Array.isArray(data?.events) ? data.events : [];
  for (const ev of events) {
    const evText = `${ev?.title ?? ""} ${ev?.slug ?? ""}`;
    const evSlug = ev?.slug ?? "";
    const mks = Array.isArray(ev?.markets) ? ev.markets : [];
    for (const mk of mks) out.push({ ...mk, _evText: evText, _evSlug: evSlug });
  }
  if (Array.isArray(data?.markets)) for (const mk of data.markets) out.push({ ...mk, _evText: "", _evSlug: "" });
  return out;
}

// Pick the most informative live market for a ticker (cached).
async function chooseStockMarket(ticker: string): Promise<Choice | null> {
  const cached = marketCache.get(ticker);
  if (cached && Date.now() - cached.at < MARKET_TTL) return cached.choice;

  const q = SEARCH_Q[ticker] ?? ticker;
  let choice: Choice | null = null;
  try {
    const markets = await searchMarkets(q);
    const tl = ticker.toLowerCase();
    const ql = q.toLowerCase();
    const stockCands = markets.filter((mk) => {
      const text = `${mk.question ?? ""} ${mk.slug ?? ""} ${mk._evText ?? ""}`.toLowerCase();
      return text.includes(tl) || text.includes(ql);
    });

    // Tier 1 — a live, mid-range binary forecast (clean Yes/No market).
    const live = stockCands
      .filter((mk) => isOpen(mk) && clobTokenId(mk))
      .map((mk) => ({ mk, p: yesProbability(mk) }))
      .filter(({ p }) => p > 0.05 && p < 0.95)
      .sort((a, b) => vol(b.mk) - vol(a.mk));

    if (live.length) {
      choice = { market: live[0].mk, prob: live[0].p, kind: "live" };
    } else {
      // Tier 2 — threshold ladder. Each rung is P(price >= strike); read it as a
      // real implied-confidence reading by taking the AT-THE-MONEY rung (strike
      // nearest the current price), whose odds are the most informative. Prefer
      // open rungs; fall back to the full ladder so we still surface a real
      // trajectory even after a weekly market has resolved.
      const ladder = stockCands
        .map((mk) => ({ mk, strike: parseStrike(`${mk.question ?? ""} ${mk._evText ?? ""}`), p: yesProbability(mk) }))
        .filter((x): x is { mk: typeof x.mk; strike: number; p: number } => x.strike != null && !!clobTokenId(x.mk));
      const openLadder = ladder.filter((x) => isOpen(x.mk));
      const use = openLadder.length ? openLadder : ladder;
      if (use.length) {
        let price: number | null = null;
        try {
          price = (await stockPrice(ticker))[1]?.price ?? null;
        } catch {
          /* price optional — fall back to most-traded rung */
        }
        const pick =
          price != null
            ? use.reduce((best, x) => (Math.abs(x.strike - price!) < Math.abs(best.strike - price!) ? x : best), use[0])
            : use.reduce((best, x) => (vol(x.mk) > vol(best.mk) ? x : best), use[0]);
        choice = { market: pick.mk, prob: pick.p, kind: "ladder" };
      }
    }
  } catch (e) {
    console.error("[polymarket:search]", e);
  }
  marketCache.set(ticker, { choice, at: Date.now() });
  return choice;
}

export async function polymarketFor(ticker: string): Promise<PolyPoint[]> {
  const c = await chooseStockMarket(ticker);
  if (c) {
    const m = c.market;
    return [
      {
        ticker,
        ts: Date.now(),
        marketId: String(m.id ?? m.conditionId ?? m.slug ?? ""),
        question: m.question ?? m._evText ?? "",
        prob: c.prob,
        url: m._evSlug ? `https://polymarket.com/event/${m._evSlug}` : m.slug ? `https://polymarket.com/market/${m.slug}` : "https://polymarket.com",
      },
    ];
  }
  return fallbackPoly(ticker);
}

// Real 5-day daily odds history for the matched market (CLOB /prices-history).
export async function polymarketHistory(ticker: string, days = 5): Promise<{ date: string; prob: number; question: string }[]> {
  try {
    const c = await chooseStockMarket(ticker);
    if (!c) return [];
    const m = c.market;
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
    const question = m.question ?? m._evText ?? "";
    return [...byDay.entries()].map(([date, prob]) => ({ date, prob, question })).sort((a, b) => (a.date < b.date ? -1 : 1));
  } catch (e) {
    console.error("[polymarket:history]", e);
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function vol(m: any): number {
  return Number(m.volumeNum ?? m.volume ?? m.volume24hr ?? 0) || 0;
}

// Yes/first-outcome probability — the crowd's odds of the event happening.
// (The old code took max(outcomePrices), which returns the NO price for a
// threshold rung pinned at ["0","1"] and made every rung look ~100% certain.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function yesProbability(m: any): number {
  try {
    const raw = m.outcomePrices;
    const arr: string[] = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(arr) && arr.length) {
      const n = Number(arr[0]);
      if (!Number.isNaN(n)) return n;
    }
  } catch {
    /* ignore */
  }
  if (typeof m.lastTradePrice === "number") return m.lastTradePrice;
  return 0.5;
}

// Parse the dollar strike from a threshold question, e.g.
// "Will NVIDIA (NVDA) hit (HIGH) $232 Week of May 18 2026?" -> 232.
function parseStrike(text: string): number | null {
  const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Is this market still live (not resolved/closed and not past its end date)?
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isOpen(m: any): boolean {
  if (m.closed === true || m.active === false) return false;
  const end = m.endDate ?? m.endDateIso ?? m.end_date_iso;
  if (end) {
    const t = Date.parse(end);
    if (!Number.isNaN(t)) return t > Date.now();
  }
  return true;
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

// Differentiated, clearly-labeled sample (per-ticker varied — never all the same).
function fallbackPoly(ticker: string): PolyPoint[] {
  let h = 2166136261;
  for (let i = 0; i < ticker.length; i++) {
    h ^= ticker.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const prob = 0.35 + ((h >>> 0) % 50) / 100; // 0.35..0.84, distinct per ticker
  return [
    {
      ticker,
      ts: Date.now(),
      marketId: `sample-${ticker}`,
      question: `[sample] crowd odds for ${ticker}`,
      prob: Number(prob.toFixed(2)),
      url: "https://polymarket.com",
    },
  ];
}
