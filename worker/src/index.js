// Liftr AI Worker
//
// Holds the OpenAI API key server-side (never exposed to the browser) and
// picks today's exercises for a user from a fixed candidate list, given
// their goal, time budget, energy level, and whether they have a partner.
// The model is constrained to only choose exercises we already gave it —
// it can reorder/trim/include, never invent — so the response is always
// safe to render directly in the app.

const MINUTES_TO_COUNT = { 15: 2, 30: 3, 45: 4, 60: 6 };

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

    if (body?.mode === "swap") {
      return handleSwap(body, env, corsHeaders);
    }
    if (body?.mode === "chat") {
      return handleChat(body, env, corsHeaders);
    }
    if (body?.mode === "opening") {
      return handleOpening(body, env, corsHeaders);
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

    const targetCount = MINUTES_TO_COUNT[minutes] || 4;
    const systemPrompt = [
      "You are a sharp, encouraging personal trainer picking today's exercises",
      "from a FIXED candidate list. Never invent exercises outside that list.",
      `Choose AT LEAST ${targetCount} exercises for a ${minutes}-minute session —`,
      "that count is a floor, not a suggestion; use every relevant candidate you",
      "have available before choosing fewer than that.",
      "Prioritize whichever candidates best serve the athlete's stated goal.",
      "On low energy, trim volume and prefer the lower-fatigue candidates.",
      "On high energy, especially for 45+ minute sessions, go the other",
      "direction: use the full candidate list including any 'Finisher:'-named",
      "candidate — that's exactly the scenario it exists for — and don't hold",
      "back on volume just because a session could technically be shorter.",
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

// Chooses one replacement from a trusted list. The client removes exercises
// already in the workout before sending candidates, so the model cannot
// invent a movement or create a duplicate.
async function handleSwap(body, env, corsHeaders) {
  const { persona, workout, currentExercise, currentWorkout, reason, todayNote, candidates } = body || {};
  const valid =
    persona?.name &&
    persona?.goal &&
    typeof workout === "string" &&
    typeof currentExercise?.name === "string" &&
    Array.isArray(currentWorkout) &&
    Array.isArray(candidates) &&
    candidates.length > 0 &&
    candidates.every((candidate) => typeof candidate?.name === "string" && typeof candidate?.detail === "string");
  if (!valid) return json({ error: "Malformed swap request" }, 400, corsHeaders);

  const names = candidates.map((candidate) => candidate.name);
  const schema = {
    type: "object",
    properties: {
      exercise: { type: "string", enum: names },
      reason: { type: "string", description: "One short sentence explaining why this is the best replacement." },
    },
    required: ["exercise", "reason"],
    additionalProperties: false,
  };

  const systemPrompt = [
    "You are choosing exactly one intelligent exercise substitution for an in-progress workout.",
    "Choose only from the candidate list. Never invent an exercise.",
    "Honor the athlete's stated pain, equipment, fatigue, and movement constraints first.",
    "Then preserve the original exercise's muscle group and movement purpose when practical.",
    "Avoid choices that conflict with the athlete's reason even if they are mechanically similar.",
    "Return one concise explanation that names the practical reason for the choice.",
  ].join(" ");

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              athlete: persona,
              workout,
              replacing: currentExercise,
              currentWorkout,
              athleteRequest: reason || null,
              todayContext: todayNote || null,
              candidates,
            }),
          },
        ],
        response_format: { type: "json_schema", json_schema: { name: "exercise_swap", schema, strict: true } },
        temperature: 0.3,
      }),
    });
    if (!aiRes.ok) return json({ error: "Upstream AI error" }, 502, corsHeaders);
    const aiData = await aiRes.json();
    const parsed = JSON.parse(aiData.choices?.[0]?.message?.content || "{}");
    if (!names.includes(parsed.exercise)) return json({ error: "Invalid swap choice" }, 502, corsHeaders);
    return json({ exercise: parsed.exercise, reason: parsed.reason }, 200, corsHeaders);
  } catch (err) {
    console.error("Worker error (swap)", err?.stack || String(err));
    return json({ error: "Worker error" }, 500, corsHeaders);
  }
}

// Ongoing coaching conversation for workouts, motivation, goals, setbacks,
// and reflection. Workout constraints and explicit goal changes come back as
// structured fields so the client can act on them safely.
const SPLIT_KEYS = ["chest-back", "legs", "cardio", "core-mobility"];
const SPLIT_LABELS = {
  "chest-back": "Chest & Back",
  legs: "Legs",
  cardio: "Cardio",
  "core-mobility": "Core & Mobility",
};

async function handleChat(body, env, corsHeaders) {
  const { persona, messages, context } = body;
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
      reply: {
        type: "string",
        description: "A warm, practical coaching reply. Brief for simple messages; more developed for reflective, emotional, goal-oriented, or multi-part discussions.",
      },
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
      goalUpdate: {
        type: ["string", "null"],
        description: "The athlete's new goal only when they clearly asked to set or change it; otherwise null.",
      },
      responseDepth: {
        type: "string",
        enum: ["brief", "expanded"],
        description: "expanded for motivation, setbacks, goal strategy, performance reflection, or multi-part discussion; brief for simple requests.",
      },
    },
    required: ["reply", "constraint", "suggestedSplit", "goalUpdate", "responseDepth"],
    additionalProperties: false,
  };

  const profileBits = [
    persona.heightIn ? `${Math.floor(persona.heightIn / 12)}'${persona.heightIn % 12}" tall` : null,
    persona.weightLb ? `${persona.weightLb} lb bodyweight` : null,
    Array.isArray(persona.focusAreas) && persona.focusAreas.length ? `focused on: ${persona.focusAreas.join(", ")}` : null,
  ].filter(Boolean);

  const systemPrompt = [
    "You are a thoughtful, knowledgeable ongoing fitness coach talking with an athlete",
    "on the main page of their training app. You can discuss workouts, motivation,",
    "confidence, habits, goals, setbacks, sports, and progress—not only today's check-in.",
    `The athlete is ${persona.name}, whose goal is: ${persona.goal}.`,
    profileBits.length ? `Also known about them: ${profileBits.join("; ")}.` : "",
    context ? `Recent app context: ${JSON.stringify(context)}.` : "",
    "Calibrate depth to the athlete. For a simple request or factual adjustment, use",
    "1 to 3 concise sentences. When they share meaningful context, emotion, a setback,",
    "a motivation problem, a changing goal, performance patterns, or multiple connected",
    "questions, expand to roughly 3 to 7 sentences. Reflect what you heard, connect it",
    "to their real history when available, offer one practical next step, and ask one or",
    "two focused questions that move the conversation forward. Do not interrogate them.",
    "Set responseDepth to expanded for those deeper discussions and brief otherwise.",
    "Avoid generic hype. Ground encouragement in their stated situation or app history.",
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
    "Only set goalUpdate when the athlete clearly asks to change or set their goal.",
    "Phrase it as a clean standalone goal. Discussing a possible goal is not enough.",
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
    return json({
      reply: parsed.reply,
      constraint: parsed.constraint || null,
      suggestedSplit,
      goalUpdate: parsed.goalUpdate || null,
      responseDepth: parsed.responseDepth === "expanded" ? "expanded" : "brief",
    }, 200, corsHeaders);
  } catch (err) {
    console.error("Worker error (chat)", err?.stack || String(err));
    return json({ error: "Worker error" }, 500, corsHeaders);
  }
}

// Writes the coach's very first message when the check-in chat opens. The
// local fallback (a fixed ~9-keyword topic matcher in app.js) only catches
// a handful of subjects and otherwise always quotes the last note back
// verbatim with the same trailing question — this is what makes the coach
// actually read recent notes and write something specific and different
// each time, instead of a template.
async function handleOpening(body, env, corsHeaders) {
  const { persona, recentNotes, lastGreeting } = body || {};
  const valid = persona?.name && persona?.goal && Array.isArray(recentNotes);
  if (!valid) {
    console.error("Malformed opening request", JSON.stringify(body));
    return json({ error: "Malformed opening request" }, 400, corsHeaders);
  }

  const schema = {
    type: "object",
    properties: {
      greeting: {
        type: "string",
        description: "The coach's opening message for today's check-in — 1 to 2 sentences, warm and specific, ending in an inviting question.",
      },
    },
    required: ["greeting"],
    additionalProperties: false,
  };

  const profileBits = [
    persona.heightIn ? `${Math.floor(persona.heightIn / 12)}'${persona.heightIn % 12}" tall` : null,
    persona.weightLb ? `${persona.weightLb} lb bodyweight` : null,
    Array.isArray(persona.focusAreas) && persona.focusAreas.length ? `focused on: ${persona.focusAreas.join(", ")}` : null,
  ].filter(Boolean);

  const systemPrompt = [
    "You write the very first message an athlete sees when they open their",
    "fitness coaching app for today's check-in.",
    `The athlete is ${persona.name}, whose goal is: ${persona.goal}.`,
    profileBits.length ? `Also known about them: ${profileBits.join("; ")}.` : "",
    recentNotes.length > 0
      ? `Their recent notes to the coach, oldest first: ${JSON.stringify(recentNotes)}.`
      : "They have no recent notes on file — this may be a new or returning athlete.",
    "Write ONE short, warm, specific opening message (1-2 sentences) ending in",
    "an inviting question about today. If a recent note mentions something",
    "concrete — an injury, a sport, an emotion, equipment, a goal change — pick",
    "the single most relevant one and reference it naturally and specifically,",
    "in your own words. Do not use a fixed template like 'Last time you",
    "mentioned X, how is that going' — vary the phrasing and angle every time,",
    "the way a real coach who remembers you would actually talk.",
    lastGreeting ? `You opened with this exact message last time — do not repeat it or its structure: "${lastGreeting}".` : "",
    "If there is nothing specific to reference, ask a natural, brief question",
    "about how they're feeling today given their goal — still not a rigid template.",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "coach_opening", schema, strict: true },
        },
        temperature: 0.9,
      }),
    });

    if (!aiRes.ok) {
      console.error("OpenAI error (opening)", aiRes.status, await aiRes.text());
      return json({ error: "Upstream AI error" }, 502, corsHeaders);
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);

    if (typeof parsed.greeting !== "string" || !parsed.greeting.trim()) {
      console.error("Empty opening", JSON.stringify(parsed));
      return json({ error: "Empty opening" }, 502, corsHeaders);
    }

    return json({ greeting: parsed.greeting.trim() }, 200, corsHeaders);
  } catch (err) {
    console.error("Worker error (opening)", err?.stack || String(err));
    return json({ error: "Worker error" }, 500, corsHeaders);
  }
}
