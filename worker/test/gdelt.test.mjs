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

test("news: a source that hangs is cut off at four seconds; one that answers 503 is skipped next time", async () => {
  const hits = { google: 0 };
  globalThis.fetch = (u, init) => {
    const url = String(u);
    if (url.includes("news.google.com")) { hits.google++; return Promise.resolve(new Response("nope", { status: 503 })); }
    if (url.includes("news.search.yahoo.com")) return new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("timed out"), { name: "TimeoutError" })))); // hangs until cut off
    return Promise.resolve(new Response(`<rss><channel><item><title>Kentucky Wildcats ready for Texas</title><link>https://example.org/a</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`, { status: 200 }));
  };
  const env = { LIFTR_KV: kv() };
  const game = { id: 9, away: "Kentucky Wildcats", home: "Texas Longhorns", awayId: 96, homeId: 251 };
  const t0 = Date.now();
  const alive = setInterval(() => {}, 500); // Node's abort timer does not keep a test running; Workers do not need this
  const out = await gameNews(env, game);
  assert.ok(Date.now() - t0 < 6000, `took ${Date.now() - t0}ms`);
  assert.ok(out.errors.some((e) => /timed out/.test(e)));
  const g1 = hits.google;
  await gameNews(env, { ...game, id: 10, awayId: 97 });
  clearInterval(alive);
  assert.equal(hits.google, g1); // cooling down after the 503
});
