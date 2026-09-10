// Puts week 1 into the record.
//
// Week 1 was played before the app understood weeks, so two pieces of it
// were never stored: the slate (it only exists as the fallback GAMES array
// in app.js) and the finals (the board read them straight from ESPN and
// kept nothing). The picks are in KV. This script fills the two gaps -
// posting the slate under the same game ids the picks reference, then the
// finals from ESPN - which makes the Worker seal the week like any other
// and hands out the trophy.
//
// Safe to re-run: sealing is idempotent and a trophy is never counted
// twice. Nothing is written until you confirm the standings it prints.
//
//   node scripts/seal-week-1.mjs              # asks for the admin key
//   node scripts/seal-week-1.mjs --dry-run    # prints, writes nothing
//
// The key can also come from ARCHIVE_LOG_KEY in the environment.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const WORKER = "https://liftr-ai.jhs797.workers.dev";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
const ORIGIN = { Origin: "https://brochiefs.com" };
const WEEK = 1;
const DRY = process.argv.includes("--dry-run");
const root = path.resolve(import.meta.dirname, "..");

// --- the slate, read out of the app's fallback array ---------------------
function weekOneSlate() {
  const src = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const start = src.indexOf("let GAMES = [");
  if (start < 0) throw new Error("could not find the GAMES fallback in app.js");
  const arr = src.slice(start, src.indexOf("\n];", start) + 3);
  const games = new Function(arr.replace("let GAMES", "var GAMES") + "; return GAMES;")();
  // Exactly the fields the Worker validates, in the array's own order so
  // the ids keep pointing at the games the picks were made on.
  return games.map((g) => ({
    id: g.id, away: g.away, home: g.home, awayShort: g.awayShort, homeShort: g.homeShort,
    awayId: g.awayId, homeId: g.homeId, favorite: g.favorite, spread: g.spread,
    kickoff: new Date(g.kickoff).toISOString(), tv: g.tv || "",
    ...(g.tiebreakerGame ? { tiebreakerGame: true } : {}),
  }));
}

// --- the finals, from ESPN's archive of those dates ----------------------
async function finalsFor(games) {
  const dates = [...new Set(games.map((g) => new Date(g.kickoff).toISOString().slice(0, 10).replace(/-/g, "")))];
  const byPair = new Map();
  for (const d of dates) {
    const res = await fetch(`${ESPN}?dates=${d}&groups=80&limit=300`);
    if (!res.ok) throw new Error(`ESPN said ${res.status} for ${d}`);
    for (const ev of (await res.json()).events || []) {
      const c = ev.competitions?.[0] || {};
      const away = (c.competitors || []).find((x) => x.homeAway === "away");
      const home = (c.competitors || []).find((x) => x.homeAway === "home");
      if (!away || !home) continue;
      byPair.set(`${away.team.id}-${home.team.id}`, {
        completed: !!c.status?.type?.completed,
        awayScore: Number(away.score), homeScore: Number(home.score),
      });
    }
  }
  const results = {};
  const missing = [];
  for (const g of games) {
    const m = byPair.get(`${g.awayId}-${g.homeId}`);
    if (!m || !m.completed || !Number.isFinite(m.awayScore) || !Number.isFinite(m.homeScore)) { missing.push(g); continue; }
    results[g.id] = { awayScore: m.awayScore, homeScore: m.homeScore };
  }
  return { results, missing, dates };
}

// --- the same scoring the app and the Worker use -------------------------
const pointValue = (g, team, mode) => (mode === "ATS" ? 2 : team === g.favorite ? 1 : 3);
function outcome(g, r) {
  if (!r) return null;
  const suWinner = r.awayScore > r.homeScore ? g.away : g.home;
  const favMargin = g.favorite === g.home ? r.homeScore - r.awayScore : r.awayScore - r.homeScore;
  const underdog = g.favorite === g.away ? g.home : g.away;
  const push = favMargin === g.spread;
  return { suWinner, atsWinner: push ? null : favMargin > g.spread ? g.favorite : underdog };
}
function scorePick(g, pick, r) {
  const o = outcome(g, r);
  if (!o) return null;
  if (!pick?.team || !pick?.mode) return 0;
  const winner = pick.mode === "SU" ? o.suWinner : o.atsWinner;
  return winner !== null && pick.team === winner ? pointValue(g, pick.team, pick.mode) : 0;
}

function standings(games, results, picks) {
  const tbGame = games.find((g) => g.tiebreakerGame);
  const tbRes = tbGame ? results[tbGame.id] : null;
  const actual = tbRes ? tbRes.awayScore + tbRes.homeScore : null;
  const rows = Object.entries(picks).map(([name, st]) => {
    let score = 0, hits = 0;
    for (const g of games) { const p = scorePick(g, st.picks?.[g.id], results[g.id]); if (p) { score += p; hits += 1; } }
    const raw = String(st.tiebreaker ?? "").trim();
    const guess = raw === "" ? null : Number(raw);
    const off = actual !== null && Number.isFinite(guess) ? Math.abs(guess - actual) : null;
    return { name, score, hits, guess, off };
  }).sort((a, b) => b.score - a.score || (a.off ?? Infinity) - (b.off ?? Infinity));
  const winners = rows.filter((r) => r.score === rows[0].score && r.off === rows[0].off && r.score > 0);
  return { rows, winners, actual, tbGame };
}

// --- key entry, without echoing it --------------------------------------
const ETX = "\u0003", EOT = "\u0004", BACKSPACE = "\u007f";
function askHidden(prompt) {
  if (process.env.ARCHIVE_LOG_KEY) return Promise.resolve(process.env.ARCHIVE_LOG_KEY.trim());
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    const wasRaw = !!stdin.isRaw;
    stdin.resume();
    if (stdin.isTTY) stdin.setRawMode(true);
    let out = "";
    const done = (value) => {
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.removeListener("data", onData);
      stdin.pause();
      process.stdout.write("\n");
      resolve(value);
    };
    const onData = (buf) => {
      const ch = buf.toString("utf8");
      if (ch === "\n" || ch === "\r" || ch === EOT) done(out.trim());
      else if (ch === ETX) done("");
      else if (ch === BACKSPACE || ch === "\b") out = out.slice(0, -1);
      else out += ch;
    };
    stdin.on("data", onData);
  });
}

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (a) => { rl.close(); resolve(a.trim().toLowerCase()); }));
}

// --- run ----------------------------------------------------------------
const games = weekOneSlate();
console.log(`Slate from app.js: ${games.length} games, tiebreaker G${games.find((g) => g.tiebreakerGame)?.id}`);

const picksRes = await fetch(`${WORKER}/picks?week=${WEEK}&t=${Date.now()}`, { headers: ORIGIN });
const picks = (await picksRes.json()).picks || {};
console.log(`Picks in KV: ${Object.keys(picks).length} owners`);

const { results, missing, dates } = await finalsFor(games);
console.log(`Finals from ESPN (${dates.join(", ")}): ${Object.keys(results).length} of ${games.length}`);
for (const g of missing) console.log(`  ! no final for G${g.id} ${g.awayShort} at ${g.homeShort}`);
if (Object.keys(results).length !== games.length) {
  console.log("\nNot every game is final, so the week cannot be sealed as complete. Nothing written.");
  process.exit(1);
}

const { rows, winners, actual, tbGame } = standings(games, results, picks);
console.log(`\nTiebreaker ${tbGame.awayShort} at ${tbGame.homeShort}, total ${actual}`);
console.log(`\n  ${"owner".padEnd(9)}${"pts".padStart(4)}${"hits".padStart(6)}${"guess".padStart(7)}${"off by".padStart(8)}`);
for (const r of rows) console.log(`  ${r.name.padEnd(9)}${String(r.score).padStart(4)}${String(r.hits).padStart(6)}${String(r.guess ?? "-").padStart(7)}${String(r.off ?? "-").padStart(8)}`);
console.log(`\nWeek ${WEEK} winner: ${winners.map((w) => w.name).join(" & ")} with ${rows[0].score} pts`);

if (DRY) { console.log("\n--dry-run: nothing written."); process.exit(0); }

const go = await ask("\nWrite this to the record? The Worker recomputes it and seals the week. [y/N] ");
if (go !== "y" && go !== "yes") { console.log("Nothing written."); process.exit(0); }

const key = await askHidden("Admin key (ARCHIVE_LOG_KEY, not echoed): ");
if (!key) { console.log("No key. Nothing written."); process.exit(1); }
const q = `key=${encodeURIComponent(key)}`;

// The slate first - makeCurrent:false leaves the league on the live week.
const slateRes = await fetch(`${WORKER}/games?week=${WEEK}&force=1&${q}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...ORIGIN },
  body: JSON.stringify({ week: WEEK, label: "Week 1", games, makeCurrent: false }),
});
const slateOut = await slateRes.json();
if (!slateRes.ok) { console.error("Slate not written:", slateOut); process.exit(1); }
console.log(`Slate stored for week ${WEEK}; the league stays on week ${slateOut.current}.`);

// Then the finals, which seals it.
const seasonRes = await fetch(`${WORKER}/season`, {
  method: "POST", headers: { "Content-Type": "application/json", ...ORIGIN },
  body: JSON.stringify({ week: WEEK, results }),
});
const seasonOut = await seasonRes.json();
if (!seasonRes.ok) { console.error("Finals not written:", seasonOut); process.exit(1); }
console.log(`Finals stored: ${seasonOut.stored} games - complete ${seasonOut.complete} - winners ${(seasonOut.winners || []).join(" & ")}`);

const weeks = await (await fetch(`${WORKER}/weeks?t=${Date.now()}`, { headers: ORIGIN })).json();
console.log("\nTrophies now:", JSON.stringify(weeks.trophies));
