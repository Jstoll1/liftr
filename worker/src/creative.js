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
import { drawImage, IMAGE_MODEL } from "./openai-image.js";

export const STATUS = ["QUEUED", "GENERATING", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "REJECTED", "FAILED"];
export const MAX_ATTEMPTS = 3;
const STALE_MS = 10 * 60000;       // a GENERATING job this old died mid-flight
const monthOf = (t) => new Date(t).toISOString().slice(0, 7);
const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, category TEXT NOT NULL, subject TEXT NOT NULL, label TEXT, data TEXT, week INTEGER, dedupe TEXT UNIQUE NOT NULL, published_version TEXT, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, status TEXT NOT NULL, prompt TEXT, feedback TEXT, model TEXT, size TEXT, quality TEXT, est_cost REAL, cost REAL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, orig_key TEXT, opt_key TEXT, next_at INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS versions_status ON versions (status, next_at)`,
  `CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, asset_id TEXT, version_id TEXT, action TEXT NOT NULL, actor TEXT, note TEXT)`,
  `CREATE TABLE IF NOT EXISTS budget (month TEXT PRIMARY KEY, spent REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0)`,
];

export class CreativeDesk {
  constructor(ctx, env, deps = {}) {
    this.ctx = ctx; this.env = env;
    this.draw = deps.draw || ((args) => drawImage(env, args));
    this.now = deps.now || (() => Date.now());
    this.sql = ctx.storage.sql;
    for (const s of SCHEMA) this.sql.exec(s);
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
    const rows = this.rows(`SELECT v.*, a.category, a.subject, a.label, a.data, a.week, a.published_version FROM versions v JOIN assets a ON a.id = v.asset_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY v.created DESC LIMIT 200`, ...args);
    return rows.map((r) => ({
      id: r.id, assetId: r.asset_id, status: r.status, category: r.category, categoryLabel: CATEGORIES[r.category]?.label || r.category,
      subject: r.subject, label: r.label, data: JSON.parse(r.data || "{}"), week: r.week, placements: CATEGORIES[r.category]?.placements || [],
      feedback: r.feedback, model: r.model, size: r.size, quality: r.quality, estCost: r.est_cost, cost: r.cost, attempts: r.attempts, error: r.error,
      hasImage: !!r.orig_key, published: r.published_version === r.id, created: r.created, updated: r.updated,
    }));
  }

  async image(versionId, col) {
    const v = this.row(`SELECT ${col} AS k FROM versions WHERE id = ?`, versionId);
    if (!v?.k || !this.env.CREATIVE) return new Response("Not found", { status: 404 });
    const obj = await this.env.CREATIVE.get(v.k);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/png", "Cache-Control": "private, max-age=3600" } });
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
    const week = body.week == null || body.week === "" ? null : Number(body.week);
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
    const prompt = cat.prompt(subject) + (feedback ? ` Art direction from the owner: ${feedback}` : "");
    const vid = newId("v");
    this.sql.exec("INSERT INTO versions (id, asset_id, status, prompt, feedback, model, size, quality, est_cost, created, updated) VALUES (?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?, ?, ?)",
      vid, asset.id, prompt, feedback, IMAGE_MODEL, cat.size, cat.quality, estimateCost(cat.quality, prompt.length), now, now);
    this.audit(asset.id, vid, "queue", body.actor, feedback);
    this.ctx.storage.setAlarm(now);
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
      const { bytes, cost } = await this.draw({ prompt: job.prompt, size: job.size, quality: job.quality, background: cat?.background || "transparent" });
      const key = `orig/${job.id}.png`;
      await this.env.CREATIVE.put(key, bytes, { httpMetadata: { contentType: "image/png" }, customMetadata: { asset: job.asset_id, category: job.category } });
      const paid = cost > 0 ? cost : est;
      this.addBudget(month, paid, -est);
      this.sql.exec("UPDATE versions SET status = 'PENDING_REVIEW', cost = ?, orig_key = ?, updated = ? WHERE id = ?", paid, key, this.now(), job.id);
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
