import { test } from "node:test";
import assert from "node:assert/strict";
import { leagueRoute, routeNote } from "../src/weekask.js";

const games = [{ away: "Iowa State", home: "UCF", awayShort: "Iowa State", homeShort: "UCF" }, { away: "Ohio State", home: "Nebraska", awayShort: "Ohio State", homeShort: "Nebraska" }];

test("route: the ship is fantasy; a follow-up keeps the league before it", () => {
  const first = leagueRoute("What kinda odds you got for a guy like me winning the ship this year?", games);
  assert.equal(first.route, "fantasy");
  assert.equal(leagueRoute("What kinda odds?", games, first.route).route, "fantasy");
});

test("route: fantasy words, NFL teams and positions go to fantasy", () => {
  assert.equal(leagueRoute("Who leads the fantasy league?", games).route, "fantasy");
  assert.equal(leagueRoute("Should I start my RB2 or bench him for the Bills D/ST?", games).route, "fantasy");
});

test("route: pick'em words and this week's college teams go to the pick'em", () => {
  assert.equal(leagueRoute("Am I covering in the Ohio State game?", games).route, "pickem");
  assert.equal(leagueRoute("Who picked Nebraska?", games).route, "pickem");
});

test("route: both leagues, or none (then the Chief asks)", () => {
  assert.equal(leagueRoute("Did Jake's lock hit and who leads fantasy?", games).route, "both");
  const none = leagueRoute("Who's winning this year?", games);
  assert.equal(none.route, "unclear");
  assert.match(routeNote(none), /fantasy or the pick'em/i);
});
