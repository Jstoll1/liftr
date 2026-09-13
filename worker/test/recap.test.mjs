// Card builder cases that bit us for real. Run: node --test worker/test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const buildRecap = new Function(src.match(/function buildRecap[\s\S]*?\n}\n\n\/\/ Writes the summary/)[0].replace(/\n\/\/ Writes the summary$/, "") + "; return buildRecap;")();

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

test("pick of the week prefers the higher-value solo hit, then the bigger spread", () => {
  const rows = [
    row("d", 1, 0, 0, [{ ...L(1, "Oklahoma", "ATS", "+8.5", "hit", 2, 2, "31-17"), spread: 8.5 }]),
    row("j", 2, 0, 0, [{ ...L(2, "A", "ATS", "+1.5", "hit", 2, 2, "20-10"), spread: 1.5 }]),
    row("k", 3, 0, 0, [L(2, "B", "SU", "SU", "miss", 0, 1, "20-10")]),
  ];
  const r = buildRecap(games, rows, 30, games[1], null);
  assert.equal(r.best.who[0], "d");
  const rows2 = [...rows, row("s", 4, 0, 0, [L(2, "A", "SU", "SU", "hit", 3, 3, "20-10")])];
  assert.equal(buildRecap(games, rows2, 30, games[1], null).best.who[0], "s", "a 3-point dog SU beats a 2-point cover");
});

test("movement is skipped without a prior week", () => {
  const r = buildRecap(games, [row("a", 1, 0, 0, [L(2, "B", "ATS", "-3", "hit", 2, 2, "10-20")])], 30, games[1], null);
  assert.equal(r.movement, null);
});
