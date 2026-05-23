// Build a time-series for the per-stock divergence chart from a RecentBundle.
// Buckets the recent window into N steps and carries the last known value
// forward, so the lines are continuous even though the loop runs irregularly.
// Social/poly are normalized to 0..100; price is the real last close.

import type { RecentBundle } from "@/lib/types";

export interface SeriesPoint {
  t: number; // bucket end (ms)
  social: number; // 0..100
  poly: number | null; // 0..100
  price: number | null; // real close price
  asOfClose: boolean; // true when price is a last close (market shut)
}

export function buildSeries(b: RecentBundle, windowMs: number, nBuckets = 24): SeriesPoint[] {
  const now = Date.now();
  const allTs = [...b.social, ...b.poly, ...b.price].map((x) => x.ts);
  // Zoom to the period that actually has data (avoid a wall of empty buckets).
  const dataStart = allTs.length ? Math.min(...allTs) : now - windowMs;
  const start = Math.max(now - windowMs, dataStart);
  const span = Math.max(1, (now - start) / nBuckets);

  const points: SeriesPoint[] = [];
  let lastSocial = 0;
  let lastPoly: number | null = null;
  let lastPrice: number | null = null;
  let lastClose = false;

  for (let i = 0; i < nBuckets; i++) {
    const lo = start + i * span;
    const hi = i === nBuckets - 1 ? now + 1 : lo + span;

    const soc = b.social.filter((s) => s.ts >= lo && s.ts < hi);
    if (soc.length) {
      const raw = soc.reduce((a, p) => a + p.volume, 0);
      lastSocial = Math.round(100 * Math.min(raw / 40, 1));
    }

    const pol = b.poly.filter((p) => p.ts >= lo && p.ts < hi);
    if (pol.length) lastPoly = Math.round(100 * Math.max(...pol.map((p) => p.prob)));

    const pr = b.price.filter((p) => p.ts >= lo && p.ts < hi).sort((a, c) => a.ts - c.ts);
    if (pr.length) {
      lastPrice = pr[pr.length - 1].price;
      lastClose = pr[pr.length - 1].asOfClose;
    }

    points.push({ t: hi, social: lastSocial, poly: lastPoly, price: lastPrice, asOfClose: lastClose });
  }
  return points;
}
