import { test } from "node:test";
import assert from "node:assert/strict";

// KV with list metadata, keys listed in name order like the real thing.
const kv = () => { const m = new Map(), meta = new Map(); return { m,
  get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
  put: async (k, v, o) => { m.set(k, v); if (o?.metadata) meta.set(k, o.metadata); }, delete: async (k) => { m.delete(k); meta.delete(k); },
  list: async ({ prefix } = {}) => ({ keys: [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)).sort().map((name) => ({ name, metadata: meta.get(name) })), list_complete: true }) }; };

test("ops: phones report failures, admin reads them, upstream failures are logged", async () => {
  // A failing upstream before the Worker module wraps fetch.
  globalThis.fetch = async (u) => (String(u).includes("fail.test") ? new Response("x", { status: 503 }) : new Response("{}", { status: 200 }));
  const { default: worker } = await import(`../src/index.js?ops=${Date.now()}`);
  const env = { LIFTR_KV: kv(), ARCHIVE_LOG_KEY: "adm", DEFAULT_ROSTER: "Curt,Jake" };
  const waits = []; const ctx = { waitUntil: (p) => waits.push(p) };
  const call = (path, body) => worker.fetch(new Request(`https://w.test${path}`, body ? { method: "POST", body: JSON.stringify(body) } : {}), env, ctx);
  assert.equal((await call("/ops", { manager: "Curt", v: "202610240101", events: [{ k: "worker-fail", d: "/games 503" }, { k: "cron-fail", d: "spoofed" }, { k: "nope", d: "x" }, { k: "worker-slow", d: "/insights/news 930.8s" }] })).status, 200);
  await call("/ops", { manager: "Jake", events: [{ k: "espn-slow", d: "scoreboard 6.1s" }] });
  await fetch("https://fail.test/x");
  await call("/nothing-here");
  await Promise.all(waits);
  assert.equal((await call("/ops")).status, 403);
  const { ops } = await (await call("/ops?key=adm")).json();
  const kinds = ops.map((o) => o.k);
  assert.ok(kinds.includes("worker-fail") && kinds.includes("espn-slow") && kinds.includes("upstream-fail"));
  assert.ok(!kinds.includes("cron-fail") && !kinds.includes("nope"));
  assert.ok(!ops.some((o) => /930/.test(o.d))); // a phone that slept mid-call is not a slow Worker // phones cannot write the Worker's own kinds
  assert.equal(ops.find((o) => o.k === "worker-fail").n, "Curt");
  assert.equal(ops.find((o) => o.k === "espn-slow").n, undefined); // the admin's own phone carries no name
});
