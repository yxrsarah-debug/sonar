// Centralized env access + "is this adapter live?" flags.

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const config = {
  nimble: {
    apiKey: env("NIMBLE_API_KEY"),
    // Nimble SDK v1 (Search / Extract / Agents). Bearer auth.
    baseUrl: env("NIMBLE_BASE_URL") ?? "https://sdk.nimbleway.com/v1",
    get live() {
      return Boolean(this.apiKey);
    },
  },
  clickhouse: {
    url: env("CLICKHOUSE_URL"),
    user: env("CLICKHOUSE_USER") ?? "default",
    password: env("CLICKHOUSE_PASSWORD") ?? "",
    database: env("CLICKHOUSE_DATABASE") ?? "sonar",
    get live() {
      return Boolean(this.url);
    },
  },
  x402: {
    payTo: env("X402_PAY_TO"), // seller wallet that receives USDC
    buyerKey: env("EVM_PRIVATE_KEY"), // buyer agent's funded testnet wallet
    network: env("X402_NETWORK") ?? "base-sepolia",
    asset: env("X402_ASSET") ?? "USDC",
    priceUsdc: Number(env("X402_PRICE_USDC") ?? "0.05"),
    facilitatorUrl: env("X402_FACILITATOR_URL") ?? "https://facilitator.payai.network",
    get live() {
      return Boolean(this.payTo);
    },
  },
  watchlist: (env("SONAR_WATCHLIST") ?? "NVDA,TSLA,AAPL,MSFT,AMD,META")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
};

export function adapterStatus() {
  return {
    nimble: config.nimble.live ? "live" : "fallback",
    clickhouse: config.clickhouse.live ? "live" : "memory",
    x402: config.x402.live ? "live" : "demo-settle",
  };
}
