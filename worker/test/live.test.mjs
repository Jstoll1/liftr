import test from "node:test";
import assert from "node:assert/strict";
import { applyBeat, roomView, emptyRoom, GONE_MS } from "../src/live.js";

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
