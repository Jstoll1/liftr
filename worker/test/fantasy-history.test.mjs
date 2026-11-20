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
