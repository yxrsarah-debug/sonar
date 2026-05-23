import { getStore } from "@/lib/store/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/briefs — most recent published / draft briefs.
export async function GET() {
  try {
    const store = await getStore();
    const briefs = await store.getBriefs(10);
    return Response.json({ briefs });
  } catch (e) {
    console.error("[api/briefs]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
