// Expert predicted scores: placed by the named winner, never by number order.
import test from "node:test";
import assert from "node:assert/strict";
import { scoreAwayHome, orientStored } from "../src/insights.js";
import { gradePick } from "../src/experts.js";

// Auburn at Georgia, Georgia -20.5 (the case that went wrong).
const game = { away: "Auburn", awayShort: "Auburn", home: "Georgia", homeShort: "Georgia", favorite: "Georgia", spread: 20.5 };

test("an article's 'Georgia 41, Auburn 10' is Georgia winning at home", () => {
  assert.equal(scoreAwayHome(game, { score: "41-10", winner: "Georgia", side: "home", type: "SU" }), "10-41");
  assert.equal(scoreAwayHome(game, { score: "10-41", winner: "Georgia", side: "home", type: "SU" }), "10-41"); // order never matters
  assert.equal(scoreAwayHome(game, { score: "31-13", winner: "Auburn", side: "away", type: "ATS" }), "31-13");
});

test("no winner named: a pick to win outright decides it; a spread pick drops the score", () => {
  assert.equal(scoreAwayHome(game, { score: "41-10", winner: "", side: "home", type: "SU" }), "10-41");
  assert.equal(scoreAwayHome(game, { score: "24-20", winner: "", side: "away", type: "ATS" }), "");
  assert.equal(scoreAwayHome(game, { score: "", winner: "Georgia", side: "home", type: "SU" }), "");
});

test("picks stored the wrong way round are fixed on read", () => {
  assert.equal(orientStored({ side: "home", type: "SU", score: "41-10" }).score, "10-41");
  assert.equal(orientStored({ side: "home", type: "BOTH", score: "10-41" }).score, "10-41");
  assert.equal(orientStored({ side: "away", type: "ATS", score: "10-41" }).score, "10-41"); // a spread pick can lose and cover
});

test("grading a flipped archived pick reads Georgia covering, not Auburn", () => {
  const final = { awayScore: 10, homeScore: 41 };
  const g = gradePick(game, { side: "home", type: "SU", score: "41-10", line: "" }, final);
  assert.deepEqual(g.map((x) => [x.kind, x.result, x.side || null]), [["SU", "W", null], ["ATS", "W", "home"]]);
});
