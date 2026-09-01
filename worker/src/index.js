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
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Cross-device sync (Cloudflare KV) — separate from the AI plan/chat
    // logic below, which stays mounted at "/" for backward compatibility.
    if (url.pathname === "/kv") {
      return handleKv(request, env, corsHeaders, url);
    }
    if (url.pathname === "/cheers") {
      return handleCheers(request, env, corsHeaders, url);
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

    const { persona, split, minutes, energy, partner, candidates, todayNote, pastNotes, weightHistory } = body || {};
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
      console.error("Malformed plan request", JSON.stringify(body));
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
        suggestedWeights: {
          type: "array",
          description:
            "A starting weight (lbs) for each chosen exercise the athlete has NO logged weight history for, " +
            "estimated from their known strength on related lifts (similar movement pattern or muscle group) " +
            "and the note the app is passing along. Skip any exercise already in weightHistory — the app already " +
            "has real data for those. Leave the array empty if you have no reasonable basis to estimate anything.",
          items: {
            type: "object",
            properties: {
              exercise: { type: "string", enum: names },
              weight: { type: "number" },
            },
            required: ["exercise", "weight"],
            additionalProperties: false,
          },
        },
      },
      required: ["chosen", "reason", "suggestedWeights"],
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
      "weightHistory lists real weights the athlete has actually logged on other",
      "exercises. For any CHOSEN exercise missing from weightHistory, estimate a",
      "conservative, sensible starting weight in suggestedWeights by reasoning",
      "from related lifts (e.g. someone who deadlifts 225 lbs probably starts",
      "Romanian Deadlift lighter, around 60-70% of that). Never guess for an",
      "exercise you have no reasonable basis for — omit it instead.",
    ].join(" ");

    const userPrompt = JSON.stringify({
      athlete: persona.name,
      goal: persona.goal,
      heightInches: persona.heightIn || null,
      bodyweightLb: persona.weightLb || null,
      focusAreas: Array.isArray(persona.focusAreas) ? persona.focusAreas : [],
      workoutType: split.name,
      minutesAvailable: minutes,
      energyLevel: energy,
      hasPartner: Boolean(partner),
      todayNote: todayNote || null,
      recentFeedback: Array.isArray(pastNotes) ? pastNotes : [],
      weightHistory: Array.isArray(weightHistory) ? weightHistory : [],
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
        console.error("OpenAI error", aiRes.status, await aiRes.text());
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
        console.error("Empty plan after mapping", JSON.stringify(parsed));
        return json({ error: "Empty plan" }, 502, corsHeaders);
      }

      // Only keep suggestions for exercises actually in today's plan, with a
      // real numeric weight — never trust the model's numbers blindly.
      const chosenNames = new Set(exercises.map((e) => e.name));
      const suggestedWeights = (parsed.suggestedWeights || [])
        .filter((s) => chosenNames.has(s?.exercise) && Number.isFinite(s?.weight) && s.weight >= 0)
        .map((s) => ({ exercise: s.exercise, weight: s.weight }));

      return json({ exercises, reason: parsed.reason || "", suggestedWeights }, 200, corsHeaders);
    } catch (err) {
      console.error("Worker error (plan)", err?.stack || String(err));
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

const VALID_USERS = ["jake", "jessica"];

// Cross-device sync for the app's main state blob (history, notes, profile).
// Keyed liftr:<user>, whole-blob last-write-wins — the client pulls once on
// entry and pushes after each meaningful mutation (never on every tap).
async function handleKv(request, env, corsHeaders, url) {
  const user = url.searchParams.get("user");
  if (!VALID_USERS.includes(user)) {
    return json({ error: "Invalid or missing user" }, 400, corsHeaders);
  }
  if (!env.LIFTR_KV) {
    console.error("LIFTR_KV binding missing");
    return json({ error: "Sync not configured" }, 500, corsHeaders);
  }

  const key = `liftr:${user}`;

  if (request.method === "GET") {
    try {
      const stored = await env.LIFTR_KV.get(key);
      return json({ value: stored ? JSON.parse(stored) : null }, 200, corsHeaders);
    } catch (err) {
      console.error("KV read error", err?.stack || String(err));
      return json({ error: "Read failed" }, 500, corsHeaders);
    }
  }

  if (request.method === "POST" || request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, corsHeaders);
    }
    try {
      await env.LIFTR_KV.put(key, JSON.stringify(body));
      return json({ ok: true }, 200, corsHeaders);
    } catch (err) {
      console.error("KV write error", err?.stack || String(err));
      return json({ error: "Write failed" }, 500, corsHeaders);
    }
  }

  return json({ error: "Method not allowed" }, 405, corsHeaders);
}

// Cross-user "cheer" queue, keyed by the RECIPIENT so each person only ever
// reads their own inbox. Additive (append on POST) rather than overwrite,
// since two people could cheer each other around the same time.
async function handleCheers(request, env, corsHeaders, url) {
  const user = url.searchParams.get("user");
  if (!VALID_USERS.includes(user)) {
    return json({ error: "Invalid or missing user" }, 400, corsHeaders);
  }
  if (!env.LIFTR_KV) {
    console.error("LIFTR_KV binding missing");
    return json({ error: "Sync not configured" }, 500, corsHeaders);
  }

  const key = `cheers:${user}`;

  if (request.method === "GET") {
    try {
      const stored = await env.LIFTR_KV.get(key);
      const cheers = stored ? JSON.parse(stored) : [];
      return json({ cheers: Array.isArray(cheers) ? cheers : [] }, 200, corsHeaders);
    } catch (err) {
      console.error("Cheers read error", err?.stack || String(err));
      return json({ error: "Read failed" }, 500, corsHeaders);
    }
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, corsHeaders);
    }
    const from = typeof body?.from === "string" ? body.from.slice(0, 40) : "";
    const text = typeof body?.text === "string" ? body.text.slice(0, 200) : "";
    if (!from || !text) {
      return json({ error: "Malformed cheer" }, 400, corsHeaders);
    }
    try {
      const stored = await env.LIFTR_KV.get(key);
      const cheers = stored ? JSON.parse(stored) : [];
      const list = Array.isArray(cheers) ? cheers : [];
      list.push({ from, text, date: new Date().toISOString() });
      await env.LIFTR_KV.put(key, JSON.stringify(list.slice(-20)));
      return json({ ok: true }, 200, corsHeaders);
    } catch (err) {
      console.error("Cheers write error", err?.stack || String(err));
      return json({ error: "Write failed" }, 500, corsHeaders);
    }
  }

  if (request.method === "DELETE") {
    try {
      await env.LIFTR_KV.put(key, JSON.stringify([]));
      return json({ ok: true }, 200, corsHeaders);
    } catch (err) {
      console.error("Cheers clear error", err?.stack || String(err));
      return json({ error: "Clear failed" }, 500, corsHeaders);
    }
  }

  return json({ error: "Method not allowed" }, 405, corsHeaders);
}

// Short, conversational check-in chat — the athlete can mention pain,
// fatigue, equipment limits, or anything else before picking a workout.
// Replies stay brief; anything worth factoring into exercise selection
// comes back as `constraint`, a short imperative phrase the app folds into
// the same free-text note the plan-selection endpoint already reads.
const SPLIT_KEYS = ["chest-back", "legs", "cardio", "core-mobility"];
const SPLIT_LABELS = {
  "chest-back": "Chest & Back",
  legs: "Legs",
  cardio: "Cardio",
  "core-mobility": "Core & Mobility",
};

async function handleChat(body, env, corsHeaders) {
  const { persona, messages } = body;
  const valid =
    persona?.name &&
    persona?.goal &&
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.every((m) => (m?.role === "user" || m?.role === "coach") && typeof m?.text === "string");

  if (!valid) {
    console.error("Malformed chat request", JSON.stringify(body));
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
      suggestedSplit: {
        type: ["string", "null"],
        enum: [...SPLIT_KEYS, null],
        description:
          "Set this to chest-back, legs, cardio, or core-mobility ONLY if the athlete clearly stated what type of workout they want today " +
          "(e.g. 'let's do legs', 'I want a cardio day'). Leave it null if they didn't specify — never guess.",
      },
    },
    required: ["reply", "constraint", "suggestedSplit"],
    additionalProperties: false,
  };

  const profileBits = [
    persona.heightIn ? `${Math.floor(persona.heightIn / 12)}'${persona.heightIn % 12}" tall` : null,
    persona.weightLb ? `${persona.weightLb} lb bodyweight` : null,
    Array.isArray(persona.focusAreas) && persona.focusAreas.length ? `focused on: ${persona.focusAreas.join(", ")}` : null,
  ].filter(Boolean);

  const systemPrompt = [
    "You are a friendly, knowledgeable strength coach texting with an athlete",
    "before their workout, as part of a fitness app's check-in screen.",
    `The athlete is ${persona.name}, whose goal is: ${persona.goal}.`,
    profileBits.length ? `Also known about them: ${profileBits.join("; ")}.` : "",
    "Keep replies SHORT — 1 to 3 sentences, warm and practical, not generic filler.",
    "If they mention pain, an injury, fatigue, equipment limits, or anything else",
    "that should change today's exercise selection, acknowledge it supportively",
    "and set constraint to a short imperative phrase capturing it (e.g. 'avoid",
    "overhead pressing, shoulder is sore'). If nothing like that was said, set",
    "constraint to null. Never give medical advice beyond general common sense",
    "(e.g. suggest resting an acute injury rather than pushing through it).",
    "The app is also showing this athlete a recommended workout category",
    `below the chat (options: ${SPLIT_KEYS.map((k) => `${k} = ${SPLIT_LABELS[k]}`).join(", ")}).`,
    "If they clearly say what they want today, set suggestedSplit to that key",
    "so the app updates the recommendation to match — otherwise leave it null.",
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
      console.error("OpenAI error (chat)", aiRes.status, await aiRes.text());
      return json({ error: "Upstream AI error" }, 502, corsHeaders);
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);

    if (typeof parsed.reply !== "string" || !parsed.reply.trim()) {
      console.error("Empty chat reply", JSON.stringify(parsed));
      return json({ error: "Empty reply" }, 502, corsHeaders);
    }

    const suggestedSplit = SPLIT_KEYS.includes(parsed.suggestedSplit) ? parsed.suggestedSplit : null;
    return json({ reply: parsed.reply, constraint: parsed.constraint || null, suggestedSplit }, 200, corsHeaders);
  } catch (err) {
    console.error("Worker error (chat)", err?.stack || String(err));
    return json({ error: "Worker error" }, 500, corsHeaders);
  }
}
