import test from "node:test";
import assert from "node:assert/strict";
import { allPlay, powerRankings, playoffOdds, weekAwards, regretTotals, fantasyStats } from "../src/fantasy-stats.js";

// Four teams, two weeks: A strong, D weak, B lucky (won with low scores).
const weekly = [
  { week: 1, owner: "A", points: 130, opponent: "C" }, { week: 1, owner: "C", points: 120, opponent: "A" },
  { week: 1, owner: "B", points: 80, opponent: "D" }, { week: 1, owner: "D", points: 70, opponent: "B" },
  { week: 2, owner: "A", points: 140, opponent: "D" }, { week: 2, owner: "D", points: 60, opponent: "A" },
  { week: 2, owner: "B", points: 90, opponent: "C" }, { week: 2, owner: "C", points: 85, opponent: "B" },
];
const standings = [
  { owner: "A", wins: 2, losses: 0, pointsFor: 270, rank: 1 }, { owner: "B", wins: 2, losses: 0, pointsFor: 170, rank: 2 },
  { owner: "C", wins: 0, losses: 2, pointsFor: 205, rank: 3 }, { owner: "D", wins: 0, losses: 2, pointsFor: 130, rank: 4 },
];

test("allPlay: every score against every other; luck = actual minus expected", () => {
  const ap = allPlay(weekly, standings);
  assert.equal(ap.A.apW, 6); assert.equal(ap.A.apL, 0);
  assert.ok(ap.B.luck > 0, "B won with low scores");
  assert.ok(ap.C.luck < 0, "C lost with good scores");
});

test("powerRankings: the best team leads; movement is against last week", () => {
  const p = powerRankings(weekly, standings);
  assert.equal(p[0].owner, "A");
  assert.equal(p.length, 4);
  assert.ok(p.every((x) => Number.isInteger(x.move)));
});

test("playoffOdds: stable, between 0 and 1, a clinched team near 1", () => {
  const remaining = [{ week: 3, home: "A", away: "B" }, { week: 3, home: "C", away: "D" }];
  const o1 = playoffOdds(weekly, standings, remaining, 2, 2000), o2 = playoffOdds(weekly, standings, remaining, 2, 2000);
  assert.deepEqual(o1, o2, "seeded, so the same each read");
  for (const v of Object.values(o1)) for (const k of ["playoffs", "bye", "title"]) assert.ok(v[k] >= 0 && v[k] <= 1);
  assert.ok(o1.A.playoffs > 0.95);
  assert.ok(o1.D.playoffs < 0.05);
  const titles = Object.values(o1).reduce((n, v) => n + v.title, 0);
  assert.ok(Math.abs(titles - 1) < 0.01, "one champion per run");
});

test("weekAwards: top, low, blowout, closest, luckiest win", () => {
  const a = weekAwards(weekly, 2);
  assert.equal(a.top.owner, "A"); assert.equal(a.low.owner, "D");
  assert.equal(a.blowout.winner, "A"); assert.equal(a.closest.winner, "B");
  assert.equal(a.luckiestWin, null, "B won week 2 with an above-median score");
  assert.equal(weekAwards(weekly, 1).luckiestWin.winner, "B");
});

test("regretTotals: best minus played, summed, worst week kept", () => {
  const r = regretTotals({ 1: { A: { points: 100, best: 120 } }, 2: { A: { points: 90, best: 95 }, B: { points: 80, best: 80 } } });
  assert.equal(r[0].owner, "A"); assert.equal(r[0].season, 25); assert.equal(r[0].worst.week, 1);
});

test("fantasyStats: one call with everything and streaks", () => {
  const st = fantasyStats({ standings, weekly, remaining: [], playoffTeams: 2, regret: {} });
  assert.equal(st.streak.A, "W2"); assert.equal(st.streak.D, "L2");
  assert.ok(st.odds && st.power && st.awards);
});

test("teamInsights: position ranks, top-two share and remaining schedule", async () => {
  const { teamInsights } = await import("../src/fantasy-stats.js");
  const rosters = { A: [{ name: "QbA", pos: "QB", season: 250 }, { name: "RbA", pos: "RB", season: 150 }], B: [{ name: "QbB", pos: "QB", season: 200 }, { name: "RbB", pos: "RB", season: 180 }], C: [], D: [] };
  const t = teamInsights(rosters, weekly, [{ week: 3, home: "A", away: "D" }, { week: 3, home: "B", away: "C" }], standings);
  assert.equal(t.A.posRank.QB, 1); assert.equal(t.B.posRank.RB, 1);
  assert.equal(t.A.topShare, 1);
  assert.equal(t.B.sos.opponents[0], "C");
  assert.ok(t.B.sos.avgOpp > t.A.sos.avgOpp, "C scores more than D");
});
