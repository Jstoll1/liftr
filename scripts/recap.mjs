// Prints the weekly recap from the Worker's sealed ledger.
//   node recap.mjs            # latest sealed or in-progress week
//   node recap.mjs 2          # a specific week
//   node recap.mjs --json path/to/weeks.json   # from a saved GET /weeks?detail=1
const WORKER = "https://liftr-ai.jhs797.workers.dev";
const args = process.argv.slice(2);
let data;
if (args[0] === "--json") data = JSON.parse(await import("node:fs").then(fs => fs.readFileSync(args[1], "utf8")));
else data = await (await fetch(`${WORKER}/weeks?detail=1&t=${Date.now()}`)).json();
const weeks = data.summaries ?? data.weeks ?? data;
const list = Object.values(weeks).filter(Boolean).sort((a, b) => b.week - a.week);
const wanted = args.find(a => /^\d+$/.test(a));
const wk = wanted ? list.find(w => String(w.week) === wanted) : list.find(w => w.complete) ?? list[0];
if (!wk) { console.log("No week data"); process.exit(1); }
console.log(recap(wk, wanted ? null : list.find(w => w.week === wk.week - 1)));

function recap(wk, prev) {
  const rows = wk.rows;
  const N = rows.length;
  // Every pick, flattened, with the manager on it.
  const all = rows.flatMap(r => r.ledger.map(l => ({ ...l, who: r.name })));
  const settled = all.filter(l => l.result === "hit" || l.result === "miss");
  const byKey = new Map();
  for (const l of settled) {
    const k = `${l.g}|${l.team}|${l.mode}`;
    if (!byKey.has(k)) byKey.set(k, { ...l, who: [] });
    byKey.get(k).who.push(l.who);
  }
  const groups = [...byKey.values()];
  const takers = g => g.who.length;

  // 1. Pick of the week: correct, fewest takers, most points.
  const best = groups.filter(g => g.result === "hit").sort((a, b) => takers(a) - takers(b) || b.pts - a.pts || b.spread - a.spread)[0];
  // 2. Worst pick: wrong, most takers, biggest points lost.
  const worst = groups.filter(g => g.result === "miss").sort((a, b) => takers(b) - takers(a) || b.worth - a.worth)[0];
  // 3. Movement: rank now vs last week, by weekly place (season standings need every week; place is what the ledger carries).
  let move = null;
  if (prev) {
    const was = new Map(prev.rows.map(r => [r.name, r.place]));
    const d = rows.map(r => ({ name: r.name, from: was.get(r.name), to: r.place })).filter(x => x.from);
    const up = d.slice().sort((a, b) => (b.from - b.to) - (a.from - a.to))[0];
    const down = d.slice().sort((a, b) => (a.from - a.to) - (b.from - b.to))[0];
    if (up && up.from > up.to) move = { up, down: down && down.to > down.from ? down : null };
  }
  // 4. Chalk vs chaos: consensus rate and the closest split.
  const games = [...new Set(all.map(l => l.g))];
  const splits = games.map(g => {
    const ps = all.filter(l => l.g === g && l.team);
    const sides = {};
    for (const p of ps) sides[p.team] = (sides[p.team] || 0) + 1;
    const [a = 0, b = 0] = Object.values(sides).sort((x, y) => y - x);
    const res = ps.find(p => p.score);
    return { g, matchup: ps[0]?.matchup, a, b, n: ps.length, sides, score: res?.score, hitSide: ps.find(p => p.result === "hit")?.team };
  }).filter(s => s.n);
  const consensus = splits.reduce((s, x) => s + x.a, 0) / Math.max(1, splits.reduce((s, x) => s + x.n, 0));
  const closest = splits.slice().sort((x, y) => Math.abs(x.a - x.b) - Math.abs(y.a - y.b) || y.n - x.n)[0];
  // 5. Tiebreaker sniper.
  const tb = rows.filter(r => r.tbDiff !== null).sort((a, b) => a.tbDiff - b.tbDiff)[0];

  const names = w => w.length === 1 ? w[0] : w.length === 2 ? w.join(" and ") : `${w.slice(0, -1).join(", ")} and ${w.at(-1)}`;
  const lines = [];
  lines.push(`★ ${wk.label.toUpperCase()} RECAP ★`);
  lines.push(wk.winners?.length ? `Week won by ${names(wk.winners)} with ${wk.highScore} pts.` : `Week not sealed. High score ${wk.highScore}.`);
  lines.push("");
  if (best) lines.push(`PICK OF THE WEEK  ${names(best.who)} · ${best.team} ${best.line} in ${best.matchup} (${best.score}). ${takers(best)} of ${N} took it, worth ${best.pts}.`);
  if (worst) lines.push(`WORST PICK        ${worst.team} ${worst.line} in ${worst.matchup} (${worst.score}). ${takers(worst)} of ${N} rode it. ${worst.worth} pts each, gone.`);
  if (move) lines.push(`MOVEMENT          ${move.up.name} up ${move.up.from - move.up.to} spots to #${move.up.to}.${move.down ? ` ${move.down.name} slid ${move.down.to - move.down.from} to #${move.down.to}.` : ""}`);
  else lines.push(`MOVEMENT          First week on record, nothing to move yet.`);
  if (closest) {
    const [t1, t2] = Object.entries(closest.sides).sort((x, y) => y[1] - x[1]);
    lines.push(`CHALK VS CHAOS    ${Math.round(consensus * 100)}% of picks went with the crowd. Closest split: ${closest.matchup}, ${t1[0]} ${t1[1]}${t2 ? ` to ${t2[0]} ${t2[1]}` : ""}${closest.hitSide ? `. ${closest.hitSide} side cashed (${closest.score}).` : "."}`);
  }
  if (tb && wk.tiebreaker) lines.push(`TB SNIPER         ${tb.name} said ${tb.tbGuess}, actual ${wk.tiebreaker.actual} in ${wk.tiebreaker.matchup}. Off by ${tb.tbDiff}.`);
  return lines.join("\n");
}
