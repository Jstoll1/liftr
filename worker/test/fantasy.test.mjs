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


test("buildCurrentSeason keeps record leaderboards for the live season", () => {
  const league = { settings: { scheduleSettings: { matchupPeriodCount: 13 } }, teams: [{ id: 1, owners: ["a"] }, { id: 2, owners: ["b"] }],
    schedule: [{ matchupPeriodId: 1, winner: "HOME", home: { teamId: 1, totalPoints: 201.5 }, away: { teamId: 2, totalPoints: 90 } }] };
  const cur = buildCurrentSeason(league, { a: "Curt", b: "Logan" }, 2026, 0);
  assert.equal(cur.records.highestWeeklyScores[0], "Curt 201.5 in 2026 week 1 vs Logan");
  assert.match(cur.records.biggestWins[0], /Curt over Logan by 111.5/);
});
