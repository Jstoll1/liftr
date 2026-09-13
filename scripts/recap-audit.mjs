// Shows the raw picks behind each recap card so the cards can be checked
// against the ledger by eye.
//   node scripts/recap-audit.mjs        # latest sealed week
//   node scripts/recap-audit.mjs 2
const WORKER = "https://liftr-ai.jhs797.workers.dev";
const data = await (await fetch(`${WORKER}/weeks?detail=1&t=${Date.now()}`)).json();
const list = Object.values(data.summaries || {}).filter((w) => w?.complete).sort((a, b) => b.week - a.week);
const asked = process.argv[2];
const wk = asked ? list.find((w) => String(w.week) === asked) : list[0];
if (!wk) { console.log("no sealed week"); process.exit(1); }
const r = wk.recap || {};
console.log(`${wk.label}  version ${wk.version}  sealed ${new Date(wk.sealedAt).toISOString()}`);
console.log(`Winner(s): ${wk.winners.join(", ")} with ${wk.highScore}\n`);

const all = wk.rows.flatMap((row) => row.ledger.map((l) => ({ ...l, who: row.name })));
const game = (matchup) => all.filter((l) => l.matchup === matchup);
const show = (rows) => rows.sort((a, b) => a.who.localeCompare(b.who)).forEach((l) =>
  console.log(`    ${l.who.padEnd(8)} ${String(l.team ?? "(no pick)").padEnd(24)} ${String(l.line ?? "").padEnd(6)} ${String(l.result).padEnd(6)} ${l.pts ?? ""}`));

// Standings as the summary has them
console.log("Standings");
wk.rows.forEach((row) => console.log(`    #${row.place} ${row.name.padEnd(8)} ${String(row.score).padStart(2)} pts  hits ${row.hits}  tb ${row.tbGuess ?? "-"} (off ${row.tbDiff ?? "-"})`));

// 1. best: every correct pick with the fewest takers, so a tie is visible
const hits = all.filter((l) => l.result === "hit");
const key = (l) => `${l.g}|${l.team}|${l.mode}`;
const count = {}; for (const l of all.filter((l) => l.result === "hit" || l.result === "miss")) count[key(l)] = (count[key(l)] || 0) + 1;
const fewest = Math.min(...hits.map((l) => count[key(l)]));
console.log(`\nPICK OF THE WEEK  card says: ${r.best?.who?.join(", ")} · ${r.best?.pick} · ${r.best?.takers} of ${r.best?.of} · +${r.best?.pts}`);
console.log(`  every correct pick taken by ${fewest}:`);
show(hits.filter((l) => count[key(l)] === fewest));

// 2. worst: the most-taken losing pick, with the whole game
const misses = all.filter((l) => l.result === "miss");
const most = Math.max(...misses.map((l) => count[key(l)]));
console.log(`\nWORST PICK  card says: ${r.worst?.pick} · ${r.worst?.takers} of ${r.worst?.of} · ${r.worst?.final}`);
console.log(`  losing picks taken by ${most}, and everyone on that game:`);
for (const m of [...new Set(misses.filter((l) => count[key(l)] === most).map((l) => l.matchup))]) { console.log(`  ${m} (${game(m)[0]?.score})`); show(game(m)); }

// 3. movement
console.log(`\nMOVEMENT  card says: ${r.movement ? `${r.movement.up.name} ${r.movement.up.from}→${r.movement.up.to}; ${r.movement.down ? `${r.movement.down.name} ${r.movement.down.from}→${r.movement.down.to}` : "nobody fell"}` : "(none: needs the prior week sealed)"}`);

// 4. coin flip: every game's split
console.log(`\nCOIN FLIP  card says: ${r.consensus?.matchup} · ${r.consensus?.sides?.map((s) => `${s.team} ${s.n}`).join(" / ")} · ${r.consensus?.final}`);
console.log("  every game's split:");
for (const m of [...new Set(all.map((l) => l.matchup))]) {
  const sides = {}; for (const l of game(m)) if (l.team) sides[l.team] = (sides[l.team] || 0) + 1;
  console.log(`    ${m.padEnd(30)} ${Object.entries(sides).map(([t, n]) => `${t} ${n}`).join(" / ")}   final ${game(m)[0]?.score}`);
}

// 5. tiebreaker
console.log(`\nTIEBREAKER  card says: ${r.tb?.who?.join(" & ")} said ${r.tb?.guesses?.join("/")} · actual ${r.tb?.actual} · off ${r.tb?.off}`);
console.log(`  actual ${wk.tiebreaker?.actual} in ${wk.tiebreaker?.matchup}; every guess:`);
wk.rows.slice().sort((a, b) => (a.tbDiff ?? 99) - (b.tbDiff ?? 99)).forEach((row) => console.log(`    ${row.name.padEnd(8)} ${row.tbGuess ?? "-"}  off ${row.tbDiff ?? "-"}`));
