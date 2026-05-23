// TRANSACT layer — x402 ("exact" scheme, EVM / USDC).
//
// Implements the x402 handshake directly with viem (no x402-next, which requires
// Next 15). Real settlement path uses EIP-3009 `transferWithAuthorization`:
//   1. Client GETs the resource with no payment.
//   2. Server replies 402 + an `accepts` array of PaymentRequirements.
//   3. Client signs a USDC transfer authorization and retries with X-PAYMENT.
//   4. Server verifies + settles via the facilitator, then returns the data.
//
// Spec: https://github.com/coinbase/x402  ·  facilitator: PayAI / x402.org
// Everything degrades gracefully: with no buyer key / payTo, the app runs in
// "demo-settle" mode so the loop and dashboard always work.

import { privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";
import { config } from "@/lib/config";

// --- per-network USDC config (EIP-712 domain for transferWithAuthorization) ---
interface UsdcInfo {
  address: `0x${string}`;
  name: string;
  version: string;
  chainId: number;
  decimals: number;
}
const USDC: Record<string, UsdcInfo> = {
  "base-sepolia": {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    name: "USDC",
    version: "2",
    chainId: 84532,
    decimals: 6,
  },
  base: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    name: "USD Coin",
    version: "2",
    chainId: 8453,
    decimals: 6,
  },
};

function usdcFor(network: string): UsdcInfo {
  return USDC[network] ?? USDC["base-sepolia"];
}
function toAtomic(usd: number, decimals: number): string {
  return BigInt(Math.round(usd * 10 ** decimals)).toString();
}

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
}

export function buildRequirements(resource: string): PaymentRequirements {
  const net = config.x402.network;
  const usdc = usdcFor(net);
  return {
    scheme: "exact",
    network: net,
    maxAmountRequired: toAtomic(config.x402.priceUsdc, usdc.decimals),
    resource,
    description: "Sonar market-intelligence brief (pay-per-read)",
    mimeType: "application/json",
    payTo: config.x402.payTo ?? "0x0000000000000000000000000000000000000000",
    maxTimeoutSeconds: 60,
    asset: usdc.address,
    extra: { name: usdc.name, version: usdc.version },
  };
}

// 402 body per the x402 spec.
export function paymentRequiredResponse(resource: string, reason?: string): Response {
  return new Response(
    JSON.stringify({ x402Version: 1, error: reason ?? "payment required", accepts: [buildRequirements(resource)] }),
    { status: 402, headers: { "content-type": "application/json" } },
  );
}

// =============================== SELLER ====================================
export interface SettleResult {
  ok: boolean;
  payer?: string;
  txHash?: string;
  settlementHeader?: string; // base64 settle response for X-PAYMENT-RESPONSE
  reason?: string;
}

function b64encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}
function b64decode<T>(s: string): T {
  return JSON.parse(Buffer.from(s, "base64").toString("utf8")) as T;
}

// Verify + settle a presented X-PAYMENT via the facilitator.
export async function verifyAndSettle(paymentHeader: string, resource: string): Promise<SettleResult> {
  let paymentPayload: unknown;
  try {
    paymentPayload = b64decode(paymentHeader);
  } catch {
    return { ok: false, reason: "malformed X-PAYMENT header" };
  }
  const paymentRequirements = buildRequirements(resource);
  const base = config.x402.facilitatorUrl;
  const body = JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements });
  const headers = { "content-type": "application/json" };

  try {
    const vr = await fetch(`${base}/verify`, { method: "POST", headers, body, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!vr.ok) return { ok: false, reason: `verify ${vr.status} ${await vr.text().catch(() => "")}` };
    const vd = (await vr.json()) as { isValid?: boolean; invalidReason?: string; payer?: string };
    if (!vd.isValid) return { ok: false, reason: vd.invalidReason ?? "invalid payment" };

    const sr = await fetch(`${base}/settle`, { method: "POST", headers, body, cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!sr.ok) return { ok: false, reason: `settle ${sr.status} ${await sr.text().catch(() => "")}` };
    const sd = (await sr.json()) as { success?: boolean; errorReason?: string; transaction?: string; payer?: string };
    if (!sd.success) return { ok: false, reason: sd.errorReason ?? "settle failed" };

    return { ok: true, payer: sd.payer ?? vd.payer, txHash: sd.transaction, settlementHeader: b64encode(sd) };
  } catch (e) {
    return { ok: false, reason: `facilitator error: ${String(e)}` };
  }
}

// =============================== BUYER =====================================
function randomNonce(): `0x${string}` {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return toHex(b);
}

// Sign a USDC transferWithAuthorization for the given requirements -> X-PAYMENT.
export async function signXPayment(reqs: PaymentRequirements, privateKey: string): Promise<{ header: string; from: string }> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const usdc = usdcFor(reqs.network);
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + reqs.maxTimeoutSeconds);
  const nonce = randomNonce();

  const signature = await account.signTypedData({
    domain: { name: reqs.extra.name, version: reqs.extra.version, chainId: usdc.chainId, verifyingContract: usdc.address },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: reqs.payTo as `0x${string}`,
      value: BigInt(reqs.maxAmountRequired),
      validAfter,
      validBefore,
      nonce,
    },
  });

  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: reqs.network,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: reqs.payTo,
        value: reqs.maxAmountRequired,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };
  return { header: b64encode(payload), from: account.address };
}

// Full buyer flow: GET -> 402 -> sign -> retry. Returns the final response.
export async function payForResource(url: string): Promise<{ res: Response; payer?: string; xPaymentResponse?: string | null }> {
  const first = await fetch(url, { cache: "no-store" });
  if (first.status !== 402) {
    return { res: first }; // open / demo mode
  }
  if (!config.x402.buyerKey) {
    return { res: first }; // can't pay without a buyer key
  }
  const body = (await first.json()) as { accepts?: PaymentRequirements[] };
  const reqs = body.accepts?.[0];
  if (!reqs) return { res: first };

  const { header, from } = await signXPayment(reqs, config.x402.buyerKey);
  const paid = await fetch(url, { cache: "no-store", headers: { "X-PAYMENT": header } });
  return { res: paid, payer: from, xPaymentResponse: paid.headers.get("x-payment-response") };
}
