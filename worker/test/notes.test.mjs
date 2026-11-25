import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const kv = () => { const m = new Map(); return { m,
  get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
  put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); },
  list: async ({ prefix } = {}) => ({ keys: [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) }; };
const env = () => ({ SPORT: "nfl", LIFTR_KV: kv(), DEFAULT_ROSTER: "Ben,Jake", ARCHIVE_LOG_KEY: "adm" });
const call = (e, path, body, ip = "1.1.1.1") => worker.fetch(new Request(`https://w.test${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) } : { headers: { "cf-connecting-ip": ip } }), e, { waitUntil() {} });

test("notes: anyone sends, only admin reads, done and delete", async () => {
  const e = env();
  assert.equal((await call(e, "/notes", { name: "Gran", text: "  forgot my PIN " })).status, 200);
  assert.equal((await call(e, "/notes", { name: "Gran", text: "" })).status, 400);
  assert.equal((await call(e, "/notes", { text: "hi" })).status, 400);
  assert.equal((await call(e, "/notes")).status, 403);
  const notes = (await (await call(e, "/notes?key=adm")).json()).notes;
  assert.deepEqual([notes[0].name, notes[0].text, notes[0].verified, notes[0].done], ["Gran", "forgot my PIN", false, false]);
  await call(e, "/notes?key=adm", { action: "done", id: notes[0].id });
  assert.equal((await (await call(e, "/notes?key=adm")).json()).notes[0].done, true);
  await call(e, "/notes?key=adm", { action: "delete", id: notes[0].id });
  assert.equal((await (await call(e, "/notes?key=adm")).json()).notes.length, 0);
});

test("notes: rate limit and college closed", async () => {
  const e = env();
  for (let i = 0; i < 10; i++) await call(e, "/notes", { name: "X", text: "m" + i }, "3.3.3.3");
  assert.equal((await call(e, "/notes", { name: "X", text: "again" }, "3.3.3.3")).status, 429);
  assert.equal((await call({ ...env(), SPORT: "cfb" }, "/notes", { name: "X", text: "y" })).status, 404);
});
