import test from "node:test";
import assert from "node:assert/strict";
import { chatCost, openaiChat } from "../src/costs.js";

test("chat cost uses the model's price, longest name first; unknown models are estimates", () => {
  assert.deepEqual(chatCost("gpt-4o-mini-2024-07-18", { prompt_tokens: 1e6, completion_tokens: 1e6 }), { tin: 1e6, tout: 1e6, usd: 0.75, estimated: false });
  assert.equal(chatCost("gpt-4o", { prompt_tokens: 1000, completion_tokens: 1000 }).usd, 0.0125);
  assert.equal(chatCost("mystery", { prompt_tokens: 1000 }).estimated, true);
});

test("openaiChat returns the same answer and records it; a failing meter changes nothing", async () => {
  const sent = [];
  const env = { CREATIVE_DESK: { idFromName: () => "x", get: () => ({ fetch: async (r) => { sent.push(await r.json()); return new Response("{}"); } }) } };
  const answer = { model: "gpt-4o-mini", usage: { prompt_tokens: 100, completion_tokens: 50 }, choices: [{ message: { content: "hi" } }] };
  const res = await openaiChat(env, "history-ask", { method: "POST", body: JSON.stringify({ model: "gpt-4o-mini" }) }, async () => new Response(JSON.stringify(answer)));
  assert.equal((await res.json()).choices[0].message.content, "hi");
  assert.equal(sent[0].feature, "history-ask");
  assert.equal(sent[0].tin, 100);
  const broken = { CREATIVE_DESK: { idFromName: () => "x", get: () => ({ fetch: async () => { throw new Error("down"); } }) } };
  const res2 = await openaiChat(broken, "story", { body: "{}" }, async () => new Response(JSON.stringify(answer)));
  assert.equal(res2.status, 200);
});
