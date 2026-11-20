import test from "node:test";
import assert from "node:assert/strict";
import { buildCurrentSeason, pullCurrentSeason, CURRENT_KEY, STATUS_KEY } from "../src/fantasy.js";

test("buildCurrentSeason ranks by wins then points and lists decided games", () => {
  const league = {
    settings: { scheduleSettings: { matchupPeriodCount: 13 } },
    teams: [{ id: 1, owners: ["a"] }, { id: 2, owners: ["b"] }],
    schedule: [
      { matchupPeriodId: 1, winner: "HOME", home: { teamId: 1, totalPoints: 120 }, away: { teamId: 2, totalPoints: 100 } },
      { matchupPeriodId: 2, winner: "AWAY", home: { teamId: 1, totalPoints: 90 }, away: { teamId: 2, totalPoints: 95 } },
      { matchupPeriodId: 3, winner: "UNDECIDED", home: { teamId: 1, totalPoints: 0 }, away: { teamId: 2, totalPoints: 0 } },
    ],
  };
  const cur = buildCurrentSeason(league, { a: "Curt", b: "Logan" }, 2026, 0);
  assert.equal(cur.weeksPlayed, 2);
  assert.equal(cur.standings[0].owner, "Curt"); // 1-1, more points
  assert.deepEqual(cur.results, ["W1: Curt 120 def. Logan 100", "W2: Logan 95 def. Curt 90"]);
});

test("buildCurrentSeason refuses an unknown owner", () => {
  assert.throws(() => buildCurrentSeason({ teams: [{ id: 1, owners: ["x"] }] }, {}, 2026));
});


test("buildCurrentSeason keeps record leaderboards for the live season", () => {
  const league = { settings: { scheduleSettings: { matchupPeriodCount: 13 } }, teams: [{ id: 1, owners: ["a"] }, { id: 2, owners: ["b"] }],
    schedule: [{ matchupPeriodId: 1, winner: "HOME", home: { teamId: 1, totalPoints: 201.5 }, away: { teamId: 2, totalPoints: 90 } }] };
  const cur = buildCurrentSeason(league, { a: "Curt", b: "Logan" }, 2026, 0);
  assert.equal(cur.records.highestWeeklyScores[0], "Curt 201.5 in 2026 week 1 vs Logan");
  assert.match(cur.records.biggestWins[0], /Curt over Logan by 111.5/);
});

// The league is public: a pull needs only the league id; saved cookies are
// used if set and dropped when ESPN refuses them; every pull leaves a status.
const league = { settings: { scheduleSettings: { matchupPeriodCount: 13 } }, teams: [{ id: 1, owners: ["a"] }, { id: 2, owners: ["b"] }],
  schedule: [{ matchupPeriodId: 1, winner: "HOME", home: { teamId: 1, totalPoints: 120 }, away: { teamId: 2, totalPoints: 100 } }] };
const kv = () => { const m = new Map(); return { m, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); } }; };
const withFetch = async (fake, fn) => { const real = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = real; } };

test("pullCurrentSeason: a public league needs no cookies", async () => {
  const KV = kv(), seen = [];
  const r = await withFetch(async (u, o) => { seen.push(o.headers.Cookie || null); return new Response(JSON.stringify(league)); },
    () => pullCurrentSeason({ ESPN_LEAGUE_ID: "1", LIFTR_KV: KV }, { a: "A", b: "B" }, { force: true }));
  assert.equal(r.how, "public");
  assert.deepEqual(seen, [null]);
  assert.ok(KV.m.has(CURRENT_KEY));
  assert.equal(JSON.parse(KV.m.get(STATUS_KEY)).ok, true);
});

test("pullCurrentSeason: refused cookies fall back to the public read", async () => {
  const KV = kv(), seen = [];
  const r = await withFetch(async (u, o) => { seen.push(!!o.headers.Cookie); return o.headers.Cookie ? new Response("", { status: 401 }) : new Response(JSON.stringify(league)); },
    () => pullCurrentSeason({ ESPN_LEAGUE_ID: "1", ESPN_S2: "x", ESPN_SWID: "{y}", LIFTR_KV: KV }, { a: "A", b: "B" }, { force: true }));
  assert.deepEqual(seen, [true, false]);
  assert.match(r.how, /public/);
});

test("pullCurrentSeason: a failed pull is recorded", async () => {
  const KV = kv();
  await assert.rejects(withFetch(async () => new Response("", { status: 500 }), () => pullCurrentSeason({ ESPN_LEAGUE_ID: "1", LIFTR_KV: KV }, { a: "A", b: "B" }, { force: true })));
  const st = JSON.parse(KV.m.get(STATUS_KEY));
  assert.equal(st.ok, false);
  assert.match(st.error, /500/);
});
