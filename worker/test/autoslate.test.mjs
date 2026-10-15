// The NFL Worker keeps each week's slate itself from ESPN. The college
// Worker never does: same code, SPORT unset.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const kv = () => {
  const m = new Map();
  return { m, get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [] }) };
};
const H = 3600e3;
const ev = (id, a, h, spread, favHome, hrs, odds = true) => ({ id: String(id), date: new Date(Date.now() + hrs * H).toISOString(), competitions: [{
  competitors: [{ homeAway: "away", team: { id: String(a), displayName: `Away ${a}`, shortDisplayName: `A${a}` } }, { homeAway: "home", team: { id: String(h), displayName: `Home ${h}`, shortDisplayName: `H${h}` } }],
  odds: odds ? [{ spread: favHome ? -spread : spread, homeTeamOdds: { favorite: favHome }, awayTeamOdds: { favorite: !favHome } }] : [], broadcasts: [{ names: ["CBS"] }] }] });
let board, nflCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes("/football/nfl/scoreboard")) nflCalls++;
  if (String(url).includes("/football/nfl/scoreboard")) return new Response(JSON.stringify(board), { status: 200 });
  if (String(url).includes("college-football")) throw new Error("college ESPN must not be called");
  return realFetch(url);
};
const call = (env, path) => worker.fetch(new Request(`https://w.example${path}`), env, { waitUntil() {} }).then((r) => r.json());

test("NFL: builds the week from ESPN, Monday night as tiebreaker, no-line games left out", async () => {
  board = { week: { number: 8 }, season: { type: 2 }, events: [ev(1, 21, 19, 6.5, false, 30), ev(2, 12, 13, 9.5, false, 80), ev(3, 8, 9, 1.5, true, 80, false), ev(4, 25, 26, 2.5, true, 104)] };
  const env = { SPORT: "nfl", LIFTR_KV: kv(), DEFAULT_ROSTER: "Ben,Nathan,Jake" };
  const r = await call(env, "/games");
  assert.equal(r.week, 8);
  assert.equal(r.games.length, 3);
  assert.deepEqual(r.games.filter((g) => g.tiebreakerGame).map((g) => g.homeShort), ["H26"]);
  const eagles = r.games.find((g) => g.awayId === 21);
  assert.equal(eagles.favorite, "Away 21");
  assert.equal(eagles.spread, 6.5);
  assert.ok(eagles.kickoffLabel.endsWith("ET"));
  assert.equal(JSON.parse(env.LIFTR_KV.m.get("weeks")).current, 8);
});

test("NFL: a line follows ESPN until the first pick on that game, then holds", async () => {
  board = { week: { number: 8 }, season: { type: 2 }, events: [ev(1, 21, 19, 6.5, false, 30), ev(2, 12, 13, 9.5, false, 80), ev(4, 25, 26, 2.5, true, 104)] };
  const env = { SPORT: "nfl", LIFTR_KV: kv(), DEFAULT_ROSTER: "Ben,Nathan,Jake" };
  const first = await call(env, "/games");
  const chiefs = first.games.find((g) => g.awayId === 12);
  // Ben picks the Chiefs game; then both lines move at ESPN.
  await env.LIFTR_KV.put("picks:w8:Ben", JSON.stringify({ picks: { [chiefs.id]: { team: "Away 12", mode: "ATS" } }, tiebreaker: "" }));
  board.events = [ev(1, 21, 19, 7.5, false, 30), ev(2, 12, 13, 11, false, 80), ev(3, 8, 9, 3, true, 80), ev(4, 25, 26, 2.5, true, 104)];
  env.LIFTR_KV.m.delete("autoslate:at");
  const r = await call(env, "/games");
  assert.equal(r.games.find((g) => g.awayId === 21).spread, 7.5);   // nobody picked it: follows ESPN
  assert.equal(r.games.find((g) => g.awayId === 12).spread, 9.5);   // picked: held
  assert.equal(r.games.find((g) => g.awayId === 12).id, chiefs.id); // ids never shift
  assert.equal(r.games.length, 4);                                  // the new line came in
});

test("NFL: throttled to once per 15 minutes between schedules", async () => {
  board = { week: { number: 8 }, season: { type: 2 }, events: [ev(1, 21, 19, 6.5, false, 30)] };
  const env = { SPORT: "nfl", LIFTR_KV: kv(), DEFAULT_ROSTER: "Ben" };
  await call(env, "/games");
  board.events = [ev(1, 21, 19, 9, false, 30)];
  const r = await call(env, "/games");
  assert.equal(r.games[0].spread, 6.5);
});

// (The tests share one module, so in-memory caches from the NFL tests can
// answer this read; in production each Worker is its own isolate. What
// matters is that college writes nothing and asks ESPN for nothing.)
test("College: never builds a slate and never calls ESPN for one", async () => {
  board = { week: { number: 8 }, season: { type: 2 }, events: [ev(1, 21, 19, 6.5, false, 30)] };
  const env = { LIFTR_KV: kv() };
  const before = nflCalls;
  await call(env, "/games");
  assert.equal(nflCalls, before);
  assert.equal(env.LIFTR_KV.m.size, 0);
});
