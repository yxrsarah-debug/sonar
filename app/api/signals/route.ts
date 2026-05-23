import { gatherSignals } from "@/lib/agent/loop";
import { getStore } from "@/lib/store/store";
import { adapterStatus } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/signals — current divergence signals + adapter status + earnings.
export async function GET() {
  try {
    const store = await getStore();
    const [signals, earnings] = await Promise.all([gatherSignals(), store.getEarnings()]);
    return Response.json({
      signals,
      earnings,
      storeKind: store.kind,
      adapters: adapterStatus(),
    });
  } catch (e) {
    console.error("[api/signals]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
