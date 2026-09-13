// Checks every sealed week's recap against its own ledger, independently
// of the Worker's card builder. Exits non-zero on any disagreement, so a
// scheduled workflow turns red and sends an email.
//   node scripts/recap-check.mjs          # every sealed week
//   node scripts/recap-check.mjs 2        # one week
const WORKER = process.env.WORKER_URL || "https://liftr-ai.jhs797.workers.dev";
const data = await (await fetch(`${WORKER}/weeks?detail=1&t=${Date.now()}`)).json();
const asked = process.argv[2];
const weeksAll = Object.values(data.summaries || {}).filter((w) => w?.complete).sort((a, b) => a.week - b.week);
const weeks = weeksAll.filter((w) => !asked || String(w.week) === asked);
function seasonRanks(list) {
  const pts = new Map();
  for (const w of list) for (const r of w.rows || []) pts.set(r.name, (pts.get(r.name) || 0) + (r.score || 0));
  const sorted = [...pts.entries()].sort((a, b) => b[1] - a[1]);
  const out = new Map(); let place = 0;
  sorted.forEach(([name, p], i) => { if (!i || sorted[i - 1][1] !== p) place = i + 1; out.set(name, place); });
  return out;
}
if (!weeks.length) { console.log("no sealed week to check"); process.exit(asked ? 1 : 0); }

let failures = 0;
const fail = (wk, msg) => { failures += 1; console.log(`FAIL week ${wk.week}: ${msg}`); };
const ok = (wk, msg) => console.log(`ok   week ${wk.week}: ${msg}`);

for (const wk of weeks) {
  const r = wk.recap;
  if (!r) { fail(wk, "no recap on a complete week"); continue; }
  const rows = wk.rows;
  const all = rows.flatMap((row) => row.ledger.map((l) => ({ ...l, who: row.name })));
  const settled = all.filter((l) => l.result === "hit" || l.result === "miss");

  // Standings: scores must equal the sum of the ledger, places must follow score then tb.
  for (const row of rows) {
    const sum = row.ledger.reduce((s, l) => s + (l.pts || 0), 0);
    if (sum !== row.score) fail(wk, `${row.name} score ${row.score} but ledger sums to ${sum}`);
  }
  const sorted = [...rows].sort((a, b) => b.score - a.score || (a.tbDiff ?? 1e9) - (b.tbDiff ?? 1e9));
  if (sorted.map((r) => r.name).join() !== rows.map((r) => r.name).join()) fail(wk, "rows are not in standings order");
  if (wk.winners.join() !== rows.filter((r) => r.place === 1 && r.score > 0).map((r) => r.name).join()) fail(wk, `winners ${wk.winners} do not match first place`);
  ok(wk, `standings sum and order (${wk.winners.join(", ")} ${wk.highScore})`);
  if (!settled.length) {
    // Nobody picked, so there is nothing to make a card from.
    [r.best, r.worst, r.consensus, r.tb].some(Boolean) ? fail(wk, "cards on a week with no picks") : ok(wk, "no picks, no cards");
    continue;
  }

  // Pick of the week: the winning team fewest people were on, then the
  // best-paid hit on it, then the bigger spread. Anyone in that hit group qualifies.
  const teams = new Map();
  for (const l of settled) { const k = `${l.g}|${l.team}`; if (!teams.has(k)) teams.set(k, { takers: 0, hits: [] }); const t = teams.get(k); t.takers += 1; if (l.result === "hit") t.hits.push(l); }
  const bestTeams = [...teams.values()].filter((t) => t.hits.length).map((t) => ({ takers: t.takers, pts: Math.max(...t.hits.map((h) => h.pts)), spread: t.hits[0].spread, hits: t.hits }))
    .sort((a, b) => a.takers - b.takers || b.pts - a.pts || b.spread - a.spread);
  const bt = bestTeams[0];
  const okBest = bestTeams.filter((t) => t.takers === bt.takers && t.pts === bt.pts && t.spread === bt.spread)
    .some((t) => t.hits.filter((h) => h.pts === t.pts).some((h) => r.best?.who?.includes(h.who)) && r.best.takers === t.takers && r.best.pts === t.pts);
  okBest ? ok(wk, `pick of the week ${r.best.who.join("/")} ${r.best.pick}, ${r.best.takers} on the team`)
    : fail(wk, `pick of the week ${JSON.stringify(r.best)}; expected team with ${bt.takers} takers paying ${bt.pts}: ${bt.hits.filter((h) => h.pts === bt.pts).map((h) => `${h.who} ${h.team} ${h.line}`).join(", ")}`);

  // Worst pick: the loser group with the most takers. A team that lost
  // outright groups every mode; a team that won but missed the cover groups by line.
  const groups = new Map();
  for (const l of settled.filter((l) => l.result === "miss")) {
    const teamHit = settled.some((x) => x.g === l.g && x.team === l.team && x.result === "hit");
    const k = teamHit ? `${l.g}|${l.team}|${l.mode}` : `${l.g}|${l.team}`;
    groups.set(k, (groups.get(k) || 0) + 1);
  }
  const most = Math.max(...groups.values());
  r.worst?.takers === most ? ok(wk, `worst pick ${r.worst.pick}, ${most} takers`) : fail(wk, `worst pick says ${r.worst?.takers} takers, ledger's biggest losing group is ${most}`);

  // Coin flip: the game with the smallest gap between its two most-taken sides.
  const gaps = [...new Set(all.map((l) => l.g))].map((g) => {
    const sides = {}; for (const l of all.filter((l) => l.g === g && l.team)) sides[l.team] = (sides[l.team] || 0) + 1;
    const [a = 0, b = 0] = Object.values(sides).sort((x, y) => y - x);
    return { matchup: all.find((l) => l.g === g).matchup, gap: Math.abs(a - b) };
  });
  const minGap = Math.min(...gaps.map((x) => x.gap));
  gaps.some((x) => x.gap === minGap && x.matchup === r.consensus?.matchup) ? ok(wk, `coin flip ${r.consensus.matchup}`) : fail(wk, `coin flip ${r.consensus?.matchup}; closest gap ${minGap} is ${gaps.filter((x) => x.gap === minGap).map((x) => x.matchup).join(", ")}`);

  // Tiebreaker: everyone at the minimum distance, and only them.
  const guessed = rows.filter((x) => x.tbDiff !== null);
  const minOff = Math.min(...guessed.map((x) => x.tbDiff));
  const closest = guessed.filter((x) => x.tbDiff === minOff).map((x) => x.name).sort().join();
  (r.tb?.who || []).slice().sort().join() === closest && r.tb?.off === minOff && r.tb?.actual === wk.tiebreaker?.actual
    ? ok(wk, `tiebreaker ${closest} off by ${minOff}`) : fail(wk, `tiebreaker ${JSON.stringify(r.tb)}; expected ${closest} off by ${minOff}`);

  // Movement: season rank through the previous counting week vs through this one.
  const earlier = weeksAll.filter((w) => w.week < wk.week && w.complete && !w.exhibition);
  if (wk.exhibition) r.movement ? fail(wk, "movement card on an exhibition") : ok(wk, "movement: exhibition, card absent");
  else if (!earlier.length) r.movement ? fail(wk, "movement card on the first counting week") : ok(wk, "movement: first counting week, card absent");
  else {
    const before = seasonRanks(earlier), after = seasonRanks([...earlier, wk]);
    const climbs = rows.filter((x) => before.has(x.name)).map((x) => ({ name: x.name, d: before.get(x.name) - after.get(x.name), from: before.get(x.name), to: after.get(x.name) }));
    const top = Math.max(...climbs.map((x) => x.d));
    const expectUp = top > 0 ? climbs.filter((x) => x.d === top) : [];
    if (!expectUp.length) r.movement ? fail(wk, "movement card with nobody climbing") : ok(wk, "movement: nobody climbed");
    else expectUp.some((x) => x.name === r.movement?.up?.name && x.from === r.movement.up.from && x.to === r.movement.up.to)
      ? ok(wk, `movement ${r.movement.up.name} #${r.movement.up.from} to #${r.movement.up.to} on the season`)
      : fail(wk, `movement ${JSON.stringify(r.movement)}; expected ${expectUp.map((x) => `${x.name} #${x.from}→#${x.to}`).join(" or ")}`);
  }
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
