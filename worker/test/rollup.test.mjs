import test from "node:test";
import assert from "node:assert/strict";
import { rollupFrom } from "../src/index.js";

// Mon Oct 5 2026 14:00 ET = 18:00 UTC; Sun Oct 11 23:00 ET = Mon 03:00 UTC.
const mon = Date.UTC(2026, 9, 5, 18), sunLate = Date.UTC(2026, 9, 12, 3), nextMon = Date.UTC(2026, 9, 12, 18);
test("rollupFrom counts an Eastern Monday-to-Sunday week", () => {
  const visits = { Logan: [{ at: mon, app: "home", v: "1" }, { at: sunLate, app: "home", v: "1" }, { at: nextMon, app: "home" }], Curt: [] };
  const sessions = { Logan: [{ at: mon, dur: 60000, f: ["scoreboard", "gamecast-g4"], h: { e: 1, ff: { espn: 2, worker: 0 }, ld: 900 } }] };
  const r = rollupFrom(visits, sessions, "2026-10-05");
  assert.equal(r.people.Logan.opens, 2);
  assert.equal(r.people.Logan.days, 2);
  assert.equal(r.people.Logan.timeMs, 60000);
  assert.deepEqual(r.people.Logan.features, { scoreboard: 1, gamecast: 1 });
  assert.equal(r.people.Logan.errSessions, 1);
  assert.equal(r.people.Logan.fails, 2);
  assert.equal(r.people.Logan.loadMs, 900);
  assert.equal(r.people.Curt.opens, 0);
  assert.equal(r.league.active, 1);
});
