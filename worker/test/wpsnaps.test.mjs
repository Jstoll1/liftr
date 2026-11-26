// Win% snapshots: kept once per moment, only after kickoff, owner reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const grab = (name) => src.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
const make = (kickoff, admin = false) => {
  const kv = new Map([["games:3", JSON.stringify({ games: [{ kickoff }] })], ["sum:3", JSON.stringify({ complete: true, winners: ["Jake"] })]]);
  const env = { LIFTR_KV: { get: async (k, t) => (kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
  const h = new Function("PICKS_MANAGERS", "gamesKey", "summaryKey", "readWeeks", "liveAdmin", "json", grab("handleWpSnaps") + "; return handleWpSnaps;")(
    ["Jake", "Curt", "Nissan"], (w) => `games:${w}`, (w) => `sum:${w}`, async () => ({ list: [3] }), async () => admin,
    (body, status) => ({ status, body }));
  return { h, kv, env };
};
const post = (b) => ({ method: "POST", json: async () => b });
const url = new URL("https://x/wp-snaps");

test("a snapshot after kickoff is kept once per moment", async () => {
  const { h, env, kv } = make(new Date(Date.now() - 3600e3).toISOString());
  let r = await h(post({ week: 3, key: "f2", finals: 2, pct: { Jake: 0.4, Curt: 0.35, Nissan: 0.25, Hacker: 0.9 } }), env, {}, url);
  assert.equal(r.body.kept, true);
  r = await h(post({ week: 3, key: "f2", finals: 2, pct: { Jake: 0.1, Curt: 0.9 } }), env, {}, url);
  assert.equal(r.body.kept, false);
  const saved = JSON.parse(kv.get("wpsnap:3"));
  assert.equal(saved.length, 1);
  assert.deepEqual(Object.keys(saved[0].pct).sort(), ["Curt", "Jake", "Nissan"]);
});

test("nothing is stored before the first kickoff, or with a bad key", async () => {
  const { h, env, kv } = make(new Date(Date.now() + 3600e3).toISOString());
  const r = await h(post({ week: 3, key: "lock", pct: { Jake: 0.5, Curt: 0.5 } }), env, {}, url);
  assert.equal(r.body.ok, false);
  const bad = await h(post({ week: 3, key: "drop table", pct: { Jake: 0.5, Curt: 0.5 } }), env, {}, url);
  assert.equal(bad.status, 400);
  assert.equal(kv.has("wpsnap:3"), false);
});

test("only the owner reads them, with the week's winners", async () => {
  const open = make(new Date(Date.now() - 3600e3).toISOString());
  await open.h(post({ week: 3, key: "lock", pct: { Jake: 0.5, Curt: 0.5 } }), open.env, {}, url);
  assert.equal((await open.h({ method: "GET" }, open.env, {}, url)).status, 403);
  const owner = make(new Date(Date.now() - 3600e3).toISOString(), true);
  await owner.h(post({ week: 3, key: "lock", pct: { Jake: 0.5, Curt: 0.5 } }), owner.env, {}, url);
  const r = await owner.h({ method: "GET" }, owner.env, {}, url);
  assert.deepEqual(r.body.weeks[0].winners, ["Jake"]);
  assert.equal(r.body.weeks[0].snaps.length, 1);
});
