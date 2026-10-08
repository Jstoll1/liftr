import test from "node:test";
import assert from "node:assert/strict";
import { gradePick, expertRecord } from "../src/experts.js";

const game = { id: 1, away: "Ohio State", home: "Michigan", awayShort: "OSU", homeShort: "MICH", favorite: "Ohio State", spread: 7 };

test("ATS uses the outlet line when written", () => {
  assert.deepEqual(gradePick(game, { side: "away", type: "ATS", line: "-3.5" }, { awayScore: 24, homeScore: 20 })[0].result, "W");
});
test("ATS falls back to the sealed line", () => {
  const [g] = gradePick(game, { side: "away", type: "ATS", line: "" }, { awayScore: 24, homeScore: 20 });
  assert.equal(g.line, -7); assert.equal(g.result, "L");
  assert.equal(gradePick(game, { side: "home", type: "ATS", line: "" }, { awayScore: 27, homeScore: 20 })[0].result, "P");
});
test("SU and BOTH", () => {
  assert.equal(gradePick(game, { side: "home", type: "SU" }, { awayScore: 24, homeScore: 20 })[0].result, "L");
  assert.equal(gradePick(game, { side: "away", type: "BOTH", line: "" }, { awayScore: 24, homeScore: 20 }).length, 2);
});
test("no final, no grade; record tallies", () => {
  assert.deepEqual(gradePick(game, { side: "away", type: "SU" }, null), []);
  const r = expertRecord([{ week: 5, game, final: { awayScore: 30, homeScore: 10 }, picks: [{ outlet: "CBS", side: "away", type: "BOTH", line: "" }, { outlet: "SI", side: "home", type: "SU" }] }]);
  assert.equal(r.total.W, 2); assert.equal(r.total.L, 1);
  assert.equal(r.outlets[0].outlet, "CBS");
});

test("SU pick with a score is graded ATS on the side the score covers", () => {
  const g = { id: 2, away: "Nebraska", home: "Indiana", favorite: "Indiana", spread: 7 };
  const r = gradePick(g, { side: "home", type: "SU", score: "24-27" }, { awayScore: 20, homeScore: 24 });
  assert.equal(r.find((x) => x.kind === "SU").result, "W");
  const ats = r.find((x) => x.kind === "ATS");
  assert.equal(ats.side, "away"); assert.equal(ats.line, 7); assert.equal(ats.result, "W");
});
