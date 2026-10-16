// Probe only: load the NFL site in headless Chrome as a returning viewer,
// open the scoreboard and report what it waited on: every request's time
// and any long stretch of script. Read only (GETs; no picks saved).
import { chromium } from "playwright";
const url = process.argv[2];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
// Never write anything to the league from the probe.
await ctx.route(/liftr-nfl\.jhs797\.workers\.dev/, (r) => r.request().method() === "GET" ? r.continue() : r.fulfill({ status: 200, body: "{}" }));
const p = await ctx.newPage();
const reqs = [];
const T0 = Date.now();
p.on("request", (q) => { q.__at = Date.now() - T0; });
p.on("requestfinished", async (q) => { const t = q.timing(); const r = await q.response().catch(() => null); reqs.push({ at: q.__at, u: q.url().replace(/&t=\d+/, "").replace(/^https?:\/\//, "").slice(0, 110), ms: Math.round(t.responseEnd), st: r?.status() }); });
p.on("requestfailed", (q) => reqs.push({ u: "FAILED " + q.url().slice(0, 90), ms: -1 }));
await p.addInitScript(() => {
  localStorage.setItem("brochiefs_me_v1", "Jake"); localStorage.setItem("brochiefs_rules_seen_v1", "1"); localStorage.setItem("brochiefs_splash_seen_v1", String(Date.now()));
  window.__long = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true }); } catch {}
});
const t0 = Date.now();
await p.goto(url, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => !document.getElementById("scoreboard-screen")?.classList.contains("hidden") || !document.getElementById("picks-screen")?.classList.contains("hidden"), null, { timeout: 30000 }).catch(() => {});
const shown = Date.now() - t0;
await p.evaluate(() => { if (document.getElementById("scoreboard-screen").classList.contains("hidden")) document.getElementById("nav-scoreboard-btn")?.click(); });
const t1 = Date.now();
await p.waitForFunction(() => document.querySelectorAll("#rankings-list .ranking-row, #rankings-list > *").length > 0 && document.querySelector(".rank-wp b"), null, { timeout: 40000 }).catch(() => {});
const board = Date.now() - t1;
await p.waitForTimeout(1500);
const timing = await p.evaluate(() => ({ long: window.__long, total: window.__long.reduce((s, x) => s + x[1], 0) }));
console.log(`screen up after ${shown} ms; leaderboard with win% after ${board} ms more`);
console.log(`long script tasks: ${timing.long.length}, ${timing.total} ms total; biggest: ${JSON.stringify(timing.long.sort((a, b) => b[1] - a[1]).slice(0, 8))}`);
console.log("data requests in order:"); for (const r of reqs.filter((x) => !/espncdn|fonts|zgo|\.(js|css|png|webp|json)(\?|$)/.test(x.u) || /espn\.com|workers\.dev/.test(x.u)).sort((a, b) => a.at - b.at)) console.log(`  +${String(r.at).padStart(5)}ms ${String(r.ms).padStart(5)}ms ${r.st ?? "-"} ${r.u}`);
// Where the time goes inside the win chance math.
const prof = await p.evaluate(() => { try { const t = performance.now(); winChanceMemo = { key: "", out: null }; const ctx = window.__wpCtx || {}; weekWinChances(ctx.cloudPicks || {}, ctx.results || {}, latestLive || {}); return Math.round(performance.now() - t); } catch (e) { return "err " + e.message; } });
console.log(`one weekWinChances run: ${prof} ms; live games: ${await p.evaluate(() => Object.values(latestLive || {}).filter((l) => l && l.state === "in").length)}`);
await b.close();
