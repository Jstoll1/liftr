import { test } from "node:test";
import assert from "node:assert/strict";
import { nflLocks } from "../src/index.js";

const T = (s) => Date.parse(s);
test("NFL: every pick locks at the week's first kickoff", () => {
  const week = [T("2026-11-26T18:00:00Z"), T("2026-11-26T21:30:00Z"), T("2026-11-27T01:20:00Z")];
  assert.deepEqual(nflLocks(week), [week[0], week[0], week[0]]);
  assert.deepEqual(nflLocks([NaN, week[1]]), [NaN, week[1]]);
});
