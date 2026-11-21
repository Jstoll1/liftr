import test from "node:test";
import assert from "node:assert/strict";
import { cleanCase, addCase, mergeRun, runRecord, turned, RETIRE_AFTER } from "../src/chieftest.js";

test("chief test: a case from a Live miss keeps its turns and screen", () => {
  const c = cleanCase({ q: "Why is my % so low?", followUp: "That's wrong", screen: "fantasy", source: "miss" });
  assert.deepEqual(c.turns, ["Why is my % so low?", "That's wrong"]);
  assert.equal(c.screen, "fantasy"); assert.equal(c.source, "miss"); assert.equal(c.id, "why-is-my-so-low");
  assert.equal(cleanCase({ q: "" }), null);
});
test("chief test: duplicate ids get a number", () => {
  let { cases } = addCase([], { q: "Who is leading?" });
  ({ cases } = addCase(cases, { q: "Who is leading?" }));
  assert.deepEqual(cases.map((c) => c.id), ["who-is-leading", "who-is-leading-2"]);
});
test("chief test: streaks retire a passing test but never a regression test", () => {
  let cases = [cleanCase({ id: "a", q: "x" }), cleanCase({ id: "b", q: "y", regression: true })];
  for (let i = 0; i < RETIRE_AFTER; i++) cases = mergeRun(cases, { a: true, b: true });
  assert.equal(cases[0].retired, true); assert.equal(cases[1].retired, false);
  cases = mergeRun(cases, { a: false });
  assert.equal(cases[0].retired, false); assert.equal(cases[0].streak, 0); assert.equal(cases[0].fails, 1);
});
test("chief test: run record keeps only the summary", () => {
  const r = runRecord({ build: "12ab34", passed: 21, total: 25, failed: ["Odds Cover"], state: "3/10 final" }, 5);
  assert.deepEqual(r, { at: 5, build: "1234", state: "3/10 final", passed: 21, total: 25, failed: ["odds-cover"], regressed: [], fixed: [] });
});

test("chief test: a run says which tests regressed and which were fixed", () => {
  let cases = [cleanCase({ id: "a", q: "x" }), cleanCase({ id: "b", q: "y" }), cleanCase({ id: "c", q: "z" })];
  cases = mergeRun(cases, { a: true, b: false });
  assert.deepEqual(turned(cases, { a: false, b: true, c: true }), { regressed: ["a"], fixed: ["b"] });
});
