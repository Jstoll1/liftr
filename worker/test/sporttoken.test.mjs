import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../src/index.js";

const kv = () => { const m = new Map(); return { m,
  get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
  put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); },
  list: async ({ prefix } = {}) => ({ keys: [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) }; };
const env = () => ({ SPORT: "nfl", LIFTR_KV: kv(), DEFAULT_ROSTER: "Ben,Jake", ARCHIVE_LOG_KEY: "adm", AUTH_SECRET: "same" });
const tok = (claims) => { const p = Buffer.from(JSON.stringify(claims)).toString("base64url"); return `${p}.${createHmac("sha256", "same").update(p).digest("base64url")}`; };
const note = async (e, token) => { await worker.fetch(new Request("https://w.test/notes", { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": String(Math.random()) }, body: JSON.stringify({ text: "hi", name: "X", token }) }), e, { waitUntil() {} }); const r = await worker.fetch(new Request("https://w.test/notes?key=adm"), e, { waitUntil() {} }); return (await r.json()).notes[0]; };

test("tokens: a college token never signs in on the NFL worker, even with the same secret", async () => {
  const exp = Date.now() + 86400000;
  assert.equal((await note(env(), tok({ m: "Jake", s: "nfl", exp }))).verified, true);
  assert.equal((await note(env(), tok({ m: "Jake", s: "cfb", exp }))).verified, false);
  assert.equal((await note(env(), tok({ m: "Jake", exp }))).verified, true); // older tokens (no league) keep working
});
