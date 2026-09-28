// Pulls every sealed week's ledger out of the Worker and writes it into
// the repo, so the season's record lives in git as well as in KV.
//   node scripts/archive-ledger.mjs
// Writes data/season-2026/weeks.json (the full summaries, recap included)
// and data/season-2026/picks.csv (one row per manager per game).
import { mkdirSync, writeFileSync } from "node:fs";
const WORKER = process.env.WORKER_URL || "https://liftr-ai.jhs797.workers.dev";
const OUT = "data/season-2026";
const data = await (await fetch(`${WORKER}/weeks?detail=1&t=${Date.now()}`)).json();
const weeks = Object.values(data.summaries || {}).filter((w) => w?.complete).sort((a, b) => a.week - b.week);
mkdirSync(OUT, { recursive: true });
// Stable ordering and no volatile fields, so the file only changes when the record does.
const stable = weeks.map(({ cached, ...w }) => w);
writeFileSync(`${OUT}/weeks.json`, JSON.stringify({ exported: new Date().toISOString().slice(0, 10), weeks: stable }, null, 1) + "\n");
const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const rows = [["week", "exhibition", "manager", "place", "week_score", "tb_guess", "tb_off", "game", "matchup", "favorite", "spread", "team", "mode", "line", "worth", "result", "points", "final", "saved_at_utc", "after_kickoff"].join(",")];
for (const w of weeks) for (const r of w.rows) for (const l of r.ledger) {
  rows.push([w.week, w.exhibition ? 1 : 0, r.name, r.place, r.score, r.tbGuess ?? "", r.tbDiff ?? "", l.g, l.matchup, l.favorite, l.spread, l.team ?? "", l.mode ?? "", l.line ?? "", l.worth ?? "", l.result, l.pts ?? "", l.score ?? "", l.savedAt ? new Date(l.savedAt).toISOString() : "", l.late ? 1 : 0].map(q).join(","));
}
writeFileSync(`${OUT}/picks.csv`, rows.join("\n") + "\n");
console.log(`${weeks.length} week(s), ${rows.length - 1} pick rows written to ${OUT}/`);
// Line samples and game briefs, one file for the season. Needs the admin
// key; skipped quietly when it is not set so the ledger still archives.
if (process.env.ARCHIVE_LOG_KEY) {
  const ins = await (await fetch(`${WORKER}/insights?all=1&key=${encodeURIComponent(process.env.ARCHIVE_LOG_KEY)}&t=${Date.now()}`)).json();
  const perWeek = Object.fromEntries(Object.entries(ins.weeks || {}).map(([w, d]) => [w, { lines: d.lines, briefs: Object.fromEntries(Object.values(d.briefs || {}).map((b) => [b.game, { updatedAt: b.updatedAt, summary: b.summary, movement: b.movement, injuries: b.injuries, news: b.news }])) }]));
  writeFileSync(`${OUT}/insights.json`, JSON.stringify({ exported: new Date().toISOString().slice(0, 10), weeks: perWeek }, null, 1) + "\n");
  console.log(`insights for ${Object.keys(perWeek).length} week(s) written`);
}
