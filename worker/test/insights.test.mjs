// Insights: odds parsing, line log, movement, feed parsers, and the rule
// that a run never touches the slate, results or picks. Run: node --test worker/test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSummary, parseOdds, appendLineSample, lineMovement, parseInjuries, parseNews, runInsights, linesKey, briefKey } from "../src/insights.js";

const game = { id: 3, away: "Coastal Carolina", home: "Georgia Southern", awayShort: "Coastal", homeShort: "GA Southern", awayId: 324, homeId: 290, favorite: "Georgia Southern", spread: 2.5, kickoff: "2099-10-03T23:00:00Z", kickoffLabel: "Sat 7:00 PM ET" };

test("parseOdds reads ESPN's home-relative spread and favourite flags", () => {
  assert.deepEqual(parseOdds({ odds: [{ details: "GASO -3.5", spread: -3.5, overUnder: 55.5, homeTeamOdds: { favorite: true }, provider: { name: "ESPN BET" } }] }),
    { details: "GASO -3.5", spread: 3.5, favoriteSide: "home", overUnder: 55.5, provider: "ESPN BET" });
  assert.equal(parseOdds({ odds: [{ spread: 4 }] }).favoriteSide, "away");
  assert.equal(parseOdds({}), null);
});

test("appendLineSample skips an unchanged line inside six hours and keeps the last forty", () => {
  const s = { spread: 3.5, favoriteSide: "home", overUnder: 55 };
  let log = appendLineSample({}, 3, s, 1000);
  log = appendLineSample(log, 3, s, 1000 + 3600 * 1000);
  assert.equal(log[3].length, 1);
  log = appendLineSample(log, 3, { ...s, spread: 4 }, 2000);
  assert.equal(log[3].length, 2);
  log = appendLineSample(log, 3, s, 1000 + 7 * 3600 * 1000);
  assert.equal(log[3].length, 3);
  for (let i = 0; i < 50; i++) log = appendLineSample(log, 3, { ...s, spread: i }, 1e12 + i);
  assert.equal(log[3].length, 40);
});

test("lineMovement is signed from the sealed favourite and names who it moved toward", () => {
  const mv = lineMovement(game, [
    { at: 1, spread: 2.5, favoriteSide: "home", overUnder: 50 },
    { at: 2, spread: 4, favoriteSide: "home", overUnder: 51 },
  ]);
  assert.equal(mv.delta, 1.5);
  assert.equal(mv.toward, "GA Southern");
  assert.equal(mv.nowFavorite, "GA Southern");
  assert.deepEqual(mv.series, [2.5, 4]);
  // Flipped: the dog became the favourite by a point.
  const flip = lineMovement(game, [{ at: 3, spread: 1, favoriteSide: "away", overUnder: null }]);
  assert.equal(flip.delta, -3.5);
  assert.equal(flip.toward, "Coastal");
  assert.equal(flip.nowFavorite, "Coastal");
  assert.equal(lineMovement(game, []), null);
});

test("feed parsers tolerate both ESPN shapes and drop junk", () => {
  const flat = { injuries: [{ athlete: { displayName: "A. Back", position: { abbreviation: "RB" } }, status: "Out", shortComment: "knee" }, { athlete: {} }] };
  assert.deepEqual(parseInjuries(flat), [{ name: "A. Back", pos: "RB", status: "Out", detail: "knee", date: null }]);
  const grouped = { injuries: [{ injuries: [{ athlete: { fullName: "B. Wide" }, type: { description: "Questionable" }, details: { detail: "ankle" } }] }] };
  assert.equal(parseInjuries(grouped)[0].status, "Questionable");
  assert.deepEqual(parseNews({ articles: [{ headline: "H", description: "d", published: "p", links: { web: { href: "u" } } }, { nope: 1 }] }),
    [{ headline: "H", blurb: "d", published: "p", link: "u" }]);
  assert.deepEqual(parseNews(null), []);
});

// A fake KV that records every key written.
function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const writes = [];
  return {
    store, writes,
    get: async (k, t) => { const v = store.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
    put: async (k, v) => { writes.push(k); store.set(k, v); },
    list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  };
}

test("runInsights writes only line, brief and log keys, never the slate, results or picks", async () => {
  const kv = fakeKv({ "games:w5": { games: [game] } });
  const env = { LIFTR_KV: kv }; // no OPENAI_API_KEY: brief summary is empty, still stored
  globalThis.fetch = async () => new Response(JSON.stringify({ injuries: [], articles: [] }), { status: 200 });
  const deps = {
    currentWeek: async () => 5,
    readSlate: async (e, w) => e.LIFTR_KV.get(`games:w${w}`, "json"),
    liveGames: async () => ({ games: [{ id: 3, found: true, eventId: "401", odds: { spread: 4, favoriteSide: "home", overUnder: 55 } }] }),
  };
  const r = await runInsights(env, deps, {});
  assert.equal(r.sampled, 1);
  assert.equal(r.briefs, 1);
  const allowed = (k) => k === linesKey(5) || k === briefKey(5, 3) || k === "insights:log" || k.startsWith("feedcache:");
  assert.ok(kv.writes.every(allowed), `unexpected writes: ${kv.writes.filter((k) => !allowed(k)).join(", ")}`);
  const slate = JSON.parse(kv.store.get("games:w5"));
  assert.equal(slate.games[0].spread, 2.5, "sealed spread untouched");
  const brief = JSON.parse(kv.store.get(briefKey(5, 3)));
  assert.equal(brief.movement.now, 4);
  assert.equal(brief.summaryError, "no model key");
});

test("runInsights does nothing once the week has kicked off", async () => {
  const kv = fakeKv({ "games:w5": { games: [{ ...game, kickoff: "2000-01-01T00:00:00Z" }] } });
  const r = await runInsights({ LIFTR_KV: kv }, { currentWeek: async () => 5, readSlate: async (e, w) => e.LIFTR_KV.get(`games:w${w}`, "json"), liveGames: async () => ({ games: [] }) }, {});
  assert.equal(r.skipped, 1);
  assert.equal(kv.writes.length, 0);
});

test("parseSummary pulls records, ATS, FPI, weather, venue and leaders from ESPN's game summary", () => {
  const data = {
    header: { competitions: [{ competitors: [
      { homeAway: "away", team: { id: "324" }, record: [{ type: "total", summary: "3-1" }, { type: "road", summary: "1-1" }] },
      { homeAway: "home", team: { id: "290" }, record: [{ type: "total", summary: "2-2" }, { type: "home", summary: "2-0" }] },
    ] }] },
    againstTheSpread: [{ team: { id: "324" }, records: [{ type: "overall", summary: "3-1-0" }] }, { team: { id: "290" }, records: [{ type: "overall", summary: "1-3-0" }] }],
    predictor: { homeTeam: { gameProjection: "58.4" }, awayTeam: { gameProjection: "41.6" } },
    weather: { displayValue: "Partly cloudy", temperature: 74, precipitation: 20 },
    gameInfo: { venue: { fullName: "Paulson Stadium", address: { city: "Statesboro", state: "GA" }, indoor: false } },
    leaders: [{ team: { id: "290", homeAway: "home" }, leaders: [{ displayName: "Passing Yards", leaders: [{ displayValue: "812 YDS, 7 TD", athlete: { displayName: "J. French" } }] }] }],
  };
  const g = parseSummary(data, game);
  assert.equal(g.records.away.overall, "3-1");
  assert.equal(g.records.home.split, "2-0");
  assert.deepEqual(g.ats, { away: "3-1-0", home: "1-3-0" });
  assert.deepEqual(g.fpi, { home: 58, away: 42 });
  assert.equal(g.weather.temp, 74);
  assert.equal(g.venue.city, "Statesboro, GA");
  assert.deepEqual(g.leaders.home, [{ cat: "Passing Yards", name: "J. French", line: "812 YDS, 7 TD" }]);
  assert.deepEqual(g.leaders.away, []);
  assert.equal(parseSummary(null, game), null);
});
