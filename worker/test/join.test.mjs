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
  const r = await (await call(e, "/join", { name: "Sam  Smith", email: "Sam@Example.com", pin: "4321" })).json();
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
  assert.equal((await call(e, "/join", { name: "ben", email: "b@x.com", pin: "4321" })).status, 409);
  assert.equal((await call(e, "/join", { name: "Al", email: "nope", pin: "4321" })).status, 400);
  const { id } = await (await call(e, "/join", { name: "Al", email: "al@x.com", pin: "4321" })).json();
  await call(e, "/joins?key=adm", { id, action: "deny" });
  assert.equal((await (await call(e, `/join?id=${id}`)).json()).status, "denied");
  for (let i = 0; i < 4; i++) await call(e, "/join", { name: "Q" + i, email: `q${i}@x.com`, pin: "4321" }, "2.2.2.2");
  assert.equal((await call(e, "/join", { name: "Q9", email: "q9@x.com", pin: "4321" }, "2.2.2.2")).status, 200);
  assert.equal((await call(e, "/join", { name: "Q10", email: "q10@x.com", pin: "4321" }, "2.2.2.2")).status, 429);
  assert.equal((await call({ ...env(), SPORT: "cfb" }, "/join", { name: "Z", email: "z@x.com" })).status, 404);
});

test("join: approval makes a personal link; only it can claim the name", async () => {
  const e = { ...env(), AUTH_SECRET: "s" };
  const { id } = await (await call(e, "/join", { name: "Sam", email: "s@x.com", message: "Ben's brother", pin: "4321" })).json();
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

test("join: Grandpa's phone signs itself in after approval (no PIN), and a new phone link works", async () => {
  const e = { ...env(), AUTH_SECRET: "s" };
  const { id } = await (await call(e, "/join", { name: "Grandpa", email: "gp@x.com", pin: "4321" })).json();
  assert.equal((await (await call(e, `/join?id=${id}`)).json()).invite, undefined); // nothing before approval
  await call(e, "/joins?key=adm", { id, action: "approve" });
  const st = await (await call(e, `/join?id=${id}`)).json();
  assert.match(st.invite, /^[a-f0-9]{32}$/);
  const secret = "a".repeat(32);
  const claim = await (await call(e, "/auth", { action: "claim", manager: "Grandpa", code: secret, invite: st.invite })).json();
  assert.ok(claim.token);
  assert.equal((await (await call(e, `/join?id=${id}`)).json()).invite, undefined); // used up
  assert.ok((await (await call(e, "/auth", { action: "login", manager: "Grandpa", code: secret })).json()).token); // silent re-login
  const list = await (await call(e, "/joins?key=adm")).json();
  assert.ok(list.claimed.includes("Grandpa"));
  assert.equal((await call(e, "/joins", { action: "relink", name: "Grandpa" })).status, 403);
  const rl = await (await call(e, "/joins?key=adm", { action: "relink", name: "grandpa" })).json();
  const code = new URL(rl.link).searchParams.get("claim");
  assert.equal((await call(e, "/auth", { action: "login", manager: "Grandpa", code: secret })).status !== 200, true); // old phone signed out
  assert.ok((await (await call(e, "/auth", { action: "claim", manager: "Grandpa", code: "b".repeat(32), invite: code })).json()).token);
});

test("join: remove takes a member off the roster and clears their sign-in and request", async () => {
  const e = { ...env(), AUTH_SECRET: "s" };
  const { id } = await (await call(e, "/join", { name: "Test", email: "t@x.com", pin: "4321" })).json();
  await call(e, "/joins?key=adm", { id, action: "approve" });
  assert.equal((await call(e, "/joins", { action: "remove", name: "Test", id })).status, 403);
  const r = await (await call(e, "/joins?key=adm", { action: "remove", name: "Test", id })).json();
  assert.deepEqual(r.roster, ["Ben", "Jake"]);
  assert.equal((await (await call(e, `/join?id=${id}`)).json()).status, "gone");
  assert.equal([...e.LIFTR_KV.m.keys()].some((k) => /invite:test|auth:Test/.test(k)), false);
});

test("join: backup PIN signs a member in on a second phone; only the signed-in owner can set it", async () => {
  const e = { ...env(), AUTH_SECRET: "s" };
  const { id } = await (await call(e, "/join", { name: "Nana", email: "n@x.com", pin: "4321" })).json();
  await call(e, "/joins?key=adm", { id, action: "approve" });
  const { invite } = await (await call(e, `/join?id=${id}`)).json();
  const { token } = await (await call(e, "/auth", { action: "claim", manager: "Nana", code: "c".repeat(32), invite })).json();
  const noPin = await call(e, "/auth", { action: "login", manager: "Nana", code: "1234" });
  assert.equal(noPin.status, 401);
  assert.ok((await (await call(e, "/auth", { action: "login", manager: "Nana", code: "4321" })).json()).token); // the PIN from her join request
  assert.equal((await call(e, "/auth", { action: "setpin", manager: "Nana", pin: "1234" })).status, 401);
  assert.equal((await call(e, "/auth", { action: "setpin", manager: "Nana", pin: "12", token })).status, 400);
  assert.equal((await call(e, "/auth", { action: "setpin", manager: "Nana", pin: "2468", token })).status, 200);
  assert.ok((await (await call(e, "/auth", { action: "login", manager: "Nana", code: "2468" })).json()).token);
  assert.ok((await (await call(e, "/auth", { action: "login", manager: "Nana", code: "c".repeat(32) })).json()).token); // the first phone still works
});

test("join: the join PIN signs in on another phone before the first phone opened it; Live can set a new PIN", async () => {
  const e = { ...env(), AUTH_SECRET: "s" };
  const { id } = await (await call(e, "/join", { name: "Pop", email: "p@x.com", pin: "1111" })).json();
  assert.equal(JSON.stringify(await (await call(e, "/joins?key=adm")).json()).includes("hash"), false); // never listed
  await call(e, "/joins?key=adm", { id, action: "approve" });
  assert.equal((await call(e, "/auth", { action: "login", manager: "Pop", code: "9999" })).status, 401);
  assert.ok((await (await call(e, "/auth", { action: "login", manager: "Pop", code: "1111" })).json()).token);
  assert.equal((await call(e, "/joins", { action: "setpin", name: "Pop", pin: "2222" })).status, 403);
  assert.equal((await call(e, "/joins?key=adm", { action: "setpin", name: "pop", pin: "2222" })).status, 200);
  assert.ok((await (await call(e, "/auth", { action: "login", manager: "Pop", code: "2222" })).json()).token);
  assert.equal((await call(e, "/auth", { action: "login", manager: "Pop", code: "1111" })).status, 401);
  assert.equal((await call(e, "/join", { name: "NoPin", email: "n@x.com" })).status, 400);
});
