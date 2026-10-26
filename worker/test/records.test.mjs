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
