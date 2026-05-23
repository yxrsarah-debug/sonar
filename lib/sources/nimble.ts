// SENSE layer — Nimble adapter.
// Pulls news + social chatter for a ticker in real time via the Nimble Search
// API (Web Search Agents), and uses last-close price as the flat reference.
//
// LIVE PATH (NIMBLE_API_KEY set): POST {baseUrl}/search with a `focus` mode.
//   - news   -> focus: "news"   (current events / journalism)
//   - social -> focus: "social"  (X, Reddit, Stocktwits, ... chatter)
//   Docs: https://docs.nimbleway.com/nimble-sdk/web-tools/search
//   Auth: Authorization: Bearer <NIMBLE_API_KEY>   (sdk.nimbleway.com/v1)
//
// FALLBACK PATH (no key): clearly-synthetic observations so the dashboard and
// the loop run end-to-end during development.
//
// Price is intentionally NOT pulled from Nimble: a search snippet is a poor
// source of truth for a quote, and the divergence model only needs price as a
// *flat reference* ("chatter up, price hasn't moved" — literally last close on
// weekends). Keeping it deterministic avoids showing a wrong number on stage.

import { config } from "@/lib/config";
import { scoreText } from "@/lib/analyze/sentiment";
import type { NewsItem, SocialPoint, PricePoint } from "@/lib/types";

const NEWS_OUTLETS = ["Reuters", "Bloomberg", "CNBC", "The Verge", "WSJ", "Barron's"];

// ---- Nimble Search response shape (lite depth) -----------------------------
interface NimbleSearchResult {
  title?: string;
  description?: string;
  url?: string;
  metadata?: { position?: number; entity_type?: string; country?: string; locale?: string };
}
interface NimbleSearchResponse {
  total_results?: number;
  results?: NimbleSearchResult[];
  request_id?: string;
}

// POST /search — one Web Search Agent call. `focus` routes to specialized WSAs.
async function nimbleSearch(query: string, focus: string, maxResults: number, timeoutMs = 9000): Promise<NimbleSearchResult[]> {
  const res = await fetch(`${config.nimble.baseUrl}/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.nimble.apiKey}`,
    },
    body: JSON.stringify({
      query,
      focus,
      max_results: maxResults,
      search_depth: "lite", // 1 credit/search; titles + urls + snippets
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Nimble /search (${focus}) -> ${res.status} ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as NimbleSearchResponse;
  return data.results ?? [];
}

// hostname helpers -----------------------------------------------------------
function hostOf(url: string | undefined): string {
  if (!url) return "web";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}
function platformOf(url: string | undefined): string {
  const h = hostOf(url).toLowerCase();
  if (h.includes("x.com") || h.includes("twitter")) return "x";
  if (h.includes("reddit")) return "reddit";
  if (h.includes("stocktwits")) return "stocktwits";
  if (h.includes("youtube") || h.includes("youtu.be")) return "youtube";
  if (h.includes("threads")) return "threads";
  return "web";
}

// ---- short cache so repeated loop clicks don't re-hit (slow) Nimble agents ---
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes
const newsCache = new Map<string, { data: NewsItem[]; at: number }>();
const socialCache = new Map<string, { data: SocialPoint[]; at: number }>();

function restampNews(items: NewsItem[]): NewsItem[] {
  const now = Date.now();
  return items.map((n, i) => ({ ...n, ts: now - i * 60_000 }));
}
function restampSocial(items: SocialPoint[]): SocialPoint[] {
  const now = Date.now();
  return items.map((s) => ({ ...s, ts: now }));
}

// =============================== NEWS =======================================
export async function nimbleNews(ticker: string): Promise<NewsItem[]> {
  const cached = newsCache.get(ticker);
  if (cached && Date.now() - cached.at < CACHE_TTL) return restampNews(cached.data);

  if (config.nimble.live) {
    try {
      const results = await nimbleSearch(`${ticker} stock news`, "news", 10, 9000);
      const now = Date.now();
      const items = results
        .filter((r) => r.url && r.title)
        .slice(0, 10)
        .map((r, i) => ({
          ticker,
          ts: now - i * 60_000, // lite has no per-article time; stagger for ordering
          source: hostOf(r.url),
          title: r.title as string,
          url: r.url as string,
          sentiment: scoreText(r.title as string), // offline finance-lexicon tone
        }));
      if (items.length) {
        newsCache.set(ticker, { data: items, at: Date.now() });
        return items;
      }
      // Empty result set: fall through to fallback so the loop still has data.
    } catch (e) {
      console.error("[nimble:news] live call failed, using fallback:", e);
    }
  }
  return fallbackNews(ticker);
}

// ============================== SOCIAL ======================================
export async function nimbleSocial(ticker: string, allowLiveFetch = true): Promise<SocialPoint[]> {
  const cached = socialCache.get(ticker);
  if (cached && Date.now() - cached.at < CACHE_TTL) return restampSocial(cached.data);

  // Only one ticker per loop runs the slow live social fetch (round-robin) so we
  // never fire 6 concurrent agent calls. Off-turn tickers reuse cache (stale OK).
  if (!allowLiveFetch) {
    return cached ? restampSocial(cached.data) : fallbackSocial(ticker);
  }

  if (config.nimble.live) {
    try {
      // Social agents are slow (they navigate X/Reddit/…), so allow more time.
      const results = await nimbleSearch(`${ticker} stock`, "social", 25, 15000);
      const now = Date.now();
      // Group matches by platform; the raw match count per platform is the
      // chatter proxy. THINK normalizes (socialVolume saturates ~raw 40) and
      // flags standouts relative to the basket — see lib/analyze/divergence.
      const counts = new Map<string, number>();
      for (const r of results) {
        const p = platformOf(r.url);
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      const points: SocialPoint[] = [...counts.entries()].map(([platform, count]) => ({
        ticker,
        ts: now,
        platform,
        volume: count,
        sentiment: 0,
      }));
      if (points.length) {
        socialCache.set(ticker, { data: points, at: Date.now() });
        return points;
      }
    } catch (e) {
      console.error("[nimble:social] live call failed, using fallback:", e);
    }
  }
  return cached ? restampSocial(cached.data) : fallbackSocial(ticker);
}

// =============================== PRICE ======================================
// Deterministic last-close reference (see header note). No Nimble call.
export async function nimblePrice(ticker: string): Promise<PricePoint[]> {
  return fallbackPrice(ticker);
}

// ----------------------------- fallbacks ------------------------------------
// a tiny seeded RNG so fallback data is stable within a minute
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
function minuteBucket(): number {
  return Math.floor(Date.now() / 60000);
}
// Deterministically pick one "hot" ticker per minute so the demo reliably flags
// when running on synthetic data (no Nimble key).
function isHot(ticker: string): boolean {
  const wl = config.watchlist;
  if (wl.length === 0) return false;
  const idx = minuteBucket() % wl.length;
  return wl[idx] === ticker;
}

function fallbackNews(ticker: string): NewsItem[] {
  const r = rng(hash(ticker + minuteBucket()));
  const hot = isHot(ticker);
  const n = hot ? 5 : 1 + Math.floor(r() * 2);
  const now = Date.now();
  return Array.from({ length: n }).map((_, i) => ({
    ticker,
    ts: now - i * 90000,
    source: NEWS_OUTLETS[Math.floor(r() * NEWS_OUTLETS.length)],
    title: `[sample] ${ticker} ${hot ? "draws unusual attention amid sector chatter" : "in line with broader market"}`,
    url: `https://example.com/${ticker.toLowerCase()}/${minuteBucket()}-${i}`,
    sentiment: Number((r() * 2 - 1).toFixed(2)),
  }));
}

function fallbackSocial(ticker: string): SocialPoint[] {
  const r = rng(hash("soc" + ticker + minuteBucket()));
  const hot = isHot(ticker);
  const base = 15 + Math.floor(r() * 25);
  const volume = hot ? base + 70 + Math.floor(r() * 40) : base;
  return [
    { ticker, ts: Date.now(), platform: "x", volume, sentiment: Number((r() * 2 - 1).toFixed(2)) },
    { ticker, ts: Date.now(), platform: "reddit", volume: Math.floor(volume * 0.6), sentiment: Number((r() * 2 - 1).toFixed(2)) },
  ];
}

function fallbackPrice(ticker: string): PricePoint[] {
  const r = rng(hash("px" + ticker));
  const price = 50 + Math.floor(r() * 600);
  return [{ ticker, ts: Date.now(), price, volume: 1_000_000, asOfClose: isMarketClosed() }];
}

export function isMarketClosed(): boolean {
  // Rough US-market check: weekends are closed (demo-relevant).
  const day = new Date().getUTCDay();
  return day === 0 || day === 6;
}
