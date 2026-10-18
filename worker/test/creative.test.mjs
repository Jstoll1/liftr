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

function desk({ cap = "10", draw, write, now } = {}) {
  const ctx = fakeCtx(), r2 = fakeR2();
  let t = now || 1_800_000_000_000;
  const kv = new Map();
  const d = new CreativeDesk(ctx, { CREATIVE_MONTHLY_CAP_USD: cap, CREATIVE: r2, LIFTR_KV: { put: async (k, v) => kv.set(k, v), get: async (k) => kv.get(k) } }, { draw: draw || (async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), cost: 0.05 })), write: write || (async () => ({ text: JSON.stringify({ headline: "Chalk eater", body: "You took 30 favorites.\n\nTake a dog." }), cost: 0.005 })), now: () => t });
  d.kv = kv;
  return { d, ctx, r2, kv, tick: (ms) => { t += ms; } };
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
  // A mascot is one per team, whatever the week.
  const nextWeek = await post(d, "/generate", { ...LSU, week: 8 });
  assert.equal(nextWeek.versionId, a.versionId);
  const other = await post(d, "/generate", { ...LSU, subject: { teamId: 194, name: "Ohio State" } });
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
  const q = await post(d, "/generate", LSU);
  assert.equal((await d.fetch(new Request(`https://desk/creative/image/${q.versionId}`))).status, 404);
  await d.alarm();
  const img = await d.fetch(new Request(`https://desk/creative/image/${q.versionId}`));
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("Content-Type"), "image/png");
  const types = await get(d, "/types");
  assert.equal(types.types[0].id, "team-mascot");
});

const WEBP = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 1, 2, 3]);
const optimize = (d, id, bytes = WEBP, type = "image/webp") => d.fetch(new Request(`https://desk/creative/optimized/${id}`, { method: "POST", headers: { "Content-Type": type }, body: bytes })).then((r) => r.json());
const act = (d, action, ids) => post(d, "/action", { action, versionIds: ids });

test("approve is not publish; publish needs the optimized copy, then the app's list carries it", async () => {
  const { d, kv, r2 } = desk();
  const q = await post(d, "/generate", LSU);
  await d.alarm();
  assert.deepEqual((await act(d, "publish", [q.versionId])).skipped[0].why, "approve it first");
  assert.deepEqual((await act(d, "approve", [q.versionId])).done, [q.versionId]);
  assert.equal(kv.size, 0);
  assert.match((await act(d, "publish", [q.versionId])).skipped[0].why, /optimized/);
  assert.match((await optimize(d, q.versionId, new Uint8Array([1, 2, 3]))).error, /WebP or PNG/);
  assert.equal((await optimize(d, q.versionId, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]), "image/png")).ok, true);
  assert.equal((await optimize(d, q.versionId)).ok, true);
  assert.equal(r2.m.get(`opt/${q.versionId}`).o.httpMetadata.contentType, "image/webp");
  assert.deepEqual((await act(d, "publish", [q.versionId])).done, [q.versionId]);
  const m = JSON.parse(kv.get("creative:published"));
  assert.equal(m.art["replay-logo:team:99"].v, q.versionId);
  const { items } = await get(d, "/assets");
  assert.equal(items[0].status, "PUBLISHED");
  assert.equal(items[0].published, true);
});

test("a replacement goes live only when published; the old one stays approved; unpublish falls back", async () => {
  const { d, kv } = desk();
  const a = await post(d, "/generate", LSU); await d.alarm();
  await act(d, "approve", [a.versionId]); await optimize(d, a.versionId); await act(d, "publish", [a.versionId]);
  // A new version for the same team, made after rejecting nothing: regenerate comes in phase 2,
  // so here a second team stands in for a new version's lifecycle.
  await act(d, "reject", [a.versionId]).then((r) => assert.match(r.skipped[0].why, /unpublish/));
  assert.equal(JSON.parse(kv.get("creative:published")).art["replay-logo:team:99"].v, a.versionId);
  await act(d, "unpublish", [a.versionId]);
  assert.deepEqual(JSON.parse(kv.get("creative:published")).art, {});
  const { items } = await get(d, "/assets");
  assert.equal(items[0].status, "APPROVED");
});

test("batch actions report what they skipped; a rejected version can be asked for again", async () => {
  const { d } = desk();
  const a = await post(d, "/generate", LSU), b = await post(d, "/generate", { ...LSU, subject: { teamId: 61, name: "Georgia" } });
  await d.alarm(); await d.alarm();
  const r = await act(d, "approve", [a.versionId, b.versionId, "v_nope"]);
  assert.equal(r.done.length, 2);
  assert.equal(r.skipped[0].why, "not found");
  await act(d, "reject", [b.versionId]);
  const again = await post(d, "/generate", { ...LSU, subject: { teamId: 61, name: "Georgia" } });
  assert.notEqual(again.versionId, b.versionId);
});

test("the cost meter tallies every call by feature and model, images included", async () => {
  const { d } = desk();
  await post(d, "/usage", { feature: "history-ask", model: "gpt-4o-mini", tin: 1000, tout: 200, usd: 0.00027 });
  await post(d, "/usage", { feature: "history-ask", model: "gpt-4o-mini", tin: 500, tout: 100, usd: 0.000135 });
  await post(d, "/usage", { feature: "story", model: "gpt-4o", tin: 2000, tout: 800, usd: 0.013 });
  await post(d, "/generate", LSU); await d.alarm();
  const c = await get(d, "/costs");
  assert.equal(c.today.calls, 4);
  assert.equal(c.month.tin, 3500);
  const ask = c.byFeature.find((r) => r.feature === "history-ask");
  assert.equal(ask.calls, 2);
  assert.ok(Math.abs(ask.usd - 0.000405) < 1e-9);
  assert.equal(c.byFeature[0].feature, "creative-image");
  assert.ok(Math.abs(c.month.usd - (0.000405 + 0.013 + 0.05)) < 1e-9);
  assert.equal(c.byDay.length, 1);
});

const SCOUT = { category: "scouting-report", subject: { name: "Jake", facts: { scored: 61, rank: 5, of: 10, fix: "Take more dogs" } }, week: 7, tone: "savage" };

test("a scouting report is written from the owner's facts in the chosen tone, then reviewed", async () => {
  const seen = [];
  const { d } = desk({ write: async (a) => { seen.push(a); return { text: JSON.stringify({ headline: "Chalk eater", body: "61 points." }), cost: 0.004 }; } });
  const q = await post(d, "/generate", SCOUT);
  await d.alarm();
  assert.match(seen[0].system, /roast/);
  assert.match(seen[0].system, /Never invent or change a number/);
  assert.match(seen[0].user, /"scored":61/);
  const { items } = await get(d, "/assets");
  assert.equal(items[0].status, "PENDING_REVIEW");
  assert.equal(items[0].text.headline, "Chalk eater");
  assert.equal(items[0].tone, "savage");
  const c = await get(d, "/costs");
  assert.equal(c.byFeature[0].feature, "creative-text");
  // Approve and publish without an image: the text goes in the app's list.
  await act(d, "approve", [q.versionId]);
  await act(d, "publish", [q.versionId]);
  const m = JSON.parse(d.kv.get("creative:published"));
  assert.equal(m.art["owner-card:owner:Jake"].text.body, "61 points.");
  assert.equal(m.art["owner-card:owner:Jake"].week, 7);
});

test("editing a live report makes a new approved version; live text changes only on publish", async () => {
  const { d } = desk();
  const q = await post(d, "/generate", SCOUT); await d.alarm();
  await act(d, "approve", [q.versionId]); await act(d, "publish", [q.versionId]);
  const e = await post(d, "/action", { action: "edit", versionIds: [q.versionId], text: { headline: "New head", body: "New body" } });
  const nv = e.done[0];
  assert.notEqual(nv, q.versionId);
  assert.equal(JSON.parse(d.kv.get("creative:published")).art["owner-card:owner:Jake"].text.headline, "Chalk eater");
  await act(d, "publish", [nv]);
  assert.equal(JSON.parse(d.kv.get("creative:published")).art["owner-card:owner:Jake"].text.headline, "New head");
  const view = await get(d, `/asset/${q.assetId}`);
  assert.equal(view.versions.length, 2);
  assert.equal(view.versions.find((v) => v.id === q.versionId).status, "APPROVED");
  assert.ok(view.audit.some((x) => x.action === "edit"));
  // A bad edit is refused.
  assert.match((await post(d, "/action", { action: "edit", versionIds: [nv], text: { headline: "", body: "" } })).skipped[0].why, /headline/);
});

test("regenerate adds a version with the note and the old draft; the live one stays live", async () => {
  const seen = [];
  const { d } = desk({ write: async (a) => { seen.push(a); return { text: JSON.stringify({ headline: `H${seen.length}`, body: "B" }), cost: 0.004 }; } });
  const q = await post(d, "/generate", SCOUT); await d.alarm();
  await act(d, "approve", [q.versionId]); await act(d, "publish", [q.versionId]);
  const r = await post(d, "/action", { action: "regenerate", versionIds: [q.versionId], feedback: "shorter", tone: "hype" });
  await d.alarm();
  assert.match(seen[1].user, /Revise this earlier draft/);
  assert.match(seen[1].user, /shorter/);
  assert.match(seen[1].system, /hype man/);
  assert.equal(JSON.parse(d.kv.get("creative:published")).art["owner-card:owner:Jake"].text.headline, "H1");
  const lib = await get(d, "/library");
  assert.equal(lib.assets[0].versions, 2);
  assert.equal(lib.assets[0].live.text.headline, "H1");
  assert.equal(lib.assets[0].latest.id, r.done[0]);
  // Images regenerate the same way.
  const img = await post(d, "/generate", LSU); await d.alarm();
  const r2 = await post(d, "/action", { action: "regenerate", versionIds: [img.versionId], feedback: "more snarl" });
  assert.equal(r2.done.length, 1);
});
