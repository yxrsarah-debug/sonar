// THINK layer — divergence detection.
//
// The core idea: flag a ticker when CHATTER + CROWD-ODDS are elevated but PRICE
// hasn't moved (often literally flat at "last close" on weekends). That gap is
// the signal — a "look here, now", never a prediction.
//
// Because our watchlist is all always-busy mega-caps, raw "lots of news/social"
// is normal for every name. So the FLAG is RELATIVE: a ticker flags when its
// cross-source activity stands out from the basket right now (see
// applyRelativeFlags). The per-ticker score below is the absolute activity;
// applyRelativeFlags decides which of those count as standouts.
//
// In production the windowed aggregation (sum/avg over the last N minutes per
// ticker) is a ClickHouse query — see lib/store/schema.sql. ClickHouse does the
// heavy lifting; this just combines the aggregates into a 0..100 score.

import type { RecentBundle, Signal, Citation, SocialPoint } from "@/lib/types";

const FLAG_THRESHOLD = 60;

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

export function computeSignal(ticker: string, b: RecentBundle): Signal {
  // --- news: dedupe by url so re-scanning the same window doesn't inflate ---
  const seenNews = new Set<string>();
  const news = b.news.filter((n) => {
    const key = n.url || n.title;
    if (!key || seenNews.has(key)) return false;
    seenNews.add(key);
    return true;
  });
  const newsCount = news.length;
  const newsNorm = clamp(100 * Math.min(newsCount / 8, 1));
  const newsSentiment = news.length ? Number((news.reduce((a, nn) => a + (nn.sentiment || 0), 0) / news.length).toFixed(2)) : 0;

  // --- social: take the LATEST reading per platform (don't sum across repeated
  //     scans), then add platforms for a current chatter level. Volume is the
  //     raw match count per platform from Nimble (focus:social). ---
  const latestByPlatform = new Map<string, SocialPoint>();
  for (const p of b.social) {
    const cur = latestByPlatform.get(p.platform);
    if (!cur || p.ts > cur.ts) latestByPlatform.set(p.platform, p);
  }
  const socialVolumeRaw = [...latestByPlatform.values()].reduce((s, p) => s + p.volume, 0);
  const socialVolume = clamp(100 * Math.min(socialVolumeRaw / 40, 1));
  const socialDelta = clamp(socialVolume - 30);

  // --- polymarket ---
  const probs = b.poly.map((p) => p.prob).filter((p) => typeof p === "number");
  const polyProb = probs.length ? Math.max(...probs) : null;
  // conviction = distance from 50/50; if we have >=2 timestamps, use the move.
  let polyDelta: number | null = null;
  if (b.poly.length >= 2) {
    const sorted = [...b.poly].sort((a, c) => a.ts - c.ts);
    polyDelta = clamp(Math.abs((sorted[sorted.length - 1].prob - sorted[0].prob) * 100));
  }
  const polyConviction = polyProb !== null ? clamp(Math.abs(polyProb - 0.5) * 200) : 0;

  // --- price (real last close + recent move; flat at last close on weekends) ---
  let priceChangePct = 0;
  let lastPrice: number | null = null;
  let asOfClose = false;
  if (b.price.length >= 1) {
    const sorted = [...b.price].sort((a, c) => a.ts - c.ts);
    lastPrice = sorted[sorted.length - 1].price;
    asOfClose = sorted[sorted.length - 1].asOfClose;
    if (sorted.length >= 2) {
      const first = sorted[0].price;
      const last = sorted[sorted.length - 1].price;
      if (first) priceChangePct = ((last - first) / first) * 100;
    }
  }

  // --- combine into absolute activity (0..100), attenuated by price flatness ---
  const activity = 0.5 * socialVolume + 0.3 * newsNorm + 0.2 * polyConviction;
  // Flatness is a gentle modifier in [0.5, 1] — a recent price move down-weights
  // a ticker (chatter "ahead of price" is the signal) but never zeroes it, so the
  // radar still ranks a standout. 1 = flat, 0.5 = moved >=8% recently.
  const flatness = 1 - 0.5 * Math.min(Math.abs(priceChangePct) / 8, 1);
  const divergenceScore = Math.round(clamp(activity * flatness));

  // citations: freshest REAL sources first; drop synthetic fallback urls.
  const topSources: Citation[] = news
    .filter((n) => n.url && !n.url.includes("example.com"))
    .slice()
    .sort((a, c) => c.ts - a.ts)
    .slice(0, 4)
    .map((n) => ({ title: n.title, url: n.url }));
  // include the top polymarket question as a citation too
  if (b.poly[0]) topSources.push({ title: `Polymarket: ${b.poly[0].question}`, url: b.poly[0].url });

  return {
    ticker,
    socialVolume: Math.round(socialVolume),
    socialDelta: Math.round(socialDelta),
    newsCount,
    newsSentiment,
    polyProb,
    polyDelta,
    priceChangePct: Number(priceChangePct.toFixed(2)),
    lastPrice: lastPrice !== null ? Number(lastPrice.toFixed(2)) : null,
    asOfClose,
    divergenceScore,
    flagged: false, // provisional — set by applyRelativeFlags() across the basket
    topSources,
    updatedAt: Date.now(),
  };
}

// Relative standout: flag tickers whose activity stands out vs the basket right
// now. Self-calibrating (works whatever the absolute magnitudes are) and keeps
// the radar selective even when every name is busy. Mutates `signals` in place.
export function applyRelativeFlags(signals: Signal[]): void {
  if (signals.length === 0) return;
  const scores = signals.map((s) => s.divergenceScore).sort((a, b) => a - b);
  const mid = Math.floor(scores.length / 2);
  const median = scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
  const ABS_FLOOR = 30; // ignore genuinely quiet names
  const MARGIN = 12; // must clear the basket median by this much to count as a standout

  let any = false;
  for (const s of signals) {
    s.flagged = s.divergenceScore >= ABS_FLOOR && s.divergenceScore >= median + MARGIN;
    if (s.flagged) any = true;
  }
  // If nothing clearly stands out but there is real activity, surface the single
  // strongest so the loop always has a "look here" to publish.
  if (!any) {
    const top = signals.reduce((a, b) => (b.divergenceScore > a.divergenceScore ? b : a));
    if (top.divergenceScore >= ABS_FLOOR) top.flagged = true;
  }
}

export { FLAG_THRESHOLD };
