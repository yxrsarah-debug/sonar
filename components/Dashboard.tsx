"use client";

import { useCallback, useEffect, useState } from "react";
import type { Signal, Brief, Earnings, LoopResult } from "@/lib/types";
import DivergenceChart from "@/components/DivergenceChart";

type Stage = "idle" | "active" | "done";
const STAGES = [
  { key: "SENSE", tool: "Nimble + Custom", color: "#38BDF8" },
  { key: "THINK", tool: "ClickHouse + Lexicon", color: "#2DD4BF" },
  { key: "COMPOSE", tool: "Sonar", color: "#A78BFA" },
  { key: "TRANSACT", tool: "x402 · CDP/AgentKit", color: "#F8B84E" },
];

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
  const [stage, setStage] = useState<Stage[]>(["idle", "idle", "idle", "idle"]);

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
    setStage(["active", "idle", "idle", "idle"]);
    addLog("Running radar loop: SENSE → THINK → COMPOSE …");
    const t1 = setTimeout(() => setStage(["done", "active", "idle", "idle"]), 1300);
    const t2 = setTimeout(() => setStage(["done", "done", "active", "idle"]), 2800);
    try {
      const res = await fetch("/api/loop", { method: "POST" });
      const data = (await res.json()) as LoopResult & { error?: string };
      clearTimeout(t1);
      clearTimeout(t2);
      if (data.error) {
        addLog(`loop error: ${data.error}`, "warn");
        setStage(["idle", "idle", "idle", "idle"]);
      } else {
        for (const n of data.notes) addLog(n, "ok");
        if (data.publishedTicker) addLog(`★ Brief ready for ${data.publishedTicker}`, "ok");
        setStage((s) => ["done", "done", "done", s[3]]);
      }
      await refresh();
    } catch (e) {
      clearTimeout(t1);
      clearTimeout(t2);
      addLog(`loop failed: ${String(e)}`, "warn");
      setStage(["idle", "idle", "idle", "idle"]);
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
    setStage(["done", "done", "done", "active"]);
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
        setStage(["done", "done", "done", "done"]);
        await refresh();
      } else {
        addLog(`payment failed: ${data.error ?? res.status}`, "warn");
        setStage(["done", "done", "done", "idle"]);
      }
    } catch (e) {
      addLog(`payment sim failed: ${String(e)}`, "warn");
      setStage(["done", "done", "done", "idle"]);
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
        <div className="brand" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sonar-icon.png"
            alt="Sonar logo"
            style={{ height: 58, width: "auto", borderRadius: 12, background: "#fff", padding: 7, boxShadow: "0 2px 12px rgba(0,0,0,0.35)" }}
          />
          <div>
            <div className="eyebrow">Autonomous market intelligence · {storeKind ? `store: ${storeKind}` : ""}</div>
            <h1 style={{ margin: 0 }}>SONAR</h1>
            <div className="sub">Market Intelligence Radar</div>
          </div>
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
        <b>Decision-support, not advice.</b> A high <b>divergence score</b> means news + social chatter (and Polymarket
        crowd-odds) are climbing while the price hasn’t moved yet — Sonar’s “look here, now,” with every source cited,
        not a buy/sell call. On weekends, news / social / Polymarket are live; price is shown as “last close.”
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

      <div className="loopstrip">
        <div className="loopstrip-label">THE AUTONOMOUS LOOP — one click runs it end to end</div>
        <div className="pipeline" aria-label="agent pipeline">
          {STAGES.map((st, i) => (
            <div key={st.key} className="stagewrap">
              <div className={`stage s-${stage[i]}`} style={stage[i] === "active" ? { borderColor: st.color } : undefined}>
                <span className="st-num" style={{ background: stage[i] === "idle" ? "#2A3656" : st.color }}>
                  {stage[i] === "done" ? "✓" : i + 1}
                </span>
                <span className="st-key">{st.key}</span>
                <span className="st-tool">{st.tool}</span>
              </div>
              {i < STAGES.length - 1 && <span className="st-arrow">→</span>}
            </div>
          ))}
          <span className="st-loop" title="continuous loop">↻</span>
        </div>
      </div>
      <style>{`
        .loopstrip { margin:16px 0 8px; border:1px solid #1B2540; background:#0E1526; border-radius:14px; padding:16px 18px; }
        .loopstrip-label { font-size:11px; letter-spacing:2px; color:#2DD4BF; font-weight:700; margin-bottom:12px; }
        .pipeline { display:flex; align-items:center; flex-wrap:wrap; gap:6px 0; }
        .stagewrap { display:flex; align-items:center; }
        .stage { border:1.5px solid #243049; background:#141C30; border-radius:12px; padding:13px 18px; min-width:162px; opacity:.5; transition:opacity .25s, border-color .25s; }
        .stage.s-active { opacity:1; animation:pipePulse 1.1s ease-in-out infinite; }
        .stage.s-done { opacity:1; }
        .st-num { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; font-size:12px; font-weight:800; color:#0A0F1E; margin-bottom:9px; }
        .st-key { display:block; font-weight:800; font-size:17px; letter-spacing:1px; color:#EAF0FB; }
        .st-tool { display:block; font-size:11.5px; color:#8C99B3; margin-top:3px; }
        .st-arrow { color:#3A496B; margin:0 10px; font-size:22px; }
        .st-loop { color:#2DD4BF; margin-left:12px; font-size:24px; align-self:center; }
        @keyframes pipePulse { 0%,100%{ box-shadow:0 0 0 0 rgba(45,212,191,0);} 50%{ box-shadow:0 0 0 4px rgba(45,212,191,.40);} }
        .formula { margin-top:12px; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:13.5px; background:#0E1526; border:1px solid #1B2540; border-radius:10px; padding:10px 12px; line-height:1.5; }
        .formula .f-eq { color:#EAF0FB; font-weight:700; }
        .formula .f-op { color:#6B7896; }
        .formula-note { margin-top:7px; font-size:11.5px; color:#8C99B3; }
      `}</style>

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

          <div className="formula" aria-label="divergence formula">
            <span className="f-eq">divergence</span>
            <span className="f-op"> ≈ ( </span>
            <span style={{ color: "#2DD4BF", fontWeight: 700 }}>0.5·social</span>
            <span className="f-op"> + </span>
            <span style={{ color: "#38BDF8", fontWeight: 700 }}>0.3·news</span>
            <span className="f-op"> + </span>
            <span style={{ color: "#F8B84E", fontWeight: 700 }}>0.2·poly</span>
            <span className="f-op"> ) × </span>
            <span style={{ color: "#A78BFA", fontWeight: 700 }}>price-flatness</span>
          </div>
          <div className="formula-note">
            High when chatter, news &amp; crowd-odds are elevated but price is flat. Flatness → 1 when price hasn’t moved, → 0.5 once it has already run.
          </div>
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
