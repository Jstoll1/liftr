import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

// The slate editor's warning: who has picked each game, names only.
const store = new Map();
const kv = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => store.set(k, v), delete: async (k) => store.delete(k), list: async () => ({ keys: [], list_complete: true }) };
store.set("picks:w5:Curt", JSON.stringify({ picks: { 1: { team: "LSU", mode: "ATS" }, 2: { team: "Iowa", mode: "SU" } } }));
store.set("picks:w5:Dewitt", JSON.stringify({ picks: { 1: { team: "Florida", mode: "ATS" } } }));
const env = { LIFTR_KV: kv, SLATE_KEY: "slatekey", ARCHIVE_LOG_KEY: "appkey" };
const call = (q) => worker.fetch(new Request(`https://w.test/games?pickers=1&week=5${q}`), env, { waitUntil() {} });

test("pickers: names per game, no picks", async () => {
  const r = await call("&key=slatekey");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.pickers, { 1: ["Curt", "Dewitt"], 2: ["Curt"] });
  assert.ok(!JSON.stringify(body).includes("LSU") && !JSON.stringify(body).includes("ATS"));
});
test("pickers: needs a key", async () => {
  assert.equal((await call("&key=nope")).status, 403);
  assert.equal((await call("")).status, 403);
});
