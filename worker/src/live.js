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
const FEED_MAX = 400, FEED_AGE = 24 * 3600000;

export const cleanKey = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
const cleanDetail = (x) => (x == null || x === "" ? undefined : String(x).replace(/[<>]/g, "").slice(0, 40));

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
    evs.push({ at: now - ago, k, ...(cleanDetail(e.d) ? { d: cleanDetail(e.d) } : {}) });
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

// What the live page reads: each person's state and the feed, newest first.
export function roomView(room, now) {
  const people = {};
  for (const [n, p] of Object.entries(room.people)) people[n] = { in: p.on && now - p.last < GONE_MS, since: p.since, last: p.last, screen: p.screen || "", app: p.app || "" };
  return { now, people, feed: room.feed.filter((e) => now - e.at < FEED_AGE) };
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
    return Response.json(roomView(room, now));
  }
}
