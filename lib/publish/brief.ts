// PUBLISH layer — Sonar brief composer.
//
// Composes a neutral, source-grounded brief from a flagged signal. Decision-
// support framing: a "look here, now" pointer with the sources attached — never
// a prediction, recommendation, or buy/sell signal. The composed brief is what
// other agents pay to read via the x402-gated /api/feed/[ticker] route.

import type { Brief, Signal, Citation } from "@/lib/types";
import { toneLabel } from "@/lib/analyze/sentiment";

function id(): string {
  return `brief_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function composeBrief(signal: Signal): Brief {
  const citations: Citation[] = signal.topSources.filter((c) => c.url);
  return {
    id: id(),
    ticker: signal.ticker,
    headline: `${signal.ticker}: unusual cross-source activity (divergence ${signal.divergenceScore})`,
    body: composeBody(signal, citations.length),
    citations,
    publishedUrl: null,
    published: true,
    source: "sonar",
    divergenceScore: signal.divergenceScore,
    createdAt: Date.now(),
  };
}

function composeBody(s: Signal, srcCount: number): string {
  const poly =
    s.polyProb !== null
      ? `Polymarket's lead outcome is pricing ${Math.round(s.polyProb * 100)}%`
      : "no matching Polymarket market was found";
  const close = s.asOfClose ? " (last close)" : "";
  const priceLine =
    s.lastPrice === null
      ? "price data is unavailable"
      : Math.abs(s.priceChangePct) < 1
        ? `price is roughly flat at $${s.lastPrice.toFixed(2)}${close}`
        : `price is $${s.lastPrice.toFixed(2)}${close}, ${s.priceChangePct > 0 ? "up" : "down"} ${Math.abs(s.priceChangePct).toFixed(1)}% recently`;
  return (
    `${s.ticker} is drawing unusual cross-source attention right now. ` +
    `Social chatter reads ${s.socialVolume}/100 (Δ${s.socialDelta} vs its recent baseline) across ${s.newsCount} fresh news items (headline tone: ${toneLabel(s.newsSentiment)}); ` +
    `${poly}; and ${priceLine}. ` +
    `That gap — attention and crowd-odds running ahead of price — is what Sonar flags as a divergence. ` +
    `This is a "look here, now" pointer with ${srcCount} source${srcCount === 1 ? "" : "s"} attached for you to verify. ` +
    `It is not a prediction, recommendation, or buy/sell signal.`
  );
}
