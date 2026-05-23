// Lightweight, finance-tuned headline sentiment — fully offline, no API/key.
// General lexicons misread market language (e.g. "beat" is positive in finance),
// so we use compact positive/negative financial term lists. Score is in [-1, 1].

const POSITIVE = [
  "beat", "beats", "surge", "surges", "surged", "rally", "rallies", "rallied", "jump", "jumps", "jumped",
  "soar", "soars", "soared", "gain", "gains", "gained", "upgrade", "upgraded", "outperform", "record", "records",
  "strong", "strength", "growth", "grows", "grew", "bullish", "raise", "raises", "raised", "tops", "rise", "rises",
  "rose", "climb", "climbs", "climbed", "boost", "boosted", "profit", "profits", "wins", "won", "approval", "approved",
  "breakthrough", "optimistic", "rebound", "rebounds", "accelerate", "expands", "expansion", "milestone", "positive",
  "high", "highs", "buy", "overweight", "upside", "momentum",
];
const NEGATIVE = [
  "miss", "misses", "missed", "plunge", "plunges", "plunged", "plummet", "drop", "drops", "dropped", "fall",
  "falls", "fell", "slump", "slumps", "slide", "slides", "tumble", "tumbles", "downgrade", "downgraded", "underperform",
  "weak", "weakness", "loss", "losses", "lawsuit", "sue", "sues", "sued", "probe", "investigation", "recall",
  "layoff", "layoffs", "cuts", "cut", "warns", "warning", "bearish", "decline", "declines", "declined", "sink",
  "sinks", "fraud", "halt", "halts", "selloff", "sell-off", "crash", "crashes", "concern", "concerns", "risk",
  "risks", "slows", "slowdown", "disappoints", "disappointing", "negative", "fears", "fear", "sell", "underweight", "downside",
  "slip", "slips", "slipped", "struggle", "struggles", "pressure", "pressured", "weakens", "shortfall",
];

const posSet = new Set(POSITIVE);
const negSet = new Set(NEGATIVE);

// Score a single piece of text (e.g. a headline) in [-1, 1].
export function scoreText(text: string): number {
  if (!text) return 0;
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  let pos = 0;
  let neg = 0;
  for (const t of tokens) {
    if (posSet.has(t)) pos++;
    else if (negSet.has(t)) neg++;
  }
  if (pos + neg === 0) return 0;
  return Number(((pos - neg) / (pos + neg)).toFixed(2));
}

export function toneLabel(s: number): string {
  if (s > 0.15) return "positive";
  if (s < -0.15) return "negative";
  return "neutral";
}
