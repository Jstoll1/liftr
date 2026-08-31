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

    const { persona, split, minutes, energy, partner, candidates } = body || {};
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
      "Keep the reason to one specific, motivating sentence — no generic filler.",
    ].join(" ");

    const userPrompt = JSON.stringify({
      athlete: persona.name,
      goal: persona.goal,
      workoutType: split.name,
      minutesAvailable: minutes,
      energyLevel: energy,
      hasPartner: Boolean(partner),
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
