import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWeekAsk } from "../src/weekask.js";
import worker from "../src/index.js";

const games = [{ id: "2", away: "Indiana Hoosiers", home: "Michigan Wolverines", awayShort: "Indiana", homeShort: "Michigan" }, { id: "3", away: "LSU Tigers", home: "Auburn Tigers", awayShort: "LSU", homeShort: "Auburn" }];
const members = ["Jake", "Curt", "Logan"];

test("week ask: the model's reading is checked against the week", () => {
  const r = parseWeekAsk(JSON.stringify({ intent: "chance", who: "jake", conditions: [{ game: 2, team: "Michigan", mode: "SU" }, { game: 9, team: "Nobody", mode: "SU" }, { game: 3, team: "LSU Tigers", mode: "ATS" }] }), games, members, "Curt");
  assert.deepEqual(r, { intent: "chance", who: "Jake", conditions: [{ game: "2", team: "Michigan Wolverines", mode: "SU" }, { game: "3", team: "LSU Tigers", mode: "ATS" }] });
  assert.equal(parseWeekAsk("not json", games, members, "Curt").intent, "unknown");
  assert.equal(parseWeekAsk(JSON.stringify({ intent: "field", who: null, conditions: [{ game: "2", team: "Indiana", mode: "ATS" }] }), games, members, "Curt").intent, "field");
  assert.equal(parseWeekAsk(JSON.stringify({ intent: "hack", who: "Andrew" }), games, members, "Curt").who, "Curt");
});

test("week ask worker: asks the model once and returns the checked reading", async () => {
  const real = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (u, o) => { sent = JSON.parse(o.body); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: "chance", who: null, conditions: [{ game: "2", team: "Michigan", mode: "SU" }] }) } }], usage: {} }), { status: 200 }); };
  const env = { OPENAI_API_KEY: "k", DEFAULT_ROSTER: "Jake,Curt,Logan" };
  const res = await worker.fetch(new Request("https://w.test/week-ask", { method: "POST", body: JSON.stringify({ question: "If Michigan wins can I still win?", asker: "Jake", members, games }) }), env, { waitUntil() {} });
  globalThis.fetch = real;
  const j = await res.json();
  assert.equal(res.status, 200, JSON.stringify(j));
  assert.equal(j.who, "Jake");
  assert.deepEqual(j.conditions, [{ game: "2", team: "Michigan Wolverines", mode: "SU" }]);
  assert.equal(sent.temperature, 0);
});
