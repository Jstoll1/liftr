import { test } from "node:test";
import assert from "node:assert/strict";
import { gameNews } from "../src/insights.js";

const kv = () => { const m = new Map(); return { m, get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); } }; };

test("news: one GDELT call per game, and none while cooling down after a 429", async () => {
  const hits = [];
  globalThis.fetch = async (u) => { const url = String(u); if (url.includes("gdeltproject")) { hits.push(url); return new Response("slow down", { status: 429 }); } return new Response("<rss><channel></channel></rss>", { status: 200 }); };
  const env = { LIFTR_KV: kv() };
  const game = { id: 1, away: "Kentucky Wildcats", home: "Texas Longhorns", awayShort: "UK", homeShort: "TEX" };
  await gameNews(env, game);
  assert.equal(hits.length, 1); // one search, no retry on 429
  await gameNews(env, { ...game, id: 2, away: "Ole Miss Rebels" });
  assert.equal(hits.length, 1); // cooling down: GDELT left alone
  assert.ok([...env.LIFTR_KV.m.keys()].some((k) => k.startsWith("cool:api.gdeltproject.org")));
});
