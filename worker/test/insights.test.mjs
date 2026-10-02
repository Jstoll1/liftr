// Insights: odds parsing, line log, movement, feed parsers, and the rule
// that a run never touches the slate, results or picks. Run: node --test worker/test
import { test } from "node:test";
import assert from "node:assert/strict";
import { sideOf, extractPicks, gamePicks, picksKey, outletRank, tidyNote, verifyQuote, parseRoster, fillPositions, parseGdelt, extractInjuries, gameInjuries, injuriesKey, searchName, parseBingNewsRss, parseGoogleNewsRss, filterNews, parseSummary, parseOdds, appendLineSample, lineMovement, parseInjuries, parseNews, runInsights, linesKey, briefKey } from "../src/insights.js";

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

test("Google News RSS parses, strips the source suffix, and drops ESPN, video and betting promos", () => {
  const xml = `<rss><channel>
    <item><title>Pitt's line reshuffled before Virginia Tech trip - Pittsburgh Post-Gazette</title><link>https://news.google.com/a1</link><pubDate>Tue, 29 Sep 2026 14:00:00 GMT</pubDate><source url="https://post-gazette.com">Pittsburgh Post-Gazette</source></item>
    <item><title>Pitt vs Virginia Tech odds, picks and prediction - Covers</title><link>https://news.google.com/a2</link><source url="https://covers.com">Covers</source></item>
    <item><title>Hokies QB update - ESPN</title><link>https://news.google.com/a3</link><source url="https://espn.com">ESPN</source></item>
    <item><title>WATCH: Pitt practice highlights - YouTube</title><link>https://news.google.com/a4</link><source url="https://youtube.com">YouTube</source></item>
    <item><title>Pitt&#39;s line reshuffled before Virginia Tech trip - Yahoo Sports</title><link>https://news.google.com/a5</link><source url="https://yahoo.com">Yahoo Sports</source></item>
  </channel></rss>`;
  const items = parseGoogleNewsRss(xml);
  assert.equal(items.length, 5);
  assert.equal(items[0].headline, "Pitt's line reshuffled before Virginia Tech trip");
  assert.equal(items[0].source, "Pittsburgh Post-Gazette");
  const kept = filterNews(items);
  assert.deepEqual(kept.map((n) => n.source), ["Pittsburgh Post-Gazette"]);
});

test("Bing News RSS unwraps the redirect link, keeps Instagram, drops TikTok", () => {
  const xml = `<rss><channel>
    <item><title>Hokies' defense braces for Pitt's run game</title><link>https://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.roanoke.com%2fsports%2fhokies-defense&amp;c=1</link><description>Virginia Tech has allowed 4.1 yards per carry.</description><pubDate>Tue, 29 Sep 2026 12:00:00 GMT</pubDate><News:Source>The Roanoke Times</News:Source></item>
    <item><title>Pitt locker room celebration</title><link>https://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fwww.tiktok.com%2f%40pittfb%2fvideo%2f1</link><News:Source>TikTok</News:Source></item>
    <item><title>Pitt football shares practice photos</title><link>https://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fwww.instagram.com%2fp%2fabc</link><News:Source>Instagram</News:Source></item>
  </channel></rss>`;
  const items = parseBingNewsRss(xml);
  assert.equal(items[0].link, "https://www.roanoke.com/sports/hokies-defense");
  assert.equal(items[0].source, "The Roanoke Times");
  assert.equal(items[0].blurb, "Virginia Tech has allowed 4.1 yards per carry.");
  assert.deepEqual(filterNews(items).map((n) => n.source), ["The Roanoke Times", "Instagram"]);
});

test("searchName strips poll ranks and parentheses", () => {
  assert.equal(searchName("#4 Miami"), "Miami");
  assert.equal(searchName("#11 LSU"), "LSU");
  assert.equal(searchName("Miami (OH)"), "Miami OH");
  assert.equal(searchName("Clemson"), "Clemson");
});

test("extractInjuries keeps only named players with a known status and dedupes", async () => {
  const items = [{ source: "On3", headline: "Two new players land on Pitt injury report vs Virginia Tech", blurb: "RB Ja'Kyrian Turner upgraded to probable; DE Zach Crothers doubtful." }];
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ players: [
    { name: "Ja'Kyrian Turner", pos: "RB", status: "PROBABLE", detail: "upgraded", source: "On3" },
    { name: "Zach Crothers", pos: "DE", status: "DOUBTFUL", detail: "", source: "On3" },
    { name: "Zach Crothers", pos: "DE", status: "DOUBTFUL", detail: "dupe", source: "On3" },
    { name: "Nobody", pos: "", status: "MAYBE", detail: "", source: "" },
  ] }) } }] }), { status: 200 });
  const r = await extractInjuries({ OPENAI_API_KEY: "k" }, "Pitt", items);
  assert.deepEqual(r.players.map((p) => `${p.name}:${p.status}`), ["Ja'Kyrian Turner:PROBABLE", "Zach Crothers:DOUBTFUL"]);
  assert.deepEqual(await extractInjuries({}, "Pitt", []), { players: [] });
});

test("gameInjuries caches a clean read and never caches a model failure", async () => {
  const kv = fakeKv();
  const rss = `<rss><channel><item><title>Pitt injury report: Turner probable</title><link>https://news.google.com/x</link><source url="https://on3.com">On3</source></item></channel></rss>`;
  globalThis.fetch = async (url) => /news\.google|bing\.com/.test(String(url)) ? new Response(rss, { status: 200 }) : new Response("nope", { status: 500 });
  const r = await gameInjuries({ LIFTR_KV: kv, OPENAI_API_KEY: "k" }, 5, game);
  assert.equal(r.error, "model 500");
  assert.ok(!kv.writes.includes(injuriesKey(5, 3)));
  globalThis.fetch = async (url) => /news\.google|bing\.com/.test(String(url)) ? new Response(rss, { status: 200 }) : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ players: [{ name: "T. Turner", pos: "RB", status: "PROBABLE", detail: "", source: "On3" }] }) } }] }), { status: 200 });
  const ok = await gameInjuries({ LIFTR_KV: kv, OPENAI_API_KEY: "k" }, 5, game);
  assert.equal(ok.away[0].name, "T. Turner");
  assert.ok(kv.writes.includes(injuriesKey(5, 3)));
});

test("parseGdelt maps the article list and its compact dates", () => {
  const items = parseGdelt({ articles: [{ url: "https://www.post-gazette.com/a", title: "Pitt&#39;s line settles", seendate: "20261001T140000Z", domain: "www.post-gazette.com" }, { url: "", title: "junk" }] });
  assert.deepEqual(items, [{ headline: "Pitt's line settles", source: "post-gazette.com", link: "https://www.post-gazette.com/a", blurb: null, published: "2026-10-01T14:00:00Z" }]);
  assert.deepEqual(parseGdelt(null), []);
});

test("every injury row gets a position: prose roles, roster lookup, then the model's own", async () => {
  const items = [{ source: "On3", headline: "Pitt injury report", blurb: "Tight end Brandon Lagg is doubtful. Zach Crothers doubtful. Kenny Johnson questionable." }];
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ players: [
    { name: "Brandon Lagg", pos: "", status: "DOUBTFUL", detail: "hamstring", source: "On3" },
    { name: "Zach Crothers", pos: "", status: "DOUBTFUL", detail: "", source: "On3" },
    { name: "Kenny Johnson", pos: "ot", status: "QUESTIONABLE", detail: "", source: "On3" },
  ] }) } }] }), { status: 200 });
  const r = await extractInjuries({ OPENAI_API_KEY: "k" }, "Pitt", items);
  assert.deepEqual(r.players.map((p) => p.pos), ["TE", "", "OL"]);
  const roster = parseRoster({ athletes: [{ position: "defense", items: [{ fullName: "Zach Crothers", position: { abbreviation: "DE" } }, { fullName: "A. Smith", position: { abbreviation: "S" } }, { fullName: "B. Smith", position: { abbreviation: "CB" } }] }] });
  const filled = fillPositions([...r.players, { name: "Smith", pos: "", status: "OUT", detail: "" }, { name: "Joe Nobody", pos: "", status: "OUT", detail: "the safety" }], roster);
  assert.deepEqual(filled.map((p) => p.pos), ["TE", "DE", "OL", "", "S"]);
});

test("verifyQuote keeps only sentences really in the articles and attaches that article's link", () => {
  const items = [
    { source: "On3", link: "https://on3.com/a", headline: "Ohio State injury report", blurb: "Jake Stoll suffered a sprained ankle and has not practiced. Another line here." },
    { source: "SI", link: "https://si.com/b", headline: "Buckeyes notes", blurb: "Nothing about him." },
  ];
  const ok = verifyQuote(items, "Jake Stoll suffered a sprained ankle and has not practiced.", "Jake Stoll");
  assert.deepEqual(ok, { quote: "Jake Stoll suffered a sprained ankle and has not practiced.", link: "https://on3.com/a", source: "On3" });
  // Curly quotes and spacing do not break the match.
  assert.ok(verifyQuote(items, "  Jake   Stoll suffered a sprained ankle and has not practiced ", "Jake Stoll"));
  // A paraphrase is dropped, then the sentence naming the player stands in.
  assert.equal(verifyQuote(items, "Stoll hurt his ankle and will sit", "Jake Stoll").quote, "Jake Stoll suffered a sprained ankle and has not practiced");
  // A player the text never names with a status gets no quote at all.
  assert.equal(verifyQuote(items, "Made up sentence about Bob Nobody being out", "Bob Nobody"), null);
  // Entities decode, stray spaces before commas go, and a stand-in that
  // would start mid-list is trimmed to a capitalised word near the name.
  const messy = [{ source: "SI", link: "https://si.com/c", headline: "Report", blurb: "Jones , Williams &#34;Snook&#34; Peterkin Kahlil Smith Bryan Keys There were three offensive linemen on the list, though Cunningham was added later after an injury in practice" }];
  const r = verifyQuote(messy, "", "Montavious Cunningham");
  assert.ok(r && r.quote.startsWith("…") && !r.quote.includes("&#") && r.quote.includes("Cunningham was added later"), r?.quote);
  assert.ok(r.quote.indexOf("Cunningham") <= 72, r.quote);
  assert.equal(verifyQuote(messy, "Jones , Williams &#34;Snook&#34; Peterkin Kahlil Smith", "Kahlil Smith").quote, 'Jones, Williams "Snook" Peterkin Kahlil Smith');
});

test("tidyNote keeps notes with a concrete fact and drops status restatements and opinion", () => {
  assert.equal(tidyNote("Terry went down with an injury in the second quarter against Maryland."), "Terry went down with an injury in the second quarter against Maryland.");
  assert.equal(tidyNote("Dehnicke went to the blue medical tent and did not return to the game after a head injury against Indiana."), "Dehnicke went to the blue medical tent and did not return to the game after a head injury against Indiana.");
  assert.equal(tidyNote("Turner is listed as doubtful, indicating he may not play."), null);
  assert.equal(tidyNote("Brookins' availability is uncertain as the game approaches."), null);
  assert.equal(tidyNote("Greene's potential return is significant for the offense."), null);
  assert.equal(tidyNote(""), null);
});

test("gameInjuries answers a stale cached read at once and refreshes behind the response", async () => {
  const kv = fakeKv();
  const old = { at: Date.now() - 5 * 3600 * 1000, site: true, away: [{ name: "T. Turner", pos: "RB", status: "PROBABLE", detail: "", source: "On3" }], home: [], sources: { away: [], home: [] } };
  await kv.put(injuriesKey(5, 3), JSON.stringify(old));
  let refreshed = null;
  globalThis.fetch = async (url) => /raw\.githubusercontent/.test(String(url)) ? new Response(JSON.stringify({ games: { 3: { injuries: { away: [{ headline: "Pitt injury report", blurb: "RB T. Turner is out with a knee injury.", source: "On3", link: "https://on3.com/a" }, { headline: "Second report", blurb: "T. Turner will not play.", source: "SI", link: "https://si.com/b" }], home: [] } } } }), { status: 200 })
    : /openai/.test(String(url)) ? new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ players: [{ name: "T. Turner", pos: "RB", status: "OUT", detail: "knee", source: "On3", quote: "RB T. Turner is out with a knee injury.", note: "" }] }) } }] }), { status: 200 })
    : new Response("nope", { status: 500 });
  const ctx = { waitUntil: (p) => { refreshed = p; } };
  const r = await gameInjuries({ LIFTR_KV: kv, OPENAI_API_KEY: "k" }, 5, game, null, ctx);
  assert.equal(r.stale, true);
  assert.equal(r.away[0].status, "PROBABLE");
  assert.ok(refreshed, "refresh scheduled");
  await refreshed;
  const now = await kv.get(injuriesKey(5, 3), "json");
  assert.equal(now.away[0].status, "OUT");
  assert.ok(!now.refreshing && !now.stale);
  // Fresh now: served straight from the cache, no refresh.
  refreshed = null;
  const again = await gameInjuries({ LIFTR_KV: kv, OPENAI_API_KEY: "k" }, 5, game, null, ctx);
  assert.equal(again.away[0].status, "OUT"); assert.equal(refreshed, null);
});

test("sideOf maps a free-text team name to a side and refuses ambiguity", () => {
  const g = { away: "Pitt", awayShort: "Pitt", home: "Virginia Tech", homeShort: "VT" };
  assert.equal(sideOf(g, "Pitt"), "away");
  assert.equal(sideOf(g, "Pittsburgh Panthers"), null);
  assert.equal(sideOf(g, "Virginia Tech Hokies"), "home");
  assert.equal(sideOf(g, "VT"), "home");
  assert.equal(sideOf(g, "Virginia"), null);
  assert.equal(sideOf(g, "Pitt and Virginia Tech"), null);
  assert.ok(outletRank("CBS Sports") < outletRank("Some Blog"));
});

test("extractPicks keeps one validated pick per outlet and picker, reputable first, with the piece's link", async () => {
  const g = { id: 3, away: "Pitt", awayShort: "Pitt", home: "Virginia Tech", homeShort: "VT", favorite: "Pitt", spread: 3.5 };
  const items = [{ source: "fansided", headline: "Pitt vs Virginia Tech prediction", link: "https://f.com/1", blurb: "We like the Hokies." }, { source: "CBS Sports", headline: "Pitt vs. Virginia Tech picks", link: "https://cbs.com/2", blurb: "Pick: Pitt -3.5. Score 27-24." }];
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ picks: [
    { outlet: "FanSided", picker: "", team: "Virginia Tech", side: "ATS", line: "+3.5", score: "", reason: "home dog" },
    { outlet: "CBS Sports", picker: "", team: "Pitt", side: "BOTH", line: "-3.5", score: "27-24", reason: "better quarterback" },
    { outlet: "CBS Sports", picker: "", team: "Pitt", side: "ATS", line: "-3.5", score: "", reason: "dupe" },
    { outlet: "Nowhere", picker: "", team: "Ohio State", side: "SU", line: "", score: "", reason: "wrong game" },
  ] }) } }] }), { status: 200 });
  const r = await extractPicks({ OPENAI_API_KEY: "k" }, g, items);
  assert.deepEqual(r.picks.map((p) => `${p.outlet}:${p.side}:${p.type}:${p.line}:${p.score}:${p.link}`), ["CBS Sports:away:BOTH:-3.5:27-24:https://cbs.com/2", "FanSided:home:ATS:+3.5::https://f.com/1"]);
  const kv = fakeKv();
  globalThis.fetch = async (url) => /raw\.githubusercontent/.test(String(url)) ? new Response(JSON.stringify({ games: { 3: { picks: items } } }), { status: 200 }) : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ picks: [{ outlet: "CBS Sports", picker: "", team: "Pitt", side: "ATS", line: "-3.5", score: "", reason: "" }] }) } }] }), { status: 200 });
  const first = await gamePicks({ LIFTR_KV: kv, OPENAI_API_KEY: "k" }, 5, g);
  assert.equal(first.picks.length, 1); assert.ok(kv.writes.includes(picksKey(5, 3)));
});
