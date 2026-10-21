import test from "node:test";
import assert from "node:assert/strict";
import { LOCK_RULE, settleLock, buildSummary } from "../src/index.js";

const slate = { games: [
  { id: 1, away: "Kentucky", home: "LSU", awayShort: "UK", homeShort: "LSU", favorite: "LSU", spread: 7 },
  { id: 2, away: "Auburn", home: "Georgia", awayShort: "AU", homeShort: "UGA", favorite: "Georgia", spread: 10, tiebreakerGame: true },
] };
const results = { 1: { awayScore: 10, homeScore: 24 }, 2: { awayScore: 20, homeScore: 27 } }; // LSU covers 7; UGA wins by 7, Auburn +10 covers
const withRule = (fn) => { const was = { ...LOCK_RULE }; Object.assign(LOCK_RULE, { on: true, fromWeek: 9, hit: 2, miss: -1 }); try { fn(); } finally { Object.assign(LOCK_RULE, was); } };

test("a locked hit adds the bonus, a locked miss scores the penalty", () => withRule(() => {
  const picks = { Jake: { picks: { 1: { team: "LSU", mode: "ATS", lock: true }, 2: { team: "Georgia", mode: "ATS" } } },
    Logan: { picks: { 1: { team: "LSU", mode: "ATS" }, 2: { team: "Georgia", mode: "ATS", lock: true } } } };
  const s = buildSummary(9, slate, results, picks);
  const jake = s.rows.find((r) => r.name === "Jake"), logan = s.rows.find((r) => r.name === "Logan");
  assert.equal(jake.score, 4); // 2 + 2 bonus, Georgia miss 0
  assert.equal(logan.score, 1); // 2, then -1 for the locked miss
  assert.equal(jake.lock.result, "hit"); assert.equal(jake.lock.pts, 2);
  assert.equal(logan.lock.result, "miss"); assert.equal(logan.lock.pts, -1);
  assert.deepEqual(s.lockRule, { hit: 2, miss: -1 });
  assert.equal(s.recap.locks.hit[0], "Jake");
}));

test("weeks before the rule starts ignore a lock flag entirely", () => withRule(() => {
  const picks = { Jake: { picks: { 1: { team: "LSU", mode: "ATS", lock: true } } } };
  const s = buildSummary(8, slate, results, picks);
  assert.equal(s.rows.find((r) => r.name === "Jake").score, 2);
  assert.equal(s.lockRule, undefined);
}));

test("a lock on a straight up pick is dropped and scores nothing extra", () => withRule(() => {
  const p = { 1: { team: "LSU", mode: "SU", lock: true } };
  settleLock(p, {}, {}, 10, 9);
  assert.equal(!!p[1].lock, false);
  const s = buildSummary(9, slate, results, { Jake: { picks: { 1: { team: "LSU", mode: "SU", lock: true } } } });
  assert.equal(s.rows.find((r) => r.name === "Jake").score, 1);
}));

test("rule off: nothing changes", () => { const was = LOCK_RULE.on; LOCK_RULE.on = false; try {
  const s = buildSummary(9, slate, results, { Jake: { picks: { 1: { team: "LSU", mode: "ATS", lock: true } } } });
  assert.equal(s.rows.find((r) => r.name === "Jake").score, 2);
} finally { LOCK_RULE.on = was; } });

test("a push on a lock scores nothing either way", () => withRule(() => {
  const push = { ...results, 1: { awayScore: 10, homeScore: 17 } };
  const s = buildSummary(9, slate, push, { Jake: { picks: { 1: { team: "LSU", mode: "ATS", lock: true } } } });
  const j = s.rows.find((r) => r.name === "Jake");
  assert.equal(j.score, 0); assert.equal(j.lock.result, "push");
}));

test("one lock a week: the newest wins, a kicked off lock is final, off weeks drop it", () => withRule(() => {
  const p = { 1: { team: "LSU", mode: "ATS", lock: true, updatedAt: 1 }, 2: { team: "Georgia", mode: "ATS", lock: true, updatedAt: 2 } };
  settleLock(p, {}, {}, 10, 9);
  assert.equal(!!p[1].lock, false); assert.equal(p[2].lock, true);
  const q = { 1: { team: "LSU", mode: "ATS", lock: true, updatedAt: 1 }, 2: { team: "Georgia", mode: "ATS", lock: true, updatedAt: 2 } };
  settleLock(q, { 1: { lock: true } }, { 1: 5 }, 10, 9);
  assert.equal(q[1].lock, true); assert.equal(!!q[2].lock, false);
  const r = { 1: { team: "LSU", mode: "ATS", lock: true } };
  settleLock(r, {}, {}, 10, 8);
  assert.equal(!!r[1].lock, false);
}));
