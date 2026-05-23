// Storage interface + singleton factory.
// Real path = ClickHouse. Dev fallback = in-memory (when CLICKHOUSE_URL unset).

import { config } from "@/lib/config";
import type { NewsItem, SocialPoint, PolyPoint, PricePoint, RecentBundle, Brief, Earnings } from "@/lib/types";

// One day's aggregated activity for a ticker (for the 5-day chart).
export interface DailyAgg {
  date: string; // YYYY-MM-DD
  social: number; // raw summed social volume that day
  poly: number | null; // lead probability (0..1) that day
}

export interface Store {
  kind: "clickhouse" | "memory";
  init(): Promise<void>;
  insertNews(items: NewsItem[]): Promise<void>;
  insertSocial(items: SocialPoint[]): Promise<void>;
  insertPoly(items: PolyPoint[]): Promise<void>;
  insertPrice(items: PricePoint[]): Promise<void>;
  recentForTicker(ticker: string, windowMs: number): Promise<RecentBundle>;
  dailyForTicker(ticker: string, days: number): Promise<DailyAgg[]>;
  saveBrief(b: Brief): Promise<void>;
  getBriefs(limit: number): Promise<Brief[]>;
  getBriefForTicker(ticker: string): Promise<Brief | null>;
  addRead(ticker: string, usdc: number): Promise<void>;
  getEarnings(): Promise<Earnings>;
}

// Cache the store on globalThis so it survives Next dev hot-reloads.
declare global {
  // eslint-disable-next-line no-var
  var __sonarStore: Promise<Store> | undefined;
}

async function build(): Promise<Store> {
  if (config.clickhouse.live) {
    const { ClickHouseStore } = await import("@/lib/store/clickhouse");
    const s = new ClickHouseStore();
    await s.init();
    return s;
  }
  const { MemoryStore } = await import("@/lib/store/memory");
  const s = new MemoryStore();
  await s.init();
  return s;
}

export function getStore(): Promise<Store> {
  if (!global.__sonarStore) {
    global.__sonarStore = build();
  }
  return global.__sonarStore;
}
