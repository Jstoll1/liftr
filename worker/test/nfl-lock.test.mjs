import test from "node:test";
import assert from "node:assert/strict";
import { sundayLockAt, nflLocks } from "../src/index.js";

// Week of Sun Oct 25 2026 (EDT, UTC-4): Thu 8:15pm, London Sun 9:30am,
// Sun 1pm, Sun 4:25pm, Sun 8:20pm, Mon 8:15pm.
const T = (iso) => Date.parse(iso);
const week = [T("2026-10-23T00:15:00Z"), T("2026-10-25T13:30:00Z"), T("2026-10-25T17:00:00Z"), T("2026-10-25T20:25:00Z"), T("2026-10-26T00:20:00Z"), T("2026-10-27T00:15:00Z")];

test("NFL: everything from Sunday 1pm ET locks at 1pm; earlier games at their own kickoff", () => {
  assert.equal(sundayLockAt(week), T("2026-10-25T17:00:00Z"));
  const locks = nflLocks(week);
  assert.equal(locks[0], week[0]);                 // Thursday night
  assert.equal(locks[1], week[1]);                 // London morning
  for (const i of [2, 3, 4, 5]) assert.equal(locks[i], T("2026-10-25T17:00:00Z"));
});

test("NFL: a week with no Sunday afternoon game keeps each game's own kickoff", () => {
  const odd = [T("2026-12-25T18:00:00Z"), T("2026-12-26T21:30:00Z")];
  assert.equal(sundayLockAt(odd), null);
  assert.deepEqual(nflLocks(odd), odd);
});

test("NFL: in standard time the 1pm ET kickoff is 18:00 UTC", () => {
  const nov = [T("2026-11-08T18:00:00Z"), T("2026-11-09T01:20:00Z")];
  assert.equal(sundayLockAt(nov), T("2026-11-08T18:00:00Z"));
});
