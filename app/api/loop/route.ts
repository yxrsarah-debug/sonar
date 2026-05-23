import { runLoop } from "@/lib/agent/loop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/loop — run one autonomous pass of the radar.
export async function POST() {
  try {
    const result = await runLoop();
    return Response.json(result);
  } catch (e) {
    console.error("[api/loop]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
