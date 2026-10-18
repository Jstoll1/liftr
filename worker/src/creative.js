// The Creative Desk: one durable object that owns every AI graphic. It keeps
// the assets, their versions, the audit trail and the month's budget in its
// own SQLite, and works through the generation queue on its alarm. Being
// one object, every change happens one at a time, so two taps can never
// double spend or publish twice.
//
// Lifecycle of a version:
//   QUEUED → GENERATING → PENDING_REVIEW → APPROVED → PUBLISHED
//   with REJECTED and FAILED beside them.
// Phase 1 runs the first three. Nothing here is ever public: images are
// read back only through the owner's routes.
import { CATEGORIES, publicTypes, estimateCost, MAX_FEEDBACK } from "./creative-types.js";
import { drawImage, IMAGE_MODEL, writeText, TEXT_MODEL } from "./openai-image.js";

export const STATUS = ["QUEUED", "GENERATING", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "REJECTED", "FAILED"];
export const MAX_ATTEMPTS = 3;
export const MANIFEST_KEY = "creative:published";
const STALE_MS = 10 * 60000;       // a GENERATING job this old died mid-flight
const monthOf = (t) => new Date(t).toISOString().slice(0, 7);
// Written work is kept as {headline, body}; anything else is not a report.
export function parseText(raw) {
  if (raw == null) return null;
  try { const o = typeof raw === "string" ? JSON.parse(raw) : raw; return o && typeof o.body === "string" ? { headline: String(o.headline || "").slice(0, 120), body: o.body.slice(0, 2000) } : null; } catch { return null; }
}
const cleanEdit = (t) => { const p = parseText(t); return p && p.headline.trim() && p.body.trim() ? { headline: p.headline.trim(), body: p.body.trim() } : null; };
const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, category TEXT NOT NULL, subject TEXT NOT NULL, label TEXT, data TEXT, week INTEGER, dedupe TEXT UNIQUE NOT NULL, published_version TEXT, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, status TEXT NOT NULL, prompt TEXT, feedback TEXT, model TEXT, size TEXT, quality TEXT, est_cost REAL, cost REAL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, orig_key TEXT, opt_key TEXT, next_at INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS versions_status ON versions (status, next_at)`,
  `CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, asset_id TEXT, version_id TEXT, action TEXT NOT NULL, actor TEXT, note TEXT)`,
  `CREATE TABLE IF NOT EXISTS budget (month TEXT PRIMARY KEY, spent REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0)`,
  // Every OpenAI call the Worker makes, by day, feature and model (see costs.js).
  `CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, feature TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, tin INTEGER NOT NULL DEFAULT 0, tout INTEGER NOT NULL DEFAULT 0, usd REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, feature, model))`,
];

export class CreativeDesk {
  constructor(ctx, env, deps = {}) {
    this.ctx = ctx; this.env = env;
    this.draw = deps.draw || ((args) => drawImage(env, args));
    this.write = deps.write || ((args) => writeText(env, args));
    this.now = deps.now || (() => Date.now());
    this.sql = ctx.storage.sql;
    for (const s of SCHEMA) this.sql.exec(s);
    // Columns added after the first release: written text and its tone.
    for (const col of ["text TEXT", "tone TEXT"]) { try { this.sql.exec(`ALTER TABLE versions ADD COLUMN ${col}`); } catch { /* already there */ } }
  }
  rows(q, ...a) { return this.sql.exec(q, ...a).toArray(); }
  row(q, ...a) { return this.rows(q, ...a)[0] || null; }
  audit(assetId, versionId, action, actor, note = null) {
    this.sql.exec("INSERT INTO audit (at, asset_id, version_id, action, actor, note) VALUES (?, ?, ?, ?, ?, ?)", this.now(), assetId, versionId, action, actor || "owner", note);
  }
  cap() { const n = Number(this.env.CREATIVE_MONTHLY_CAP_USD); return Number.isFinite(n) && n >= 0 ? n : 0; }
  budget(month = monthOf(this.now())) {
    const b = this.row("SELECT spent, reserved FROM budget WHERE month = ?", month) || { spent: 0, reserved: 0 };
    return { month, cap: this.cap(), spent: +b.spent.toFixed(4), reserved: +b.reserved.toFixed(4), left: +Math.max(0, this.cap() - b.spent - b.reserved).toFixed(4) };
  }
  addBudget(month, spent, reserved) {
    this.sql.exec("INSERT INTO budget (month, spent, reserved) VALUES (?, ?, ?) ON CONFLICT(month) DO UPDATE SET spent = spent + excluded.spent, reserved = MAX(0, reserved + excluded.reserved)", month, spent, reserved);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/creative/, "");
    try {
      if (request.method === "GET") {
        if (path === "/types") return Response.json({ types: publicTypes() });
        if (path === "/budget") return Response.json(this.budget());
        if (path === "/assets") return Response.json({ items: this.list(url.searchParams), budget: this.budget() });
        const m = /^\/image\/([\w-]+)$/.exec(path);
        if (m) return this.image(m[1], url.searchParams.get("v") === "opt" ? "opt_key" : "orig_key");
      }
      // The cost meter: written by the Worker itself (costs.js), read by the live page.
      if (request.method === "POST" && path === "/usage") { this.addUsage(await request.json().catch(() => ({}))); return Response.json({ ok: true }); }
      if (request.method === "GET" && path === "/library") return Response.json({ assets: this.library(url.searchParams) });
      const one = /^\/asset\/([\w-]+)$/.exec(path);
      if (request.method === "GET" && one) { const a = this.assetView(one[1]); return Response.json(a || { error: "Not found" }, { status: a ? 200 : 404 }); }
      if (request.method === "GET" && path === "/costs") return Response.json(this.costs(Number(url.searchParams.get("days")) || 30));
      if (request.method === "POST" && path === "/action") {
        const out = await this.act(await request.json().catch(() => ({})));
        return Response.json(out, { status: out.error ? 400 : 200 });
      }
      const opt = /^\/optimized\/([\w-]+)$/.exec(path);
      if (request.method === "POST" && opt) {
        const out = await this.saveOptimized(opt[1], new Uint8Array(await request.arrayBuffer()), request.headers.get("Content-Type"));
        return Response.json(out, { status: out.error ? 400 : 200 });
      }
      if (request.method === "POST" && path === "/generate") {
        const out = this.enqueue(await request.json().catch(() => ({})));
        return Response.json(out, { status: out.error ? 400 : 200 });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    } catch (err) {
      return Response.json({ error: String(err?.message || err) }, { status: 500 });
    }
  }

  // A card per version, newest first, with its asset alongside.
  list(params) {
    const status = params.get("status"), category = params.get("category");
    const where = [], args = [];
    if (status && STATUS.includes(status)) { where.push("v.status = ?"); args.push(status); }
    if (category && CATEGORIES[category]) { where.push("a.category = ?"); args.push(category); }
    const rows = this.rows(`SELECT v.*, a.category, a.subject, a.label, a.data, a.week, a.published_version FROM versions v JOIN assets a ON a.id = v.asset_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY v.created DESC, v.rowid DESC LIMIT 200`, ...args);
    return rows.map((r) => ({
      id: r.id, assetId: r.asset_id, status: r.status, category: r.category, categoryLabel: CATEGORIES[r.category]?.label || r.category,
      subject: r.subject, label: r.label, data: JSON.parse(r.data || "{}"), week: r.week, placements: CATEGORIES[r.category]?.placements || [],
      feedback: r.feedback, model: r.model, size: r.size, quality: r.quality, estCost: r.est_cost, cost: r.cost, attempts: r.attempts, error: r.error,
      hasImage: !!r.orig_key, published: r.published_version === r.id, created: r.created, updated: r.updated,
      kind: CATEGORIES[r.category]?.kind || "image", tone: r.tone, text: parseText(r.text),
    }));
  }

  async image(versionId, col) {
    const v = this.row(`SELECT ${col} AS k FROM versions WHERE id = ?`, versionId);
    if (!v?.k || !this.env.CREATIVE) return new Response("Not found", { status: 404 });
    const obj = await this.env.CREATIVE.get(v.k);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/png", "Cache-Control": "private, max-age=3600" } });
  }

  addUsage(r) {
    const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
    const feature = String(r?.feature || "unknown").slice(0, 40), model = String(r?.model || "unknown").slice(0, 60);
    const day = new Date(this.now()).toISOString().slice(0, 10);
    this.sql.exec("INSERT INTO usage (day, feature, model, calls, tin, tout, usd) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(day, feature, model) DO UPDATE SET calls = calls + excluded.calls, tin = tin + excluded.tin, tout = tout + excluded.tout, usd = usd + excluded.usd",
      day, feature, model, Math.max(1, Math.round(n(r?.calls) || 1)), Math.round(n(r?.tin)), Math.round(n(r?.tout)), n(r?.usd));
  }
  // Today, this month and the last N days, by feature and by day.
  costs(days) {
    const now = this.now(), today = new Date(now).toISOString().slice(0, 10), month = today.slice(0, 7);
    const from = new Date(now - (Math.min(Math.max(days, 1), 120) - 1) * 86400000).toISOString().slice(0, 10);
    const sum = (where, ...a) => this.row(`SELECT COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(tin), 0) AS tin, COALESCE(SUM(tout), 0) AS tout, COALESCE(SUM(usd), 0) AS usd FROM usage WHERE ${where}`, ...a);
    const first = this.row("SELECT MIN(day) AS d FROM usage")?.d || null;
    return {
      today: sum("day = ?", today), month: sum("substr(day, 1, 7) = ?", month), all: sum("1 = 1"), since: first,
      byFeature: this.rows("SELECT feature, model, SUM(calls) AS calls, SUM(tin) AS tin, SUM(tout) AS tout, SUM(usd) AS usd FROM usage WHERE substr(day, 1, 7) = ? GROUP BY feature, model ORDER BY usd DESC", month),
      byDay: this.rows("SELECT day, SUM(calls) AS calls, SUM(usd) AS usd FROM usage WHERE day >= ? GROUP BY day ORDER BY day", from),
      creative: this.budget(),
    };
  }

  // The small copy the app shows, made in the owner's browser at approval
  // (Workers cannot resize images on their own). Checked before it is kept.
  async saveOptimized(versionId, bytes, type) {
    const v = this.row("SELECT * FROM versions WHERE id = ?", versionId);
    if (!v) return { error: "No such version." };
    if (!["PENDING_REVIEW", "APPROVED", "PUBLISHED"].includes(v.status)) return { error: `Can't add a copy to a ${v.status.toLowerCase()} version.` };
    const sig = (a, b) => String.fromCharCode(...bytes.slice(a, b));
    const ok = (type === "image/webp" && bytes.length > 12 && sig(0, 4) === "RIFF" && sig(8, 12) === "WEBP") || (type === "image/png" && bytes.length > 8 && sig(1, 4) === "PNG");
    if (!ok) return { error: "The optimized copy must be a WebP or PNG image." };
    if (bytes.length > 400 * 1024) return { error: "The optimized copy is too big." };
    const key = `opt/${versionId}`;
    await this.env.CREATIVE.put(key, bytes, { httpMetadata: { contentType: type } });
    this.sql.exec("UPDATE versions SET opt_key = ?, updated = ? WHERE id = ?", key, this.now(), versionId);
    return { ok: true };
  }

  // Approve, reject, publish and unpublish, each one at a time and each in
  // the audit. Approving never publishes; publishing needs an approved
  // version with its optimized copy, and only then swaps what is live.
  async act(body) {
    const action = body?.action, ids = Array.isArray(body?.versionIds) ? body.versionIds.slice(0, 50) : [];
    if (!["approve", "reject", "publish", "unpublish", "regenerate", "edit"].includes(action)) return { error: "Unknown action." };
    if (!ids.length) return { error: "Pick at least one graphic." };
    const note = typeof body.feedback === "string" ? body.feedback.trim().slice(0, MAX_FEEDBACK) || null : null;
    const done = [], skipped = [];
    for (const id of ids) {
      const v = this.row("SELECT v.*, a.category, a.subject, a.published_version FROM versions v JOIN assets a ON a.id = v.asset_id WHERE v.id = ?", String(id));
      if (!v) { skipped.push({ id, why: "not found" }); continue; }
      const now = this.now();
      const set = (status) => this.sql.exec("UPDATE versions SET status = ?, updated = ? WHERE id = ?", status, now, v.id);
      if (action === "regenerate") {
        // A new version beside this one; whatever is live stays live until
        // the new one is approved and published.
        const cat = CATEGORIES[v.category], asset = this.row("SELECT * FROM assets WHERE id = ?", v.asset_id);
        if (!cat) { skipped.push({ id, why: "unknown kind" }); continue; }
        const subject = { key: asset.subject, label: asset.label, data: JSON.parse(asset.data || "{}") };
        const tone = typeof body.tone === "string" ? body.tone : v.tone;
        const nv = this.newVersion(asset, cat, subject, { tone, feedback: note, previous: cat.kind === "text" && v.text ? v.text : null, actor: body.actor });
        done.push(nv);
        continue;
      }
      if (action === "edit") {
        // Hand edits to written work. A live version is never changed in
        // place: the edit becomes a new approved version to publish.
        const text = cleanEdit(body.text);
        if (!text) { skipped.push({ id, why: "the edit needs a headline and a body" }); continue; }
        if (v.text == null) { skipped.push({ id, why: "only written work can be edited" }); continue; }
        if (v.status === "PUBLISHED") {
          const nv = newId("v"), now2 = this.now();
          this.sql.exec("INSERT INTO versions (id, asset_id, status, prompt, feedback, tone, model, est_cost, cost, text, created, updated) VALUES (?, ?, 'APPROVED', ?, 'hand edit', ?, ?, 0, 0, ?, ?, ?)", nv, v.asset_id, v.prompt, v.tone, v.model, JSON.stringify(text), now2, now2);
          this.audit(v.asset_id, nv, "edit", body.actor, `from ${v.id}`);
          done.push(nv);
          continue;
        }
        if (!["PENDING_REVIEW", "APPROVED"].includes(v.status)) { skipped.push({ id, why: `is ${v.status}` }); continue; }
        this.sql.exec("UPDATE versions SET text = ?, updated = ? WHERE id = ?", JSON.stringify(text), now, v.id);
        this.audit(v.asset_id, v.id, "edit", body.actor, null);
        done.push(id);
        continue;
      }
      if (action === "approve") {
        if (v.status !== "PENDING_REVIEW") { skipped.push({ id, why: `is ${v.status}` }); continue; }
        set("APPROVED");
      } else if (action === "reject") {
        if (!["PENDING_REVIEW", "APPROVED"].includes(v.status)) { skipped.push({ id, why: v.status === "PUBLISHED" ? "is live: unpublish it first" : `is ${v.status}` }); continue; }
        set("REJECTED");
      } else if (action === "publish") {
        if (v.status !== "APPROVED") { skipped.push({ id, why: v.status === "PENDING_REVIEW" ? "approve it first" : `is ${v.status}` }); continue; }
        if (!v.opt_key && v.text == null) { skipped.push({ id, why: "has no optimized copy yet" }); continue; }
        const cat = CATEGORIES[v.category];
        if (cat?.publishWhen && cat.publishWhen !== "any") { skipped.push({ id, why: "isn't eligible yet" }); continue; }
        // The version it replaces steps back to approved, still reusable.
        if (v.published_version && v.published_version !== v.id) this.sql.exec("UPDATE versions SET status = 'APPROVED', updated = ? WHERE id = ? AND status = 'PUBLISHED'", now, v.published_version);
        this.sql.exec("UPDATE assets SET published_version = ? WHERE id = ?", v.id, v.asset_id);
        set("PUBLISHED");
      } else if (action === "unpublish") {
        if (v.status !== "PUBLISHED") { skipped.push({ id, why: `is ${v.status}` }); continue; }
        this.sql.exec("UPDATE assets SET published_version = NULL WHERE id = ?", v.asset_id);
        set("APPROVED");
      }
      this.audit(v.asset_id, v.id, action, body.actor, note);
      done.push(id);
    }
    if (done.length && (action === "publish" || action === "unpublish")) await this.writeManifest();
    return { ok: true, done, skipped };
  }

  // What the app may show: every published version by placement and
  // subject, kept in KV so the public site reads one small key.
  async writeManifest() {
    const rows = this.rows("SELECT a.category, a.subject, a.week, v.id, v.updated, v.text, v.opt_key FROM assets a JOIN versions v ON v.id = a.published_version WHERE v.status = 'PUBLISHED' AND (v.opt_key IS NOT NULL OR v.text IS NOT NULL) ORDER BY v.updated");
    const art = {};
    // Newest wins where two weeks' versions share a spot (a report per week).
    for (const r of rows) for (const pl of CATEGORIES[r.category]?.placements || []) art[`${pl}:${r.subject}`] = { v: r.id, at: r.updated, ...(r.week != null ? { week: r.week } : {}), ...(r.text ? { text: parseText(r.text) } : {}) };
    const manifest = { at: this.now(), art };
    if (this.env.LIFTR_KV) await this.env.LIFTR_KV.put(MANIFEST_KEY, JSON.stringify(manifest));
    return manifest;
  }

  // One row per asset: what is live, the newest version, and how many.
  library(params) {
    const category = params.get("category");
    const rows = this.rows(`SELECT a.*, (SELECT COUNT(*) FROM versions v WHERE v.asset_id = a.id) AS n,
      (SELECT id FROM versions v WHERE v.asset_id = a.id ORDER BY created DESC, rowid DESC LIMIT 1) AS latest
      FROM assets a ${category && CATEGORIES[category] ? "WHERE a.category = ?" : ""} ORDER BY a.created DESC LIMIT 500`, ...(category && CATEGORIES[category] ? [category] : []));
    return rows.map((a) => {
      const latest = this.row("SELECT id, status, text, orig_key, created, cost FROM versions WHERE id = ?", a.latest);
      const live = a.published_version ? this.row("SELECT id, text, orig_key, updated FROM versions WHERE id = ?", a.published_version) : null;
      return { id: a.id, category: a.category, categoryLabel: CATEGORIES[a.category]?.label || a.category, kind: CATEGORIES[a.category]?.kind || "image", subject: a.subject, label: a.label, week: a.week,
        placements: CATEGORIES[a.category]?.placements || [], versions: a.n,
        latest: latest && { id: latest.id, status: latest.status, hasImage: !!latest.orig_key, text: parseText(latest.text), created: latest.created },
        live: live && { id: live.id, hasImage: !!live.orig_key, text: parseText(live.text), at: live.updated },
        spent: this.row("SELECT COALESCE(SUM(cost), 0) AS c FROM versions WHERE asset_id = ?", a.id).c };
    });
  }
  assetView(id) {
    const a = this.row("SELECT * FROM assets WHERE id = ?", id);
    if (!a) return null;
    const versions = this.rows("SELECT * FROM versions WHERE asset_id = ? ORDER BY created DESC, rowid DESC", id).map((v) => ({ id: v.id, status: v.status, tone: v.tone, feedback: v.feedback, cost: v.cost, estCost: v.est_cost, error: v.error, attempts: v.attempts,
      hasImage: !!v.orig_key, hasOpt: !!v.opt_key, text: parseText(v.text), created: v.created, updated: v.updated, published: a.published_version === v.id }));
    const audit = this.rows("SELECT at, version_id, action, actor, note FROM audit WHERE asset_id = ? ORDER BY id DESC LIMIT 200", id);
    return { id: a.id, category: a.category, categoryLabel: CATEGORIES[a.category]?.label || a.category, kind: CATEGORIES[a.category]?.kind || "image", subject: a.subject, label: a.label, week: a.week,
      data: JSON.parse(a.data || "{}"), placements: CATEGORIES[a.category]?.placements || [], published: a.published_version, versions, audit };
  }

  // A new version of an asset, queued. Image prompts gain the owner's note;
  // text prompts carry tone, note and the draft being revised.
  newVersion(asset, cat, subject, { tone = null, feedback = null, previous = null, actor = null } = {}) {
    const now = this.now();
    const prompt = cat.kind === "text" ? cat.prompt(subject, { tone, feedback, previous }) : cat.prompt(subject) + (feedback ? ` Art direction from the owner: ${feedback}` : "");
    const vid = newId("v");
    this.sql.exec("INSERT INTO versions (id, asset_id, status, prompt, feedback, tone, model, size, quality, est_cost, created, updated) VALUES (?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      vid, asset.id, prompt, feedback, cat.kind === "text" ? (tone || "coach") : null, cat.kind === "text" ? TEXT_MODEL : IMAGE_MODEL, cat.size || null, cat.quality || null, cat.kind === "text" ? 0.006 : estimateCost(cat.quality, prompt.length), now, now);
    this.audit(asset.id, vid, previous || feedback ? "regenerate" : "queue", actor, [tone && `tone ${tone}`, feedback].filter(Boolean).join(" · ") || null);
    this.ctx.storage.setAlarm(now);
    return vid;
  }

  // Ask for a graphic. The same category, subject and week is one asset:
  // asking again while a version is queued, in review or kept returns that
  // one rather than paying twice. Only after every version was rejected or
  // failed does asking again make a new version.
  enqueue(body) {
    const cat = CATEGORIES[body?.category];
    if (!cat) return { error: "Unknown category." };
    const subject = cat.subject(body.subject || {});
    if (subject.error) return { error: subject.error };
    // A graphic that is not tied to a week (a team's mascot) is one asset for good.
    const week = cat.perWeek === false || body.week == null || body.week === "" ? null : Number(body.week);
    if (week !== null && (!Number.isInteger(week) || week < 0 || week > 30)) return { error: "Bad week." };
    const feedback = typeof body.feedback === "string" && body.feedback.trim() ? body.feedback.trim().slice(0, MAX_FEEDBACK) : null;
    const dedupe = `${body.category}|${subject.key}|${week ?? "-"}`;
    const now = this.now();
    let asset = this.row("SELECT * FROM assets WHERE dedupe = ?", dedupe);
    if (asset) {
      const live = this.row("SELECT id, status FROM versions WHERE asset_id = ? AND status NOT IN ('REJECTED', 'FAILED') ORDER BY created DESC", asset.id);
      if (live) return { ok: true, existing: true, assetId: asset.id, versionId: live.id, status: live.status };
    } else {
      asset = { id: newId("a") };
      this.sql.exec("INSERT INTO assets (id, category, subject, label, data, week, dedupe, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", asset.id, body.category, subject.key, subject.label, JSON.stringify(subject.data), week, dedupe, now);
    }
    const tone = typeof body.tone === "string" ? body.tone : null;
    const vid = this.newVersion(asset, cat, subject, { tone, feedback, actor: body.actor });
    return { ok: true, assetId: asset.id, versionId: vid, status: "QUEUED" };
  }

  // One job per wake: the oldest queued version that is due. More work
  // sets the next wake straight away.
  async alarm() {
    const now = this.now();
    // A job that never finished (the object was moved or restarted) goes back in line.
    for (const v of this.rows("SELECT id, est_cost, created FROM versions WHERE status = 'GENERATING' AND updated < ?", now - STALE_MS)) {
      this.sql.exec("UPDATE versions SET status = 'QUEUED', updated = ? WHERE id = ?", now, v.id);
      this.addBudget(monthOf(now), 0, -(v.est_cost || 0));
    }
    const job = this.row("SELECT v.*, a.category FROM versions v JOIN assets a ON a.id = v.asset_id WHERE v.status = 'QUEUED' AND v.next_at <= ? ORDER BY v.created LIMIT 1", now);
    if (job) await this.run(job);
    const next = this.row("SELECT MIN(next_at) AS t FROM versions WHERE status = 'QUEUED'");
    if (next?.t != null) {
      // Over the budget, queued work waits for the next month (or a higher cap) rather than spinning.
      const wait = this.budget().left < (this.row("SELECT est_cost FROM versions WHERE status = 'QUEUED' ORDER BY created LIMIT 1")?.est_cost || 0) ? 6 * 3600000 : 0;
      await this.ctx.storage.setAlarm(Math.max(this.now() + 1000, next.t, this.now() + wait));
    }
  }

  async run(job) {
    const now = this.now(), month = monthOf(now), est = job.est_cost || 0;
    // Hold the money first; over the cap, the job stays queued and says why.
    if (this.budget(month).left < est) {
      this.sql.exec("UPDATE versions SET error = ?, updated = ? WHERE id = ?", `Waiting: the $${this.cap()} monthly budget is used up.`, now, job.id);
      return;
    }
    this.addBudget(month, 0, est);
    this.sql.exec("UPDATE versions SET status = 'GENERATING', attempts = attempts + 1, error = NULL, updated = ? WHERE id = ?", now, job.id);
    this.audit(job.asset_id, job.id, "generate", "engine", `attempt ${job.attempts + 1}`);
    const cat = CATEGORIES[job.category];
    try {
      if (cat?.kind === "text") {
        const p = JSON.parse(job.prompt);
        const { text, cost } = await this.write({ system: p.system, user: p.user });
        const parsed = parseText(text);
        if (!parsed?.body) { const e = new Error("The writer's answer wasn't a report."); e.retry = true; throw e; }
        const paid = cost > 0 ? cost : est;
        this.addBudget(month, paid, -est);
        this.sql.exec("UPDATE versions SET status = 'PENDING_REVIEW', cost = ?, text = ?, updated = ? WHERE id = ?", paid, JSON.stringify(parsed), this.now(), job.id);
        this.addUsage({ feature: "creative-text", model: job.model || TEXT_MODEL, calls: 1, usd: paid });
        this.audit(job.asset_id, job.id, "ready", "engine", `$${paid.toFixed(4)}`);
        return;
      }
      const { bytes, cost } = await this.draw({ prompt: job.prompt, size: job.size, quality: job.quality, background: cat?.background || "transparent" });
      const key = `orig/${job.id}.png`;
      await this.env.CREATIVE.put(key, bytes, { httpMetadata: { contentType: "image/png" }, customMetadata: { asset: job.asset_id, category: job.category } });
      const paid = cost > 0 ? cost : est;
      this.addBudget(month, paid, -est);
      this.sql.exec("UPDATE versions SET status = 'PENDING_REVIEW', cost = ?, orig_key = ?, updated = ? WHERE id = ?", paid, key, this.now(), job.id);
      this.addUsage({ feature: "creative-image", model: job.model || IMAGE_MODEL, calls: 1, usd: paid });
      this.audit(job.asset_id, job.id, "ready", "engine", `$${paid.toFixed(3)}`);
    } catch (err) {
      this.addBudget(month, 0, -est);
      const attempts = job.attempts + 1;
      const again = err?.retry !== false && attempts < MAX_ATTEMPTS;
      const msg = String(err?.message || err).slice(0, 300);
      if (again) {
        this.sql.exec("UPDATE versions SET status = 'QUEUED', error = ?, next_at = ?, updated = ? WHERE id = ?", msg, this.now() + attempts * 60000, this.now(), job.id);
        this.audit(job.asset_id, job.id, "retry", "engine", msg);
      } else {
        this.sql.exec("UPDATE versions SET status = 'FAILED', error = ?, updated = ? WHERE id = ?", msg, this.now(), job.id);
        this.audit(job.asset_id, job.id, "fail", "engine", msg);
      }
    }
  }
}
