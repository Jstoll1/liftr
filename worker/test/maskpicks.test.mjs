import { test } from "node:test";
import assert from "node:assert/strict";
import { maskPicks } from "../src/index.js";

test("maskPicks: counts and tiebreaker before kickoff are right for the grid card", () => {
  const ko = { 1: 2000, 2: 3000, 3: 4000 };
  const picks = {
    Ann: { picks: { 1: { team: "A", mode: "ats" }, 2: null, 3: { team: null } }, tiebreaker: "45" },
    Bo: { picks: {}, tiebreaker: "" },
    Me: { picks: { 1: { team: "A" } }, tiebreaker: "50" },
  };
  const out = maskPicks(picks, ko, 1000, { all: false, me: "Me" });
  assert.deepEqual(out.Ann.picks, { 1: { hidden: true } }); // only the real pick, hidden
  assert.equal(out.Ann.tiebreaker, "hidden");              // set, but private
  assert.equal(String(out.Bo.tiebreaker ?? "").trim(), "");  // not set reads as not set
  assert.equal(out.Me.tiebreaker, "50");                     // your own is yours
  const after = maskPicks(picks, ko, 2500, { all: false, me: "Me" });
  assert.deepEqual(after.Ann.picks[1], { team: "A", mode: "ats" }); // shown once its game kicks off
  assert.equal(after.Ann.tiebreaker, "45");
});
