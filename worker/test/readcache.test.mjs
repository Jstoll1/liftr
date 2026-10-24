import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

// The Worker's short memory cache for public reads.
const kv = () => { const m = new Map(); let reads = 0; return { m, reads: () => reads, get: async (k, t) => { reads++; const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [], list_complete: true }) }; };
const call = (env, path, init) => worker.fetch(new Request(`https://w.test${path}`, init), env, { waitUntil() {} });

test("read cache: a repeat public read is served from memory, ?t= ignored", async () => {
  const env = { LIFTR_KV: kv(), ARCHIVE_LOG_KEY: "adm", DEFAULT_ROSTER: "Curt,Jake" };
  const a = await call(env, "/weeks?t=1");
  const before = env.LIFTR_KV.reads();
  const b = await call(env, "/weeks?t=2");
  assert.equal(b.headers.get("X-Read-Cache"), "memory");
  assert.equal(env.LIFTR_KV.reads(), before); // no storage read the second time
  assert.equal(await a.text(), await b.text());
});

test("read cache: anything that names a person is never cached", async () => {
  const env = { LIFTR_KV: kv(), ARCHIVE_LOG_KEY: "adm", DEFAULT_ROSTER: "Curt,Jake" };
  for (const q of ["?me=Curt", "?key=adm", "?device=x", "?token=y"]) {
    await call(env, `/season${q}`);
    const r = await call(env, `/season${q}`);
    assert.equal(r.headers.get("X-Read-Cache"), null, q);
  }
});

test("read cache: a write clears it, so the next read is fresh", async () => {
  const env = { LIFTR_KV: kv(), ARCHIVE_LOG_KEY: "adm", DEFAULT_ROSTER: "Curt,Jake" };
  await call(env, "/weeks");
  assert.equal((await call(env, "/weeks")).headers.get("X-Read-Cache"), "memory");
  await call(env, "/presence", { method: "POST", body: JSON.stringify({ manager: "Curt" }) });
  assert.equal((await call(env, "/weeks")).headers.get("X-Read-Cache"), null);
});
