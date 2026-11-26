import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { resetReadCache } from "../src/index.js";

// KV whose list() keeps answering with the metadata it had first, the way
// Cloudflare's listing lags a write.
const laggyKv = () => {
  const m = new Map(), meta = new Map(), frozen = new Map();
  return {
    m,
    get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
    put: async (k, v, o) => { m.set(k, String(v)); if (o?.metadata) { meta.set(k, o.metadata); if (!frozen.has(k)) frozen.set(k, o.metadata); } },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...frozen].filter(([k]) => k.startsWith(prefix)).map(([name, metadata]) => ({ name, metadata })), list_complete: true }),
  };
};

test("ops: close all sticks even when the key listing lags, old entries included", async () => {
  resetReadCache?.();
  const kv = laggyKv();
  const now = Date.now();
  await kv.put("ops:1", "", { metadata: { at: now - 1000, k: "espn-fail", d: "x Load failed" } });
  await kv.put("ops:2", "", { metadata: { at: now - 2000, k: "worker-slow", d: "/insights/news 4.5s" } });
  kv.m.set("ops-log", JSON.stringify([{ at: now - 5000, k: "upstream-fail", d: "gdelt 429" }]));
  const env = { LIFTR_KV: kv, ARCHIVE_LOG_KEY: "adm" };
  const call = async (body) => (await worker.fetch(new Request("https://w.test/ops?key=adm", body ? { method: "POST", body: JSON.stringify(body) } : {}), env, { waitUntil() {} })).json();
  const before = (await call()).ops;
  assert.equal(before.length, 3);
  assert.ok(before.every((r) => r.id && !r.closed));
  const after = (await call({ action: "close", ids: before.map((r) => r.id), closed: true })).ops;
  assert.ok(after.every((r) => r.closed), JSON.stringify(after));
  const reread = (await call()).ops;
  assert.ok(reread.every((r) => r.closed));
  const reopened = (await call({ action: "close", ids: [before[0].id], closed: false })).ops;
  assert.equal(reopened.filter((r) => !r.closed).length, 1);
});
