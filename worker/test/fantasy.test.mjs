import test from "node:test";
import assert from "node:assert/strict";
import { buildCurrentSeason, pullCurrentSeason, CURRENT_KEY, STATUS_KEY, buildLiveWeek, inNflWindow } from "../src/fantasy.js";

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

test("buildLiveWeek: this week's matchups with starters in lineup order, bench apart, live totals", () => {
  const p = (id, name, pos, slot, pts, team) => ({ lineupSlotId: slot, playerPoolEntry: { appliedStatTotal: pts, player: { id, fullName: name, defaultPositionId: pos, proTeamId: team } } });
  const lw = buildLiveWeek({
    status: { currentMatchupPeriod: 11 },
    teams: [{ id: 1, owners: ["a"], name: "Burrow's Naberhood", abbrev: "JS", record: { overall: { wins: 6, losses: 4 } } }, { id: 2, owners: ["b"], location: "Team", nickname: "Two" }],
    schedule: [
      { id: 9, matchupPeriodId: 10, winner: "HOME", home: { teamId: 1, totalPoints: 100 }, away: { teamId: 2, totalPoints: 90 } },
      { id: 10, matchupPeriodId: 11, winner: "UNDECIDED",
        home: { teamId: 1, totalPointsLive: 42.5, rosterForCurrentScoringPeriod: { entries: [p(11, "Bench Guy", 3, 20, 9, 2), p(12, "Joe QB", 1, 0, 21.4, 4), p(13, "Kicker", 5, 17, 3, 12), p(14, "Wide One", 3, 4, 18.1, 15)] } },
        away: { teamId: 2, totalPoints: 30 } },
    ],
  }, { a: "Jake", b: "Curt" });
  assert.equal(lw.week, 11);
  assert.equal(lw.matchups.length, 1);
  const h = lw.matchups[0].home;
  assert.equal(h.owner, "Jake");
  assert.equal(h.points, 42.5);
  assert.equal(h.record, "6-4");
  assert.deepEqual(h.starters.map((x) => x.slot), ["QB", "WR", "K"]);
  assert.equal(h.starters[0].nfl, "CIN");
  assert.deepEqual(h.bench.map((x) => x.name), ["Bench Guy"]);
  assert.equal(lw.matchups[0].away.name, "Team Two");
  assert.equal(lw.matchups[0].final, false);
});

test("inNflWindow: Sunday afternoon and Monday night yes, Wednesday no", () => {
  assert.equal(inNflWindow(Date.parse("2026-11-22T19:00:00Z")), true);  // Sun 2 PM ET
  assert.equal(inNflWindow(Date.parse("2026-11-24T02:00:00Z")), true);  // Mon 9 PM ET
  assert.equal(inNflWindow(Date.parse("2026-11-25T17:00:00Z")), false); // Wed noon ET
});
