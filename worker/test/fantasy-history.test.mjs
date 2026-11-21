import test from "node:test";
import assert from "node:assert/strict";
import { pastGames, historyContext } from "../src/fantasy-history.js";

const every = { 2020: ["W1 A 120 d. B 100", "W2 A 110 d. C 90", "W1 C 99 d. D 80", "W2 B 101 d. D 70", "W14 A 130 d. B 100 (playoff)"], 2021: ["W1 B 140 d. A 90", "W2 B 150 d. C 80"] };
test("pastGames: regular season only, parsed", () => {
  const g = pastGames(every, 13);
  assert.equal(g.length, 6);
  assert.deepEqual(g[0], { year: 2020, week: 1, winner: "A", w: 120, loser: "B", l: 100 });
});
test("historyContext: a 2-0 start finds past 2-0 starts and how they ended", () => {
  const cur = { weeksPlayed: 2, regularSeasonWeeks: 2, standings: [{ owner: "X", wins: 2, losses: 0, pointsFor: 300 }], weekly: [] };
  const h = historyContext(cur, { everyGameByYear: every, records: {}, seasons: { 2020: { champion: "A" }, 2021: { runnerUp: "B" } } });
  const b = h.before.find((x) => x.owner === "X");
  assert.equal(b.times, 2);
  assert.equal(b.titles, 1);
  assert.match(b.line, /Last: B in 2021, who lost the final/);
  assert.match(h.record[0].text, /past the record/);
});

import { seedOrder } from "../src/fantasy-stats.js";
test("seedOrder: division winners take the top seeds (league screenshot, week 11)", () => {
  const w = { Dewitt: 9, Andrew: 5, Curt: 8, Skills: 6, Jake: 5, Logan: 4, Robert: 3, Connie: 3, Nissan: 2, Jordan: 3 };
  const pf = { Dewitt: 1200, Andrew: 1000, Curt: 1150, Skills: 1100, Jake: 1050, Logan: 990, Robert: 900, Connie: 950, Nissan: 800, Jordan: 1001 };
  const div = { Dewitt: 1, Curt: 1, Skills: 1, Jake: 1, Logan: 1, Andrew: 2, Robert: 2, Connie: 2, Nissan: 2, Jordan: 2 };
  assert.deepEqual(seedOrder(Object.keys(w), w, pf, 6, div), ["Dewitt", "Andrew", "Curt", "Skills", "Jake", "Logan"]);
  assert.deepEqual(seedOrder(Object.keys(w), w, pf, 6, null).slice(0, 2), ["Dewitt", "Curt"]);
});

test("seedOrder: tied records go to head to head", () => {
  const w = { A: 5, B: 5, C: 9 }, pf = { A: 1200, B: 1000, C: 1100 };
  assert.deepEqual(seedOrder(["A", "B", "C"], w, pf, 3, null, { B: { A: 1 } }), ["C", "B", "A"]);
  assert.deepEqual(seedOrder(["A", "B", "C"], w, pf, 3, null, null), ["C", "A", "B"]);
});

import { playoffOdds } from "../src/fantasy-stats.js";
test("playoffOdds: a head-to-head game still to play feeds the tiebreak", () => {
  // A leads B 1-0 head to head, same record; they meet once more. B is far
  // stronger, so B usually wins that game, evens it 1-1, and takes the seed
  // on points. Old code kept A's 1-0 and seeded A almost every time.
  const weekly = [{ week: 1, owner: "A", points: 101, opponent: "B" }, { week: 1, owner: "B", points: 100, opponent: "A" },
    { week: 2, owner: "A", points: 60, opponent: "C" }, { week: 2, owner: "C", points: 50, opponent: "A" }, { week: 2, owner: "B", points: 160, opponent: "D" }, { week: 2, owner: "D", points: 50, opponent: "B" },
    { week: 1, owner: "C", points: 40, opponent: "D" }, { week: 1, owner: "D", points: 50, opponent: "C" }];
  const standings = [{ owner: "A", wins: 2, losses: 0, pointsFor: 161 }, { owner: "B", wins: 1, losses: 1, pointsFor: 260 }, { owner: "C", wins: 0, losses: 2, pointsFor: 90 }, { owner: "D", wins: 1, losses: 1, pointsFor: 100 }];
  const o = playoffOdds(weekly, standings, [{ week: 3, home: "A", away: "B" }], 1, 2000);
  assert.ok(o.B.playoffs > 0.4, `B ${o.B.playoffs}`);
});
