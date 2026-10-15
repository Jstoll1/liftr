// The exact "is anyone out?" check behind the win chance labels, against a
// plain walk over every way the games left can end.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const span = (from, to) => { const a = app.indexOf(from); return app.slice(a, app.indexOf(to, a)); };
const { gameCats, exactPaths, scorePick, winChanceLabel } = new Function(
  `${span("function pointValue", "// Fill this in")}\n${span("const catSig", "let winChanceMemo")}\nreturn { gameCats, exactPaths, scorePick, winChanceLabel };`)();

const mk = (id, sp, favHome = true) => ({ id, away: `A${id}`, home: `H${id}`, awayShort: `A${id}`, homeShort: `H${id}`, favorite: favHome ? `H${id}` : `A${id}`, spread: sp });

// Every combination, and every tiebreaker total from the current one up.
function brute(models, picks, guesses, tbGame) {
  const M = picks.length, alive = new Array(M).fill(false);
  const ks = models.map((_, k) => k).filter((k) => !models[k].fixed);
  const tk = models.findIndex((m) => m.g === tbGame);
  const walk = (x, res) => {
    if (x === ks.length) {
      const sc = picks.map((row) => models.reduce((s, m, k) => s + (row[k] ? scorePick(m.g, row[k], res[k]) : 0), 0));
      const top = Math.max(...sc), T = sc.map((s, j) => (s === top ? j : -1)).filter((j) => j >= 0);
      if (T.length === 1 || tk < 0) { for (const j of T) alive[j] = true; return; }
      const ts = models[tk].fixed ? [models[tk].fixed.awayScore + models[tk].fixed.homeScore] : Array.from({ length: 150 }, (_, t) => t);
      for (const t of ts) {
        const d = T.map((j) => (guesses[j] == null ? Infinity : Math.abs(guesses[j] - t)));
        const mn = Math.min(...d);
        T.forEach((j, q) => { if (d[q] === mn) alive[j] = true; });
      }
      return;
    }
    for (const c of gameCats(models[ks[x]].g)) { res[ks[x]] = c.res; walk(x + 1, res); }
  };
  walk(0, models.map((m) => m.fixed || null));
  return alive;
}

test("game endings: a push replaces 'no cover' on a 1 point line, pick'em has two", () => {
  assert.deepEqual(gameCats(mk(1, 0)).map((c) => c.txt), ["H1 wins", "A1 wins"]);
  assert.deepEqual(gameCats(mk(1, 1)).map((c) => c.txt), ["H1 covers -1", "H1 by exactly 1", "A1 wins"]);
  assert.deepEqual(gameCats(mk(1, 7)).map((c) => c.txt), ["H1 covers -7", "H1 by exactly 7", "H1 wins, no cover", "A1 wins"]);
  assert.deepEqual(gameCats(mk(1, 6.5)).map((c) => c.txt), ["H1 covers -6.5", "H1 wins, no cover", "A1 wins"]);
});

test("exact check agrees with every combination on random leagues", () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 250; trial++) {
    const G = 3 + Math.floor(rnd() * 4), M = 3 + Math.floor(rnd() * 6);
    const games = Array.from({ length: G }, (_, k) => mk(k, [0, 1, 3, 3.5, 7, 7.5, 14][Math.floor(rnd() * 7)], rnd() < 0.5));
    const nFixed = Math.floor(rnd() * G);
    const models = games.map((g, k) => (k < nFixed ? { g, fixed: { awayScore: Math.floor(rnd() * 40), homeScore: 1 + Math.floor(rnd() * 40) } } : { g, curA: 0, curH: 0 }));
    const picks = Array.from({ length: M }, () => games.map((g) => (rnd() < 0.1 ? null : { team: rnd() < 0.5 ? g.home : g.away, mode: rnd() < 0.5 ? "SU" : "ATS" })));
    const guesses = picks.map(() => (rnd() < 0.15 ? null : 30 + Math.floor(rnd() * 40)));
    const catN = models.map((m) => (m.fixed ? null : gameCats(m.g).map(() => Math.floor(rnd() * 100))));
    const ex = exactPaths(picks.map((_, i) => i), models, picks, guesses, games[G - 1], catN, 5000);
    const ref = brute(models, picks, guesses, games[G - 1]);
    for (let i = 0; i < M; i++) assert.equal(ex[i].alive, ref[i], `trial ${trial}, manager ${i}`);
  }
});

test("a manager who can't reach the leader is out; a long shot gets a path", () => {
  const g1 = mk(1, 3), g2 = mk(2, 7);
  const models = [{ g: g1, fixed: { awayScore: 10, homeScore: 30 } }, { g: g2, curA: 0, curH: 0 }];
  // Leader banked 1 on g1; trailer has nothing banked and only 1 point left (fav SU).
  const picks = [
    [{ team: "H1", mode: "SU" }, { team: "H2", mode: "ATS" }],
    [{ team: "A1", mode: "SU" }, { team: "H2", mode: "SU" }],
    [{ team: "A1", mode: "SU" }, { team: "A2", mode: "SU" }],
  ];
  const catN = [null, [3000, 100, 1500, 400]];
  const ex = exactPaths([1, 2], models, picks, [50, null, 50], g2, catN, 5000);
  assert.equal(ex[1].alive, false);                  // best case ties the leader, who has a guess when they have none
  assert.equal(ex[2].alive, true);                   // A2 winning pays 3
  assert.deepEqual(ex[2].path.need.map((x) => x.txt), ["A2 wins"]);
});

test("labels never read 0%", () => {
  assert.equal(winChanceLabel(0, { alive: false }), "OUT");
  assert.equal(winChanceLabel(0, { alive: true }), "<1%");
  assert.equal(winChanceLabel(0, undefined), "<1%");
  assert.equal(winChanceLabel(0.004, {}), "<1%");
  assert.equal(winChanceLabel(0.42, {}), "42%");
  assert.equal(winChanceLabel(0.999, {}), "99%+");
});
