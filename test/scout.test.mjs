// The scouting report engine, against the app's own scoring rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Scout = require("../scout.js");
// The app's scoring, taken from app.js so the test can't drift from it.
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const grab = (name) => app.slice(app.indexOf(`function ${name}(`), app.indexOf("\n}\n", app.indexOf(`function ${name}(`)) + 2);
const { scorePick } = new Function(`${grab("pointValue")}\n${grab("resultOutcome")}\n${grab("scorePick")}\nreturn { scorePick };`)();

const { phi, favWinP, worth } = Scout._internals;

test("worth of a pick follows the spread", () => {
  assert.ok(Math.abs(phi(0) - 0.5) < 1e-6);
  const g = { spread: 3.5, favorite: "A", home: "A", away: "B" };
  assert.ok(Math.abs(favWinP(g) - 0.592) < 0.005);
  assert.equal(worth(g, "ats"), 1);
  assert.ok(worth(g, "fav") < 1);           // a favorite to win is never worth more than the spread
  assert.ok(worth(g, "dog") > 1.2);         // a close underdog to win is the best value
  assert.ok(worth({ ...g, spread: 13.5 }, "dog") < 1);
});

// Ten weeks of ten games; "Fav" always takes favorites to win, "Dog" the
// underdog outright in close games and spreads otherwise.
const names = ["Fav", "Dog", "Mid"];
const season = { season: {} };
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let w = 1; w <= 10; w++) {
  const games = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, away: `A${w}${i}`, home: `H${w}${i}`, favorite: `H${w}${i}`, spread: [2.5, 3.5, 6, 7, 10.5, 13.5, 1.5, 4, 20, 9][i] }));
  const results = {}, picks = { Fav: { picks: {} }, Dog: { picks: {} }, Mid: { picks: {} } };
  for (const g of games) {
    const margin = g.spread + (rnd() * 2 - 1) * 26; // home margin
    results[g.id] = { homeScore: 30 + Math.max(0, Math.round(margin)), awayScore: 30 + Math.max(0, Math.round(-margin)) };
    picks.Fav.picks[g.id] = { team: g.home, mode: "SU" };
    picks.Dog.picks[g.id] = g.spread <= 6 ? { team: g.away, mode: "SU" } : { team: g.home, mode: "ATS" };
    if (g.id !== 5) picks.Mid.picks[g.id] = { team: rnd() < .5 ? g.home : g.away, mode: rnd() < .5 ? "SU" : "ATS" };
  }
  season.season[w] = { games, results, picks };
}
const S = Scout.build({ season, log: [], names, scorePick });

test("report totals add up to the app's scoring", () => {
  const r = S.report("Fav");
  let total = 0;
  for (const wk of Object.values(season.season)) for (const g of wk.games) total += scorePick(g, wk.picks.Fav.picks[g.id], wk.results[g.id]);
  assert.equal(r.scored, total);
  assert.equal(r.picks, 100);
  assert.ok(Math.abs(r.luck - (r.scored - r.expected)) < 1e-9);
});

test("the favorites-for-1 habit is called out; the close-underdog habit is a strength", () => {
  const fav = S.report("Fav"), dog = S.report("Dog");
  assert.ok(fav.insights.some((x) => x.key === "fav1" && x.tone === "weak"));
  assert.ok(fav.insights.some((x) => x.key === "value" && x.tone === "weak"));
  assert.ok(dog.all.some((x) => x.key === "dogs" && x.tone === "strong"));
  assert.ok(dog.expected > fav.expected);
});

test("blanks are counted; every shown insight carries its evidence", () => {
  const mid = S.report("Mid");
  assert.ok(mid.all.some((x) => x.key === "missed" && /10 games/.test(x.evidence)));
  for (const n of names) for (const x of S.report(n).insights) { assert.ok(x.evidence); assert.ok(x.text.length > 20); }
  assert.ok(S.report("Fav").insights.length <= 5);
});

test("an owner with no finished picks gets an empty report", () => {
  assert.equal(Scout.build({ season: { season: {} }, log: [], names, scorePick }).report("Fav").empty, true);
});

test("taking underdogs isn't called a failure to pick winners", () => {
  // Dog's picked teams win less often by design; judged against the spreads, not the league.
  const dog = S.report("Dog");
  const side = dog.all.find((x) => x.key === "side");
  assert.ok(!side || /spreads say/.test(side.text));
  for (const n of names) { const r = S.report(n); const tones = new Set(r.insights.map((x) => x.tone)); if (r.all.some((x) => x.tone === "weak" && x.weight >= 2)) assert.ok(tones.has("weak")); }
});
