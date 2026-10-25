import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const kvOf = () => { const m = new Map(), meta = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v, o) => { m.set(k, String(v)); if (o?.metadata) meta.set(k, o.metadata); }, delete: async (k) => { m.delete(k); meta.delete(k); }, list: async ({ prefix }) => ({ keys: [...meta].filter(([k]) => k.startsWith(prefix)).map(([name, metadata]) => ({ name, metadata })), list_complete: true }) }; };

test("under construction hits: logged once per device, read by the admin only", async () => {
  const env = { LIFTR_KV: kvOf(), ARCHIVE_LOG_KEY: "adm" };
  const hit = (body, ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)") => worker.fetch(new Request("https://w.test/uc-hit", { method: "POST", headers: { "User-Agent": ua }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  assert.equal((await hit({ device: "dev1abcdefgh", name: "Ben", via: "home" })).status, 200);
  await hit({ device: "dev1abcdefgh", name: "Ben", via: "home" });
  await hit({ device: "dev2zzzzzzzz", invite: "Nathan<script>", via: "invite" }, "Mozilla/5.0 (Linux; Android 14)");
  assert.equal((await worker.fetch(new Request("https://w.test/uc-hit"), env, { waitUntil() {} })).status, 403);
  const r = await (await worker.fetch(new Request("https://w.test/uc-hit?key=adm"), env, { waitUntil() {} })).json();
  assert.equal(r.hits.length, 2);
  const nathan = r.hits.find((h) => h.dev === "dev2zzzz");
  assert.equal(nathan.inv, "Nathanscript");
  assert.equal(nathan.kind, "Android");
  assert.equal(nathan.via, "invite");
  assert.equal(r.hits.find((h) => h.dev === "dev1abcd").n, "Ben");
});
