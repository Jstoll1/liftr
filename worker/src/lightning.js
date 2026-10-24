// Lightning: the late night pot. The commissioner builds five quick bets
// on the night's late games in the live page editor (a spread, a straight
// up winner or an over/under, each with two sides), sets a buy-in and one
// lock time, and activates it around 9:30. Phones then flash the five up
// one at a time to swipe: right for side A, left for side B, plus a
// tiebreaker guess at the last game's total points. One point per bet
// right; the most points takes the pot, the closest tiebreaker breaks a
// tie, and a dead heat splits. Like the side bet, the app keeps the ledger
// only: money changes hands outside it. A draft is the commissioner's
// alone until it is activated.

export const lightningKey = (week) => `lightning:w${week}`;
export const lightningEntryKey = (week, nightId, manager) => `lightning:w${week}:${nightId}:${manager}`;
export const LIGHTNING_HISTORY_KEY = "lightning:history";
export const LIGHTNING_BETS = 5;
export const LIGHTNING_MAX_BUYIN = 500;
const KINDS = ["ats", "su", "ou"];

const kickMs = (g) => new Date(g?.kickoff).getTime();
const str = (v, max = 80) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
const half = (n) => Number.isFinite(n) && Math.round(n * 2) === n * 2;

// A game as the editor sends it, from ESPN's late scoreboard. Returns the
// clean game or null.
export function cleanGame(g) {
  const eventId = String(g?.eventId || "");
  if (!/^\d{5,12}$/.test(eventId)) return null;
  const away = str(g.away), home = str(g.home), awayShort = str(g.awayShort, 24), homeShort = str(g.homeShort, 24);
  const awayId = Number(g.awayId), homeId = Number(g.homeId), kick = kickMs(g);
  if (!away || !home || !awayShort || !homeShort || away === home) return null;
  if (!Number.isInteger(awayId) || !Number.isInteger(homeId) || !Number.isFinite(kick)) return null;
  return { eventId, away, home, awayShort, homeShort, awayId, homeId, kickoff: new Date(kick).toISOString(), ...(str(g.kickoffLabel, 40) ? { kickoffLabel: str(g.kickoffLabel, 40) } : {}) };
}

// One bet: a game, a kind and its line. Side A is the away team (spread or
// straight up) or the over; side B the home team or the under. The labels
// are written here, so a phone never has to work out what a side means.
export function cleanBet(b) {
  const game = cleanGame(b?.game);
  if (!game) return { error: "A bet is missing its game." };
  const kind = String(b?.kind || "");
  if (!KINDS.includes(kind)) return { error: `Bet on ${game.awayShort} at ${game.homeShort} needs a kind: spread, straight up or over/under.` };
  const where = `${game.awayShort} at ${game.homeShort}`;
  if (kind === "ou") {
    const total = Number(b.total);
    if (!half(total) || total < 10 || total > 150) return { error: `${where}: the over/under needs a total like 52.5.` };
    return { bet: { kind, game, total, a: `Over ${total}`, b: `Under ${total}` } };
  }
  if (kind === "su") return { bet: { kind, game, a: game.awayShort, b: game.homeShort } };
  // Spread: a favourite and a number. A pick'em (0) has no favourite.
  const spread = Number(b.spread);
  if (!half(spread) || spread < 0 || spread > 70) return { error: `${where}: the spread needs a number like 3.5.` };
  const favorite = spread === 0 ? null : b.favorite === game.away || b.favorite === game.home ? b.favorite : null;
  if (spread !== 0 && !favorite) return { error: `${where}: say which team is favoured.` };
  const line = (team) => (spread === 0 ? "PK" : `${team === favorite ? "-" : "+"}${spread}`);
  return { bet: { kind, game, spread, ...(favorite ? { favorite } : {}), a: `${game.awayShort} ${line(game.away)}`, b: `${game.homeShort} ${line(game.home)}` } };
}

// A night from the editor: five bets, a buy-in and one lock time. The
// tiebreaker is the total points of the last of the games to kick off.
// Returns { night } or { error }. A night that is already live keeps its
// id (so nobody in is dropped) unless replace is asked for.
export function buildNight({ week, bets, buyIn, closesAt, now, prev = null }) {
  const list = Array.isArray(bets) ? bets : [];
  if (list.length !== LIGHTNING_BETS) return { error: `Lightning is ${LIGHTNING_BETS} bets; this has ${list.length}.` };
  const clean = [];
  for (const b of list) { const c = cleanBet(b); if (c.error) return c; clean.push(c.bet); }
  const seen = new Set(clean.map((b) => `${b.game.eventId}:${b.kind}`));
  if (seen.size !== clean.length) return { error: "Two bets are the same bet on the same game." };
  const amt = Number(buyIn);
  if (!Number.isInteger(amt) || amt < 1 || amt > LIGHTNING_MAX_BUYIN) return { error: `Buy-in must be a whole dollar amount from 1 to ${LIGHTNING_MAX_BUYIN}.` };
  const close = Number(closesAt);
  if (!Number.isFinite(close) || close <= now) return { error: "Set a lock time that is still to come." };
  if (close > now + 12 * 3600000) return { error: "The lock time is more than twelve hours away." };
  const last = clean.reduce((a, b) => (kickMs(b.game) > kickMs(a.game) ? b : a));
  const bet = (b, i) => ({ id: `b${i + 1}`, ...b });
  return { night: {
    week, id: prev?.id || String(now), status: prev?.status || "draft",
    bets: clean.map(bet), buyIn: amt, closesAt: close,
    tbEvent: last.game.eventId, tbLabel: `${last.game.awayShort} at ${last.game.homeShort}`,
    createdAt: prev?.createdAt || now, ...(prev ? { editedAt: now } : {}), ...(prev?.activatedAt ? { activatedAt: prev.activatedAt } : {}),
  } };
}

export function activate(night, now) {
  if (!night) return { error: "There is no Lightning night to activate." };
  if (night.status === "live") return { night };
  if (now >= night.closesAt) return { error: "The lock time has passed: move it later before activating." };
  return { night: { ...night, status: "live", activatedAt: now } };
}

// A player's answers: side "a" or "b" for every bet, and the tiebreaker.
export function cleanAnswers(night, picks, tb) {
  const out = {};
  for (const b of night.bets) {
    const p = picks?.[b.id];
    if (p !== "a" && p !== "b") return { error: `Swipe every bet: ${b.a} or ${b.b} is missing.` };
    out[b.id] = p;
  }
  const guess = Number(tb);
  if (tb == null || tb === "" || !Number.isInteger(guess) || guess < 0 || guess > 200) return { error: `Enter a tiebreaker guess: total points in ${night.tbLabel}.` };
  return { picks: out, tb: guess };
}

export function joinNight(night, prev, picks, tb, now) {
  if (!night || night.status !== "live") return { error: "Lightning is not on right now." };
  if (now >= night.closesAt) return { error: "Lightning has locked." };
  return { entry: { in: true, picks, tb, at: prev?.in ? prev.at : now, savedAt: now, ...(prev?.paid ? { paid: true } : {}) } };
}
export function declineNight(night, now) {
  if (!night || night.status !== "live") return { error: "Lightning is not on right now." };
  if (now >= night.closesAt) return { error: "Lightning has locked." };
  return { entry: { in: false, at: now } };
}

// Which side won a bet from the final score: "a", "b", "push" or null
// (no final yet).
export function betResult(bet, final) {
  if (!final) return null;
  const aw = Number(final.awayScore), hm = Number(final.homeScore);
  if (!Number.isFinite(aw) || !Number.isFinite(hm)) return null;
  if (bet.kind === "ou") { const t = aw + hm; return t > bet.total ? "a" : t < bet.total ? "b" : "push"; }
  if (bet.kind === "su") return aw > hm ? "a" : hm > aw ? "b" : "push";
  // Spread: the away side's margin with its line added.
  const awayLine = !bet.favorite ? 0 : bet.favorite === bet.game.away ? -bet.spread : bet.spread;
  const m = aw - hm + awayLine;
  return m > 0 ? "a" : m < 0 ? "b" : "push";
}

// The table: points per player (a push scores nothing for anyone), how
// close their tiebreaker is once the last game is final, and the winners
// when every bet is settled.
export function standings(night, entries, finals) {
  const res = Object.fromEntries(night.bets.map((b) => [b.id, betResult(b, finals?.[b.game.eventId])]));
  const tbFinal = finals?.[night.tbEvent];
  const tbTotal = tbFinal ? Number(tbFinal.awayScore) + Number(tbFinal.homeScore) : null;
  const rows = Object.entries(entries || {}).filter(([, e]) => e?.in && e.picks).map(([name, e]) => ({
    name, points: night.bets.filter((b) => res[b.id] && res[b.id] !== "push" && e.picks[b.id] === res[b.id]).length,
    tb: e.tb, off: tbTotal == null || e.tb == null ? null : Math.abs(e.tb - tbTotal),
  })).sort((x, y) => y.points - x.points || (x.off ?? 999) - (y.off ?? 999) || x.name.localeCompare(y.name));
  const done = night.bets.every((b) => res[b.id]) && tbTotal != null;
  let winners = [];
  if (done && rows.length) {
    const top = rows[0].points, best = Math.min(...rows.filter((r) => r.points === top).map((r) => r.off ?? 999));
    winners = rows.filter((r) => r.points === top && (r.off ?? 999) === best).map((r) => r.name);
  }
  return { results: res, tbTotal, rows, done, winners };
}

// What a phone sees. A draft is the commissioner's only. Who is in is
// public; what they picked stays hidden from everyone else until the lock.
export function viewNight(night, entries, finals, now, viewer) {
  if (!night) return null;
  if (night.status !== "live" && !viewer?.all) return null;
  const open = now < night.closesAt;
  const entrants = {}, declined = [];
  for (const [n, e] of Object.entries(entries || {})) {
    if (!e) continue;
    if (!e.in) { declined.push(n); continue; }
    const show = !open || viewer?.all || viewer?.me === n;
    entrants[n] = { at: e.at, ...(e.paid ? { paid: true } : {}), ...(show ? { picks: e.picks, tb: e.tb } : { hidden: true }) };
  }
  const table = open ? null : standings(night, entries, finals);
  return { ...night, finals: finals || {}, open, entrants, declined, ...(table ? { table } : {}) };
}

// Finals for the night's games, posted by the first phone that sees each
// end. A game takes a final only once it could be over (two and a half
// hours after kickoff); one already kept stays unless the commissioner
// sends it again.
export function cleanFinals(night, posted, kept, now, admin = false) {
  if (!night || night.status !== "live") return { error: "No Lightning night to settle." };
  if (now < night.closesAt) return { error: "Lightning is still open." };
  const games = new Map(night.bets.map((b) => [b.game.eventId, b.game]));
  const out = {};
  for (const [id, f] of Object.entries(posted || {})) {
    const g = games.get(String(id));
    if (!g || (kept?.[id] && !admin)) continue;
    const a = Number(f?.awayScore), h = Number(f?.homeScore);
    if (!Number.isInteger(a) || !Number.isInteger(h) || a < 0 || h < 0 || a > 200 || h > 200) return { error: `Bad score for game ${id}.` };
    if (now < kickMs(g) + 150 * 60000) return { error: `Game ${id} can't be final yet.` };
    out[id] = { awayScore: a, homeScore: h };
  }
  return { finals: out };
}

// The season's record of a finished night.
export function historyRecord(night, entries, finals) {
  const t = standings(night, entries, finals);
  if (!t.done) return null;
  const entrants = {};
  for (const [n, e] of Object.entries(entries || {})) if (e?.in && e.picks) entrants[n] = { picks: e.picks, tb: e.tb };
  return { week: night.week, id: night.id, buyIn: night.buyIn, bets: night.bets, tbEvent: night.tbEvent, tbLabel: night.tbLabel, finals, entrants, winners: t.winners, rows: t.rows };
}

// The prompt for an edit asked of the model in the editor: the current
// five, the games on offer, and the instruction. It answers with five bets
// in the same shape; the Worker checks every one before the editor sees it.
export function editPrompt() {
  return [
    "You edit a five-bet 'Lightning' card for a friends' college football pick'em, late night games only.",
    "Each bet is {eventId, kind, spread, favorite, total}: kind is 'ats' (point spread: set spread as a positive half or whole number and favorite as the favoured team's full name, or spread 0 for a pick'em), 'su' (straight up winner: no line) or 'ou' (over/under: set total).",
    "Only use games from the 'games' list (by eventId) and their real lines from that list unless the instruction gives a number. Never invent a game or a team.",
    "Apply the instruction to the current card and return exactly five bets, keeping the ones the instruction does not touch. Two bets may be on the same game only if their kinds differ.",
    "Return JSON: {\"bets\": [{\"eventId\": \"...\", \"kind\": \"ats|su|ou\", \"spread\": number|null, \"favorite\": string|null, \"total\": number|null}], \"note\": \"one short sentence on what changed\"}",
  ].join(" ");
}
// The model's bets back on the editor's games: the full game from the list,
// the line from the answer.
export function betsFromModel(answer, games) {
  const byId = new Map((games || []).map((g) => [String(g.eventId), g]));
  const out = [];
  for (const x of Array.isArray(answer?.bets) ? answer.bets : []) {
    const game = byId.get(String(x?.eventId));
    if (!game) return { error: `The edit used a game that is not on tonight's list (${x?.eventId}).` };
    out.push({ game, kind: x.kind, spread: x.spread, favorite: x.favorite, total: x.total });
  }
  return { bets: out, note: typeof answer?.note === "string" ? answer.note.slice(0, 200) : "" };
}
