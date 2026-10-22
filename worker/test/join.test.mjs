import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const kv = () => { const m = new Map(); return { m,
  get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
  put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); },
  list: async ({ prefix } = {}) => ({ keys: [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) }; };
const env = () => ({ SPORT: "nfl", LIFTR_KV: kv(), DEFAULT_ROSTER: "Ben,Jake", ARCHIVE_LOG_KEY: "adm" });
const call = (e, path, body, ip = "1.1.1.1") => worker.fetch(new Request(`https://w.test${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) } : { headers: { "cf-connecting-ip": ip } }), e, { waitUntil() {} });

test("join: request, admin sees it with email, approve adds to the roster", async () => {
  const e = env();
  const r = await (await call(e, "/join", { name: "Sam  Smith", email: "Sam@Example.com" })).json();
  assert.ok(r.id);
  assert.equal((await (await call(e, `/join?id=${r.id}`)).json()).status, "pending");
  assert.equal((await call(e, "/joins")).status, 403);
  const list = (await (await call(e, "/joins?key=adm")).json()).requests;
  assert.deepEqual([list[0].name, list[0].email], ["Sam Smith", "sam@example.com"]);
  const ok = await (await call(e, "/joins?key=adm", { id: r.id, action: "approve" })).json();
  assert.deepEqual(ok.roster, ["Ben", "Jake", "Sam Smith"]);
  assert.equal((await (await call(e, `/join?id=${r.id}`)).json()).status, "approved");
  assert.equal(JSON.stringify((await (await call(e, `/join?id=${r.id}`)).json())).includes("example.com"), false); // the public status never shows the email
});

test("join: guards (names taken, bad email, deny, rate limit, college closed)", async () => {
  const e = env();
  assert.equal((await call(e, "/join", { name: "ben", email: "b@x.com" })).status, 409);
  assert.equal((await call(e, "/join", { name: "Al", email: "nope" })).status, 400);
  const { id } = await (await call(e, "/join", { name: "Al", email: "al@x.com" })).json();
  await call(e, "/joins?key=adm", { id, action: "deny" });
  assert.equal((await (await call(e, `/join?id=${id}`)).json()).status, "denied");
  for (let i = 0; i < 4; i++) await call(e, "/join", { name: "Q" + i, email: `q${i}@x.com` }, "2.2.2.2");
  assert.equal((await call(e, "/join", { name: "Q9", email: "q9@x.com" }, "2.2.2.2")).status, 200);
  assert.equal((await call(e, "/join", { name: "Q10", email: "q10@x.com" }, "2.2.2.2")).status, 429);
  assert.equal((await call({ ...env(), SPORT: "cfb" }, "/join", { name: "Z", email: "z@x.com" })).status, 404);
});

test("join: approval makes a personal link; only it can claim the name", async () => {
  const e = { ...env(), AUTH_SECRET: "s" };
  const { id } = await (await call(e, "/join", { name: "Sam", email: "s@x.com", message: "Ben's brother" })).json();
  assert.equal((await (await call(e, "/joins?key=adm")).json()).requests[0].message, "Ben's brother");
  const { request } = await (await call(e, "/joins?key=adm", { id, action: "approve" })).json();
  const code = new URL(request.link).searchParams.get("claim");
  assert.match(request.link, /^https:\/\/nfl\.brochiefs\.com\/\?claim=[a-f0-9]{32}&n=Sam$/);
  const claim = (inv) => call(e, "/auth", { action: "claim", manager: "Sam", code: "123456", ...(inv ? { invite: inv } : {}) });
  assert.equal((await claim()).status, 403);            // someone picking Sam from the list
  assert.equal((await claim("wrong")).status, 403);
  assert.equal((await claim(code)).status, 200);         // the personal link
  assert.equal((await claim(code)).status, 409);         // and only once
});
