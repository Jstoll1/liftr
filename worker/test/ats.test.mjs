import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { parseAtsRecord } from "../src/index.js";

test("ATS parser: plain wins/losses/pushes, stats arrays, summaries", () => {
  assert.equal(parseAtsRecord({ items: [{ type: { name: "atsHome" }, wins: 2, losses: 1 }, { type: { name: "atsOverall" }, wins: 5, losses: 2, pushes: 1 }] }), "5-2-1");
  assert.equal(parseAtsRecord({ items: [{ type: { name: "spreadOverall" }, stats: [{ name: "wins", value: 4 }, { name: "losses", value: 3 }, { name: "pushes", value: 0 }] }] }), "4-3");
  assert.equal(parseAtsRecord({ items: [{ name: "ATS", summary: "3-4" }] }), "3-4");
  assert.equal(parseAtsRecord({}), null);
});

test("ATS endpoint: tries ESPN, answers with the record and where it came from", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).includes("/ats") ? new Response("nope", { status: 404 }) : new Response(JSON.stringify({ items: [{ type: { name: "atsOverall" }, wins: 6, losses: 1 }] }), { status: 200 });
  try {
    const store = new Map();
    const kv = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => store.set(k, v) };
    const r = await (await worker.fetch(new Request("https://w.test/ats?team=25"), { LIFTR_KV: kv }, { waitUntil() {} })).json();
    assert.equal(r.ats, "6-1");
    assert.match(r.src, /odds-records/);
    assert.equal((await worker.fetch(new Request("https://w.test/ats?team=x"), { LIFTR_KV: kv }, { waitUntil() {} })).status, 400);
  } finally { globalThis.fetch = real; }
});
