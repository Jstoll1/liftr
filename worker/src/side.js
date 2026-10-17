// The late night side pot. Once the week is decided, the commissioner
// picks a few games still to kick off and sets a buy-in; anyone can opt in
// and pick those same games, scored like the main pool. Entry, and every
// side pick, closes at the first of those kickoffs. The app keeps the
// ledger only: money changes hands outside it.

export const sideKey = (week) => `side:w${week}`;
export const SIDE_MAX_GAMES = 5;
export const SIDE_MAX_BUYIN = 500;

const kickMs = (g) => new Date(g?.kickoff).getTime();

// A new pot from the commissioner's choice, checked against the week's
// slate. Returns { pot } or { error }.
export function newPot({ week, games, buyIn, slate, now }) {
  const ids = [...new Set((Array.isArray(games) ? games : []).map(Number))];
  if (ids.length < 1 || ids.length > SIDE_MAX_GAMES) return { error: `Pick 1 to ${SIDE_MAX_GAMES} games.` };
  const byId = new Map((slate?.games || []).map((g) => [Number(g.id), g]));
  for (const id of ids) {
    const g = byId.get(id);
    if (!g) return { error: `Game ${id} is not on this week's slate.` };
    if (!Number.isFinite(kickMs(g)) || now >= kickMs(g)) return { error: `${g.awayShort} at ${g.homeShort} has already kicked off.` };
  }
  const amt = Number(buyIn);
  if (!Number.isInteger(amt) || amt < 1 || amt > SIDE_MAX_BUYIN) return { error: `Buy-in must be a whole dollar amount from 1 to ${SIDE_MAX_BUYIN}.` };
  const sorted = ids.sort((a, b) => kickMs(byId.get(a)) - kickMs(byId.get(b)) || a - b);
  return { pot: { week, id: String(now), games: sorted, buyIn: amt, closesAt: kickMs(byId.get(sorted[0])), createdAt: now } };
}

// Side picks must cover every pot game: a team playing in it, against the
// spread or straight up. Returns { picks } or { error }.
export function cleanSidePicks(pot, slate, picks) {
  const byId = new Map((slate?.games || []).map((g) => [Number(g.id), g]));
  const out = {};
  for (const id of pot.games) {
    const g = byId.get(id), p = picks?.[id] ?? picks?.[String(id)];
    if (!g) return { error: `Game ${id} is no longer on the slate.` };
    if (!p || (p.team !== g.away && p.team !== g.home)) return { error: `Pick a team in ${g.awayShort} at ${g.homeShort}.` };
    if (p.mode !== "ATS" && p.mode !== "SU") return { error: `Pick ATS or SU in ${g.awayShort} at ${g.homeShort}.` };
    out[id] = { team: p.team, mode: p.mode };
  }
  return { picks: out };
}

// Each player's answer is its own record, so a rush of joins the moment the
// prompt goes out cannot overwrite one another. The pot id is in the key,
// so a replaced pot starts with nobody in.
export const entryKey = (week, potId, manager) => `side:w${week}:${potId}:${manager}`;

export function joinEntry(pot, prev, picks, now) {
  if (now >= pot.closesAt) return { error: "The side pot has closed." };
  return { entry: { in: true, picks, at: prev?.in ? prev.at : now, savedAt: now, ...(prev?.paid ? { paid: true } : {}) } };
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
    entrants[n] = { at: e.at, ...(e.paid ? { paid: true } : {}), ...(show ? { picks: e.picks } : { hidden: true }) };
  }
  return { week: pot.week, id: pot.id, games: pot.games, buyIn: pot.buyIn, closesAt: pot.closesAt, createdAt: pot.createdAt, open, entrants, declined };
}
