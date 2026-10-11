import test from "node:test";
import assert from "node:assert/strict";
import { maskPicks } from "../src/index.js";

const picks = {
  Jake: { picks: { 1: { team: "LSU", mode: "ATS", updatedAt: 5 }, 2: { team: "UK", mode: "SU" } }, tiebreaker: "51" },
  Logan: { picks: { 1: { team: "Bama", mode: "SU" }, 2: { team: "UGA", mode: "ATS" } }, tiebreaker: "44" },
};
const kick = { 1: 1000, 2: 5000 };

test("before lock, other owners' picks and tiebreaker are hidden but still count", () => {
  const out = maskPicks(picks, kick, 500, { all: false, me: "Jake" });
  assert.deepEqual(out.Jake, picks.Jake);
  assert.deepEqual(out.Logan.picks, { 1: { hidden: true }, 2: { hidden: true } });
  assert.equal(out.Logan.tiebreaker, "hidden");
  assert.equal(Object.keys(out.Logan.picks).length, 2);
});

test("a game that has kicked off shows; the rest stay hidden", () => {
  const out = maskPicks(picks, kick, 2000, { all: false, me: null });
  assert.deepEqual(out.Logan.picks[1], { team: "Bama", mode: "SU" });
  assert.deepEqual(out.Logan.picks[2], { hidden: true });
  assert.equal(out.Logan.tiebreaker, "44");
  assert.deepEqual(out.Jake.picks[2], { hidden: true });
});

test("the admin sees everything; no kickoffs means hidden", () => {
  assert.deepEqual(maskPicks(picks, kick, 0, { all: true }), picks);
  const out = maskPicks(picks, {}, 9e15, { all: false, me: null });
  assert.deepEqual(out.Logan.picks[1], { hidden: true });
});
