import { config } from "@/lib/config";
import { payForResource } from "@/lib/pay/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/buy/:ticker — the BUYER agent.
// Calls the x402-gated feed and pays automatically with the funded Base Sepolia
// wallet (real USDC settlement via the facilitator). Falls back to a plain read
// (demo) when no buyer key / seller wallet is configured.
export async function POST(req: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  const feedUrl = `${new URL(req.url).origin}/api/feed/${ticker}`;

  try {
    if (config.x402.live && config.x402.buyerKey) {
      const { res, payer, xPaymentResponse } = await payForResource(feedUrl);
      const data = await res.json();
      if (!res.ok) {
        return Response.json({ mode: "live", error: data?.error ?? `feed ${res.status}` }, { status: 502 });
      }
      return Response.json({
        mode: "live",
        payer: payer ?? "agent",
        amountUsdc: config.x402.priceUsdc,
        asset: config.x402.asset,
        network: config.x402.network,
        settlement: xPaymentResponse ?? null,
        brief: data.brief ?? null,
      });
    }

    // demo fallback: feed is open — just read it.
    const res = await fetch(feedUrl, { cache: "no-store" });
    const data = await res.json();
    return Response.json({
      mode: "demo-settle",
      payer: "demo-agent",
      amountUsdc: config.x402.priceUsdc,
      asset: config.x402.asset,
      network: config.x402.network,
      settlement: null,
      brief: data.brief ?? null,
    });
  } catch (e) {
    console.error("[api/buy]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
