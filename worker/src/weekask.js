// "Ask the week": the model only reads a question into game outcomes; the
// app runs its own win-chance maths with those outcomes fixed and says the
// numbers. The model never states odds.

export const WEEK_ASK_INTENTS = ["chance", "needs", "threats", "field", "unknown"];

export function weekAskPrompt() {
  return [
    "You read questions about a college football pick'em week and turn them into JSON. You never answer the question yourself.",
    "Input: the question, who is asking, the league members, and this week's games (id, away, home, short names, spread favourite, status).",
    'Return {"intent": "chance" | "needs" | "threats" | "field" | "unknown", "who": member name or null, "conditions": [{"game": id, "team": full team name exactly as given, "mode": "SU" | "ATS"}]}.',
    "intent chance: can someone win the week, their odds, optionally if some games go a certain way (if Michigan wins, if LSU covers).",
    "intent needs: what does someone need to happen to win.",
    "intent threats: who can still catch or beat someone.",
    "intent field: about everyone at once: who is eliminated or still alive, who is favourite, everyone's odds (optionally if some games go a certain way). who is null.",
    "intent unknown: anything else (not about this week's race).",
    "who: the member the question is about; 'I', 'me', 'my' means the asker. null if nobody is named and there is no asker.",
    "conditions: one per game outcome the question assumes. 'wins' or 'beats' is SU. 'covers' or a spread number is ATS. A team losing means the other team in that game wins (SU) or covers (ATS). Only games from the list. Empty if none.",
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
    if (!conditions.some((x) => String(x.game) === String(g.id))) conditions.push({ game: g.id, team, mode });
  }
  return { intent, who, conditions };
}
