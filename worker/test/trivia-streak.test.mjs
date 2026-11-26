import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const kvOf = () => { const m = new Map(); return { get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => m.delete(k), list: async () => ({ keys: [], list_complete: true }) }; };

test("trivia streaks: best run kept per player, bad input refused", async () => {
  const env = { LIFTR_KV: kvOf() };
  const post = (b) => worker.fetch(new Request("https://w.test/trivia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }), env, { waitUntil() {} });
  assert.equal((await post({ player: "Logan", streak: 4 })).status, 200);
  assert.equal((await post({ player: "Logan", streak: 2 })).status, 200);
  assert.equal((await post({ player: "Nobody", streak: 3 })).status, 400);
  assert.equal((await post({ player: "Logan", streak: 0 })).status, 400);
  const r = await (await worker.fetch(new Request("https://w.test/trivia?streak=1"), env, { waitUntil() {} })).json();
  const l = r.streaks.find((x) => x.player === "Logan");
  assert.equal(l.best, 4); assert.equal(l.runs, 2);
});
