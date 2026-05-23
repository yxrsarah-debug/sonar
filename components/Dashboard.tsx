"use client";

import { useCallback, useEffect, useState } from "react";
import type { Signal, Brief, Earnings, LoopResult } from "@/lib/types";
import DivergenceChart from "@/components/DivergenceChart";

type SignalsResponse = {
  signals: Signal[];
  earnings: Earnings;
  storeKind: string;
  adapters: Record<string, string>;
};

export default function Dashboard() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [earnings, setEarnings] = useState<Earnings>({ reads: 0, usdc: 0 });
  const [adapters, setAdapters] = useState<Record<string, string>>({});
  const [storeKind, setStoreKind] = useState<string>("");
  const [log, setLog] = useState<{ text: string; cls?: string }[]>([]);
  const [scanning, setScanning] = useState(false);
  const [paying, setPaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [chartKey, setChartKey] = useState(0);

  const addLog = useCallback((text: string, cls?: string) => {
    const stamp = new Date().toLocaleTimeString();
    setLog((l) => [{ text: `${stamp}  ${text}`, cls }, ...l].slice(0, 60));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [sigRes, brfRes] = await Promise.all([fetch("/api/signals", { cache: "no-store" }), fetch("/api/briefs", { cache: "no-store" })]);
      const sig = (await sigRes.json()) as SignalsResponse;
      const brf = (await brfRes.json()) as { briefs: Brief[] };
      if (sig.signals) setSignals(sig.signals);
      if (sig.earnings) setEarnings(sig.earnings);
      if (sig.adapters) setAdapters(sig.adapters);
      if (sig.storeKind) setStoreKind(sig.storeKind);
      if (brf.briefs) setBriefs(brf.briefs);
      setChartKey((k) => k + 1);
    } catch (e) {
      addLog(`refresh failed: ${String(e)}`, "warn");
    }
  }, [addLog]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runLoop = useCallback(async () => {
    setScanning(true);
    addLog("Running radar loop: sense → think → publish …");
    try {
      const res = await fetch("/api/loop", { method: "POST" });
      const data = (await res.json()) as LoopResult & { error?: string };
      if (data.error) {
        addLog(`loop error: ${data.error}`, "warn");
      } else {
        for (const n of data.notes) addLog(n, "ok");
        if (data.publishedTicker) addLog(`★ Brief ready for ${data.publishedTicker}`, "ok");
      }
      await refresh();
    } catch (e) {
      addLog(`loop failed: ${String(e)}`, "warn");
    } finally {
      setScanning(false);
    }
  }, [addLog, refresh]);

  const simulatePayment = useCallback(async () => {
    const target = briefs[0];
    if (!target) {
      addLog("no brief to purchase yet — run the loop first", "warn");
      return;
    }
    setPaying(true);
    try {
      addLog(`Buyer agent requesting ${target.ticker} feed (x402)…`);
      const res = await fetch(`/api/buy/${target.ticker}`, { method: "POST" });
      const data = await res.json();
      if (res.ok && !data.error) {
        if (data.mode === "live") {
          addLog(`✓ Paid on-chain via x402 — ${data.amountUsdc} ${data.asset} on ${data.network} from ${String(data.payer).slice(0, 8)}…`, "ok");
          if (data.settlement) addLog(`settlement receipt: ${String(data.settlement).slice(0, 44)}…`, "ok");
        } else {
          addLog(`✓ Agent read ${target.ticker} (demo-settle — set X402_PAY_TO + EVM_PRIVATE_KEY for real USDC)`, "ok");
        }
        await refresh();
      } else {
        addLog(`payment failed: ${data.error ?? res.status}`, "warn");
      }
    } catch (e) {
      addLog(`payment sim failed: ${String(e)}`, "warn");
    } finally {
      setPaying(false);
    }
  }, [briefs, addLog, refresh]);

  const top = signals[0];
  const latest = briefs[0];
  const activeTicker = selected ?? top?.ticker;

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <div className="eyebrow">Autonomous market intelligence · {storeKind ? `store: ${storeKind}` : ""}</div>
          <h1>SONAR</h1>
          <div className="sub">Market Intelligence Radar</div>
        </div>
        <div>
          <div className="statusrow">
            {Object.entries(adapters).map(([k, v]) => (
              <span key={k} className={`chip ${v === "live" ? "live" : "fallback"}`}>
                {k}: {v}
              </span>
            ))}
          </div>
          <div className="earn" style={{ marginTop: 10 }}>
            <div className="num">${earnings.usdc.toFixed(2)}</div>
            <div className="lbl">{earnings.reads} paid reads · x402</div>
          </div>
        </div>
      </div>

      <div className="banner">
        <b>Decision-support, not advice.</b> Sonar surfaces where to look and cites every source — it never issues buy/sell
        signals or price predictions. On weekends, news / social / Polymarket are live; price is shown as “last close.”
      </div>

      <div className="controls">
        <button className="primary" onClick={runLoop} disabled={scanning}>
          {scanning ? "Scanning…" : "▸ Run radar loop"}
        </button>
        <button className="ghost" onClick={simulatePayment} disabled={paying || !latest}>
          {paying ? "Paying…" : "Simulate agent payment (x402)"}
        </button>
        <button className="ghost" onClick={refresh} disabled={scanning}>
          Refresh
        </button>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Watchlist · divergence radar</h2>
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Social</th>
                <th>News</th>
                <th>Poly</th>
                <th>Price</th>
                <th>Divergence</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <tr
                  key={s.ticker}
                  className={s.flagged ? "flagged" : ""}
                  onClick={() => setSelected(s.ticker)}
                  style={{ cursor: "pointer", background: activeTicker === s.ticker ? "rgba(45,212,191,0.08)" : undefined }}
                >
                  <td className="tk">{s.ticker}</td>
                  <td>
                    <div className="bar">
                      <span style={{ width: `${s.socialVolume}%` }} />
                    </div>
                  </td>
                  <td className="muted">
                    {s.newsCount}
                    {s.newsSentiment > 0.15 && <span style={{ color: "#34D399", marginLeft: 6 }} title={`tone +${s.newsSentiment}`}>▲</span>}
                    {s.newsSentiment < -0.15 && <span style={{ color: "#F2685E", marginLeft: 6 }} title={`tone ${s.newsSentiment}`}>▼</span>}
                  </td>
                  <td className="muted">{s.polyProb !== null ? `${Math.round(s.polyProb * 100)}%` : "—"}</td>
                  <td className="muted">
                    {s.lastPrice !== null ? (
                      <>
                        ${s.lastPrice.toFixed(2)}{" "}
                        <span style={{ opacity: 0.6 }}>
                          {s.priceChangePct > 0 ? "+" : ""}
                          {s.priceChangePct}%{s.asOfClose ? " · close" : ""}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <div className={`bar ${s.flagged ? "amber" : ""}`}>
                      <span style={{ width: `${s.divergenceScore}%` }} />
                    </div>
                  </td>
                  <td>{s.flagged ? <span className="flag">flag</span> : ""}</td>
                </tr>
              ))}
              {signals.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ padding: "18px 8px" }}>
                    No signals yet — hit <b>Run radar loop</b> to sense the watchlist.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {top && (
            <p className="muted" style={{ marginTop: 12, fontSize: 12.5 }}>
              Top divergence: <b style={{ color: "var(--ink)" }}>{top.ticker}</b> at {top.divergenceScore}/100 — social{" "}
              {top.socialVolume}, {top.newsCount} news, poly {top.polyProb !== null ? `${Math.round(top.polyProb * 100)}%` : "—"},
              price {top.lastPrice !== null ? `$${top.lastPrice.toFixed(2)} ` : ""}({top.priceChangePct}%).
            </p>
          )}
        </div>

        <div className="card brief">
          <h2>Latest cited brief</h2>
          {latest ? (
            <>
              <div className="head">{latest.headline}</div>
              <div className="meta">
                <span className="tag pub">✓ Sonar brief · cited</span>{" "}
                <span className="muted" style={{ marginLeft: 6 }}>
                  divergence {latest.divergenceScore}
                </span>
              </div>
              <div className="body">{latest.body}</div>
              {latest.publishedUrl && (
                <p style={{ marginTop: 10, fontSize: 12.5 }}>
                  Public URL: <a href={latest.publishedUrl} target="_blank" rel="noreferrer">{latest.publishedUrl}</a>
                </p>
              )}
              <ul className="cites">
                {latest.citations.map((c, i) => (
                  <li key={i}>
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a>
                    ) : (
                      c.title
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">No brief yet. Run the loop; when a ticker crosses the divergence threshold, Sonar generates and publishes a cited brief here.</p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <DivergenceChart ticker={activeTicker} refreshKey={chartKey} />
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          Click any ticker in the radar to chart it. Left axis (0–100) is Social &amp; Polymarket; the price line reads on the right axis in dollars. On weekends the price is the dotted last-close. Dotted line / hollow dots = sample social history (replaced by live data as snapshots accumulate).
        </p>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Loop activity</h2>
        <div className="log">
          {log.length === 0 ? "› idle — run the radar loop to begin." : log.map((l, i) => <div key={i} className={l.cls}>{l.text}</div>)}
        </div>
      </div>

      <footer className="disc">
        Sonar is informational decision-support — not an RIA, not investment advice. Every signal links to its sources. Sample
        data is clearly labeled until live API keys are configured.
      </footer>
    </div>
  );
}
