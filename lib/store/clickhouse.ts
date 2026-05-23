// Real storage path — ClickHouse.

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { config } from "@/lib/config";
import type { Store, DailyAgg } from "@/lib/store/store";
import type { NewsItem, SocialPoint, PolyPoint, PricePoint, RecentBundle, Brief, Earnings } from "@/lib/types";

function chTs(ms: number): string {
  // ClickHouse DateTime64(3) accepts "YYYY-MM-DD HH:MM:SS.mmm" (UTC).
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

export class ClickHouseStore implements Store {
  kind = "clickhouse" as const;
  private client: ClickHouseClient;
  private db: string;

  constructor() {
    this.db = config.clickhouse.database;
    this.client = createClient({
      url: config.clickhouse.url!,
      username: config.clickhouse.user,
      password: config.clickhouse.password,
    });
  }

  async init(): Promise<void> {
    const db = this.db;
    const ddl = [
      `CREATE DATABASE IF NOT EXISTS ${db}`,
      `CREATE TABLE IF NOT EXISTS ${db}.news_events (ticker LowCardinality(String), ts DateTime64(3), source String, title String, url String, sentiment Float32) ENGINE = MergeTree ORDER BY (ticker, ts)`,
      `CREATE TABLE IF NOT EXISTS ${db}.social_events (ticker LowCardinality(String), ts DateTime64(3), platform LowCardinality(String), volume UInt32, sentiment Float32) ENGINE = MergeTree ORDER BY (ticker, ts)`,
      `CREATE TABLE IF NOT EXISTS ${db}.poly_events (ticker LowCardinality(String), ts DateTime64(3), market_id String, question String, prob Float32, url String) ENGINE = MergeTree ORDER BY (ticker, ts)`,
      `CREATE TABLE IF NOT EXISTS ${db}.price_events (ticker LowCardinality(String), ts DateTime64(3), price Float64, volume UInt64, as_of_close UInt8) ENGINE = MergeTree ORDER BY (ticker, ts)`,
      `CREATE TABLE IF NOT EXISTS ${db}.briefs (id String, ticker LowCardinality(String), headline String, body String, citations String, published_url String, published UInt8, source LowCardinality(String), divergence UInt8, created_at DateTime64(3)) ENGINE = MergeTree ORDER BY (created_at)`,
      `CREATE TABLE IF NOT EXISTS ${db}.reads (ticker LowCardinality(String), ts DateTime64(3), usdc Float64) ENGINE = MergeTree ORDER BY (ts)`,
    ];
    for (const q of ddl) await this.client.command({ query: q });
  }

  async insertNews(items: NewsItem[]): Promise<void> {
    if (!items.length) return;
    await this.client.insert({
      table: `${this.db}.news_events`,
      values: items.map((n) => ({ ticker: n.ticker, ts: chTs(n.ts), source: n.source, title: n.title, url: n.url, sentiment: n.sentiment })),
      format: "JSONEachRow",
    });
  }

  async insertSocial(items: SocialPoint[]): Promise<void> {
    if (!items.length) return;
    await this.client.insert({
      table: `${this.db}.social_events`,
      values: items.map((s) => ({ ticker: s.ticker, ts: chTs(s.ts), platform: s.platform, volume: s.volume, sentiment: s.sentiment })),
      format: "JSONEachRow",
    });
  }

  async insertPoly(items: PolyPoint[]): Promise<void> {
    if (!items.length) return;
    await this.client.insert({
      table: `${this.db}.poly_events`,
      values: items.map((p) => ({ ticker: p.ticker, ts: chTs(p.ts), market_id: p.marketId, question: p.question, prob: p.prob, url: p.url })),
      format: "JSONEachRow",
    });
  }

  async insertPrice(items: PricePoint[]): Promise<void> {
    if (!items.length) return;
    await this.client.insert({
      table: `${this.db}.price_events`,
      values: items.map((p) => ({ ticker: p.ticker, ts: chTs(p.ts), price: p.price, volume: p.volume, as_of_close: p.asOfClose ? 1 : 0 })),
      format: "JSONEachRow",
    });
  }

  private async rows<T>(query: string): Promise<T[]> {
    const rs = await this.client.query({ query, format: "JSONEachRow" });
    return (await rs.json()) as T[];
  }

  async recentForTicker(ticker: string, windowMs: number): Promise<RecentBundle> {
    const since = chTs(Date.now() - windowMs);
    const t = ticker.replace(/'/g, "");
    const [news, social, poly, price] = await Promise.all([
      this.rows<any>(`SELECT ticker, toUnixTimestamp64Milli(ts) AS ms, source, title, url, sentiment FROM ${this.db}.news_events WHERE ticker = '${t}' AND ts > '${since}' ORDER BY ts DESC LIMIT 50`),
      this.rows<any>(`SELECT ticker, toUnixTimestamp64Milli(ts) AS ms, platform, volume, sentiment FROM ${this.db}.social_events WHERE ticker = '${t}' AND ts > '${since}' ORDER BY ts DESC LIMIT 50`),
      this.rows<any>(`SELECT ticker, toUnixTimestamp64Milli(ts) AS ms, market_id, question, prob, url FROM ${this.db}.poly_events WHERE ticker = '${t}' AND ts > '${since}' ORDER BY ts DESC LIMIT 20`),
      this.rows<any>(`SELECT ticker, toUnixTimestamp64Milli(ts) AS ms, price, volume, as_of_close FROM ${this.db}.price_events WHERE ticker = '${t}' AND ts > '${since}' ORDER BY ts DESC LIMIT 50`),
    ]);
    return {
      news: news.map((r) => ({ ticker: r.ticker, ts: Number(r.ms), source: r.source, title: r.title, url: r.url, sentiment: Number(r.sentiment) })),
      social: social.map((r) => ({ ticker: r.ticker, ts: Number(r.ms), platform: r.platform, volume: Number(r.volume), sentiment: Number(r.sentiment) })),
      poly: poly.map((r) => ({ ticker: r.ticker, ts: Number(r.ms), marketId: r.market_id, question: r.question, prob: Number(r.prob), url: r.url })),
      price: price.map((r) => ({ ticker: r.ticker, ts: Number(r.ms), price: Number(r.price), volume: Number(r.volume), asOfClose: r.as_of_close === 1 })),
    };
  }

  async dailyForTicker(ticker: string, days: number): Promise<DailyAgg[]> {
    const t = ticker.replace(/'/g, "");
    const since = chTs(Date.now() - days * 24 * 3600 * 1000);
    // social: per-minute snapshot total (sum across platforms), averaged per day
    // — robust to the loop re-inserting cached social each pass.
    const [soc, pol] = await Promise.all([
      this.rows<any>(
        `SELECT toDate(m) AS d, avg(v) AS v FROM (SELECT toStartOfMinute(ts) AS m, sum(volume) AS v FROM ${this.db}.social_events WHERE ticker = '${t}' AND ts > '${since}' GROUP BY m) GROUP BY d ORDER BY d`,
      ),
      this.rows<any>(`SELECT toDate(ts) AS d, max(prob) AS p FROM ${this.db}.poly_events WHERE ticker = '${t}' AND ts > '${since}' GROUP BY d ORDER BY d`),
    ]);
    const map = new Map<string, { social: number; poly: number | null }>();
    for (const r of soc) map.set(String(r.d), { social: Number(r.v) || 0, poly: null });
    for (const r of pol) {
      const e = map.get(String(r.d)) ?? { social: 0, poly: null };
      e.poly = Number(r.p);
      map.set(String(r.d), e);
    }
    return [...map.entries()].map(([date, v]) => ({ date, social: v.social, poly: v.poly })).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  async saveBrief(b: Brief): Promise<void> {
    await this.client.insert({
      table: `${this.db}.briefs`,
      values: [{ id: b.id, ticker: b.ticker, headline: b.headline, body: b.body, citations: JSON.stringify(b.citations), published_url: b.publishedUrl ?? "", published: b.published ? 1 : 0, source: b.source, divergence: b.divergenceScore, created_at: chTs(b.createdAt) }],
      format: "JSONEachRow",
    });
  }

  async getBriefs(limit: number): Promise<Brief[]> {
    const rows = await this.rows<any>(`SELECT id, ticker, headline, body, citations, published_url, published, source, divergence, toUnixTimestamp64Milli(created_at) AS ms FROM ${this.db}.briefs ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(50, limit))}`);
    return rows.map(mapBrief);
  }

  async getBriefForTicker(ticker: string): Promise<Brief | null> {
    const t = ticker.replace(/'/g, "");
    const rows = await this.rows<any>(`SELECT id, ticker, headline, body, citations, published_url, published, source, divergence, toUnixTimestamp64Milli(created_at) AS ms FROM ${this.db}.briefs WHERE ticker = '${t}' ORDER BY created_at DESC LIMIT 1`);
    return rows.length ? mapBrief(rows[0]) : null;
  }

  async addRead(ticker: string, usdc: number): Promise<void> {
    await this.client.insert({ table: `${this.db}.reads`, values: [{ ticker, ts: chTs(Date.now()), usdc }], format: "JSONEachRow" });
  }

  async getEarnings(): Promise<Earnings> {
    const rows = await this.rows<any>(`SELECT count() AS reads, sum(usdc) AS usdc FROM ${this.db}.reads`);
    const r = rows[0] ?? { reads: 0, usdc: 0 };
    return { reads: Number(r.reads ?? 0), usdc: Number(r.usdc ?? 0) };
  }
}

function mapBrief(r: any): Brief {
  let citations = [];
  try {
    citations = JSON.parse(r.citations || "[]");
  } catch {
    citations = [];
  }
  return {
    id: r.id,
    ticker: r.ticker,
    headline: r.headline,
    body: r.body,
    citations,
    publishedUrl: r.published_url || null,
    published: r.published === 1,
    source: r.source,
    divergenceScore: Number(r.divergence),
    createdAt: Number(r.ms),
  };
}
