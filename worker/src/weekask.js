// "Ask the week": the model only reads a question into game outcomes; the
// app runs its own win-chance maths with those outcomes fixed and says the
// numbers. The model never states odds.

export const WEEK_ASK_INTENTS = ["chance", "needs", "threats", "field", "max", "picks", "tiebreaker", "unknown"];

export function weekAskPrompt() {
  return [
    "You read questions about a college football pick'em week and turn them into JSON. You never answer the question yourself.",
    "Input: the question, who is asking, the league members, and this week's games (id, away, home, short names, spread favourite, status).",
    'Return {"intent": "chance" | "needs" | "threats" | "field" | "max" | "picks" | "tiebreaker" | "unknown", "who": member name or null, "conditions": [{"game": id, "team": the team named in the question, full name exactly as given, "mode": "SU" | "ATS", "not": true | false}]}.',
    "intent chance: can someone win the week, their odds, optionally if some games go a certain way (if Michigan wins, if LSU covers).",
    "intent needs: what does someone need to happen to win.",
    "intent threats: who can still catch or beat someone.",
    "intent field: about everyone at once: who is eliminated or still alive, who is favourite, everyone's odds (optionally if some games go a certain way). who is null.",
    "intent max: the most points someone can still finish with, or whether they can still reach a number or catch a score.",
    "intent picks: who picked a team or a side of a game, how the room split on a game, or someone's pick on a game. Put that game in conditions with the team asked about (mode SU unless a spread or covering is mentioned).",
    "intent tiebreaker: anything about the tiebreaker game, guesses or total points.",
    "intent unknown: anything else (not about this week's race).",
    "who: the member the question is about; 'I', 'me', 'my' means the asker. null if nobody is named and there is no asker.",
    "conditions: one per game outcome the question assumes. 'wins' or 'beats' is SU. 'covers', 'cover' or a spread number is ATS. Keep the team the question names and set not: true when it says that team does NOT win or does NOT cover (doesn't, does not, fails to, loses, misses): 'if IU doesn't cover' is {team: Indiana, mode: ATS, not: true}. Only games from the list. Empty if none.",
    "If the question follows up or corrects the previous question (given as previous), carry over what it does not change: 'I said if IU doesn't cover' keeps the previous intent and fixes the condition.",
    "Never invent games, teams or members. Never include odds or prose.",
  ].join("\n");
}

// The model's JSON, checked against this week's games and members.
export function parseWeekAsk(raw, games, members, asker) {
  let j = raw;
  if (typeof raw === "string") { try { j = JSON.parse(raw); } catch { return { intent: "unknown", who: null, conditions: [] }; } }
  const intent = WEEK_ASK_INTENTS.includes(j?.intent) ? j.intent : "unknown";
  const byName = new Map(members.map((m) => [m.toLowerCase(), m]));
  let who = typeof j?.who === "string" ? byName.get(j.who.trim().toLowerCase()) || null : null;
  if (!who && asker && members.includes(asker)) who = asker;
  const conditions = [];
  for (const c of Array.isArray(j?.conditions) ? j.conditions.slice(0, 6) : []) {
    const g = games.find((x) => String(x.id) === String(c?.game));
    if (!g) continue;
    const t = String(c?.team || "").toLowerCase();
    const team = [g.away, g.home].find((x) => x.toLowerCase() === t) || [[g.away, g.awayShort], [g.home, g.homeShort]].find(([full, sh]) => sh && sh.toLowerCase() === t)?.[0];
    if (!team) continue;
    const mode = c?.mode === "ATS" ? "ATS" : "SU";
    // "Does not cover / does not win" is the other side doing it; flipped
    // here rather than trusted to the model.
    if (c?.not === true) { const other = team === g.away ? g.home : g.away; if (!conditions.some((x) => String(x.game) === String(g.id))) conditions.push({ game: g.id, team: other, mode }); continue; }
    if (!conditions.some((x) => String(x.game) === String(g.id))) conditions.push({ game: g.id, team, mode });
  }
  return { intent, who, conditions };
}
