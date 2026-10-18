// The late night side pot. Once the week is decided, the commissioner
// picks a few of the slate's games, at the slate's lines, that are not
// over yet (still to come, or on now), and sets a buy-in; anyone can opt in and
// pick those same games, scored like the main pool, plus an over/under on
// each game that has a total (2 points) and a tiebreaker guess at the last
// game's total points (closest wins a tie on points; a dead heat splits). Entry, and every side
// pick, closes at the first of those kickoffs, but never sooner than
// ENTRY_MIN_MS after the pot opens, so there is time to get in on a game
// that is about to start or already on. The app keeps the ledger only:
// money changes hands outside it.

export const sideKey = (week) => `side:w${week}`;
export const SIDE_MAX_GAMES = 5;
export const SIDE_MAX_BUYIN = 500;
// The Worker does not read live scores, so "not over" is judged by the
// clock here (no college game runs this long); the console also leaves
// out anything the live feed already has as final.
export const LIVE_MS = 5 * 3600000;
export const ENTRY_MIN_MS = 20 * 60000; // entry stays open at least this long

const kickMs = (g) => new Date(g?.kickoff).getTime();
// A total is a whole or half point, in any range a football game plays to.
const cleanTotal = (v) => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) && n >= 10 && n <= 150 && Math.round(n * 2) === n * 2 ? n : null; };

const GAME_FIELDS = ["id", "away", "home", "awayShort", "homeShort", "awayId", "homeId", "favorite", "spread", "kickoff", "kickoffLabel"];
const pickFields = (g) => Object.fromEntries(GAME_FIELDS.filter((f) => g[f] != null).map((f) => [f, g[f]]));

// A game off the week's slate comes from the console with ESPN's line,
// its id "e" plus the ESPN event id. A second-half bet on any game is "h"
// plus the event id, at the line the commissioner set, and is scored on
// third quarter and later points only. Returns the clean game or null.
export function cleanExtraGame(g) {
  const id = String(g?.id || "");
  if (!/^[eh]\d{5,12}$/.test(id)) return null;
  const str = (v) => (typeof v === "string" && v.trim() && v.length <= 80 ? v.trim() : null);
  const away = str(g.away), home = str(g.home), awayShort = str(g.awayShort), homeShort = str(g.homeShort), favorite = str(g.favorite);
  const awayId = Number(g.awayId), homeId = Number(g.homeId), spread = Number(g.spread), kick = new Date(g.kickoff).getTime();
  if (!away || !home || !awayShort || !homeShort || !favorite || away === home) return null;
  if (favorite !== away && favorite !== home) return null;
  if (!Number.isInteger(awayId) || !Number.isInteger(homeId)) return null;
  if (!Number.isFinite(spread) || spread < 0 || spread > 80 || Math.round(spread * 2) !== spread * 2) return null;
  if (!Number.isFinite(kick)) return null;
  const total = cleanTotal(g.total);
  return { id, away, home, awayShort, homeShort, awayId, homeId, favorite, spread, ...(total != null ? { total } : {}), kickoff: new Date(kick).toISOString(), kickoffLabel: str(g.kickoffLabel) || "", eventId: id.slice(1), ...(id[0] === "h" ? { half: 2 } : {}) };
}

// A new pot from the commissioner's choice. A game on the week's slate
// (given by its id) keeps the slate's line; any other game comes whole.
// The pot keeps every game in full, so scoring never depends on the slate
// changing later. Returns { pot } or { error }.
// closeAt, when the commissioner sets it (a second-half bet closes at the
// end of halftime, which only they can judge), replaces the usual close.
export const CLOSE_MIN_MS = 5 * 60000, CLOSE_MAX_MS = 8 * 3600000;
export function newPot({ week, games, buyIn, slate, now, closeAt = null }) {
  const list = Array.isArray(games) ? games : [];
  const byId = new Map((slate?.games || []).map((g) => [String(g.id), g]));
  const chosen = new Map();
  for (const item of list) {
    const key = String(item && typeof item === "object" ? item.id : item);
    // A slate game keeps the slate's line; its total (the slate has none)
    // comes from the console, read from ESPN.
    const total = byId.has(key) && item && typeof item === "object" ? cleanTotal(item.total) : null;
    const g = byId.has(key) ? { ...pickFields(byId.get(key)), ...(total != null ? { total } : {}) } : cleanExtraGame(item);
    if (!g) return { error: /^\d+$/.test(key) ? `Game ${key} is not on this week's slate.` : "One of those games is missing its line or teams." };
    chosen.set(String(g.id), g);
  }
  if (chosen.size < 1 || chosen.size > SIDE_MAX_GAMES) return { error: `Pick 1 to ${SIDE_MAX_GAMES} games.` };
  for (const g of chosen.values()) {
    if (!Number.isFinite(kickMs(g)) || now >= kickMs(g) + LIVE_MS) return { error: `${g.awayShort} at ${g.homeShort} is over.` };
  }
  const amt = Number(buyIn);
  if (!Number.isInteger(amt) || amt < 1 || amt > SIDE_MAX_BUYIN) return { error: `Buy-in must be a whole dollar amount from 1 to ${SIDE_MAX_BUYIN}.` };
  const sorted = [...chosen.values()].sort((a, b) => kickMs(a) - kickMs(b) || String(a.id).localeCompare(String(b.id)));
  return { pot: { week, id: String(now), games: sorted.map((g) => g.id), slate: sorted, tbGame: sorted[sorted.length - 1].id, buyIn: amt, closesAt: Number.isFinite(Number(closeAt)) && closeAt !== null && Number(closeAt) >= now + CLOSE_MIN_MS && Number(closeAt) <= now + CLOSE_MAX_MS ? Number(closeAt) : Math.max(kickMs(sorted[0]), now + ENTRY_MIN_MS), createdAt: now } };
}

// Side picks must cover every pot game: a team playing in it, against the
// spread or straight up, and over or under where the game has a total; and
// a tiebreaker guess when the pot has one. Returns { picks, tb } or { error }.
export function cleanSidePicks(pot, slate, picks, tb) {
  const byId = new Map((pot.slate || slate?.games || []).map((g) => [String(g.id), g]));
  const out = {};
  for (const id of pot.games) {
    const g = byId.get(String(id)), p = picks?.[id];
    if (!g) return { error: `Game ${id} is no longer on the slate.` };
    if (!p || (p.team !== g.away && p.team !== g.home)) return { error: `Pick a team in ${g.awayShort} at ${g.homeShort}.` };
    if (p.mode !== "ATS" && p.mode !== "SU") return { error: `Pick ATS or SU in ${g.awayShort} at ${g.homeShort}.` };
    if (g.total != null && p.ou !== "over" && p.ou !== "under") return { error: `Pick over or under in ${g.awayShort} at ${g.homeShort}.` };
    out[id] = { team: p.team, mode: p.mode, ...(g.total != null ? { ou: p.ou } : {}) };
  }
  if (pot.tbGame == null) return { picks: out };
  const guess = Number(tb);
  if (tb == null || tb === "" || !Number.isInteger(guess) || guess < 0 || guess > 200) return { error: "Enter a tiebreaker guess: total points in the last game." };
  return { picks: out, tb: guess };
}

// Each player's answer is its own record, so a rush of joins the moment the
// prompt goes out cannot overwrite one another. The pot id is in the key,
// so a replaced pot starts with nobody in.
export const entryKey = (week, potId, manager) => `side:w${week}:${potId}:${manager}`;

export function joinEntry(pot, prev, picks, now, tb = null) {
  if (now >= pot.closesAt) return { error: "The side pot has closed." };
  return { entry: { in: true, picks, ...(tb != null ? { tb } : {}), at: prev?.in ? prev.at : now, savedAt: now, ...(prev?.paid ? { paid: true } : {}) } };
}

// No thanks, which also takes someone back out if they had joined.
export function declineEntry(pot, prev, now) {
  if (now >= pot.closesAt) return { error: "The side pot has closed." };
  return { entry: { in: false, at: now } };
}

// What a phone sees. Who is in is public from the start; what they picked
// stays hidden from everyone else until the pot closes. A player's own
// picks always come back.
export function viewPot(pot, entries, now, viewer) {
  const open = now < pot.closesAt;
  const entrants = {}, declined = [];
  for (const [n, e] of Object.entries(entries || {})) {
    if (!e) continue;
    if (!e.in) { declined.push(n); continue; }
    const show = !open || viewer?.all || viewer?.me === n;
    entrants[n] = { at: e.at, ...(e.paid ? { paid: true } : {}), ...(show ? { picks: e.picks, ...(e.tb != null ? { tb: e.tb } : {}) } : { hidden: true }) };
  }
  return { week: pot.week, id: pot.id, games: pot.games, ...(pot.slate ? { slate: pot.slate } : {}), ...(pot.tbGame != null ? { tbGame: pot.tbGame } : {}), buyIn: pot.buyIn, closesAt: pot.closesAt, createdAt: pot.createdAt, open, entrants, declined };
}
