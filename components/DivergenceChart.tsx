"use client";

import { useEffect, useState } from "react";

type Pt = { date: string; price: number | null; real: boolean; social: number | null; poly: number | null; socialSample?: boolean; polySample?: boolean };

const C = { social: "#2DD4BF", poly: "#F8B84E", price: "#A78BFA", grid: "#22304d", axis: "#7E8AA8" };

function md(d: string): string {
  const parts = d.split("-");
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : d;
}

export default function DivergenceChart({ ticker, refreshKey = 0 }: { ticker?: string; refreshKey?: number }) {
  const [pts, setPts] = useState<Pt[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/series/${ticker}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setPts(Array.isArray(d.points) ? d.points : []);
      })
      .catch(() => {
        if (!cancelled) setPts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, refreshKey]);

  const W = 760, H = 320, padL = 40, padR = 60, padT = 30, padB = 42;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = pts.length;

  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y100 = (v: number) => padT + (1 - v / 100) * plotH;

  const prices = pts.map((p) => p.price).filter((v): v is number => typeof v === "number");
  const pmin = prices.length ? Math.min(...prices) : 0;
  const pmax = prices.length ? Math.max(...prices) : 1;
  // Price gets its own band (12..88) and a real-$ right axis, so its line reads
  // in dollars while social/poly use the 0..100 left axis.
  const priceY = (v: number) => y100(pmax > pmin ? 12 + ((v - pmin) / (pmax - pmin)) * 76 : 50);
  const rightTicks =
    prices.length === 0
      ? []
      : (pmax > pmin ? [pmax, (pmax + pmin) / 2, pmin] : [pmin]).map((pv) => ({
          pv,
          y: y100(pmax > pmin ? 12 + ((pv - pmin) / (pmax - pmin)) * 76 : 50),
        }));

  // price: solid through trading days, dotted tail across carried (weekend) days
  const solid = pts.map((p, i) => (p.real && p.price != null ? `${x(i).toFixed(1)},${priceY(p.price).toFixed(1)}` : null)).filter(Boolean).join(" ");
  let lastReal = -1;
  pts.forEach((p, i) => { if (p.real) lastReal = i; });
  const dotted: string[] = [];
  if (lastReal >= 0) for (let i = lastReal; i < n; i++) if (pts[i].price != null) dotted.push(`${x(i).toFixed(1)},${priceY(pts[i].price as number).toFixed(1)}`);
  const dottedSeg = dotted.length > 1 ? dotted.join(" ") : "";
  const hasCarried = pts.some((p) => !p.real);

  const seg = (sel: (p: Pt) => number | null) =>
    pts.map((p, i) => { const v = sel(p); return v === null ? null : `${x(i).toFixed(1)},${v.toFixed(1)}`; }).filter(Boolean).join(" ");
  const socialSeg = seg((p) => (p.social === null ? null : y100(p.social)));
  const polySeg = seg((p) => (p.poly === null ? null : y100(p.poly)));
  const hasSample = pts.some((p) => p.socialSample);
  const hasPolySample = pts.some((p) => p.polySample);

  const dot = (sel: (p: Pt) => number | null, color: string) =>
    pts.map((p, i) => { const v = sel(p); return v === null ? null : <circle key={`${color}${i}`} cx={x(i)} cy={v} r={3} fill={color} />; });

  const hasData = n > 0 && (prices.length > 0 || pts.some((p) => p.social != null));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>5-day activity &amp; divergence · {ticker ?? "—"}</h2>
        {loading && <span className="muted" style={{ fontSize: 12 }}>updating…</span>}
      </div>

      {!hasData ? (
        <p className="muted" style={{ padding: "24px 4px" }}>
          No series yet for {ticker}. The price line needs a live fetch; social &amp; Polymarket fill in as snapshots accumulate.
        </p>
      ) : (
        <>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`5-day divergence chart for ${ticker}`}>
          {[0, 20, 40, 60, 80, 100].map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y100(v)} y2={y100(v)} stroke={C.grid} strokeWidth={1} />
              <text x={padL - 6} y={y100(v) + 3} textAnchor="end" fontSize={10} fill={C.axis}>{v}</text>
            </g>
          ))}
          {pts.map((p, i) => (
            <text key={p.date} x={x(i)} y={H - 16} textAnchor="middle" fontSize={10} fill={C.axis}>{md(p.date)}</text>
          ))}

          {/* right axis: real price in dollars */}
          {rightTicks.map((t, k) => (
            <text key={`pr${k}`} x={W - padR + 8} y={t.y + 3} fontSize={10} fill={C.price}>${t.pv.toFixed(0)}</text>
          ))}
          <text x={W - padR + 8} y={padT - 10} fontSize={9} fill={C.price}>$ price</text>
          <text x={padL - 6} y={padT - 10} textAnchor="end" fontSize={9} fill={C.axis}>%</text>

          {solid && <polyline points={solid} fill="none" stroke={C.price} strokeWidth={2.5} />}
          {dottedSeg && <polyline points={dottedSeg} fill="none" stroke={C.price} strokeWidth={2.5} strokeDasharray="5 5" />}
          {polySeg && (
            <polyline points={polySeg} fill="none" stroke={C.poly} strokeWidth={2.5} strokeDasharray={hasPolySample ? "4 4" : undefined} />
          )}
          {socialSeg && (
            <polyline points={socialSeg} fill="none" stroke={C.social} strokeWidth={2.5} strokeDasharray={hasSample ? "4 4" : undefined} />
          )}
          {dot((p) => (p.price === null ? null : priceY(p.price)), C.price)}
          {/* poly markers: filled = real, hollow = sample */}
          {pts.map((p, i) =>
            p.poly === null ? null : (
              <circle
                key={`p${i}`}
                cx={x(i)}
                cy={y100(p.poly)}
                r={3.2}
                fill={p.polySample ? "#0A0F1E" : C.poly}
                stroke={C.poly}
                strokeWidth={p.polySample ? 1.5 : 0}
              />
            ),
          )}
          {/* social markers: filled = real, hollow = sample */}
          {pts.map((p, i) =>
            p.social === null ? null : (
              <circle
                key={`s${i}`}
                cx={x(i)}
                cy={y100(p.social)}
                r={3.2}
                fill={p.socialSample ? "#0A0F1E" : C.social}
                stroke={C.social}
                strokeWidth={p.socialSample ? 1.5 : 0}
              />
            ),
          )}

          <g fontSize={11} fill={C.axis}>
            <rect x={padL} y={8} width={12} height={3} fill={C.social} />
            <text x={padL + 18} y={12}>Social volume</text>
            <rect x={padL + 130} y={8} width={12} height={3} fill={C.poly} />
            <text x={padL + 148} y={12}>Polymarket odds{hasPolySample ? " (sample)" : ""}</text>
            <rect x={padL + 285} y={8} width={12} height={3} fill={C.price} />
            <text x={padL + 303} y={12}>Price{hasCarried ? " (last close)" : ""}</text>
          </g>
        </svg>
        <div style={{ marginTop: 10, fontSize: 11.5, color: "#8C99B3", lineHeight: 1.65 }}>
          <div>
            <span style={{ color: "#2DD4BF", fontWeight: 700 }}>Social ▲</span> chatter heating up&nbsp;·&nbsp;
            <span style={{ color: "#2DD4BF", fontWeight: 700 }}>▼</span> cooling off
          </div>
          <div>
            <span style={{ color: "#F8B84E", fontWeight: 700 }}>Polymarket ▲</span> crowd more convinced&nbsp;·&nbsp;
            <span style={{ color: "#F8B84E", fontWeight: 700 }}>▼</span> conviction fading
          </div>
          <div>
            <span style={{ color: "#A78BFA", fontWeight: 700 }}>Price ▲▼</span> the actual move&nbsp;·&nbsp;flat dotted = last close (weekend)
          </div>
          <div style={{ marginTop: 6, color: "#EAF0FB" }}>
            <b>Divergence:</b> social &amp; odds climbing while price stays flat — that gap is the “look here, now.”
          </div>
        </div>
        </>
      )}
    </div>
  );
}
