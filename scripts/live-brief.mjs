#!/usr/bin/env node
// Everything open on Live, as one brief: health (Worker, ESPN, outside
// APIs), stuck moments (rage, dead taps, sudden closes, errors) and Ask the
// Chief misses from the last 24h, filtered the way Live filters them
// (fixes.json, connection blips, one-off slow calls, outside 429s).
//
//   BROCHIEFS_KEY=... node scripts/live-brief.mjs [--hours 24] [--league cfb|nfl]
//
// The key is the admin key Live uses. It is read from the environment and
// never printed. Output is for a terminal or a chat with Claude: people are
// counted, not named, and the admin's own activity is left out. Do not run
// this in a GitHub Action (no real data in Action logs).
import { readFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const HOURS = Number(arg("--hours", 24));
const LEAGUE = arg("--league", "cfb");
const WORKER = process.env.BROCHIEFS_WORKER || (LEAGUE === "nfl" ? "https://liftr-nfl.jhs797.workers.dev" : "https://liftr-ai.jhs797.workers.dev");
const KEY = process.env.BROCHIEFS_KEY;
if (!KEY) { console.error("Set BROCHIEFS_KEY (the Live admin key) in the environment."); process.exit(2); }

const since = Date.now() - HOURS * 3600000;
const get = async (path) => {
  const r = await fetch(`${WORKER}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(KEY)}&t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path.split("?")[0]} answered ${r.status}`);
  return r.json();
};
const fixes = (() => { try { return JSON.parse(readFileSync(new URL("../fixes.json", import.meta.url), "utf8")).fixes || []; } catch { return []; } })();
const when = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ADMIN = "Jake";

const [opsR, presR, chatR] = await Promise.allSettled([get("/ops"), get("/presence?seen=1"), get("/week-chat")]);
const fail = [opsR, presR, chatR].filter((x) => x.status === "rejected").map((x) => x.reason.message);

// --- Health -----------------------------------------------------------------
const OPS_KIND = { "route-fail": ["Worker error", 1], "cron-fail": ["Job failed", 1], "upstream-fail": ["Outside API failed", 1], "upstream-slow": ["Outside API slow", 0], "worker-fail": ["Worker failed", 1], "worker-slow": ["Worker slow", 0], "espn-fail": ["ESPN failed", 1], "espn-slow": ["ESPN slow", 0], "slow-load": ["Slow load", 0], "js-error": ["Error", 1] };
const ops = (opsR.value?.ops || []).filter((r) => r.at >= since);
const opsFixed = (r) => fixes.some((f) => f.k === r.k && String(r.d || "").includes(f.match) && r.at <= f.at);
const netErr = (r) => /-fail$/.test(r.k) && r.src !== "worker" && !/\s\d{3}$/.test(String(r.d || ""));
const blip = (r) => netErr(r) && r.n && new Set(ops.filter((x) => x.n === r.n && netErr(x) && Math.abs(x.at - r.at) <= 90000).map((x) => String(x.d || "").split(" ")[0])).size >= 2;
const groups = new Map();
for (const r of ops) {
  if (r.closed || opsFixed(r) || blip(r)) continue;
  const k = `${r.k}|${String(r.d || "").replace(/\d+(\.\d+)?s?\b/g, "#").slice(0, 60)}`;
  const g = groups.get(k) || { k: r.k, d: r.d, n: 0, ats: [], vs: new Set() };
  g.n++; g.ats.push(r.at); if (r.v) g.vs.add(r.v); groups.set(k, g);
}
const health = [...groups.values()].filter((g) => {
  const err = (OPS_KIND[g.k] || [g.k, 1])[1];
  if (g.k === "upstream-slow" && /saved copy served/.test(g.d || "")) return false;
  if (g.k === "upstream-fail" && /\b429\b/.test(g.d || "")) return g.n >= 3;
  return err || g.n >= 3;
}).sort((a, b) => (OPS_KIND[b.k]?.[1] || 0) - (OPS_KIND[a.k]?.[1] || 0) || b.n - a.n);

// --- Stuck moments ------------------------------------------------------------
const FR = { rage: "Rage tap", "dead-tap": "Dead tap", "quick-exit": "Sudden close", "js-error": "Error" };
const feed = (presR.value?.feed || []).filter((e) => e.at >= since && FR[e.k] && e.n !== ADMIN);
const frFixed = (e) => fixes.some((f) => (!f.k || f.k === e.k) && String(e.d || "").includes(f.match) && e.at <= f.at);
const fr = new Map();
for (const e of feed) {
  if (frFixed(e)) continue;
  const k = `${e.k}|${e.d || ""}`;
  const g = fr.get(k) || { k: e.k, d: e.d || "", n: 0, who: new Set(), ats: [], v: new Set() };
  g.n++; g.who.add(e.n); g.ats.push(e.at); if (e.v) g.v.add(e.v); fr.set(k, g);
}
const stuck = [...fr.values()].sort((a, b) => b.who.size - a.who.size || b.n - a.n);

// --- Ask the Chief ----------------------------------------------------------
const chats = (chatR.value?.chats || []).filter((c) => c.at >= since && c.asker !== ADMIN);
const misses = chats.filter((c) => c.flagged || (c.status && !["answered", "asked"].includes(c.status)));

// --- Print ------------------------------------------------------------------
const out = [`Brochiefs ${LEAGUE.toUpperCase()} · open on Live, last ${HOURS}h · ${when(Date.now())} ET`];
if (fail.length) out.push(`(could not read: ${fail.join("; ")})`);
out.push("", `HEALTH · ${health.length} open`);
health.slice(0, 12).forEach((g, i) => out.push(`${i + 1}. "${(OPS_KIND[g.k] || [g.k])[0]}" ${g.n}x (example: ${g.d || g.k}; at ${g.ats.sort((a, b) => a - b).map(when).join(", ")}${g.vs.size ? `; app build ${[...g.vs].join(", ")}` : ""})`));
out.push("", `STUCK MOMENTS · ${stuck.length} open`);
stuck.slice(0, 12).forEach((g, i) => out.push(`${i + 1}. ${FR[g.k]} on ${g.d || "(no label)"}: ${g.n}x by ${g.who.size} ${g.who.size === 1 ? "person" : "people"} (last ${when(Math.max(...g.ats))}${g.v.size ? `; build ${[...g.v].join(", ")}` : ""})`));
out.push("", `ASK THE CHIEF · ${misses.length} of ${chats.length} need a look`);
misses.slice(0, 8).forEach((c, i) => out.push(`${i + 1}. [${c.flagged ? "flagged" : c.status}] Q: ${c.q}\n   A: ${c.a ?? "(no answer)"}${(c.tools || []).map((t) => `\n   tool ${t.name}(${typeof t.args === "string" ? t.args : JSON.stringify(t.args)}) -> ${String(typeof t.out === "string" ? t.out : JSON.stringify(t.out)).slice(0, 300)}`).join("")}`));
if (!health.length && !stuck.length && !misses.length) out.push("", "Nothing open. Live is clean.");
console.log(out.join("\n"));
