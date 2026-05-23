// x402 payment gating is handled directly in the API route handlers
// (see app/api/feed/[ticker]/route.ts and lib/pay/x402.ts), not in middleware —
// x402-next requires Next.js 15, and this project runs on Next 14.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

// Match nothing — this middleware is intentionally inert.
export const config = { matcher: ["/__x402_inert__"] };
