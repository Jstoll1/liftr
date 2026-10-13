import test from "node:test";
import assert from "node:assert/strict";
import { queuedOpenAt } from "../src/index.js";

const now = 1_800_000_000_000, D = 86400000;

test("a queued open keeps the time it happened", () => {
  assert.equal(queuedOpenAt({ q: 1, at: now - 3 * 3600000 }, now), now - 3 * 3600000);
});

test("live opens and bad times are stamped on arrival", () => {
  assert.equal(queuedOpenAt({ at: now - 3600000 }, now), null);
  assert.equal(queuedOpenAt({ q: 1, at: now - 8 * D }, now), null);
  assert.equal(queuedOpenAt({ q: 1, at: now + 5 * 60000 }, now), null);
  assert.equal(queuedOpenAt({ q: 1, at: "soon" }, now), null);
  assert.equal(queuedOpenAt(null, now), null);
});

test("a little clock drift ahead is clamped to now", () => {
  assert.equal(queuedOpenAt({ q: 1, at: now + 30000 }, now), now);
});
