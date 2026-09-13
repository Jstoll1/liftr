// Checks every sealed week's recap against its own ledger, independently
// of the Worker's card builder. Exits non-zero on any disagreement, so a
// scheduled workflow turns red and sends an email.
//   node scripts/recap-check.mjs          # every sealed week
//   node scripts/recap-check.mjs 2        # one week
const WORKER = process.env.WORKER_URL || "https://liftr-ai.jhs797.workers.dev";
const data = await (await fetch(`${WORKER}/weeks?detail=1&t=${Date.now()}`)).json();
const asked = process.argv[2];
const weeks = Object.values(data.summaries || {}).filter((w) => w?.complete && (!asked || String(w.week) === asked)).sort((a, b) => a.week - b.week);
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

  // Pick of the week: a hit, taken by the fewest, worth the most among those, then biggest spread.
  const count = new Map();
  for (const l of settled) { const k = `${l.g}|${l.team}|${l.mode}`; count.set(k, (count.get(k) || 0) + 1); }
  const hits = settled.filter((l) => l.result === "hit");
  const fewest = Math.min(...hits.map((l) => count.get(`${l.g}|${l.team}|${l.mode}`)));
  const cands = hits.filter((l) => count.get(`${l.g}|${l.team}|${l.mode}`) === fewest);
  const bestPts = Math.max(...cands.map((l) => l.pts));
  const bestSpread = Math.max(...cands.filter((l) => l.pts === bestPts).map((l) => l.spread));
  const bestOk = cands.some((l) => l.pts === bestPts && l.spread === bestSpread && r.best?.who?.includes(l.who) && r.best.takers === fewest && r.best.pts === l.pts);
  bestOk ? ok(wk, `pick of the week ${r.best.who.join("/")} ${r.best.pick}`) : fail(wk, `pick of the week ${JSON.stringify(r.best)}; expected among ${cands.filter((l) => l.pts === bestPts && l.spread === bestSpread).map((l) => `${l.who} ${l.team} ${l.line}`).join(", ")}`);

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

  // Movement: only when the prior week is sealed; then the biggest climb must be right.
  const prev = data.summaries[String(wk.week - 1)];
  if (prev?.complete) {
    const was = new Map(prev.rows.map((x) => [x.name, x.place]));
    const climbs = rows.map((x) => ({ name: x.name, d: (was.get(x.name) ?? x.place) - x.place }));
    const top = Math.max(...climbs.map((x) => x.d));
    const expectUp = top > 0 ? climbs.filter((x) => x.d === top).map((x) => x.name) : [];
    if (!expectUp.length) r.movement ? fail(wk, "movement card with nobody climbing") : ok(wk, "movement: nobody climbed");
    else expectUp.includes(r.movement?.up?.name) && (r.movement.up.from - r.movement.up.to) === top ? ok(wk, `movement ${r.movement.up.name} +${top}`) : fail(wk, `movement ${JSON.stringify(r.movement)}; expected ${expectUp.join("/")} +${top}`);
  } else if (r.movement) fail(wk, "movement card without a sealed prior week");
  else ok(wk, "movement: no prior week, card absent");
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
