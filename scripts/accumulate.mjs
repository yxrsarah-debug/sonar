// Sonar snapshot accumulator.
//
// Runs the radar loop on an interval so social + Polymarket history accumulates
// in ClickHouse, filling the 5-day chart over time. Run it on YOUR machine
// (Cowork's scheduler can't reach your localhost):
//
//   node scripts/accumulate.mjs
//   # or keep it running in the background:
//   nohup node scripts/accumulate.mjs > accumulate.log 2>&1 &
//
// Env: SONAR_URL (default http://localhost:3000), EVERY_MIN (default 30)

const URL = process.env.SONAR_URL || "http://localhost:3000";
const EVERY_MIN = Number(process.env.EVERY_MIN || 30);

async function tick() {
  const t = new Date().toISOString();
  try {
    const res = await fetch(`${URL}/api/loop`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    const flagged = Array.isArray(data.flagged) && data.flagged.length ? data.flagged.join(",") : "none";
    console.log(`${t}  loop ${res.status}  flagged: ${flagged}`);
  } catch (e) {
    console.error(`${t}  error: ${String(e)}`);
  }
}

console.log(`Sonar accumulator -> ${URL}/api/loop every ${EVERY_MIN} min. Ctrl+C to stop.`);
tick();
setInterval(tick, EVERY_MIN * 60 * 1000);
