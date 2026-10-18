// The AI cost meter. Every OpenAI chat call goes through openaiChat, which
// makes exactly the same request as before and, from the answer's own
// usage numbers, records tokens and dollars by feature and model. The
// tally lives in the Creative Desk (one durable object, so counts are
// never lost to two calls at once). Recording never gets in the way: if
// it fails, the feature still gets its answer.

// Dollars per million tokens, from OpenAI's published pricing. A model not
// listed is priced as gpt-4o and marked as an estimate.
export const CHAT_PRICES = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1-nano": { in: 0.1, out: 0.4 },
  "o4-mini": { in: 1.1, out: 4.4 },
};
export function chatCost(model, usage) {
  const key = Object.keys(CHAT_PRICES).sort((a, b) => b.length - a.length).find((k) => String(model || "").startsWith(k));
  const p = CHAT_PRICES[key] || CHAT_PRICES["gpt-4o"];
  const tin = usage?.prompt_tokens || 0, tout = usage?.completion_tokens || 0;
  return { tin, tout, usd: +((tin * p.in + tout * p.out) / 1e6).toFixed(6), estimated: !key };
}

export async function recordUsage(env, row) {
  try {
    if (!env.CREATIVE_DESK) return;
    const desk = env.CREATIVE_DESK.get(env.CREATIVE_DESK.idFromName("studio"));
    await desk.fetch(new Request("https://desk/usage", { method: "POST", body: JSON.stringify(row) }));
  } catch { /* the meter never breaks a feature */ }
}

export async function openaiChat(env, feature, init, fetchImpl = fetch) {
  const res = await fetchImpl("https://api.openai.com/v1/chat/completions", init);
  try {
    if (res.ok) {
      const data = await res.clone().json();
      let model = data?.model;
      try { model = model || JSON.parse(init.body).model; } catch {}
      const c = chatCost(model, data?.usage);
      await recordUsage(env, { feature, model, calls: 1, tin: c.tin, tout: c.tout, usd: c.usd });
    } else {
      await recordUsage(env, { feature, model: "error", calls: 1, tin: 0, tout: 0, usd: 0 });
    }
  } catch { /* an odd answer is the feature's problem, not the meter's */ }
  return res;
}
