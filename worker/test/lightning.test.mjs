import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNight, betResult, standings, cleanAnswers, viewNight, activate } from "../src/lightning.js";

const H = 3600e3;
const game = (id, away, home, hrs) => ({ eventId: String(id), away, home, awayShort: away.split(" ")[0], homeShort: home.split(" ")[0], awayId: id + 1, homeId: id + 2, kickoff: new Date(Date.UTC(2026, 9, 24, 23) + hrs * H).toISOString() });
const g1 = game(401001, "Virginia Tech Hokies", "Clemson Tigers", 0), g2 = game(401002, "Oregon Ducks", "USC Trojans", 0.5), g3 = game(401003, "Utah Utes", "BYU Cougars", 1.5);
const five = () => [
  { game: g1, kind: "ats", spread: 2.5, favorite: "Clemson Tigers" },
  { game: g1, kind: "ou", total: 48.5 },
  { game: g2, kind: "su" },
  { game: g2, kind: "ats", spread: 0 },
  { game: g3, kind: "ou", total: 41 },
];
const NOW = Date.UTC(2026, 9, 24, 21, 30);

test("lightning: a night is five checked bets, labels written, the last game is the tiebreaker", () => {
  const { night, error } = buildNight({ week: 9, bets: five(), buyIn: 10, closesAt: NOW + H, now: NOW });
  assert.equal(error, undefined);
  assert.equal(night.status, "draft");
  assert.deepEqual(night.bets.map((b) => [b.id, b.a, b.b]), [["b1", "Virginia +2.5", "Clemson -2.5"], ["b2", "Over 48.5", "Under 48.5"], ["b3", "Oregon", "USC"], ["b4", "Oregon PK", "USC PK"], ["b5", "Over 41", "Under 41"]]);
  assert.equal(night.tbEvent, "401003");
  assert.match(buildNight({ week: 9, bets: five().slice(0, 4), buyIn: 10, closesAt: NOW + H, now: NOW }).error, /5 bets/);
  assert.match(buildNight({ week: 9, bets: [...five().slice(0, 4), five()[0]], buyIn: 10, closesAt: NOW + H, now: NOW }).error, /same bet/);
  assert.match(buildNight({ week: 9, bets: five(), buyIn: 10, closesAt: NOW - 1, now: NOW }).error, /lock time/);
  assert.match(buildNight({ week: 9, bets: [{ ...five()[0], favorite: "Nobody" }, ...five().slice(1)], buyIn: 10, closesAt: NOW + H, now: NOW }).error, /favoured/);
});

test("lightning: each kind settles from the final, pushes included", () => {
  const { night } = buildNight({ week: 9, bets: five(), buyIn: 10, closesAt: NOW + H, now: NOW });
  const [ats, ou, su, pk] = night.bets;
  assert.equal(betResult(ats, { awayScore: 21, homeScore: 23 }), "a"); // VT +2.5 covers a 2 point loss
  assert.equal(betResult(ats, { awayScore: 20, homeScore: 24 }), "b");
  assert.equal(betResult(ou, { awayScore: 30, homeScore: 20 }), "a");
  assert.equal(betResult(ou, { awayScore: 20, homeScore: 20 }), "b");
  assert.equal(betResult(su, { awayScore: 17, homeScore: 17 }), "push");
  assert.equal(betResult(pk, { awayScore: 10, homeScore: 13 }), "b");
  assert.equal(betResult(ats, null), null);
});

test("lightning: most right wins, the tiebreaker breaks a tie, a dead heat splits", () => {
  const { night } = buildNight({ week: 9, bets: five(), buyIn: 10, closesAt: NOW + H, now: NOW });
  const finals = { 401001: { awayScore: 21, homeScore: 23 }, 401002: { awayScore: 28, homeScore: 24 }, 401003: { awayScore: 20, homeScore: 17 } };
  // Results: b1 a, b2 b (44), b3 a, b4 a, b5 b (37). Tiebreaker 37.
  const all = { b1: "a", b2: "b", b3: "a", b4: "a", b5: "b" };
  const entries = { Curt: { in: true, picks: all, tb: 40 }, Logan: { in: true, picks: all, tb: 36 }, Jordan: { in: true, picks: { ...all, b1: "b" }, tb: 37 }, Andrew: { in: false } };
  const t = standings(night, entries, finals);
  assert.equal(t.done, true);
  assert.deepEqual(t.rows.map((r) => [r.name, r.points, r.off]), [["Logan", 5, 1], ["Curt", 5, 3], ["Jordan", 4, 0]]);
  assert.deepEqual(t.winners, ["Logan"]);
  entries.Curt.tb = 38; // 1 off as well
  assert.deepEqual(standings(night, entries, finals).winners.sort(), ["Curt", "Logan"]);
  assert.equal(standings(night, entries, { 401001: finals[401001] }).done, false);
});

test("lightning: answers need every bet and a tiebreaker; a draft is the commissioner's only", () => {
  const { night } = buildNight({ week: 9, bets: five(), buyIn: 10, closesAt: NOW + H, now: NOW });
  assert.match(cleanAnswers(night, { b1: "a" }, 40).error, /Swipe every bet/);
  assert.match(cleanAnswers(night, { b1: "a", b2: "a", b3: "a", b4: "a", b5: "a" }, "").error, /tiebreaker/);
  assert.equal(viewNight(night, {}, {}, NOW, { all: false, me: "Curt" }), null);
  assert.ok(viewNight(night, {}, {}, NOW, { all: true }));
  const live = activate(night, NOW).night;
  assert.equal(live.status, "live");
  const entries = { Curt: { in: true, picks: { b1: "a", b2: "a", b3: "a", b4: "a", b5: "a" }, tb: 40, at: NOW } };
  assert.equal(viewNight(live, entries, {}, NOW, { all: false, me: "Logan" }).entrants.Curt.hidden, true);
  assert.equal(viewNight(live, entries, {}, NOW, { all: false, me: "Curt" }).entrants.Curt.picks.b1, "a");
  assert.equal(viewNight(live, entries, {}, NOW + 2 * H, { all: false, me: "Logan" }).entrants.Curt.picks.b1, "a"); // public after the lock
});

// The Worker end to end.
import worker from "../src/index.js";
const kv = () => { const m = new Map(); return { m, get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [], list_complete: true }) }; };

test("lightning worker: save and activate are the admin's; players join with picks hidden; finals settle it into history", async () => {
  const env = { LIFTR_KV: kv(), ARCHIVE_LOG_KEY: "adm", DEFAULT_ROSTER: "Curt,Logan,Jake" };
  const call = async (path, body) => (await worker.fetch(new Request(`https://w.test${path}`, body ? { method: "POST", body: JSON.stringify(body) } : {}), env, { waitUntil() {} }));
  const close = Date.now() + 3600e3;
  assert.equal((await call("/lightning?week=9", { action: "save", week: 9, bets: five(), buyIn: 10, closesAt: close })).status, 403);
  assert.equal((await call("/lightning?key=adm", { action: "save", week: 9, bets: five(), buyIn: 10, closesAt: close })).status, 200);
  assert.equal((await (await call("/lightning?week=9")).json()).night, null); // a draft: nothing for players
  assert.equal((await call("/lightning?week=9", { action: "join", week: 9, manager: "Curt", picks: { b1: "a", b2: "a", b3: "a", b4: "a", b5: "a" }, tb: 40 })).status, 404);
  assert.equal((await call("/lightning?key=adm", { action: "activate", week: 9 })).status, 200);
  const picks = { b1: "a", b2: "b", b3: "a", b4: "a", b5: "b" };
  assert.equal((await call("/lightning?week=9", { action: "join", week: 9, manager: "Curt", picks, tb: 40 })).status, 200);
  assert.equal((await call("/lightning?week=9", { action: "join", week: 9, manager: "Logan", picks: { ...picks, b1: "b" }, tb: 37 })).status, 200);
  const seen = (await (await call("/lightning?week=9&me=Logan")).json()).night;
  assert.equal(seen.entrants.Curt.hidden, true);
  assert.equal(seen.status, "live");
  // After the lock, finals from a phone settle it.
  const n = JSON.parse(env.LIFTR_KV.m.get("lightning:w9")); n.closesAt = Date.now() - 1; n.bets.forEach((b) => { b.game.kickoff = new Date(Date.now() - 4 * 3600e3).toISOString(); }); env.LIFTR_KV.m.set("lightning:w9", JSON.stringify(n));
  const r = await (await call("/lightning?week=9", { action: "finals", week: 9, nightId: n.id, finals: { 401001: { awayScore: 21, homeScore: 23 }, 401002: { awayScore: 28, homeScore: 24 }, 401003: { awayScore: 20, homeScore: 17 } } })).json();
  assert.equal(r.recorded, true);
  const hist = (await (await call("/lightning?history=1")).json()).history;
  assert.deepEqual(hist[0].winners, ["Curt"]);
});

test("lightning worker: a prompt edit comes back checked against tonight's games", async () => {
  const env = { LIFTR_KV: kv(), ARCHIVE_LOG_KEY: "adm", DEFAULT_ROSTER: "Curt,Jake", OPENAI_API_KEY: "k" };
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).includes("openai") ? new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bets: [{ eventId: "401003", kind: "su" }, ...five().slice(1).map((b) => ({ eventId: b.game.eventId, kind: b.kind, spread: b.spread ?? null, favorite: b.favorite ?? null, total: b.total ?? null }))], note: "Swapped bet 1 for Utah straight up." }) } }], usage: {} }), { status: 200 }) : real(u);
  const res = await worker.fetch(new Request("https://w.test/lightning?key=adm", { method: "POST", body: JSON.stringify({ action: "edit", prompt: "make bet 1 Utah to win", bets: five(), games: [g1, g2, g3] }) }), env, { waitUntil() {} });
  const j = await res.json();
  globalThis.fetch = real;
  assert.equal(res.status, 200, JSON.stringify(j));
  assert.equal(j.bets[0].game.eventId, "401003");
  assert.equal(j.bets[0].kind, "su");
  assert.match(j.note, /Utah/);
});
