// The live room: who is in the app right now and what they are using, for
// the admin's live page. One Durable Object holds it, so a tap on a phone
// in one city shows on the page in another at the next poll, which KV (up
// to a minute between locations) can't promise.
//
// Phones report uses a second or two after they happen, a still-here beat
// every 30 seconds while the app is on screen, and a goodbye when it's put
// away. Someone is in while their beats keep coming; a phone that dies
// without a goodbye drops out after GONE_MS.

export const GONE_MS = 75000;
// Seven days of taps are kept; the page reads the last day unless it asks
// for the week.
const DAY_MS = 24 * 3600000, FEED_MAX = 3000, FEED_AGE = 7 * DAY_MS;

export const cleanKey = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
// Details are short (a game id, a name); a question asked of the archive
// keeps up to 140 characters.
const cleanDetail = (x, k) => (x == null || x === "" ? undefined : String(x).replace(/[<>]/g, "").slice(0, k === "history-ask" ? 140 : 40));

export const emptyRoom = () => ({ people: {}, feed: [] });

// One report from a phone, applied to the room in place. Event times come
// as "this long before the report", so a phone's clock doesn't matter.
export function applyBeat(room, b, now) {
  const n = b.manager;
  const p = room.people[n] || { since: 0, last: 0, on: false };
  const wasIn = p.on && now - p.last < GONE_MS;
  const add = (e) => room.feed.push({ n, ...e });
  const evs = [];
  for (const e of (Array.isArray(b.events) ? b.events : []).slice(0, 30)) {
    const k = cleanKey(e?.k);
    if (!k) continue;
    const ago = Math.min(Math.max(Number(e.ago) || 0, 0), 60000);
    const d = cleanDetail(e.d, k);
    evs.push({ at: now - ago, k, ...(d ? { d } : {}) });
  }
  // Coming in is stamped at the first thing they did, so it reads first.
  if (!b.bye && !wasIn) { p.since = Math.min(now, ...evs.map((e) => e.at)); add({ at: p.since - 1, k: "in", d: b.app === "home" ? "home" : "browser" }); }
  evs.forEach(add);
  if (b.bye) {
    if (wasIn) add({ at: now, k: "out", d: String(now - p.since) });
    p.on = false;
  } else {
    p.on = true;
    if (cleanKey(b.screen)) p.screen = cleanKey(b.screen);
    p.app = b.app === "home" ? "home" : "browser";
  }
  p.last = now;
  room.people[n] = p;
  room.feed = room.feed.filter((e) => now - e.at < FEED_AGE).sort((a, b) => b.at - a.at).slice(0, FEED_MAX);
  return room;
}

// What the live page reads: each person's state and the feed, newest first,
// for the last day or (days = 7) the week.
export function roomView(room, now, days = 1) {
  const people = {}, age = Math.min(Math.max(Number(days) || 1, 1), 7) * DAY_MS;
  for (const [n, p] of Object.entries(room.people)) people[n] = { in: p.on && now - p.last < GONE_MS, since: p.since, last: p.last, screen: p.screen || "", app: p.app || "" };
  return { now, people, feed: room.feed.filter((e) => now - e.at < age) };
}

export class LiveRoom {
  constructor(ctx) { this.ctx = ctx; this.room = null; }
  async load() {
    if (!this.room) this.room = (await this.ctx.storage.get("room")) || emptyRoom();
    return this.room;
  }
  async fetch(request) {
    const room = await this.load(), now = Date.now();
    if (request.method === "POST") {
      applyBeat(room, await request.json(), now);
      await this.ctx.storage.put("room", room);
      return Response.json({ ok: true });
    }
    return Response.json(roomView(room, now, new URL(request.url).searchParams.get("days")));
  }
}

// Remember this device: the live page swaps the admin key, once, for a
// token signed with it that lasts DEVICE_DAYS, so the key itself is never
// kept in the browser. Changing the admin key signs every device out.
export const DEVICE_DAYS = 180;
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function deviceSig(secret, exp) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`live-device|${exp}`)));
}
export async function deviceToken(secret, now) {
  const exp = now + DEVICE_DAYS * 86400000;
  return { token: `${exp}.${await deviceSig(secret, exp)}`, exp };
}
export async function deviceTokenOk(secret, token, now) {
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ""));
  if (!secret || !m || Number(m[1]) < now) return false;
  const want = await deviceSig(secret, m[1]);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0;
}
