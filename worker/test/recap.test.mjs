// Card builder cases that bit us for real. Run: node --test worker/test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const grab = (name) => src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
const { buildRecap, seasonMovement } = new Function(grab("seasonRanks") + grab("seasonMovement") + grab("buildRecap") + "; return { buildRecap, seasonMovement };")();

const games = [
  { id: 1, away: "Oklahoma", home: "Michigan", awayShort: "Oklahoma", homeShort: "Michigan" },
  { id: 2, away: "A", home: "B", awayShort: "A", homeShort: "B", tiebreakerGame: true },
];
const L = (g, team, mode, line, result, pts, worth, score) => ({ g, team, mode, line, result, pts, worth, score, spread: 5.5, matchup: g === 1 ? "Oklahoma at Michigan" : "A at B" });
const row = (name, place, tbGuess, tbDiff, ledger) => ({ name, place, tbGuess, tbDiff, ledger });

test("worst pick counts every taker when the team lost outright", () => {
  const rows = [
    row("Jake", 1, 1, 1, [L(1, "Oklahoma", "SU", "SU", "miss", 0, 1, "10-17")]),
    row("a", 2, 2, 2, [L(1, "Oklahoma", "ATS", "-5.5", "miss", 0, 2, "10-17")]),
    row("b", 2, 2, 2, [L(1, "Oklahoma", "ATS", "-5.5", "miss", 0, 2, "10-17")]),
    row("Logan", 3, 3, 3, [L(1, "Michigan", "ATS", "+5.5", "hit", 2, 2, "10-17")]),
  ];
  const r = buildRecap(games, rows, 20, games[1], null);
  assert.equal(r.worst.takers, 3);
  assert.equal(r.worst.pick, "Oklahoma");
  assert.equal(r.worst.final, "Michigan won 17-10");
});

test("worst pick stays on the line when the team won but did not cover", () => {
  const rows = [
    row("x", 1, 0, 0, [L(1, "Michigan", "SU", "SU", "hit", 1, 1, "17-20")]),
    row("y", 2, 0, 0, [L(1, "Michigan", "ATS", "-5.5", "miss", 0, 2, "17-20")]),
    row("z", 2, 0, 0, [L(1, "Michigan", "ATS", "-5.5", "miss", 0, 2, "17-20")]),
  ];
  const r = buildRecap(games, rows, 20, games[1], null);
  assert.equal(r.worst.takers, 2);
  assert.equal(r.worst.pick, "Michigan -5.5");
});

test("tiebreaker credits everyone tied for closest", () => {
  const rows = [
    row("Andrew", 1, 48, 1, [L(2, "B", "ATS", "-3", "hit", 2, 2, "10-20")]),
    row("Conlan", 2, 46, 1, [L(2, "B", "ATS", "-3", "hit", 2, 2, "10-20")]),
    row("Curt", 3, 45, 2, [L(2, "B", "ATS", "-3", "hit", 2, 2, "10-20")]),
  ];
  const r = buildRecap(games, rows, 47, games[1], null);
  assert.deepEqual(r.tb.who, ["Andrew", "Conlan"]);
  assert.equal(r.tb.off, 1);
});

test("pick of the week groups by team: Georgia State three ways", () => {
  const rows = [
    row("Robert", 1, 0, 0, [{ ...L(1, "Oklahoma", "SU", "SU", "hit", 3, 3, "31-17"), spread: 8.5 }]),
    row("Conlan", 2, 0, 0, [{ ...L(1, "Oklahoma", "SU", "SU", "hit", 3, 3, "31-17"), spread: 8.5 }]),
    row("Dewitt", 3, 0, 0, [{ ...L(1, "Oklahoma", "ATS", "+8.5", "hit", 2, 2, "31-17"), spread: 8.5 }]),
    row("Jake", 4, 0, 0, [{ ...L(2, "A", "ATS", "+1.5", "hit", 2, 2, "20-10"), spread: 1.5 }]),
    ...["a", "b", "c", "d", "e", "f"].map((n) => row(n, 5, 0, 0, [{ ...L(2, "A", "SU", "SU", "hit", 1, 1, "20-10"), spread: 1.5 }])),
  ];
  const r = buildRecap(games, rows, 30, games[1], null);
  assert.deepEqual(r.best.who.sort(), ["Conlan", "Robert"]);
  assert.equal(r.best.takers, 3, "everyone on the team, not just the line");
  assert.equal(r.best.pts, 3);
});

test("pick of the week prefers the higher-value solo hit, then the bigger spread", () => {
  const rows = [
    row("d", 1, 0, 0, [{ ...L(1, "Oklahoma", "ATS", "+8.5", "hit", 2, 2, "31-17"), spread: 8.5 }]),
    row("j", 2, 0, 0, [{ ...L(2, "A", "ATS", "+1.5", "hit", 2, 2, "20-10"), spread: 1.5 }]),
    row("k", 3, 0, 0, [L(2, "B", "SU", "SU", "miss", 0, 1, "20-10")]),
  ];
  const r = buildRecap(games, rows, 30, games[1], null);
  assert.equal(r.best.who[0], "d");
  // Fewest on the team comes first: adding a second person to A leaves d alone on top.
  const rows2 = [...rows, row("s", 4, 0, 0, [L(2, "A", "SU", "SU", "hit", 3, 3, "20-10")])];
  assert.equal(buildRecap(games, rows2, 30, games[1], null).best.who[0], "d", "two on A, one on Oklahoma");
  // Alone on a 3-point dog SU beats alone on a 2-point cover.
  const rows3 = [rows[0], row("s", 4, 0, 0, [L(2, "A", "SU", "SU", "hit", 3, 3, "20-10")]), rows[2]];
  assert.equal(buildRecap(games, rows3, 30, games[1], null).best.who[0], "s");
});

test("movement is season rank before and after the week", () => {
  const wk = (a, b, c) => ({ rows: [{ name: "A", score: a }, { name: "B", score: b }, { name: "C", score: c }] });
  // Through last week: A 20, B 15, C 10. This week: C 12, A 0, B 3 -> A 20, C 22, B 18.
  const m = seasonMovement([wk(10, 5, 4), wk(10, 10, 6)], wk(0, 3, 12).rows, false);
  assert.deepEqual(m.up, { name: "C", from: 3, to: 1 });
  assert.deepEqual(m.down, { name: "A", from: 1, to: 2 });
  assert.equal(seasonMovement([], wk(1, 2, 3).rows, false), null, "first counting week");
  assert.equal(seasonMovement([wk(1, 2, 3)], wk(1, 2, 3).rows, true), null, "exhibition");
});
