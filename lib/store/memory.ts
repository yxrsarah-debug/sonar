// Dev fallback store (in-memory). Used when CLICKHOUSE_URL is not set so the
// site runs end-to-end without infrastructure. NOT for production.

import type { Store, DailyAgg } from "@/lib/store/store";
import type { NewsItem, SocialPoint, PolyPoint, PricePoint, RecentBundle, Brief, Earnings } from "@/lib/types";

export class MemoryStore implements Store {
  kind = "memory" as const;
  private news: NewsItem[] = [];
  private social: SocialPoint[] = [];
  private poly: PolyPoint[] = [];
  private price: PricePoint[] = [];
  private briefs: Brief[] = [];
  private reads: { ticker: string; usdc: number; ts: number }[] = [];

  async init(): Promise<void> {
    /* nothing to set up */
  }

  async insertNews(items: NewsItem[]): Promise<void> {
    this.news.push(...items);
    this.trim();
  }
  async insertSocial(items: SocialPoint[]): Promise<void> {
    this.social.push(...items);
    this.trim();
  }
  async insertPoly(items: PolyPoint[]): Promise<void> {
    this.poly.push(...items);
    this.trim();
  }
  async insertPrice(items: PricePoint[]): Promise<void> {
    this.price.push(...items);
    this.trim();
  }

  private trim() {
    const cap = 5000;
    if (this.news.length > cap) this.news = this.news.slice(-cap);
    if (this.social.length > cap) this.social = this.social.slice(-cap);
    if (this.poly.length > cap) this.poly = this.poly.slice(-cap);
    if (this.price.length > cap) this.price = this.price.slice(-cap);
  }

  async recentForTicker(ticker: string, windowMs: number): Promise<RecentBundle> {
    const since = Date.now() - windowMs;
    return {
      news: this.news.filter((n) => n.ticker === ticker && n.ts > since),
      social: this.social.filter((s) => s.ticker === ticker && s.ts > since),
      poly: this.poly.filter((p) => p.ticker === ticker && p.ts > since),
      price: this.price.filter((p) => p.ticker === ticker && p.ts > since),
    };
  }

  async dailyForTicker(ticker: string, days: number): Promise<DailyAgg[]> {
    const since = Date.now() - days * 24 * 3600 * 1000;
    // social: per-minute snapshot total, averaged per day (robust to re-inserts)
    const perMin = new Map<number, number>();
    for (const s of this.social) {
      if (s.ticker !== ticker || s.ts <= since) continue;
      const m = Math.floor(s.ts / 60000);
      perMin.set(m, (perMin.get(m) ?? 0) + s.volume);
    }
    const dayVals = new Map<string, number[]>();
    for (const [m, v] of perMin) {
      const d = new Date(m * 60000).toISOString().slice(0, 10);
      const arr = dayVals.get(d) ?? [];
      arr.push(v);
      dayVals.set(d, arr);
    }
    const map = new Map<string, { social: number; poly: number | null }>();
    for (const [d, arr] of dayVals) {
      map.set(d, { social: arr.reduce((a, b) => a + b, 0) / arr.length, poly: null });
    }
    for (const p of this.poly) {
      if (p.ticker !== ticker || p.ts <= since) continue;
      const d = new Date(p.ts).toISOString().slice(0, 10);
      const e = map.get(d) ?? { social: 0, poly: null };
      e.poly = Math.max(e.poly ?? 0, p.prob);
      map.set(d, e);
    }
    return [...map.entries()].map(([date, v]) => ({ date, social: v.social, poly: v.poly })).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  async saveBrief(b: Brief): Promise<void> {
    this.briefs.unshift(b);
    if (this.briefs.length > 100) this.briefs = this.briefs.slice(0, 100);
  }

  async getBriefs(limit: number): Promise<Brief[]> {
    return this.briefs.slice(0, limit);
  }

  async getBriefForTicker(ticker: string): Promise<Brief | null> {
    return this.briefs.find((b) => b.ticker === ticker) ?? null;
  }

  async addRead(ticker: string, usdc: number): Promise<void> {
    this.reads.push({ ticker, usdc, ts: Date.now() });
  }

  async getEarnings(): Promise<Earnings> {
    return {
      reads: this.reads.length,
      usdc: Number(this.reads.reduce((s, r) => s + r.usdc, 0).toFixed(4)),
    };
  }
}
