import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

// The slate editor's warning: who has picked each game, names only.
const store = new Map();
const kv = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => store.set(k, v), delete: async (k) => store.delete(k), list: async () => ({ keys: [], list_complete: true }) };
store.set("picks:w5:Curt", JSON.stringify({ picks: { 1: { team: "LSU", mode: "ATS" }, 2: { team: "Iowa", mode: "SU" } } }));
store.set("picks:w5:Dewitt", JSON.stringify({ picks: { 1: { team: "Florida", mode: "ATS" } } }));
const env = { LIFTR_KV: kv, SLATE_KEY: "slatekey", ARCHIVE_LOG_KEY: "appkey" };
const call = (q) => worker.fetch(new Request(`https://w.test/games?pickers=1&week=5${q}`), env, { waitUntil() {} });

test("pickers: names per game, no picks", async () => {
  const r = await call("&key=slatekey");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.pickers, { 1: ["Curt", "Dewitt"], 2: ["Curt"] });
  assert.ok(!JSON.stringify(body).includes("LSU") && !JSON.stringify(body).includes("ATS"));
});
test("pickers: needs a key", async () => {
  assert.equal((await call("&key=nope")).status, 403);
  assert.equal((await call("")).status, 403);
});

test("audit: flags picks whose team is not in their game, owner key only, no teams", async () => {
  store.set("games:w5", JSON.stringify({ week: 5, games: [{ id: 1, away: "LSU", home: "Florida", awayShort: "LSU", homeShort: "UF" }, { id: 2, away: "Army", home: "Navy", awayShort: "ARMY", homeShort: "NAVY" }] }));
  const r = await worker.fetch(new Request("https://w.test/games?audit=1&week=5&key=appkey"), env, { waitUntil() {} });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.checked, 3);
  assert.deepEqual(body.problems, [{ manager: "Curt", slot: 2, game: "ARMY @ NAVY", why: "the saved team is not in this game" }]);
  assert.ok(!JSON.stringify(body).includes("Iowa"));
  // Card state per player: counts, tiebreaker and lock flags, never a team.
  const curt = body.cards.find((c) => c.name === "Curt"), dew = body.cards.find((c) => c.name === "Dewitt");
  assert.deepEqual([curt.picks, curt.of, curt.tb, dew.picks, dew.tb], [2, 2, false, 1, false]);
  assert.deepEqual(dew.slots, [true, false]);
  assert.equal((await worker.fetch(new Request("https://w.test/games?audit=1&week=5&key=slatekey"), env, { waitUntil() {} })).status, 403);
});

import { slateRenumbering } from "../src/index.js";
test("slate guard: a published game keeps its number, numbers never move", () => {
  const a = { id: 1, awayId: 1, homeId: 2, awayShort: "A", homeShort: "B" }, b = { id: 2, awayId: 3, homeId: 4, awayShort: "C", homeShort: "D" }, c = { awayId: 5, homeId: 6, awayShort: "E", homeShort: "F" };
  assert.equal(slateRenumbering(null, [a]), null);
  assert.equal(slateRenumbering([a, b], [a, b, { ...c, id: 3 }]), null);
  assert.equal(slateRenumbering([a, b], [b, { ...c, id: 3 }]), null); // removing a game is fine
  assert.match(slateRenumbering([a, b], [{ ...c, id: 1 }, { ...a, id: 2 }, { ...b, id: 3 }]), /A @ B is G1/);
  assert.match(slateRenumbering([a, b], [b, { ...c, id: 1 }]), /G1 was A @ B/);
});
