import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

// KV with list metadata, keys listed in name order like the real thing.
const kv = () => { const m = new Map(), meta = new Map(); return { m,
  get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
  put: async (k, v, o) => { m.set(k, v); if (o?.metadata) meta.set(k, o.metadata); }, delete: async (k) => { m.delete(k); meta.delete(k); },
  list: async ({ prefix } = {}) => ({ keys: [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)).sort().map((name) => ({ name, metadata: meta.get(name) })), list_complete: true }) }; };
const env = () => ({ LIFTR_KV: kv(), DEFAULT_ROSTER: "Ben,Jake", ARCHIVE_LOG_KEY: "adm" });
const call = (e, path, body) => worker.fetch(new Request(`https://w.test${path}`, body ? { method: "POST", body: JSON.stringify(body) } : {}), e, { waitUntil() {} });

test("admin friction: only Jake's dead taps are kept, admin only to read", async () => {
  const e = env();
  assert.equal((await (await call(e, "/admin-friction", { manager: "Robert", d: ".x “1”" })).json()).tracked, false);
  assert.equal((await call(e, "/admin-friction", { manager: "Jake", k: "rage", d: ".cd-chip “9/10 !”", screen: "picks" })).status, 200);
  assert.equal((await call(e, "/admin-friction")).status, 403);
  const { taps } = await (await call(e, "/admin-friction?key=adm")).json();
  assert.equal(taps.length, 1);
  assert.deepEqual([taps[0].k, taps[0].d, taps[0].screen], ["rage", ".cd-chip “9/10 !”", "picks"]);
});

test("admin friction: the admin ticks an entry fixed and back", async () => {
  const e = env();
  await call(e, "/admin-friction", { manager: "Jake", k: "dead-tap", d: ".x" });
  const at = (await (await call(e, "/admin-friction?key=adm")).json()).taps[0].at;
  assert.equal((await call(e, "/admin-friction", { action: "fix", at, fixed: true })).status, 403);
  assert.ok((await (await call(e, "/admin-friction?key=adm", { action: "fix", at, fixed: true })).json()).taps[0].fixed);
  assert.equal((await (await call(e, "/admin-friction?key=adm", { action: "fix", at, fixed: false })).json()).taps[0].fixed, undefined);
});

test("admin friction: entries sent at the same moment are all kept, newest first", async () => {
  const e = env();
  await Promise.all([".a", ".b", ".c"].map((d) => call(e, "/admin-friction", { manager: "Jake", k: "dead-tap", d })));
  await new Promise((r) => setTimeout(r, 5)); // a later millisecond, so "newest" is well defined
  await call(e, "/admin-friction", { manager: "Jake", k: "rage", d: ".last" });
  const { taps } = await (await call(e, "/admin-friction?key=adm")).json();
  assert.equal(taps.length, 4);
  assert.equal(taps[0].d, ".last");
  assert.equal(new Set(taps.map((t) => t.id)).size, 4); // one key each
});
