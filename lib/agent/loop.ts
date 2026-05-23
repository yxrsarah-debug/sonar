// The agent loop — one autonomous pass: SENSE -> THINK -> PUBLISH.
// (TRANSACT happens when other agents read the published brief via the
//  x402-gated /api/feed/[ticker] route.)

import { config } from "@/lib/config";
import { getStore } from "@/lib/store/store";
import { nimbleNews, nimbleSocial } from "@/lib/sources/nimble";
import { stockPrice } from "@/lib/sources/prices";
import { polymarketFor } from "@/lib/sources/polymarket";
import { computeSignal, applyRelativeFlags } from "@/lib/analyze/divergence";
import { composeBrief } from "@/lib/publish/brief";
import type { LoopResult, Signal } from "@/lib/types";

const WINDOW_MS = 20 * 60 * 1000; // 20 minutes — "recent" activity window
let socialCursor = 0; // round-robin: only one ticker does a live social fetch per loop

export async function gatherSignals(): Promise<Signal[]> {
  const store = await getStore();
  const signals: Signal[] = [];
  for (const ticker of config.watchlist) {
    const bundle = await store.recentForTicker(ticker, WINDOW_MS);
    signals.push(computeSignal(ticker, bundle));
  }
  applyRelativeFlags(signals); // flag standouts relative to the basket
  return signals.sort((a, b) => b.divergenceScore - a.divergenceScore);
}

export async function runLoop(): Promise<LoopResult> {
  const startedAt = Date.now();
  const notes: string[] = [];
  const store = await getStore();

  // 1) SENSE — pull every source for every ticker, in parallel, and store it.
  // Only ONE ticker per pass runs the slow live social fetch (round-robin); the
  // rest reuse cached social. This avoids 6 concurrent social agents timing out.
  const primaryTicker = config.watchlist[socialCursor % config.watchlist.length];
  socialCursor++;

  await Promise.all(
    config.watchlist.map(async (ticker) => {
      const [news, social, price, poly] = await Promise.all([
        nimbleNews(ticker),
        nimbleSocial(ticker, ticker === primaryTicker),
        stockPrice(ticker),
        polymarketFor(ticker),
      ]);
      await Promise.all([
        store.insertNews(news),
        store.insertSocial(social),
        store.insertPrice(price),
        store.insertPoly(poly),
      ]);
    }),
  );
  notes.push(
    `Sensed ${config.watchlist.length} tickers (nimble=${config.nimble.live ? "live" : "fallback"}, polymarket=live); social refreshed: ${primaryTicker}.`,
  );

  // 2) THINK — score divergence per ticker.
  const signals = await gatherSignals();
  const flagged = signals.filter((s) => s.flagged);
  notes.push(`Detected ${flagged.length} divergence flag(s).`);

  // 3) PUBLISH — generate + publish a cited brief for the top flagged ticker.
  let publishedTicker: string | null = null;
  let brief = null;
  const top = flagged[0];
  if (top) {
    brief = composeBrief(top);
    await store.saveBrief(brief);
    publishedTicker = top.ticker;
    notes.push(`Composed cited brief for ${top.ticker} (divergence ${top.divergenceScore}).`);
  } else {
    notes.push("No ticker crossed the divergence threshold this pass.");
  }

  return {
    startedAt,
    finishedAt: Date.now(),
    scanned: config.watchlist.length,
    flagged: flagged.map((s) => s.ticker),
    publishedTicker,
    brief,
    storeKind: store.kind,
    notes,
  };
}
