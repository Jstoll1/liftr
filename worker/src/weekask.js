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

// --- Chat (tool calling) ----------------------------------------------------
// What the league calls people. Tools take the member name on the left;
// replies use the first name after it (what the app shows).
export const MEMBER_ALIASES = {
  Jordan: ["Woods"],
  Conlan: ["Connie", "Conlin"],
  Skills: ["Adam"],
  Logan: ["Logs"],
  Dewitt: ["DeWitt", "Tyler", "Tyler DeWitt"],
};
const SHOWN = { Conlan: "Connie" };
// The model holds the conversation and writes the reply; every fact comes
// from a tool the phone runs with the app's own maths, so no number is made
// up. The Worker never runs the tools: it relays the calls and results.
export const WEEK_CHAT_TOOLS = [
  { type: "function", function: { name: "standings", description: "Everyone's week right now: points banked, live points if games ended now, best possible finish, chance to win the week, eliminated or not.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "chance", description: "Everyone's chance to win the week if some games go a given way. Use for any 'if X wins / covers / doesn't cover' question. With no conditions it is the current odds.", parameters: { type: "object", properties: { conditions: { type: "array", items: { type: "object", properties: { game: { type: "string", description: "game id" }, team: { type: "string", description: "team named in the question" }, mode: { type: "string", enum: ["SU", "ATS"], description: "SU = wins outright, ATS = covers the spread" }, not: { type: "boolean", description: "true when the question says this team does NOT win / does NOT cover" } }, required: ["game", "team", "mode", "not"], additionalProperties: false } } }, required: ["conditions"], additionalProperties: false } } },
  { type: "function", function: { name: "scenarios", description: "Exact outcomes, no simulation: every way the still-open games can land (winner, margin vs the spread, push) and who wins the week in each, with ties settled by the tiebreaker total. Use when 3 or fewer games are open, or for 'what's the ultimate outcome', 'what exactly do I need', 'how does this end'. Conditions hold games to a side, same as chance.", parameters: { type: "object", properties: { conditions: { type: "array", items: { type: "object", properties: { game: { type: "string", description: "game id" }, team: { type: "string" }, mode: { type: "string", enum: ["SU", "ATS"] }, not: { type: "boolean" } }, required: ["game", "team", "mode", "not"], additionalProperties: false } } }, required: ["conditions"], additionalProperties: false } } },
  { type: "function", function: { name: "needs", description: "For one member: their open picks ranked by how much each swings their chance to win, with the chance if it hits and if it misses.", parameters: { type: "object", properties: { member: { type: "string" } }, required: ["member"], additionalProperties: false } } },
  { type: "function", function: { name: "picks", description: "Who picked which side of one game (only picks already shown, from that game's kickoff on), and locks.", parameters: { type: "object", properties: { game: { type: "string", description: "game id" } }, required: ["game"], additionalProperties: false } } },
  { type: "function", function: { name: "tiebreaker", description: "The tiebreaker game, its current or final total, and everyone's guesses (hidden before the first kickoff).", parameters: { type: "object", properties: {}, additionalProperties: false } } },
];

export function weekChatSystem(ctx) {
  const games = (ctx.games || []).map((g) => `G${g.id}: ${g.away} (${g.awayShort}) at ${g.home} (${g.homeShort}), ${g.favorite ? `${g.favorite} −${g.spread}` : "pick'em"}, ${g.status}${g.score ? ` ${g.score}` : ""}`).join("\n");
  return [
    "You are BroChief Intelligence (BI), the BroChiefs pick'em league's assistant for this week. Friendly, brief, plain words; one to three short sentences unless a list is asked for.",
    "Scoring: each member picks every game, either against the spread (ATS) or straight up (SU, worth more for an underdog). One pick a week can be a lock: it scores extra if it hits and loses points if it misses. Most points wins the week; the tiebreaker is total points in one game.",
    `The member asking is ${ctx.asker || "unknown (not signed in)"}; "I", "me", "my" mean them. Members: ${(ctx.members || []).join(", ")}.`,
    `Nicknames (pass the member name to tools): ${(ctx.members || []).filter((m) => MEMBER_ALIASES[m]).map((m) => `${MEMBER_ALIASES[m].join(" / ")} = ${m}`).join("; ")}. In replies call people what the app shows: ${(ctx.members || []).map((m) => SHOWN[m] || m).join(", ")}. If a name matches nobody, ask who they mean; never guess a different member.`,
    `This week's games:\n${games}`,
    "Never state a number, a pick, an odds figure or an outcome you did not get from a tool in this conversation. Call the tools you need, then answer from their results. Chances are fractions: say them as percents, whole numbers from 10% up and one decimal under 10% (0.007 is 0.7%, never 1%).",
    "Questions with 'if' about game results: call chance with conditions. 'Doesn't cover', 'doesn't win', 'loses' is not: true on the team named. A correction or follow-up ('I said…', 'what about Curt') reuses the earlier question with the change.",
    "Who is out: use each member's status. Only status 'out' is eliminated. 'long shot' means 0% in the simulations but a path still exists: say it is a long shot and, if asked, what must happen (onlyPath). 'likely out' means no path was found but it isn't proven. Never call someone eliminated just because their chance is 0%.",
    "Late in the night: when 3 or fewer games are still open (see the game list), answer 'how do I win', 'what's the outcome', 'what do I need' with scenarios, not chance: give exact outcomes ('NDSU by 1 to 6: you win; by 7+: Connie'), not percents. If scenarios says settled, say it is decided.",
    "Keep what the asker told you: if they say a game is 'in place', 'locked up' or 'holding', carry it as a condition on every later call, and say plainly that it is not final yet if the game list shows it live. Never drop a condition the asker gave earlier unless they take it back.",
    "To stop or eliminate someone: call needs for them; their biggest swings are the games that hurt them most if they miss. For a long shot, any result off their onlyPath ends it.",
    "Tone: match the asker. If the question is trash talk ('how did Dewitt get out so fast', 'is Logan even trying'), answer with the facts and a light, friendly jab about the picks or the football. Never mean about anything but this week's picks.",
    "If a tool says picks are hidden, say so; never guess hidden picks. If the question is not about this week's pick'em, say briefly what you can help with.",
  ].join("\n\n");
}

// A conversation from the phone, cleaned: only user, assistant (with tool
// calls) and tool turns, trimmed; the system prompt is always the Worker's.
export function cleanChat(messages) {
  const out = [];
  for (const m of (Array.isArray(messages) ? messages : []).slice(-24)) {
    if (m?.role === "user" && typeof m.content === "string") out.push({ role: "user", content: m.content.slice(0, 500) });
    else if (m?.role === "assistant") {
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls.slice(0, 6).filter((c) => c?.id && c.function?.name && WEEK_CHAT_TOOLS.some((t) => t.function.name === c.function.name)).map((c) => ({ id: String(c.id).slice(0, 80), type: "function", function: { name: c.function.name, arguments: String(c.function.arguments || "{}").slice(0, 2000) } })) : [];
      out.push({ role: "assistant", content: typeof m.content === "string" ? m.content.slice(0, 2000) : null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else if (m?.role === "tool" && m.tool_call_id) out.push({ role: "tool", tool_call_id: String(m.tool_call_id).slice(0, 80), content: String(m.content || "").slice(0, 6000) });
  }
  // A tool turn must follow the assistant turn that asked for it.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
