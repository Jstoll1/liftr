import test from "node:test";
import assert from "node:assert/strict";
import { buildCurrentSeason } from "../src/fantasy.js";

test("buildCurrentSeason ranks by wins then points and lists decided games", () => {
  const league = {
    settings: { scheduleSettings: { matchupPeriodCount: 13 } },
    teams: [{ id: 1, owners: ["a"] }, { id: 2, owners: ["b"] }],
    schedule: [
      { matchupPeriodId: 1, winner: "HOME", home: { teamId: 1, totalPoints: 120 }, away: { teamId: 2, totalPoints: 100 } },
      { matchupPeriodId: 2, winner: "AWAY", home: { teamId: 1, totalPoints: 90 }, away: { teamId: 2, totalPoints: 95 } },
      { matchupPeriodId: 3, winner: "UNDECIDED", home: { teamId: 1, totalPoints: 0 }, away: { teamId: 2, totalPoints: 0 } },
    ],
  };
  const cur = buildCurrentSeason(league, { a: "Curt", b: "Logan" }, 2026, 0);
  assert.equal(cur.weeksPlayed, 2);
  assert.equal(cur.standings[0].owner, "Curt"); // 1-1, more points
  assert.deepEqual(cur.results, ["W1: Curt 120 def. Logan 100", "W2: Logan 95 def. Curt 90"]);
});

test("buildCurrentSeason refuses an unknown owner", () => {
  assert.throws(() => buildCurrentSeason({ teams: [{ id: 1, owners: ["x"] }] }, {}, 2026));
});

test("isHistoryQuestion routes archive questions and keeps the week chat", async () => {
  const { isHistoryQuestion } = await import("../src/index.js");
  for (const q of ["Who won the 2019 title?", "Most championships all time", "Curt vs Logan head to head", "Who is leading the fantasy league?", "Who did Jake draft first?"]) assert.ok(isHistoryQuestion(q), q);
  for (const q of ["Who is winning this week?", "What are Curt's chances?", "How long will Curt's wedding speech be for Nissan?", "Did Logan pick blindfolded?"]) assert.ok(!isHistoryQuestion(q), q);
});
