// Shared domain types for the Sonar loop.

export interface NewsItem {
  ticker: string;
  ts: number; // epoch ms
  source: string;
  title: string;
  url: string;
  sentiment: number; // -1..1
}

export interface SocialPoint {
  ticker: string;
  ts: number;
  platform: string; // "x" | "reddit" | ...
  volume: number; // mentions in the bucket
  sentiment: number; // -1..1
}

export interface PolyPoint {
  ticker: string;
  ts: number;
  marketId: string;
  question: string;
  prob: number; // 0..1 implied probability of the lead outcome
  url: string;
}

export interface PricePoint {
  ticker: string;
  ts: number;
  price: number;
  volume: number;
  asOfClose: boolean; // true on weekends / closed markets
}

export interface RecentBundle {
  news: NewsItem[];
  social: SocialPoint[];
  poly: PolyPoint[];
  price: PricePoint[];
}

export interface Signal {
  ticker: string;
  socialVolume: number; // 0..100 normalized recent activity
  socialDelta: number; // 0..100 change vs baseline
  newsCount: number;
  newsSentiment: number; // average headline tone, -1..1
  polyProb: number | null;
  polyDelta: number | null; // probability points moved (0..100)
  priceChangePct: number; // recent % change (often ~0 at last close)
  lastPrice: number | null; // most recent close price (real)
  asOfClose: boolean; // true when the price is a last close (market closed)
  divergenceScore: number; // 0..100
  flagged: boolean;
  topSources: Citation[];
  updatedAt: number;
}

export interface Citation {
  title: string;
  url: string;
}

export interface Brief {
  id: string;
  ticker: string;
  headline: string;
  body: string;
  citations: Citation[];
  publishedUrl: string | null; // external URL when published elsewhere
  published: boolean;
  source: "sonar"; // composed locally by Sonar from the sensed evidence
  divergenceScore: number;
  createdAt: number;
}

export interface Earnings {
  reads: number;
  usdc: number;
}

export interface LoopResult {
  startedAt: number;
  finishedAt: number;
  scanned: number;
  flagged: string[];
  publishedTicker: string | null;
  brief: Brief | null;
  storeKind: string;
  notes: string[];
}
