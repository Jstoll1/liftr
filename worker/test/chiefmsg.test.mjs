// Messages from the Chief: Live sends, the member sees it until answered,
// Live reads seen / thanks / reply. Only Live can send or read everyone's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const grab = (name) => src.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
const make = () => {
  const kv = new Map(); let admin = false;
  const env = { LIFTR_KV: { get: async (k, t) => (kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
  const h = new Function("PICKS_MANAGERS", "liveAdmin", "json", grab("handleChiefMsg") + "; return handleChiefMsg;")(
    ["Jake", "Curt"], async () => admin, (body, status) => ({ status, body }));
  return { h, env, kv, setAdmin: (v) => { admin = v; } };
};
const post = (b) => ({ method: "POST", json: async () => b });
const get = { method: "GET" };
const u = (q = "") => new URL(`https://x/chief-msg${q}`);

test("only Live can send or read every message", async () => {
  const { h, env } = make();
  assert.equal((await h(post({ to: "Curt", text: "hi" }), env, {}, u())).status, 403);
  assert.equal((await h(get, env, {}, u("?all=1"))).status, 403);
});

test("a message shows until thanked, and Live sees seen, thanks and reply", async () => {
  const { h, env, setAdmin } = make();
  setAdmin(true);
  const s = await h(post({ to: "Curt", text: "Big week, Curt." }), env, {}, u());
  assert.equal(s.body.ok, true);
  setAdmin(false);
  let r = await h(get, env, {}, u("?manager=Curt"));
  assert.equal(r.body.messages.length, 1);
  assert.equal((await h(get, env, {}, u("?manager=Jake"))).body.messages.length, 0);
  const id = r.body.messages[0].id;
  await h(post({ manager: "Curt", id, seen: 1 }), env, {}, u());
  await h(post({ manager: "Curt", id, reply: "Thanks, I'll need it" }), env, {}, u());
  assert.equal((await h(get, env, {}, u("?manager=Curt"))).body.messages.length, 0);
  setAdmin(true);
  const all = (await h(get, env, {}, u("?all=1"))).body.messages.Curt[0];
  assert.ok(all.seenAt && all.ackAt);
  assert.equal(all.reply, "Thanks, I'll need it");
});

test("send to everyone, and unknown members are refused", async () => {
  const { h, env, setAdmin } = make();
  setAdmin(true);
  assert.equal((await h(post({ to: "*", text: "Lines are up" }), env, {}, u())).body.sent, 2);
  assert.equal((await h(post({ to: "Hacker", text: "x" }), env, {}, u())).status, 400);
  setAdmin(false);
  assert.equal((await h(post({ manager: "Hacker", id: "x" }), env, {}, u())).status, 400);
});
