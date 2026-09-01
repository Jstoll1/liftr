// Liftr AI Worker
//
// Holds the OpenAI API key server-side (never exposed to the browser) and
// picks today's exercises for a user from a fixed candidate list, given
// their goal, time budget, energy level, and whether they have a partner.
// The model is constrained to only choose exercises we already gave it —
// it can reorder/trim/include, never invent — so the response is always
// safe to render directly in the app.

const MINUTES_TO_COUNT = { 15: 2, 30: 3, 45: 4, 60: 5 };

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, corsHeaders);
    }

    if (body?.mode === "chat") {
      return handleChat(body, env, corsHeaders);
    }

    const { persona, split, minutes, energy, partner, candidates, todayNote, pastNotes } = body || {};
    const valid =
      persona?.name &&
      persona?.goal &&
      split?.name &&
      Number.isFinite(minutes) &&
      ["low", "medium", "high"].includes(energy) &&
      Array.isArray(candidates) &&
      candidates.length > 0 &&
      candidates.every((c) => typeof c?.name === "string" && typeof c?.detail === "string");

    if (!valid) {
      return json({ error: "Malformed request" }, 400, corsHeaders);
    }

    const names = candidates.map((c) => c.name);

    const schema = {
      type: "object",
      properties: {
        chosen: {
          type: "array",
          items: { type: "string", enum: names },
          minItems: 1,
        },
        reason: {
          type: "string",
          description: "One upbeat, specific sentence explaining the picks.",
        },
      },
      required: ["chosen", "reason"],
      additionalProperties: false,
    };

    const systemPrompt = [
      "You are a sharp, encouraging personal trainer picking today's exercises",
      "from a FIXED candidate list. Never invent exercises outside that list.",
      `Aim for roughly ${MINUTES_TO_COUNT[minutes] || 4} exercises for a ${minutes}-minute session.`,
      "Prioritize whichever candidates best serve the athlete's stated goal.",
      "On low energy, trim volume and prefer the lower-fatigue candidates.",
      "If a partner is available, prefer partner-friendly candidates when present.",
      "The athlete may give a free-text note (today's, and/or recent prior days').",
      "Use it: honor equipment constraints or injuries by avoiding candidates that",
      "conflict with them, factor in stated goal changes, and if it mentions a",
      "specific weight, rep count, or exercise they struggled or excelled with,",
      "acknowledge it by name in your reason — e.g. suggest easing back toward a",
      "prior weight after a struggle, or acknowledge hitting a new threshold.",
      "Keep the reason to one specific, motivating sentence — no generic filler.",
    ].join(" ");

    const userPrompt = JSON.stringify({
      athlete: persona.name,
      goal: persona.goal,
      workoutType: split.name,
      minutesAvailable: minutes,
      energyLevel: energy,
      hasPartner: Boolean(partner),
      todayNote: todayNote || null,
      recentFeedback: Array.isArray(pastNotes) ? pastNotes : [],
      candidateExercises: candidates,
    });

    try {
      const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "workout_plan", schema, strict: true },
          },
          temperature: 0.6,
        }),
      });

      if (!aiRes.ok) {
        return json({ error: "Upstream AI error" }, 502, corsHeaders);
      }

      const aiData = await aiRes.json();
      const content = aiData.choices?.[0]?.message?.content;
      const parsed = JSON.parse(content);

      // Map chosen names back to our trusted candidate objects — the model
      // never gets to invent or alter the detail (sets/reps/duration) text.
      const byName = new Map(candidates.map((c) => [c.name, c]));
      const exercises = (parsed.chosen || []).map((name) => byName.get(name)).filter(Boolean);

      if (exercises.length === 0) {
        return json({ error: "Empty plan" }, 502, corsHeaders);
      }

      return json({ exercises, reason: parsed.reason || "" }, 200, corsHeaders);
    } catch {
      return json({ error: "Worker error" }, 500, corsHeaders);
    }
  },
};

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// Short, conversational check-in chat — the athlete can mention pain,
// fatigue, equipment limits, or anything else before picking a workout.
// Replies stay brief; anything worth factoring into exercise selection
// comes back as `constraint`, a short imperative phrase the app folds into
// the same free-text note the plan-selection endpoint already reads.
async function handleChat(body, env, corsHeaders) {
  const { persona, messages } = body;
  const valid =
    persona?.name &&
    persona?.goal &&
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.every((m) => (m?.role === "user" || m?.role === "coach") && typeof m?.text === "string");

  if (!valid) {
    return json({ error: "Malformed chat request" }, 400, corsHeaders);
  }

  const schema = {
    type: "object",
    properties: {
      reply: { type: "string", description: "A short, warm, practical reply — 1 to 3 sentences." },
      constraint: {
        type: ["string", "null"],
        description:
          "A short imperative phrase to factor into today's exercise selection (e.g. 'avoid overhead pressing, shoulder is sore'), or null if nothing constraint-worthy was said.",
      },
    },
    required: ["reply", "constraint"],
    additionalProperties: false,
  };

  const systemPrompt = [
    "You are a friendly, knowledgeable strength coach texting with an athlete",
    "before their workout, as part of a fitness app's check-in screen.",
    `The athlete is ${persona.name}, whose goal is: ${persona.goal}.`,
    "Keep replies SHORT — 1 to 3 sentences, warm and practical, not generic filler.",
    "If they mention pain, an injury, fatigue, equipment limits, or anything else",
    "that should change today's exercise selection, acknowledge it supportively",
    "and set constraint to a short imperative phrase capturing it (e.g. 'avoid",
    "overhead pressing, shoulder is sore'). If nothing like that was said, set",
    "constraint to null. Never give medical advice beyond general common sense",
    "(e.g. suggest resting an acute injury rather than pushing through it).",
  ].join(" ");

  const openaiMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role === "coach" ? "assistant" : "user", content: m.text })),
  ];

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4o-mini",
        messages: openaiMessages,
        response_format: {
          type: "json_schema",
          json_schema: { name: "chat_reply", schema, strict: true },
        },
        temperature: 0.7,
      }),
    });

    if (!aiRes.ok) {
      return json({ error: "Upstream AI error" }, 502, corsHeaders);
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);

    if (typeof parsed.reply !== "string" || !parsed.reply.trim()) {
      return json({ error: "Empty reply" }, 502, corsHeaders);
    }

    return json({ reply: parsed.reply, constraint: parsed.constraint || null }, 200, corsHeaders);
  } catch {
    return json({ error: "Worker error" }, 500, corsHeaders);
  }
}
