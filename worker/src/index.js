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
    if (url.pathname === "/library") {
      return handleLibrary(request, env, corsHeaders);
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
    if (body?.mode === "parseLibraryDoc") {
      return handleParseLibraryDoc(body, env, corsHeaders);
    }

    const { persona, split, minutes, energy, partner, candidates, todayNote, pastNotes, weightHistory, recentExercises, libraryContext, libraryRoutines } = body || {};
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
      "The candidate list is usually all one body-part/category for this",
      "session's split, but may include exactly one 'Finisher:'-named candidate",
      "from a DIFFERENT category — that only happens when the athlete",
      "specifically asked to close with it (e.g. an ab finisher during a legs",
      "session). ALWAYS include that specific candidate in chosen, regardless",
      "of energy level or session length — it's an explicit request, not an",
      "optional volume decision like the split's own default finisher above.",
      "If a partner is available, prefer partner-friendly candidates when present.",
      "Some candidates carry a `superset` field — candidates sharing the same",
      "superset value are a deliberate pair (e.g. a push paired with a pull, so",
      "the session stays balanced). ALWAYS choose both members of a pair",
      "together, never just one — picking only one half breaks the balance it",
      "exists to guarantee.",
      "recentlyUsed lists exercises this same session type actually used the",
      "last couple of times. The candidate list is often bigger than a single",
      "session needs specifically so there's room to rotate — prefer candidates",
      "NOT in recentlyUsed over ones that are, all else being equal, so the",
      "athlete sees real variety across sessions instead of the same picks",
      "every time. This is a preference, not a rule: still choose whatever",
      "genuinely best fits today's goal, energy, and note even if that means",
      "repeating something recent.",
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
      "libraryReference (if present) holds excerpts from documents the athlete",
      "personally uploaded — their own training program, a PT's rehab protocol,",
      "a coach's notes, etc. Let it inform your picks and reasoning where it's",
      "actually relevant (e.g. a rehab protocol that says avoid a movement, or",
      "a program that specifies a rep scheme) — but it never overrides the",
      "candidate list: still only choose from candidateExercises, never an",
      "exercise the reference material mentions but that isn't a candidate.",
      "If nothing in it applies to today's session, ignore it entirely.",
      "savedRoutines (if present) lists workouts this athlete has personally",
      "kept — proven combos that worked for them (e.g. they always pair bench",
      "press with pull-ups). When their note or history suggests they want",
      "something similar to, or a variation on, a saved routine, use it as a",
      "reference pattern: prefer picking candidates today that match the same",
      "movement roles (e.g. a saved routine pairing a horizontal push with a",
      "vertical pull suggests doing the same pairing again, even with",
      "different specific candidates). Still only choose from",
      "candidateExercises — never invent or add movements from savedRoutines",
      "that aren't in today's candidate list.",
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
      recentlyUsed: Array.isArray(recentExercises) ? recentExercises : [],
      libraryReference: sanitizeLibraryContext(libraryContext),
      savedRoutines: sanitizeLibraryRoutines(libraryRoutines),
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
          // The exercise-picking engine gets its own, stronger model —
          // falls back to the shared OPENAI_MODEL, then gpt-4o-mini, if
          // OPENAI_MODEL_PLAN isn't set. Same OPENAI_API_KEY covers both;
          // this is just which model that key is allowed to call.
          model: env.OPENAI_MODEL_PLAN || env.OPENAI_MODEL || "gpt-4o-mini",
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

      // The schema only constrains WHICH names are valid, not their
      // relationships — nothing stops the model from choosing one half of
      // a superset pair without the other. A pair exists specifically to
      // guarantee balance (e.g. a bench press + pull-up pair is exactly
      // one push and one pull); picking only the push half of every pair
      // silently turns a "Chest & Back" session into an all-push one.
      // Deterministically complete any partial pair rather than trusting
      // a prompt instruction to always hold.
      const chosenSupersetKeys = new Set(exercises.filter((e) => e.superset).map((e) => e.superset));
      if (chosenSupersetKeys.size > 0) {
        candidates.forEach((c) => {
          if (c.superset && chosenSupersetKeys.has(c.superset) && !exercises.some((e) => e.name === c.name)) {
            exercises.push(c);
          }
        });
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

// Defense in depth against a malformed or oversized libraryContext blowing
// up prompt/token cost — the client already budgets this, but the Worker
// shouldn't trust that blindly since nothing stops a direct request here.
function sanitizeLibraryContext(libraryContext) {
  if (!Array.isArray(libraryContext)) return [];
  return libraryContext
    .filter((item) => item && typeof item.title === "string" && typeof item.excerpt === "string")
    .slice(0, 5)
    .map((item) => ({ title: item.title.slice(0, 120), excerpt: item.excerpt.slice(0, 3000) }));
}

// Same defense-in-depth as sanitizeLibraryContext above, for the athlete's
// saved-workout combos — names only, capped, so a malformed or oversized
// payload can't blow up prompt/token cost.
function sanitizeLibraryRoutines(libraryRoutines) {
  if (!Array.isArray(libraryRoutines)) return [];
  return libraryRoutines
    .filter((item) => item && typeof item.name === "string" && Array.isArray(item.exercises))
    .slice(0, 8)
    .map((item) => ({
      name: item.name.slice(0, 80),
      splitKey: typeof item.splitKey === "string" ? item.splitKey : null,
      exercises: item.exercises.filter((e) => typeof e === "string").slice(0, 20).map((e) => e.slice(0, 80)),
    }));
}

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

// Shared exercise-library sync — extracted PDF text uploaded from either
// persona's device, keyed under one global key (not per-user, since a
// training program or PT protocol usually isn't specific to one athlete).
// Same whole-blob-overwrite shape as handleKv above; the client is
// responsible for merging its local copy with the cloud copy before POSTing.
async function handleLibrary(request, env, corsHeaders) {
  if (!env.LIFTR_KV) {
    console.error("LIFTR_KV binding missing");
    return json({ error: "Sync not configured" }, 500, corsHeaders);
  }

  const key = "liftr:library";

  if (request.method === "GET") {
    try {
      const stored = await env.LIFTR_KV.get(key);
      const data = stored ? JSON.parse(stored) : null;
      // Tolerates the pre-routines shape (a bare array of docs) written by
      // clients before saved workouts existed.
      const docs = Array.isArray(data) ? data : Array.isArray(data?.docs) ? data.docs : [];
      const routines = Array.isArray(data?.routines) ? data.routines : [];
      return json({ docs, routines }, 200, corsHeaders);
    } catch (err) {
      console.error("Library read error", err?.stack || String(err));
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
    const docs = Array.isArray(body?.docs) ? body.docs : [];
    const routines = Array.isArray(body?.routines) ? body.routines : [];
    try {
      await env.LIFTR_KV.put(key, JSON.stringify({ docs, routines }));
      return json({ ok: true }, 200, corsHeaders);
    } catch (err) {
      console.error("Library write error", err?.stack || String(err));
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

// Caps how much of an uploaded doc's text gets sent to the model for
// parsing — generous enough for a real multi-day program, bounded so
// token cost/context stays sane regardless of how large the upload is.
const MAX_PARSE_DOC_CHARS = 24000;

// Turns a raw uploaded PDF's extracted text into the app's own exercise
// shape (name/detail/howTo/tip, grouped into named workout days) so it
// can render with the exact same components as every other workout in
// the app, instead of just being a wall of PDF text. Never invents
// exercises the document doesn't actually mention — if the model can't
// find real workout content (a nutrition guide, a rehab note with no
// discrete exercise list, etc.) it returns an empty workouts array
// rather than fabricating one, and the client shows that honestly.
async function handleParseLibraryDoc(body, env, corsHeaders) {
  const { title, text } = body || {};
  const valid = typeof title === "string" && typeof text === "string" && text.trim().length > 0;
  if (!valid) return json({ error: "Malformed parse request" }, 400, corsHeaders);

  const schema = {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "One to three sentences explaining what this program/document actually is — its goal, structure, and who it's for. If it isn't a workout program at all, say what it is instead.",
      },
      workouts: {
        type: "array",
        description: "Each distinct workout/day the document describes. Empty array if the document contains no identifiable structured workout.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "A short label for this workout/day, e.g. 'Day 1: Chest & Triceps' or the document's own name if it's a single-day routine.",
            },
            exercises: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "The exercise name as stated (or clearly implied) in the document." },
                  detail: { type: "string", description: "Sets/reps/duration exactly as the document states it, e.g. '4 x 8-10' or '20 min'." },
                  howTo: { type: "string", description: "A brief, accurate one-sentence how-to for this exercise using standard form — write this even if the document itself doesn't explain it." },
                  tip: { type: "string", description: "One short, practical coaching cue for this exercise." },
                },
                required: ["name", "detail", "howTo", "tip"],
                additionalProperties: false,
              },
            },
          },
          required: ["name", "exercises"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "workouts"],
    additionalProperties: false,
  };

  const systemPrompt = [
    "You extract the actual workout content from a document's raw extracted text into a",
    "structured format. Only include exercises the document genuinely mentions or clearly",
    "implies — never invent exercises, sets, or reps it doesn't state. If sets/reps aren't",
    "given for something that's clearly an exercise, write a sensible standard detail and",
    "say so isn't needed — just make a reasonable choice.",
    "Group exercises into separate workouts/days exactly as the document structures them",
    "(e.g. 'Day 1', 'Push Day', 'Week 1 Phase'). If it's genuinely one single routine, return",
    "exactly one workout. If the document has no identifiable exercise program at all",
    "(nutrition advice, a cover page, general commentary), return an empty workouts array",
    "and use summary to say what the document actually is instead.",
    "Keep the summary factual and specific to this document — no generic filler.",
  ].join(" ");

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.OPENAI_MODEL_PLAN || env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify({ title, documentText: text.slice(0, MAX_PARSE_DOC_CHARS) }) },
        ],
        response_format: { type: "json_schema", json_schema: { name: "parsed_library_doc", schema, strict: true } },
        temperature: 0.2,
      }),
    });
    if (!aiRes.ok) {
      console.error("OpenAI error (parseLibraryDoc)", aiRes.status, await aiRes.text());
      return json({ error: "Upstream AI error" }, 502, corsHeaders);
    }
    const aiData = await aiRes.json();
    const parsed = JSON.parse(aiData.choices?.[0]?.message?.content || "{}");
    if (typeof parsed.summary !== "string" || !Array.isArray(parsed.workouts)) {
      return json({ error: "Malformed AI response" }, 502, corsHeaders);
    }
    return json({ summary: parsed.summary, workouts: parsed.workouts }, 200, corsHeaders);
  } catch (err) {
    console.error("Worker error (parseLibraryDoc)", err?.stack || String(err));
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
// Persona-specific presets that go beyond the four generic splits — each
// one built for a specific real scenario, richer than its generic
// equivalent. Offered only to the athlete it was built for, so this can't
// leak into the other persona's chat. When the athlete describes the
// scenario a preset was built for, prefer suggesting it over the thin
// generic split it would otherwise fall back to.
const PERSONA_SPLIT_KEYS = {
  Jessica: {
    "jess-game-day-core": "Jess + Partner: Core & Mobility — a 5-phase pre-basketball-game partner session (trunk stability + hip mobility), richer than the generic core-mobility split",
  },
};

async function handleChat(body, env, corsHeaders) {
  const { persona, messages, context, libraryContext, libraryRoutines } = body;
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

  const personaSplitKeys = PERSONA_SPLIT_KEYS[persona.name] || {};
  const allSplitKeys = [...SPLIT_KEYS, ...Object.keys(personaSplitKeys)];

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
        enum: [...allSplitKeys, null],
        description:
          `Set this to one of ${allSplitKeys.join(", ")} ONLY if the athlete clearly stated what type of workout they want today ` +
          "(e.g. 'let's do legs', 'I want a cardio day'). Leave it null if they didn't specify — never guess." +
          (Object.keys(personaSplitKeys).length
            ? ` ${Object.entries(personaSplitKeys).map(([key, desc]) => `${key} = ${desc}`).join("; ")}.`
            : ""),
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

  const libraryDocs = sanitizeLibraryContext(libraryContext);
  const savedRoutines = sanitizeLibraryRoutines(libraryRoutines);

  const systemPrompt = [
    "You are a thoughtful, knowledgeable ongoing fitness coach talking with an athlete",
    "on the main page of their training app. You can discuss workouts, motivation,",
    "confidence, habits, goals, setbacks, sports, and progress—not only today's check-in.",
    `The athlete is ${persona.name}, whose goal is: ${persona.goal}.`,
    profileBits.length ? `Also known about them: ${profileBits.join("; ")}.` : "",
    context ? `Recent app context: ${JSON.stringify(context)}.` : "",
    libraryDocs.length
      ? `The athlete has personally uploaded reference material — their own training program, PT protocol, or coaching notes. Reference it naturally when relevant to what they're asking, but don't force it in if it doesn't apply: ${JSON.stringify(libraryDocs)}.`
      : "",
    savedRoutines.length
      ? `The athlete has saved these workouts as proven combos they like: ${JSON.stringify(savedRoutines)}. If they ask for a variation, a similar workout, or want to combine/derive from something they've done before, reason about the movement pattern of the saved combo (e.g. a horizontal push paired with a vertical pull) and suggest analogous exercises or a natural variation — don't just repeat the saved list verbatim unless asked to.`
      : "",
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
    Object.keys(personaSplitKeys).length
      ? `This athlete also has a personal preset built for a specific scenario: ${Object.entries(personaSplitKeys).map(([key, desc]) => `${key} (${desc})`).join("; ")}. It isn't one of the four visible category cards, but if they describe that scenario, set suggestedSplit to it instead of the generic category it would otherwise fall under — it's more complete and was built for exactly that.`
      : "",
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

    const suggestedSplit = allSplitKeys.includes(parsed.suggestedSplit) ? parsed.suggestedSplit : null;
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
