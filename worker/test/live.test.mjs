import test from "node:test";
import assert from "node:assert/strict";
import { applyBeat, roomView, emptyRoom, GONE_MS, deviceToken, deviceTokenOk, DEVICE_DAYS } from "../src/live.js";

const t = 1_800_000_000_000;

test("a first beat brings someone in, uses land in the feed", () => {
  const r = emptyRoom();
  applyBeat(r, { manager: "Curt", app: "home", screen: "scoreboard", events: [{ k: "scoreboard", ago: 1000 }, { k: "gamecast", d: "401", ago: 500 }] }, t);
  const v = roomView(r, t + 1000);
  assert.equal(v.people.Curt.in, true);
  assert.equal(v.people.Curt.screen, "scoreboard");
  assert.deepEqual(v.feed.map((e) => e.k), ["gamecast", "scoreboard", "in"]);
  assert.equal(v.feed[0].d, "401");
});

test("beats keep someone in; a goodbye logs how long, silence drops them", () => {
  const r = emptyRoom();
  applyBeat(r, { manager: "Curt", app: "browser" }, t);
  applyBeat(r, { manager: "Curt" }, t + 30000);
  assert.equal(r.feed.filter((e) => e.k === "in").length, 1);
  applyBeat(r, { manager: "Curt", bye: true }, t + 60000);
  const v = roomView(r, t + 61000);
  assert.equal(v.people.Curt.in, false);
  assert.equal(v.feed[0].k, "out"); assert.equal(v.feed[0].d, "60000");
  applyBeat(r, { manager: "Nissan" }, t);
  assert.equal(roomView(r, t + GONE_MS + 1).people.Nissan.in, false);
});

test("keys are cleaned, odd times clamped, a goodbye from nobody adds nothing", () => {
  const r = emptyRoom();
  applyBeat(r, { manager: "Logan", bye: true, events: [{ k: "<b>Path-Run</b>", ago: 9e9 }, { k: "" }] }, t);
  assert.deepEqual(r.feed.map((e) => [e.k, e.at]), [["bpath-runb", t - 60000]]);
});

test("a remembered device: its token works until it expires, and only for its key", async () => {
  const { token, exp } = await deviceToken("k1", t);
  assert.equal(exp, t + DEVICE_DAYS * 86400000);
  assert.equal(await deviceTokenOk("k1", token, t + 1000), true);
  assert.equal(await deviceTokenOk("k1", token, exp + 1), false);
  assert.equal(await deviceTokenOk("k2", token, t), false);
  assert.equal(await deviceTokenOk("k1", token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), t), false);
  assert.equal(await deviceTokenOk("k1", `${exp + 86400000}.${token.split(".")[1]}`, t), false);
  assert.equal(await deviceTokenOk("k1", "", t), false);
  assert.equal(await deviceTokenOk("", token, t), false);
});

test("the room keeps a week; the page reads a day unless it asks for the week", () => {
  const r = emptyRoom(), D = 86400000;
  applyBeat(r, { manager: "Curt", events: [{ k: "scoreboard" }] }, t - 3 * D);
  applyBeat(r, { manager: "Curt", bye: true }, t - 3 * D + 60000);
  applyBeat(r, { manager: "Nissan", events: [{ k: "picks" }] }, t - 8 * D);
  applyBeat(r, { manager: "Logan", events: [{ k: "h2h" }] }, t);
  assert.ok(r.feed.every((e) => e.n !== "Nissan"));
  assert.deepEqual([...new Set(roomView(r, t + 1000).feed.map((e) => e.n))], ["Logan"]);
  assert.deepEqual([...new Set(roomView(r, t + 1000, "7").feed.map((e) => e.n))].sort(), ["Curt", "Logan"]);
  assert.equal(roomView(r, t + 1000, "99").feed.length, roomView(r, t + 1000, 7).feed.length);
});

test("a question asked of the archive keeps its words", () => {
  const r = emptyRoom(), q = "Who has won the most titles since 2014, and who has the worst all time record of the active owners?";
  applyBeat(r, { manager: "Curt", events: [{ k: "history-ask", d: q }, { k: "ranking-expand", d: q }] }, t);
  assert.equal(r.feed.find((e) => e.k === "history-ask").d, q.slice(0, 140));
  assert.equal(r.feed.find((e) => e.k === "ranking-expand").d.length, 40);
});
