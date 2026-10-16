// Probe only: audit one manager's win chance on the live board. Loads the
// site read only (writes and analytics blocked, as in browser.mjs), reruns
// the simulation, then forces each way their swing game can end and reruns
// it, so "hit it / miss it" is checked by direct conditioning.
import { chromium } from "playwright";
const [url, who] = [process.argv[2], process.argv[3]];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
const READS = /^\/(games|auth|weeks|picks|live|avatars|app-control|trivia|roster|season|insights|experts|qotw)(\?|$)/;
await ctx.route(/liftr-(nfl|ai)\.jhs797\.workers\.dev/, (r) => { const u = new URL(r.request().url()); return r.request().method() === "GET" && READS.test(u.pathname + u.search.slice(0, 1)) ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
await ctx.route(/goatcounter|zgo\.at/, (r) => r.abort());
const p = await ctx.newPage();
await p.addInitScript(() => { localStorage.setItem("brochiefs_me_v1", "Jake"); localStorage.setItem("brochiefs_rules_seen_v1", "1"); });
await p.goto(url, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => document.querySelector(".rank-wp b") && typeof lastGoodCloudPicks !== "undefined" && lastGoodCloudPicks, null, { timeout: 40000 }).catch(() => {});
await p.waitForTimeout(1500);
const out = await p.evaluate((who) => {
  const L = [];
  const picks = lastGoodCloudPicks || {};
  const live0 = JSON.parse(JSON.stringify(latestLive));
  const results0 = computeLiveResults(live0);
  const label = (g, pk) => `${pk.team === g.away ? g.awayShort : g.homeShort} ${pk.mode === "SU" ? "to win" : `${pk.team === g.favorite ? "-" : "+"}${g.spread}`}`;
  const run = (live) => { winChanceMemo = { key: "", out: null }; const res = computeLiveResults(live); weekWinChances(picks, res, live); return winChanceMemo.detail[who]; };
  const pct = (x) => (x * 100).toFixed(1) + "%";
  L.push(`final games: ${Object.keys(results0).length} of ${GAMES.length}; live: ${Object.values(live0).filter((l) => l?.state === "in").length}`);
  const runs = [];
  for (let i = 0; i < 6; i++) runs.push(run(live0));
  L.push(`${who} win chance over 6 reruns of 5,000: ${runs.map((d) => pct(d.pct)).join(" ")}`);
  const d = runs[0], sw = d.swing;
  if (!sw) return L.concat("no swing game").join("\n");
  L.push(`swing: ${label(sw.game, sw.pick)} · p(hit) ${pct(sw.pHit)} · if hit ${pct(sw.ifHit)} · if miss ${pct(sw.ifMiss)} · check p*hit+(1-p)*miss = ${pct(sw.pHit * sw.ifHit + (1 - sw.pHit) * sw.ifMiss)} vs ${pct(d.pct)}`);
  // Force the swing game final each way it can end, rerun.
  const g = sw.game;
  for (const c of gameCats(g)) {
    const live = JSON.parse(JSON.stringify(live0));
    live[g.id] = { ...(live[g.id] || {}), found: true, completed: true, state: "post", awayScore: c.res.awayScore, homeScore: c.res.homeScore };
    const rs = [run(live), run(live), run(live)];
    const dd = rs[0];
    L.push(`forced "${c.txt}": ${who} ${rs.map((x) => pct(x.pct)).join(" ")} · threats ${dd.threats.map((t) => `${t.name} ${pct(t.p)}`).join(", ")}`);
  }
  // Where everyone stands, and their pick on the swing game.
  const rows = MANAGERS.map((n) => {
    const banked = GAMES.reduce((t, x) => t + (results0[x.id] ? scorePick(x, picks[n]?.picks?.[x.id], results0[x.id]) || 0 : 0), 0);
    let max = banked; for (const x of GAMES) { const pk = picks[n]?.picks?.[x.id]; if (pk?.team && !results0[x.id]) max += pointValue(x, pk.team, pk.mode); }
    const pk = picks[n]?.picks?.[g.id];
    const same = GAMES.filter((x) => !results0[x.id] && picks[n]?.picks?.[x.id]?.team === picks[who]?.picks?.[x.id]?.team && picks[n]?.picks?.[x.id]?.mode === picks[who]?.picks?.[x.id]?.mode).length;
    return { n, banked, max, swingPick: pk?.team ? label(g, pk) : "-", same, tb: String(picks[n]?.tiebreaker ?? "") };
  }).sort((a, b) => b.max - a.max);
  L.push(`open games: ${GAMES.filter((x) => !results0[x.id]).length}`);
  for (const r of rows) L.push(`  ${r.n.padEnd(8)} banked ${String(r.banked).padStart(2)} max ${String(r.max).padStart(2)} · on swing game: ${r.swingPick.padEnd(16)} · same open picks as ${who}: ${r.same} · tb ${r.tb ? "set" : "none"}`);
  return L.join("\n");
}, who);
console.log(out);
await b.close();
