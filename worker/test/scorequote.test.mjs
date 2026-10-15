import test from "node:test";
import assert from "node:assert/strict";
import { scoreFromQuote, scoreAwayHome } from "../src/insights.js";

const g = { away: "Washington Commanders", home: "San Francisco 49ers", awayShort: "Commanders", homeShort: "49ers" };
const oriented = (q) => scoreAwayHome(g, { score: scoreFromQuote(g, q), winner: "49ers", side: "home", type: "BOTH" });

test("a number in a team's name is never a score", () => {
  assert.equal(oriented("49ers 31, Commanders 23"), "23-31");
  assert.equal(oriented("49ers 35-20"), "20-35");
});
test("a line is not a score, and no score gives none", () => {
  assert.equal(scoreFromQuote(g, "49ERS (-8) over Commanders"), "");
  assert.equal(scoreFromQuote(g, "Pick: 49ers -7.5"), "");
});
