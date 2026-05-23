# Sonar — Market Intelligence Radar

An **autonomous agent** that watches the open web for market signals, fuses them in real time, detects **divergence**, composes a **neutral, fully-cited brief**, and **sells it to other agents for real USDC** over the x402 protocol.

```
SENSE  →  THINK  →  COMPOSE  →  TRANSACT  →  (loop)
Nimble    ClickHouse   Sonar       x402 · Coinbase
```

- **SENSE — Nimble.** Real news and social chatter via Nimble Web Search Agents (focus modes `news` / `social`). Real equity prices (daily history, "last close" on weekends). Prediction-market odds from Polymarket.
- **THINK — ClickHouse.** Every observation is stored as a timestamped event. The loop scores **divergence** — when chatter + crowd-odds are elevated while price is flat — using a self-calibrating *relative standout* model.
- **COMPOSE — Sonar.** For the top flagged ticker it composes a neutral, fully-cited brief from the measured signal. Deterministic, offline, **no LLM — so it can't hallucinate.**
- **TRANSACT — x402 (Coinbase).** The brief is served from an **x402-gated** endpoint; a buyer agent pays per read in USDC, **settled on-chain on Base Sepolia** via a facilitator.

> **Decision-support, not advice.** Sonar surfaces *where to look* and cites every source. It never issues buy/sell signals or price predictions. This is intentional, stated in the UI, and is the credibility moat.

---

## Sponsor tools (3, each load-bearing)

| Tool | Role | What breaks without it |
|------|------|------------------------|
| **Nimble** (Web Search Agents) | SENSE — real news + social | no live market chatter |
| **ClickHouse** | THINK — store + divergence analytics | no idea what changed |
| **x402 / Coinbase** | TRANSACT — real on-chain USDC payments | no revenue / no agent economy |

Polymarket (Gamma + CLOB) and Stooq/Yahoo (prices) are **data sources**, not sponsors.

---

## Quickstart (runs locally with sample fallbacks)

```bash
npm install
cp .env.example .env.local   # fill in keys for the live paths
npm run dev                  # http://localhost:3000
```

Open the dashboard and click **▸ Run radar loop**. Each adapter has a live path that activates from `.env.local`; without a key it falls back to clearly-labeled sample data so the full loop still runs end-to-end.

| Layer | Env | Without it |
|-------|-----|-----------|
| Nimble | `NIMBLE_API_KEY` | synthetic news/social (labeled `[sample]`) |
| ClickHouse | `CLICKHOUSE_URL` `CLICKHOUSE_USER` `CLICKHOUSE_PASSWORD` | in-memory dev store |
| x402 (real settlement) | `X402_PAY_TO` + `EVM_PRIVATE_KEY` | `demo-settle` (no on-chain transfer) |

Prices (Stooq/Yahoo) and Polymarket (Gamma/CLOB) are keyless and live by default.

---

## Turning on real on-chain x402 (Base Sepolia)

1. **Buyer wallet** — fund an EVM wallet with **Base Sepolia test USDC** from [faucet.circle.com](https://faucet.circle.com). (Gas is covered by the facilitator's relayer; you only need USDC.)
2. Set in `.env.local`:
   ```
   X402_PAY_TO=0xYourSellerAddress          # receives the USDC
   EVM_PRIVATE_KEY=0xYourBuyerWalletKey      # funded buyer agent (testnet only)
   X402_NETWORK=base-sepolia
   X402_FACILITATOR_URL=https://facilitator.payai.network
   X402_PRICE_USDC=0.05
   ```
3. Restart `npm run dev`, run the loop, then click **Simulate agent payment (x402)**. The buyer agent signs an EIP-3009 `transferWithAuthorization` (viem), the server verifies + settles via the facilitator, and a real USDC transfer lands — verify it on [sepolia.basescan.org](https://sepolia.basescan.org).

### The x402 handshake (`lib/pay/x402.ts`)

`GET /api/feed/:ticker`

1. No payment → **HTTP 402** + an `accepts` array of payment requirements.
2. Buyer signs a USDC authorization and retries with an `X-PAYMENT` header.
3. Server verifies + settles via the facilitator → returns the brief + an `X-PAYMENT-RESPONSE` receipt.

The buyer agent lives at `POST /api/buy/:ticker` and uses a funded testnet wallet.

---

## The 5-day chart

Each ticker has a real **5-day Activity & Divergence** chart:

- **Price** — real daily closes (right axis, $); weekend days are a dotted flat last-close line.
- **Polymarket odds** — real 5-day history from the CLOB `/prices-history` endpoint for the matched market.
- **Social** — real where collected (solid/filled); past days show as clearly-marked **sample** (dotted line / hollow dots) until live snapshots accumulate.

To accumulate real social/Polymarket history over days, run the snapshot loop on your machine:

```bash
node scripts/accumulate.mjs          # POSTs /api/loop every 30 min
EVERY_MIN=120 node scripts/accumulate.mjs   # economical
```

---

## How divergence is scored (`lib/analyze/divergence.ts`)

```
activity  = 0.5·socialVolume + 0.3·newsIntensity + 0.2·polymarketConviction
flatness  = 1 − 0.5·min(|recent price move| / 8, 1)      # gentle: never zeroes a score
score     = activity × flatness                          # 0..100
```

Because all watchlist names are always-busy mega-caps, flagging is **relative**: a ticker is flagged when its score stands out from the basket median (with an absolute floor), so the radar highlights the genuine standout instead of lighting up everything. Headlines are scored with a free **offline finance-lexicon sentiment** model (`lib/analyze/sentiment.ts`) — the tone shows as ▲/▼ in the radar and in the brief.

---

## Project structure

```
app/
  page.tsx                       # dashboard (radar UI)
  api/loop/route.ts              # POST: run one autonomous pass
  api/signals/route.ts          # GET: divergence signals + adapters + earnings
  api/briefs/route.ts           # GET: recent briefs
  api/feed/[ticker]/route.ts     # GET: x402-gated pay-per-read brief
  api/buy/[ticker]/route.ts      # POST: buyer agent (pays via x402)
  api/series/[ticker]/route.ts   # GET: 5-day chart series
components/
  Dashboard.tsx                  # radar dashboard (client)
  DivergenceChart.tsx            # 5-day per-stock chart (SVG)
lib/
  sources/nimble.ts              # SENSE: real news + social (Web Search Agents)
  sources/prices.ts              # SENSE: real daily prices (Stooq → Yahoo)
  sources/polymarket.ts          # SENSE: Polymarket odds (Gamma) + 5-day CLOB history
  analyze/divergence.ts          # THINK: divergence + relative-standout flagging
  analyze/sentiment.ts           # THINK: offline finance-lexicon headline tone
  analyze/series.ts              # THINK: chart series helper
  store/clickhouse.ts            # THINK: real storage + daily aggregation
  store/memory.ts                # THINK: dev fallback
  store/schema.sql               # ClickHouse DDL
  publish/brief.ts               # COMPOSE: neutral, fully-cited brief (no LLM)
  pay/x402.ts                    # TRANSACT: x402 handshake + EIP-3009 + facilitator
  agent/loop.ts                  # the orchestrator
scripts/accumulate.mjs           # snapshot loop on a schedule (builds chart history)
```

## Disclaimer

Sonar is informational decision-support — not an RIA and not investment advice. Outputs are grounded in cited sources; the brief is composed deterministically from measured data (no hallucination), and any sample data is clearly labeled until live sources are configured.
