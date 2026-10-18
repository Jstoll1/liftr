import test from "node:test";
import assert from "node:assert/strict";
import { newPot, cleanSidePicks, joinEntry, declineEntry, viewPot, entryKey, sideKey, ENTRY_MIN_MS } from "../src/side.js";

const t = 1_800_000_000_000, H = 3600e3;
const g = (id, h) => ({ id, away: `Away ${id}`, home: `Home ${id}`, awayShort: `A${id}`, homeShort: `H${id}`, favorite: `Home ${id}`, spread: 7, kickoff: new Date(t + h * H).toISOString() });
const slate = { games: [g(1, -5.5), g(6, -1.2), g(7, -0.25), g(8, 1), g(9, 2), g(10, 4)] };

test("a pot takes games still to kick off, sorted, and closes at the first", () => {
  const { pot } = newPot({ week: 7, games: [10, 8, 9], buyIn: 25, slate, now: t });
  assert.deepEqual(pot.games, [8, 9, 10]);
  assert.equal(pot.closesAt, t + H);
  assert.equal(pot.buyIn, 25);
  assert.equal(sideKey(7), "side:w7");
  assert.equal(entryKey(7, pot.id, "Jake"), `side:w7:${pot.id}:Jake`);
});

test("a game already on can go in; entry then stays open 20 minutes", () => {
  const { pot } = newPot({ week: 7, games: [8, 7, 6], buyIn: 25, slate, now: t });
  assert.deepEqual(pot.games, [6, 7, 8]);
  assert.equal(pot.closesAt, t + ENTRY_MIN_MS);
  // About to kick off: still the 20 minutes, not the kickoff a minute away.
  const soon = { games: [g(8, 0.02)] };
  assert.equal(newPot({ week: 7, games: [8], buyIn: 25, slate: soon, now: t }).pot.closesAt, t + ENTRY_MIN_MS);
});

test("a pot refuses started games, unknown games, bad buy-ins and too many games", () => {
  assert.match(newPot({ week: 7, games: [1, 8], buyIn: 25, slate, now: t }).error, /is over/);
  assert.match(newPot({ week: 7, games: [5], buyIn: 25, slate, now: t }).error, /not on this week/);
  assert.match(newPot({ week: 7, games: [8], buyIn: 2.5, slate, now: t }).error, /whole dollar/);
  assert.match(newPot({ week: 7, games: [8], buyIn: 0, slate, now: t }).error, /whole dollar/);
  assert.match(newPot({ week: 7, games: [], buyIn: 25, slate, now: t }).error, /Pick 1/);
  assert.match(newPot({ week: 7, games: [8, 9, 10, 1, 2, 3], buyIn: 25, slate, now: t }).error, /Pick 1/);
});

test("side picks must cover every pot game with a real team and mode", () => {
  const { pot } = newPot({ week: 7, games: [8, 9], buyIn: 25, slate, now: t });
  assert.match(cleanSidePicks(pot, slate, { 8: { team: "Home 8", mode: "ATS" } }).error, /A9 at H9/);
  assert.match(cleanSidePicks(pot, slate, { 8: { team: "Home 8", mode: "ATS" }, 9: { team: "Nobody", mode: "SU" } }).error, /Pick a team/);
  assert.match(cleanSidePicks(pot, slate, { 8: { team: "Home 8", mode: "ATS" }, 9: { team: "Away 9", mode: "PARLAY" } }).error, /ATS or SU/);
  const ok = cleanSidePicks(pot, slate, { 8: { team: "Home 8", mode: "ATS", extra: 1 }, 9: { team: "Away 9", mode: "SU" }, 10: { team: "Home 10", mode: "SU" } });
  assert.deepEqual(ok.picks, { 8: { team: "Home 8", mode: "ATS" }, 9: { team: "Away 9", mode: "SU" } });
});

test("joining, changing picks and backing out work until the first kickoff, then nothing does", () => {
  const { pot } = newPot({ week: 7, games: [8], buyIn: 25, slate, now: t });
  const a = joinEntry(pot, null, { 8: { team: "Home 8", mode: "ATS" } }, t + 1000).entry;
  assert.equal(a.in, true); assert.equal(a.at, t + 1000);
  const b = joinEntry(pot, { ...a, paid: true }, { 8: { team: "Away 8", mode: "SU" } }, t + 2000).entry;
  assert.equal(b.at, t + 1000, "joined time kept on a change");
  assert.equal(b.paid, true);
  assert.equal(declineEntry(pot, b, t + 3000).entry.in, false);
  assert.match(joinEntry(pot, null, {}, t + H).error, /closed/);
  assert.match(declineEntry(pot, null, t + H).error, /closed/);
});

test("who is in shows from the start; picks stay hidden from others until close", () => {
  const { pot } = newPot({ week: 7, games: [8], buyIn: 25, slate, now: t });
  const entries = { Jake: { in: true, at: t, picks: { 8: { team: "Home 8", mode: "ATS" } } }, Dewitt: { in: true, at: t, paid: true, picks: { 8: { team: "Away 8", mode: "SU" } } }, Logan: { in: false, at: t } };
  const open = viewPot(pot, entries, t + 1000, { all: false, me: "Jake" });
  assert.equal(open.open, true);
  assert.deepEqual(Object.keys(open.entrants).sort(), ["Dewitt", "Jake"]);
  assert.deepEqual(open.entrants.Jake.picks, entries.Jake.picks);
  assert.equal(open.entrants.Dewitt.picks, undefined);
  assert.equal(open.entrants.Dewitt.hidden, true);
  assert.equal(open.entrants.Dewitt.paid, true);
  assert.deepEqual(open.declined, ["Logan"]);
  assert.ok(!JSON.stringify(open).includes("Away 8"), "nobody else's team leaks before close");
  const admin = viewPot(pot, entries, t + 1000, { all: true });
  assert.deepEqual(admin.entrants.Dewitt.picks, entries.Dewitt.picks);
  const closed = viewPot(pot, entries, t + H, { all: false, me: null });
  assert.equal(closed.open, false);
  assert.deepEqual(closed.entrants.Dewitt.picks, entries.Dewitt.picks);
});
