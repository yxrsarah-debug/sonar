import { getStore } from "@/lib/store/store";
import { config } from "@/lib/config";
import { verifyAndSettle, paymentRequiredResponse } from "@/lib/pay/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/feed/:ticker — the x402-gated, pay-per-read brief endpoint.
// When a seller wallet (X402_PAY_TO) is set: no payment -> 402; a valid
// X-PAYMENT is verified + settled on-chain via the facilitator, then the brief
// is returned. With no wallet configured it runs open ("demo-settle").
export async function GET(req: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  const resource = `/api/feed/${ticker}`;
  const mode: "live" | "demo-settle" = config.x402.live ? "live" : "demo-settle";
  let payer = "demo-agent";
  let settlementHeader: string | null = null;

  if (config.x402.live) {
    const header = req.headers.get("x-payment");
    if (!header) return paymentRequiredResponse(resource);
    const settle = await verifyAndSettle(header, resource);
    if (!settle.ok) return paymentRequiredResponse(resource, settle.reason);
    payer = settle.payer ?? payer;
    settlementHeader = settle.settlementHeader ?? null;
  }

  try {
    const store = await getStore();
    const brief = await store.getBriefForTicker(ticker);
    if (!brief) {
      return Response.json({ error: `no brief published for ${ticker} yet` }, { status: 404 });
    }
    const amount = config.x402.priceUsdc;
    await store.addRead(ticker, amount); // settled read -> earnings

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (settlementHeader) headers["x-payment-response"] = settlementHeader;
    return new Response(
      JSON.stringify({
        brief,
        payment: { mode, payer, amountUsdc: amount, asset: config.x402.asset, network: config.x402.network },
      }),
      { headers },
    );
  } catch (e) {
    console.error("[api/feed]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
