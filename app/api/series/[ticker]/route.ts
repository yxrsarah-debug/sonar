import { getStore } from "@/lib/store/store";
import { dailyHistory } from "@/lib/sources/prices";
import { polymarketHistory } from "@/lib/sources/polymarket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAYS = 5;

// GET /api/series/:ticker — 5-day daily series for the chart.
// Price = real daily closes (carried forward on non-trading days, drawn dotted).
// Social / Polymarket = daily aggregates from ClickHouse (fill in as the loop
// accumulates snapshots over the coming days).
export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  try {
    const store = await getStore();
    // Fetch independently so a failure in one doesn't blank the whole chart.
    let hist: Awaited<ReturnType<typeof dailyHistory>> = [];
    let agg: Awaited<ReturnType<typeof store.dailyForTicker>> = [];
    try {
      hist = await dailyHistory(ticker, 10);
    } catch (e) {
      console.error("[api/series] price history failed:", e);
    }
    try {
      agg = await store.dailyForTicker(ticker, DAYS + 2);
    } catch (e) {
      console.error("[api/series] daily aggregation failed:", e);
    }
    let polyHist: Awaited<ReturnType<typeof polymarketHistory>> = [];
    try {
      polyHist = await polymarketHistory(ticker, DAYS + 2);
    } catch (e) {
      console.error("[api/series] polymarket history failed:", e);
    }

    const priceMap = new Map(hist.map((h) => [h.date, h.close]));
    const aggMap = new Map(agg.map((a) => [a.date, a]));
    const polyHistMap = new Map(polyHist.map((p) => [p.date, p.prob]));
    // Does this ticker have ANY real prediction-market signal? Some names (e.g.
    // NVDA) only have resolved threshold bets pinned at 0/1, which we filter out
    // upstream — so there's no live forecast and we show a labeled sample line.
    const hasRealPoly = polyHist.length > 0 || agg.some((a) => a.poly != null);

    const dates: string[] = [];
    for (let i = DAYS - 1; i >= 0; i--) dates.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));

    let lastClose: number | null = null;
    const jitter = (ticker.charCodeAt(0) + ticker.length * 3) % 14;
    const points = dates.map((date, i) => {
      const real = priceMap.has(date);
      let price: number | null;
      if (real) {
        price = priceMap.get(date)!;
        lastClose = price;
      } else {
        price = lastClose; // weekend / holiday — carry forward, drawn dotted
      }
      const a = aggMap.get(date);
      // Real social if we have it; otherwise a clearly-labeled SAMPLE so the
      // 5-day demo isn't empty. Sample is drawn dotted/hollow and disappears as
      // real snapshots accumulate.
      let social = a ? Math.round(100 * Math.min(a.social / 40, 1)) : null;
      let socialSample = false;
      if (social === null) {
        social = Math.min(95, 32 + i * 12 + jitter); // gentle rise toward today
        socialSample = true;
      }
      // Polymarket odds: prefer real CLOB history, then accumulated daily
      // aggregate. If the ticker has NO live forecast market (only resolved
      // threshold bets), show a clearly-labeled SAMPLE line so the chart isn't
      // empty — drawn dotted/hollow, exactly like sample social.
      const polyReal = polyHistMap.get(date);
      let poly: number | null;
      let polySample = false;
      if (polyReal != null) {
        poly = Math.round(polyReal * 100);
      } else if (a && a.poly != null) {
        poly = Math.round(a.poly * 100);
      } else if (!hasRealPoly) {
        const base = 28 + ((ticker.charCodeAt(0) * 7 + ticker.length * 5) % 16); // ~28..43
        poly = Math.min(68, base + i * 3 + (jitter % 4)); // gentle drift
        polySample = true;
      } else {
        poly = null;
      }
      return { date, price, real, social, poly, socialSample, polySample };
    });

    // Backfill any leading nulls (dates before the first known close).
    const firstClose = hist.length ? hist[0].close : null;
    for (const p of points) if (p.price == null) p.price = firstClose;

    return Response.json({ ticker, days: DAYS, points });
  } catch (e) {
    console.error("[api/series]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
