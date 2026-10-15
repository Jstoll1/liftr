// ESPN analysts' picks from the NFL feed become expert picks as they are,
// with no model step, and a game without them is unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { gamePicks, espnPicks } from "../src/insights.js";

const kv = () => { const m = new Map(); return { get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, String(v)); } }; };
const game = { id: 1, away: "Seattle Seahawks", home: "Denver Broncos", awayShort: "Seahawks", homeShort: "Broncos", kickoff: new Date(Date.now() + 864e5).toISOString() };
const feed = { games: { 1: { picks: [], espn: { link: "https://www.espn.com/nfl/picks", picks: [{ name: "Matt Bowen", record: "47-30", side: "away" }, { name: "Pamela Maldonado", record: "48-30", side: "home" }, { name: "Bad", side: "nope" }] } } } };
globalThis.fetch = async (url) => String(url).endsWith("/w6.json") ? new Response(JSON.stringify(feed), { status: 200 }) : new Response("", { status: 404 });

test("ESPN analysts come through as straight-up picks with their records", async () => {
  const r = await gamePicks({ LIFTR_KV: kv(), FEEDS_URL: "https://x.test/feeds" }, 6, game);
  assert.equal(r.error, null);
  assert.deepEqual(r.picks.map((p) => [p.outlet, p.picker, p.side, p.type]), [["ESPN", "Matt Bowen", "away", "SU"], ["ESPN", "Pamela Maldonado", "home", "SU"]]);
  assert.equal(r.picks[0].reason, "Season record 47-30");
});

test("no ESPN block, no ESPN picks", () => {
  assert.deepEqual(espnPicks(null), []);
  assert.deepEqual(espnPicks({ picks: [] }), []);
});
