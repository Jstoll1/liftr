import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CreativeDesk, MAX_ATTEMPTS } from "../src/creative.js";

// A durable object's storage, on a real SQLite: exec(query, ...args) with
// a cursor that has toArray(), and an alarm we can read back.
function fakeCtx() {
  const db = new DatabaseSync(":memory:");
  const ctx = {
    alarmAt: null,
    storage: {
      sql: { exec: (q, ...a) => { const st = db.prepare(q); const isRead = /^\s*SELECT/i.test(q); const rows = isRead ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; } },
      setAlarm: (t) => { ctx.alarmAt = t; },
    },
  };
  return ctx;
}
const fakeR2 = () => { const m = new Map(); return { m, put: async (k, v, o) => m.set(k, { v, o }), get: async (k) => (m.has(k) ? { body: m.get(k).v, httpMetadata: m.get(k).o?.httpMetadata } : null) }; };
const LSU = { category: "team-mascot", subject: { teamId: 99, name: "LSU", mascot: "tiger", colors: "purple and gold" }, week: 7 };

function desk({ cap = "10", draw, now } = {}) {
  const ctx = fakeCtx(), r2 = fakeR2();
  let t = now || 1_800_000_000_000;
  const d = new CreativeDesk(ctx, { CREATIVE_MONTHLY_CAP_USD: cap, CREATIVE: r2 }, { draw: draw || (async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), cost: 0.05 })), now: () => t });
  return { d, ctx, r2, tick: (ms) => { t += ms; } };
}
const post = (d, path, body) => d.fetch(new Request(`https://desk/creative${path}`, { method: "POST", body: JSON.stringify(body) })).then((r) => r.json());
const get = (d, path) => d.fetch(new Request(`https://desk/creative${path}`)).then((r) => r.json());

test("a request is queued, generated on the alarm, stored privately and waits for review", async () => {
  const { d, ctx, r2 } = desk();
  const q = await post(d, "/generate", LSU);
  assert.equal(q.status, "QUEUED");
  assert.ok(ctx.alarmAt);
  await d.alarm();
  const { items, budget } = await get(d, "/assets");
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "PENDING_REVIEW");
  assert.equal(items[0].label, "LSU");
  assert.equal(items[0].cost, 0.05);
  assert.ok(items[0].hasImage);
  assert.ok(r2.m.has(`orig/${q.versionId}.png`));
  assert.equal(budget.spent, 0.05);
  assert.equal(budget.reserved, 0);
});

test("the prompt names the team and forbids text; feedback is added", async () => {
  const seen = [];
  const { d } = desk({ draw: async (a) => { seen.push(a); return { bytes: new Uint8Array([1]), cost: 0.04 }; } });
  await post(d, "/generate", { ...LSU, feedback: "more snarl" });
  await d.alarm();
  assert.match(seen[0].prompt, /LSU/);
  assert.match(seen[0].prompt, /no text, letters, numbers/i);
  assert.match(seen[0].prompt, /more snarl/);
  assert.equal(seen[0].background, "transparent");
});

test("asking twice for the same graphic does not pay twice", async () => {
  const { d } = desk();
  const a = await post(d, "/generate", LSU);
  const b = await post(d, "/generate", LSU);
  assert.equal(b.existing, true);
  assert.equal(b.versionId, a.versionId);
  const other = await post(d, "/generate", { ...LSU, week: 8 });
  assert.notEqual(other.versionId, a.versionId);
});

test("over the monthly cap, the job waits and nothing is charged", async () => {
  let calls = 0;
  const { d } = desk({ cap: "0.01", draw: async () => { calls += 1; return { bytes: new Uint8Array([1]), cost: 0.05 }; } });
  await post(d, "/generate", LSU);
  await d.alarm();
  const { items, budget } = await get(d, "/assets");
  assert.equal(calls, 0);
  assert.equal(items[0].status, "QUEUED");
  assert.match(items[0].error, /budget/);
  assert.equal(budget.spent, 0);
});

test("an outage is retried, then fails after the last try; a refusal fails at once", async () => {
  const outage = desk({ draw: async () => { const e = new Error("OpenAI answered 503"); e.retry = true; throw e; } });
  await post(outage.d, "/generate", LSU);
  for (let i = 0; i < MAX_ATTEMPTS; i++) { await outage.d.alarm(); outage.tick(10 * 60000); }
  let { items, budget } = await get(outage.d, "/assets");
  assert.equal(items[0].status, "FAILED");
  assert.equal(items[0].attempts, MAX_ATTEMPTS);
  assert.equal(budget.spent, 0);
  assert.equal(budget.reserved, 0);

  const refused = desk({ draw: async () => { const e = new Error("Your request was rejected"); e.retry = false; throw e; } });
  await post(refused.d, "/generate", LSU);
  await refused.d.alarm();
  ({ items } = await get(refused.d, "/assets"));
  assert.equal(items[0].status, "FAILED");
  assert.equal(items[0].attempts, 1);
  // After a failure, asking again makes a new version.
  const again = await post(refused.d, "/generate", LSU);
  assert.equal(again.existing, undefined);
});

test("a job stuck mid-generation goes back in line and its hold is released", async () => {
  const { d, tick } = desk({ draw: () => new Promise(() => {}) });
  await post(d, "/generate", LSU);
  d.alarm(); // never finishes
  await new Promise((r) => setTimeout(r, 10));
  assert.ok((await get(d, "/budget")).reserved > 0);
  tick(11 * 60000);
  d.draw = async () => ({ bytes: new Uint8Array([1]), cost: 0.05 });
  await d.alarm();
  const { items, budget } = await get(d, "/assets");
  assert.equal(items[0].status, "PENDING_REVIEW");
  assert.equal(budget.reserved, 0);
  assert.equal(budget.spent, 0.05);
});

test("bad requests are refused; images are served only for stored versions", async () => {
  const { d } = desk();
  assert.match((await post(d, "/generate", { category: "nope" })).error, /category/);
  assert.match((await post(d, "/generate", { category: "team-mascot", subject: {} })).error, /team/);
  assert.match((await post(d, "/generate", { ...LSU, week: 99 })).error, /week/);
  const q = await post(d, "/generate", LSU);
  assert.equal((await d.fetch(new Request(`https://desk/creative/image/${q.versionId}`))).status, 404);
  await d.alarm();
  const img = await d.fetch(new Request(`https://desk/creative/image/${q.versionId}`));
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("Content-Type"), "image/png");
  const types = await get(d, "/types");
  assert.equal(types.types[0].id, "team-mascot");
});
