import test from "node:test";
import assert from "node:assert/strict";
import worker, { mergeRecords, daysFromSessions } from "../src/index.js";

test("records: a day only goes up, best day ever per metric", () => {
  let r = mergeRecords(null, [{ d: "2026-10-24", visits: 40, people: 6, timeMs: 3600000, actions: 300 }, { d: "2026-10-25", visits: 12, people: 4 }]);
  r = mergeRecords(r, [{ d: "2026-10-25", visits: 55, people: 3, actions: 90 }, { d: "bad", visits: 999 }]);
  assert.equal(r.days["2026-10-25"].visits, 55);
  assert.equal(r.days["2026-10-25"].people, 4);
  assert.deepEqual(r.best.visits, { v: 55, d: "2026-10-25" });
  assert.deepEqual(r.best.actions, { v: 300, d: "2026-10-24" });
  assert.equal(r.days.bad, undefined);
});

test("records endpoint: admin only, saves and returns", async () => {
  const m = new Map();
  const env = { LIFTR_KV: { get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, String(v)); } }, ARCHIVE_LOG_KEY: "adm" };
  assert.equal((await worker.fetch(new Request("https://w.test/records"), env, { waitUntil() {} })).status, 403);
  await worker.fetch(new Request("https://w.test/records?key=adm", { method: "POST", body: JSON.stringify({ days: [{ d: "2026-10-26", visits: 7 }] }) }), env, { waitUntil() {} });
  const r = await (await worker.fetch(new Request("https://w.test/records?key=adm"), env, { waitUntil() {} })).json();
  assert.equal(r.best.visits.v, 7);
});

test("records: history from the session logs, by Eastern day", () => {
  const at = (iso) => Date.parse(iso);
  const days = daysFromSessions({ Logan: [{ at: at("2026-10-24T20:00:00Z"), dur: 60000 }, { at: at("2026-10-24T21:00:00Z"), dur: 120000 }], Curt: [{ at: at("2026-10-24T22:00:00Z"), dur: 30000 }, { at: at("2026-10-25T03:30:00Z"), dur: 10000 }] });
  const d24 = days.find((d) => d.d === "2026-10-24");
  assert.equal(d24.visits, 4); assert.equal(d24.people, 2); assert.equal(d24.timeMs, 220000);
});

test("pace: hourly running totals from sessions, merged highest-wins", () => {
  const at = (s) => Date.parse(s);
  // 2pm and 4pm ET on Oct 24 (EDT, UTC-4).
  const [day] = daysFromSessions({ Logan: [{ at: at("2026-10-24T18:10:00Z"), dur: 60000 }, { at: at("2026-10-24T20:30:00Z"), dur: 120000 }], Curt: [{ at: at("2026-10-24T20:40:00Z"), dur: 30000 }] });
  assert.equal(day.h.visits.length, 24);
  assert.equal(day.h.visits[13], 0); assert.equal(day.h.visits[14], 1); assert.equal(day.h.visits[16], 3); assert.equal(day.h.visits[23], 3);
  assert.equal(day.h.people[14], 1); assert.equal(day.h.people[16], 2);
  assert.equal(day.h.timeMs[16], 210000);
  let r = mergeRecords(null, [day]);
  r = mergeRecords(r, [{ d: day.d, h: { visits: Array(24).fill(2), actions: Array(24).fill(5) } }]);
  assert.equal(r.days[day.d].h.visits[13], 2); assert.equal(r.days[day.d].h.visits[16], 3);
  assert.equal(r.days[day.d].h.actions[0], 5);
  r = mergeRecords(r, [{ d: day.d, h: { visits: [1, 2] } }]);
  assert.equal(r.days[day.d].h.visits[16], 3);
});

test("a week sealed before its games could finish reopens on read, and early results are refused", async () => {
  const m = new Map();
  const kv = { get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => m.delete(k), list: async () => ({ keys: [], list_complete: true }) };
  const env = { LIFTR_KV: kv, ARCHIVE_LOG_KEY: "adm" };
  const now = Date.now();
  const games = [{ id: 1, away: "A", home: "B", awayShort: "A", homeShort: "B", favorite: "B", spread: 3, kickoff: new Date(now - 26 * 3600e3).toISOString() }, { id: 2, away: "C", home: "D", awayShort: "C", homeShort: "D", favorite: "D", spread: 3, kickoff: new Date(now - 1 * 3600e3).toISOString() }];
  m.set("weeks", JSON.stringify({ current: 9, list: [9] }));
  for (const k of ["games:w9", "games:9", "slate:9"]) m.set(k, JSON.stringify({ week: 9, games }));
  const hit = (path, init) => worker.fetch(new Request(`https://w.test${path}`, init), env, { waitUntil() {} });
  // A phone posts a "final" for game 2, an hour after it kicked off.
  const r = await (await hit("/season", { method: "POST", body: JSON.stringify({ week: 9, results: { 1: { awayScore: 10, homeScore: 20 }, 2: { awayScore: 7, homeScore: 3 } } }) })).json();
  assert.equal(r.stored, 1, "only the game that could be over is kept");
  assert.equal(r.complete, false);
});
