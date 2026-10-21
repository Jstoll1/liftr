// Arrived via brochiefs.com/admin: set before anything else runs.
window.__adminEntry = /[?&]admin(=|&|$)/.test(location.search) || location.hash === "#admin";
// Opened by the admin's live page as a preview (?view=game&x=401): a quiet
// look at one screen, nobody signed in, no popups, nothing reported.
window.__liveView = new URLSearchParams(location.search).get("view") || "";
// Brochiefs 2026 College Football Pick'em — retro arcade pick app.
// Picks are cached per-manager in localStorage and, when configured,
// synced through a small Cloudflare Worker (worker/src/index.js, the
// /picks and /results routes) so everyone can see everyone's picks and
// live rankings from one shared "scoreboard" page — not just their own
// browser.
//
// Each game is submitted individually: pick one of 4 options, hit
// Submit, and it's saved. You can change your mind and resubmit as many
// times as you want right up until that specific game's kickoff — at
// that instant it locks for everyone, submitted or not.
//
// Scoring (per the official rules email): for each game, pick ONE of —
//   Favorite, Straight Up   = 1 point
//   Either team, Against the Spread (covers) = 2 points
//   Underdog, Straight Up   = 3 points
// A pick scores only if it's fully correct (SU picks need that team to
// win outright; ATS picks need that team to cover), otherwise 0.

function pointValue(game, team, mode) {
  if (mode === "ATS") return 2;
  return team === game.favorite ? 1 : 3;
}

// Given a final score, returns who won straight-up and who covered.
function resultOutcome(game, result) {
  if (!result || !Number.isFinite(result.awayScore) || !Number.isFinite(result.homeScore)) return null;
  const { awayScore, homeScore } = result;
  // Level (only possible mid game) has no winner yet, so nobody cashes.
  const suWinner = awayScore === homeScore ? null : awayScore > homeScore ? game.away : game.home;
  const favMargin = game.favorite === game.home ? homeScore - awayScore : awayScore - homeScore;
  const underdog = game.favorite === game.away ? game.home : game.away;
  // A push (favorite wins by exactly the spread) pays nobody on the
  // spread: atsWinner is null and both sides score 0.
  const push = favMargin === game.spread;
  const atsWinner = push ? null : favMargin > game.spread ? game.favorite : underdog;
  return { suWinner, atsWinner, push };
}

// Points earned for one pick given a final score, or null if the game
// hasn't been scored yet.
function scorePick(game, pick, result) {
  const outcome = resultOutcome(game, result);
  if (!outcome) return null;
  if (!pick || !pick.team || !pick.mode) return 0;
  const winner = pick.mode === "SU" ? outcome.suWinner : outcome.atsWinner;
  if (winner === null) return 0;
  return pick.team === winner ? pointValue(game, pick.team, pick.mode) : 0;
}

// Fill this in after deploying the Worker (see worker/README.md), e.g.
// "https://liftr-ai.<your-subdomain>.workers.dev". Left blank, the app
// works fine on a single device/browser but the scoreboard can only ever
// show picks made on that same device.
const WORKER_URL = "https://liftr-ai.jhs797.workers.dev";

// Preview site: the preview branch, published by Cloudflare Pages at
// brochiefs-preview.pages.dev, for trying changes before they go live. It
// reads the real slate, picks and scores, but writes nothing: picks, logins,
// usage, avatars, QOTW and admin saves are answered on the phone ("ok") and
// never sent, and no usage is counted. Game insights and the archive, which
// ask with POST but only read, still go through. brochiefs.com is untouched.
const PREVIEW = /(^|\.)brochiefs-preview\.pages\.dev$/.test(location.hostname);
if (PREVIEW) {
  const realFetch = window.fetch.bind(window);
  const readOnlyPost = /^\/(insights\/|history-ask$)/;
  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = String(init.method || (typeof input === "string" ? "GET" : input?.method) || "GET").toUpperCase();
    if (url.startsWith(WORKER_URL) && method !== "GET" && method !== "HEAD" && !readOnlyPost.test(new URL(url).pathname)) {
      let echo = {};
      try { echo = JSON.parse(init.body || "{}"); } catch {}
      console.info("[preview] not sent:", method, url);
      return Promise.resolve(new Response(JSON.stringify({ ok: true, preview: true, state: echo?.state ?? null }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return realFetch(input, init);
  };
  if (navigator.sendBeacon) { const realBeacon = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (url, data) => String(url).startsWith(WORKER_URL) ? true : realBeacon(url, data); }
  addEventListener("DOMContentLoaded", () => {
    const flag = Object.assign(document.createElement("div"), { className: "preview-flag", textContent: "PREVIEW · NOTHING HERE IS SAVED" });
    document.body.appendChild(flag);
  });
}

// App health, for the admin dashboard: errors, data loads that failed or
// crawled (ESPN vs our Worker), and how long until the first screen had
// data. Counted in memory and sent with the session beacon when the app
// is put away; a counter bump per event, nothing on the network.
const appHealth = { e: 0, em: [], ff: { espn: 0, worker: 0 }, sl: { espn: 0, worker: 0 }, ld: null };
const healthT0 = performance.now();
function noteError(msg) {
  appHealth.e++;
  const m = String(msg || "error").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (m && appHealth.em.length < 3 && !appHealth.em.includes(m)) appHealth.em.push(m);
}
addEventListener("error", (e) => { if (e?.message) noteError(e.message); });
addEventListener("unhandledrejection", (e) => noteError(e?.reason?.message || e?.reason || "unhandled rejection"));
function markUsable() { if (appHealth.ld == null) appHealth.ld = Math.round(performance.now() - healthT0); }
(() => {
  const raw = window.fetch?.bind(window);
  if (!raw) return;
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const b = /espn\.com|espncdn/.test(url) ? "espn" : url.startsWith(WORKER_URL) ? "worker" : null;
    if (!b) return raw(input, init);
    const t0 = performance.now();
    try {
      const r = await raw(input, init);
      if (r.status >= 500 || r.status === 429) appHealth.ff[b]++;
      if (performance.now() - t0 > 4000) appHealth.sl[b]++;
      return r;
    } catch (err) {
      if (err?.name !== "AbortError") appHealth.ff[b]++;
      throw err;
    }
  };
})();

const STORAGE_KEY_BASE = "brochiefs_picks_v1";
// Local picks are namespaced per week from week 2 on, so a device holding
// last week's card cannot leak it into the new one.
const storageKey = () => (currentWeek === 1 ? STORAGE_KEY_BASE : `${STORAGE_KEY_BASE}_w${currentWeek}`);

// Kickoff dates confirmed against each team's published 2026 schedule:
// Week 1 Saturday slate is Sept 5, 2026; the Louisville/Ole Miss "Music
// City Kickoff" is Sunday, Sept 6, 2026.
// ESPN team IDs, used to hotlink official logos from ESPN's CDN
// (a.espncdn.com/i/teamlogos/ncaa/500-dark/<id>.png) — nothing downloaded or
// stored in this repo, just referenced by URL like any other <img src>.
// The week-1 slate ships in the file so the app works before the Worker
// answers, and as a fallback if it never does. From week 2 on the slate
// comes from the Worker, where the commissioner edits it.
let GAMES = [
  { id: 1, away: "Liberty", awayId: 2335, awayShort: "Liberty", homeShort: "JMU", home: "James Madison", homeId: 256, favorite: "James Madison", spread: 6.5, kickoff: "2026-09-05T16:00:00Z", kickoffLabel: "Sat 12:00 PM ET", tv: "ESPNU" },
  { id: 2, away: "Miami (OH)", awayId: 193, awayShort: "Miami OH", homeShort: "Pitt", home: "Pitt", homeId: 221, favorite: "Pitt", spread: 16.5, kickoff: "2026-09-05T16:30:00Z", kickoffLabel: "Sat 12:30 PM ET", tv: "The CW" },
  { id: 3, away: "Baylor", awayId: 239, awayShort: "Baylor", homeShort: "Auburn", home: "Auburn", homeId: 2, favorite: "Auburn", spread: 7.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "ABC" },
  { id: 4, away: "Boston College", awayId: 103, awayShort: "BC", homeShort: "Cincy", home: "Cincinnati", homeId: 2132, favorite: "Cincinnati", spread: 7.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "FOX" },
  { id: 5, away: "Tulane", awayId: 2655, awayShort: "Tulane", homeShort: "Duke", home: "Duke", homeId: 150, favorite: "Duke", spread: 7.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "ACCN" },
  { id: 6, away: "Boise State", awayId: 68, awayShort: "Boise St", homeShort: "Oregon", home: "#2 Oregon", homeId: 2483, favorite: "#2 Oregon", spread: 24.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "CBS" },
  { id: 7, away: "Wyoming", awayId: 2751, awayShort: "Wyoming", homeShort: "Colo St", home: "Colorado State", homeId: 36, favorite: "Colorado State", spread: 3.5, kickoff: "2026-09-05T22:00:00Z", kickoffLabel: "Sat 6:00 PM ET", tv: "USA" },
  { id: 8, away: "Clemson", awayId: 228, awayShort: "Clemson", homeShort: "LSU", home: "#11 LSU", homeId: 99, favorite: "#11 LSU", spread: 10, kickoff: "2026-09-05T23:30:00Z", kickoffLabel: "Sat 7:30 PM ET", tv: "ABC", tiebreakerGame: true },
  { id: 9, away: "East Carolina", awayId: 151, awayShort: "ECU", homeShort: "Alabama", home: "#13 Alabama", homeId: 333, favorite: "#13 Alabama", spread: 27.5, kickoff: "2026-09-05T16:00:00Z", kickoffLabel: "Sat 12:00 PM ET", tv: "ABC" },
  { id: 10, away: "#24 Louisville", awayId: 97, awayShort: "Louisville", homeShort: "Ole Miss", home: "#9 Ole Miss", homeId: 145, favorite: "#9 Ole Miss", spread: 7, kickoffLabel: "Sun 7:30 PM ET", kickoff: "2026-09-06T23:30:00Z", tv: "ABC" },
];

let WEEK_LABEL = "Week 1";
let currentWeek = 1;
let weekList = [1];

// Pull the current slate from the Worker. The last good slate is kept on
// the phone, so with no signal the app opens on this week's games rather
// than the built-in week 1 below, which stays as the last resort.
const SLATE_CACHE_KEY = "brochiefs_slate_v1";
let slateFromNetwork = false;
function restoreCachedSlate() {
  if (slateFromNetwork) return;
  try {
    const c = JSON.parse(localStorage.getItem(SLATE_CACHE_KEY) || "null");
    if (!c || !Array.isArray(c.games) || !c.games.length) return;
    GAMES = c.games;
    currentWeek = c.week || currentWeek;
    if (latestLiveWeek !== null && latestLiveWeek !== currentWeek) { latestLive = {}; latestLiveWeek = null; }
    WEEK_LABEL = c.label || `Week ${currentWeek}`;
    if (Array.isArray(c.list)) weekList = c.list;
  } catch { /* private mode or a bad copy: keep what is there */ }
}
async function loadSlate(week) {
  if (!WORKER_URL) return false;
  try {
    const q = week ? `?week=${week}&` : "?";
    const res = await fetch(`${WORKER_URL}/games${q}t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) { if (!week) restoreCachedSlate(); return false; }
    const data = await res.json();
    if (data.weeks && Array.isArray(data.weeks.list)) weekList = data.weeks.list;
    if (!Array.isArray(data.games) || !data.games.length) return false;
    GAMES = data.games;
    currentWeek = data.week || currentWeek;
    // A new week: last week's live data (scores, ranks, records) is keyed by
    // game number, so it would land on this week's games. Drop it.
    if (latestLiveWeek !== null && latestLiveWeek !== currentWeek) { latestLive = {}; latestLiveWeek = null; }
    WEEK_LABEL = data.label || `Week ${currentWeek}`;
    if (!week) {
      slateFromNetwork = true;
      try { localStorage.setItem(SLATE_CACHE_KEY, JSON.stringify({ games: GAMES, week: currentWeek, label: WEEK_LABEL, list: weekList })); } catch {}
    }
    return true;
  } catch {
    if (!week) restoreCachedSlate();
    return false;
  }
}
function weekIsFinal() {
  const results = computeLiveResults(latestLive);
  return GAMES.every((g) => results[g.id]);
}

// ESPN ships a second cut of every logo drawn for dark backgrounds
// (navy and black marks such as Penn State get a light outline or a
// white fill). The app is dark everywhere, so that cut is the default;
// an <img> that fails to load it falls back to the standard file below.
// Logos come through ESPN's image resizer at 160px, enough for the largest
// 50px logo on a 3x screen and about a sixth of the 500px file's weight.
// A failed resized logo falls back to the full file, then to the light cut.
const LOGO_PX = 160;
function logoUrl(espnId) {
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500-dark/${espnId}.png&w=${LOGO_PX}&h=${LOGO_PX}`;
}
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.src.includes("a.espncdn.com/")) return;
  const m = img.src.match(/combiner\/i\?img=([^&]+)/);
  if (m) { img.src = `https://a.espncdn.com${decodeURIComponent(m[1])}`; return; }
  if (img.src.includes("/500-dark/")) img.src = img.src.replace("/500-dark/", "/500/");
}, true);

const MANAGERS = [
  "Robert", "Logan", "Jordan", "Conlan", "Dewitt",
  "Nissan", "Skills", "Jake", "Curt", "Andrew",
];

const AVATAR_COLORS = ["#ff2079", "#05d9e8", "#c13cff", "#ffe45e", "#39ff88"];
// Full palette for the avatar editor: neon, warm, cool, deep and neutral.
const AVATAR_PALETTE = [
  "#ff2079", "#ff5c8a", "#ff3b3b", "#ff7a1a", "#ffb000", "#ffe45e",
  "#c6ff3d", "#39ff88", "#00c48c", "#05d9e8", "#3da5ff", "#2f5bff",
  "#7b5cff", "#c13cff", "#ff4fd8", "#b5179e", "#8b1e3f", "#7a4b2a",
  "#1f7a4d", "#14506e", "#2b2d6e", "#ffffff", "#9aa0b5", "#3a3a4a",
];
// A player's avatar colour: their own pick if they set one, else the
// roster default by position.
function accentFor(name) {
  const own = typeof avatarColors !== "undefined" && avatarColors[name];
  if (own) return own;
  const i = MANAGERS.indexOf(name);
  return AVATAR_COLORS[(i >= 0 ? i : 0) % AVATAR_COLORS.length];
}

// What a manager is called on screen. The key stays what every stored
// pick, ledger row, login and vote hangs off; only the label changes.
const NAME_SHOWN = { Conlan: "Connie" };
const shown = (n) => NAME_SHOWN[n] || n;

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(storageKey())) || {};
  } catch {
    return {};
  }
}

function saveAll(data) {
  localStorage.setItem(storageKey(), JSON.stringify(data));
}

// Discards any pick saved in the old "just a team name" format (from
// before the SU/ATS scoring rules were wired in), so stale test data
// renders as "not submitted" instead of crashing or showing "undefined".
function sanitizePicks(picks) {
  const clean = {};
  Object.entries(picks || {}).forEach(([gameId, pick]) => {
    if (pick && typeof pick === "object" && pick.team && pick.mode) clean[gameId] = pick;
  });
  return clean;
}

// For the room's view of other owners: keeps the server's hidden
// placeholders ({ hidden: true }, an unlocked pick we may not see) so pick
// counts stay right, alongside real picks. Never used for our own state.
function sanitizeRoomPicks(picks) {
  const clean = {};
  Object.entries(picks || {}).forEach(([gameId, pick]) => {
    if (pick && typeof pick === "object" && (pick.hidden === true || (pick.team && pick.mode))) clean[gameId] = pick.hidden === true ? { hidden: true } : pick;
  });
  return clean;
}

function getManagerState(name) {
  const all = loadAll();
  const state = all[name] || { picks: {}, tiebreaker: "" };
  return { ...state, picks: sanitizePicks(state.picks) };
}

function setManagerState(name, state) {
  const all = loadAll();
  all[name] = state;
  saveAll(all);
}

// The Sweatpants Amendment, carried 2026-09-24: from week 4, every pick
// locks at the week's first kickoff. Before that, each game locked at
// its own. The Worker applies the same rule when it grades a late save.
const LOCK_ALL_FROM_WEEK = 4;
function weekLockTime() {
  if (currentWeek < LOCK_ALL_FROM_WEEK || !GAMES.length) return null;
  return Math.min(...GAMES.map((g) => new Date(g.kickoff).getTime()));
}
// The slate flags the tiebreaker game. If a slate ever ships without the
// flag, the last kickoff stands in, so nothing that needs it can crash.
function tiebreakerGameOf() {
  return GAMES.find((g) => g.tiebreakerGame) || gamesByKickoff().slice(-1)[0] || null;
}
function isGameLocked(game) {
  if (!game) return false;
  const all = weekLockTime();
  return Date.now() >= (all ?? new Date(game.kickoff).getTime());
}

// --- Worker sync (cross-device picks + results) --------------------------

// Every pick carries the time it was made so two copies of a manager's
// state can be merged game by game instead of one blob replacing the
// other. Newer wins per game; a pick with no timestamp is treated as old.
function mergeStates(a, b) {
  const out = { picks: {}, tiebreaker: "" };
  const ids = new Set([...Object.keys(a?.picks || {}), ...Object.keys(b?.picks || {})]);
  ids.forEach((id) => {
    const pa = a?.picks?.[id], pb = b?.picks?.[id];
    if (!pa) out.picks[id] = pb; else if (!pb) out.picks[id] = pa;
    else out.picks[id] = (pb.updatedAt || 0) > (pa.updatedAt || 0) ? pb : pa;
  });
  const ta = a?.tiebreakerUpdatedAt || 0, tb = b?.tiebreakerUpdatedAt || 0;
  const useB = tb > ta || (tb === ta && !String(a?.tiebreaker || "").trim());
  out.tiebreaker = useB ? (b?.tiebreaker ?? "") : (a?.tiebreaker ?? "");
  out.tiebreakerUpdatedAt = Math.max(ta, tb);
  return out;
}

// Push with retries. The caller gets true only when the Worker confirmed
// the write; on failure the state is queued and retried in the background
// so a flaky connection never silently drops a pick.
const PENDING_KEY = "brochiefs_pending_push_v1";
let syncStatus = "idle"; // idle | saving | saved | failed
const syncListeners = new Set();
function setSyncStatus(next) { syncStatus = next; syncListeners.forEach((fn) => fn(next)); }

// The queue, not the last tap, is the truth about whether a pick reached
// the cloud. A badge tied to the tap goes stale the moment the pulse timer
// clears, which is well before three retries have run out.
function pendingPushFor(manager) {
  try { return localStorage.getItem(PENDING_KEY) === manager; } catch { return false; }
}

// The state the Worker sent back on the last successful push, so the
// tiebreaker card can confirm what the cloud actually holds.
let lastPushEcho = null;
async function pushManagerState(manager, state, { attempts = 3 } = {}) {
  if (!WORKER_URL) return false;
  setSyncStatus("saving");
  // Read, merge, then write: only this device's newer picks go up, and a
  // stale copy of the other games never overwrites what the cloud holds.
  // Locked games are always taken from the cloud.
  let toSend = state;
  try {
    const cloud = await fetchAllPicks(manager);
    const remote = cloud && cloud[manager] ? { ...cloud[manager], picks: sanitizePicks(cloud[manager].picks) } : null;
    if (remote) {
      toSend = mergeStates(remote, state);
      GAMES.forEach((game) => {
        if (!isGameLocked(game)) return;
        if (remote.picks[game.id]) toSend.picks[game.id] = remote.picks[game.id]; else delete toSend.picks[game.id];
      });
      const all = loadAll(); all[manager] = toSend; saveAll(all);
    }
  } catch {
    // Cloud unreadable: send what we have; the Worker merges too.
  }
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${WORKER_URL}/picks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manager, state: toSend, week: currentWeek, token: tokenFor(manager) || undefined }),
        cache: "no-store",
      });
      // Signed out: retrying cannot help, so stop and ask for the code.
      if (res.status === 401) {
        setSyncStatus("failed");
        handleAuthFailure(manager);
        return false;
      }
      if (res.ok) {
        try { lastPushEcho = (await res.json())?.state || null; } catch { lastPushEcho = null; }
        try { localStorage.removeItem(PENDING_KEY); } catch {}
        boardPicks.at = 0;
        setSyncStatus("saved");
        return true;
      }
    } catch {
      // fall through to retry
    }
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  try { localStorage.setItem(PENDING_KEY, manager); } catch {}
  setSyncStatus("failed");
  return false;
}

// Retry anything that failed to reach the Worker, on a timer and whenever
// the app comes back to the foreground.
async function flushPendingPush() {
  let manager = null;
  try { manager = localStorage.getItem(PENDING_KEY); } catch {}
  if (!manager) return;
  const ok = await pushManagerState(manager, getManagerState(manager), { attempts: 1 });
  if (ok && manager === currentManager && !picksScreen.classList.contains("hidden")) withScrollPreserved(renderPicksScreen);
}

// Other owners' picks come back hidden until each game locks; ours come
// back whole because we say who we are (and prove it once login is on).
async function fetchAllPicks(who = currentManager || loadMe()) {
  if (!WORKER_URL) return null;
  try {
    const me = who && MANAGERS.includes(who) ? `&me=${encodeURIComponent(who)}${tokenFor(who) ? `&token=${encodeURIComponent(tokenFor(who))}` : ""}` : "";
    const res = await fetchCapped(`${WORKER_URL}/picks?week=${currentWeek}${me}&t=${Date.now()}`, { cache: "no-store" }, 8000);
    if (!res.ok) return null;
    const data = await res.json();
    // A response without a picks object is a broken response, not an
    // empty league. Returning {} for it made everyone read as 0/10.
    if (!data || typeof data.picks !== "object" || data.picks === null) return null;
    return data.picks;
  } catch {
    return null;
  }
}

// Live scores, proxied through the Worker (which talks to ESPN's public
// scoreboard server-side). Returns a map of gameId -> live status, or {}
// if the Worker is unreachable — the scoreboard just won't show live
// data in that case, nothing breaks.
// ESPN's public scoreboard allows browser requests but blocks Cloudflare's
// datacenter IPs, so the phone asks ESPN directly and the Worker route is
// only a fallback. Matching by ESPN team id, same as the Worker did.
// The days to ask ESPN about come from the slate itself. These were once
// hardcoded to week 1's Saturday and Sunday, which meant every week after
// that asked for the wrong days and found no scores at all.
function espnScoreboardDates() {
  const days = new Set();
  for (const g of GAMES) {
    const t = new Date(g.kickoff).getTime();
    if (!Number.isFinite(t)) continue;
    // Eastern, because that is the day ESPN files a game under, and a
    // Friday night kickoff is already Saturday in UTC.
    days.add(new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" }).replace(/-/g, ""));
  }
  return [...days].sort();
}
// A team's poll position, drawn the same way everywhere it appears. It
// comes from the live ESPN feed, so it is simply absent when the feed has
// nothing to say: an unranked team gets no badge.
// Two states, and the number carries the rest. Green paid, pink did not,
// a dashed edge means the game has not finished. Colouring by value as
// well, green 1, cyan 2, gold 3, meant four colours of pill scattered over
// ten cards, and the digit beside them already said how many.
function ptsTier(points) {
  return points > 0 ? "hit" : "miss";
}

// The breakdown is one manager's ten picks read side by side, where what
// each was worth is the interesting part, so its chips colour by value:
// 1 green, 2 cyan, 3 gold. The board does not, because ten cards of
// four-colour pills is noise and the digit already says how many.
function ptsValueTier(points) {
  return points >= 3 ? "upset" : points === 2 ? "hit2" : points > 0 ? "hit" : "miss";
}

function rankBadge(rank) {
  return rank ? `<i class="tm-rank" title="AP rank">${rank}</i>` : "";
}

function parseEspnEvents(events, games = GAMES) {
  const byId = {};
  games.forEach((game) => {
    const event = events.find((e) => {
      const ids = ((e?.competitions?.[0]?.competitors) || []).map((c) => Number(c?.team?.id));
      return ids.includes(game.awayId) && ids.includes(game.homeId);
    });
    if (!event) return;
    const comp = event.competitions[0];
    const away = comp.competitors.find((c) => c.homeAway === "away");
    const home = comp.competitors.find((c) => c.homeAway === "home");
    // ESPN carries status on both the event and the competition and they
    // do not always flip together at the final, so read both and treat any
    // "final" signal as final.
    const st1 = comp.status?.type || {};
    const st2 = event.status?.type || {};
    // Final means ESPN's structured flags say so: completed, or a
    // STATUS_FINAL* name. A postponed or canceled game also sits in state
    // "post" with completed=false, so "post" alone is never treated as
    // final, and free-text status strings are never used for scoring.
    const isVoid = (t) => /^STATUS_(POSTPONED|CANCELED|CANCELLED|SUSPENDED|FORFEIT)/.test(t.name || "");
    const isFinal = (t) => !isVoid(t) && (t.completed === true || /^STATUS_FINAL/.test(t.name || ""));
    const finalNow = isFinal(st1) || isFinal(st2);
    const statusType = finalNow ? { ...st2, ...st1, completed: true, state: "post", shortDetail: (st1.shortDetail && /final/i.test(st1.shortDetail)) ? st1.shortDetail : (st2.shortDetail && /final/i.test(st2.shortDetail)) ? st2.shortDetail : "Final" } : (Object.keys(st1).length ? st1 : st2);
    const prob = comp.situation?.lastPlay?.probability;
    const winProb = prob && Number.isFinite(prob.homeWinPercentage) && Number.isFinite(prob.awayWinPercentage)
      ? { home: prob.homeWinPercentage * 100, away: prob.awayWinPercentage * 100 }
      : null;
    // AP / CFP poll position. ESPN files an unranked team as 99, which is
    // not a rank, so it becomes null rather than a number nobody wants to
    // see. Read live rather than frozen into the slate, because a team's
    // rank moves every week and the slate does not.
    const recordOf = (side) => { const r = side?.records?.find((x) => /total|overall/i.test(x?.type || x?.name || "")) || side?.records?.[0]; return typeof r?.summary === "string" ? r.summary : null; };
    const rankOf = (side) => { const n = Number(side?.curatedRank?.current); return Number.isFinite(n) && n >= 1 && n <= 25 ? n : null; };
    const o = comp.odds?.[0];
    const oSpread = Number(o?.spread);
    const odds = o ? {
      details: typeof o.details === "string" ? o.details : null,
      spread: Number.isFinite(oSpread) ? Math.abs(oSpread) : null,
      favoriteSide: o.homeTeamOdds?.favorite === true ? "home" : o.awayTeamOdds?.favorite === true ? "away" : Number.isFinite(oSpread) ? (oSpread < 0 ? "home" : "away") : null,
      overUnder: Number.isFinite(Number(o.overUnder)) ? Number(o.overUnder) : null,
    } : null;
    byId[game.id] = {
      id: game.id,
      found: true,
      eventId: event.id || null,
      odds,
      awayRank: rankOf(away),
      homeRank: rankOf(home),
      awayAbbr: away?.team?.abbreviation || null,
      homeAbbr: home?.team?.abbreviation || null,
      awayTeamId: Number(away?.team?.id) || null,
      awayRecord: recordOf(away),
      homeRecord: recordOf(home),
      state: statusType.state || "pre",
      completed: !!statusType.completed,
      rawStatus: { comp: { name: st1.name, state: st1.state, completed: st1.completed, detail: st1.shortDetail }, event: { name: st2.name, state: st2.state, completed: st2.completed, detail: st2.shortDetail } },
      detail: statusType.shortDetail || statusType.detail || "",
      period: comp.status?.period ?? null,
      clock: comp.status?.displayClock ?? null,
      awayScore: away?.score != null ? Number(away.score) : null,
      homeScore: home?.score != null ? Number(home.score) : null,
      // Points by quarter, for second-half side bets.
      awayLines: Array.isArray(away?.linescores) ? away.linescores.map((x) => Number(x?.value) || 0) : null,
      homeLines: Array.isArray(home?.linescores) ? home.linescores.map((x) => Number(x?.value) || 0) : null,
      winProb,
      // Where the ball is, for the live view on the sheet.
      awayColor: away?.team?.color ? `#${away.team.color}` : null,
      homeColor: home?.team?.color ? `#${home.team.color}` : null,
      situation: comp.situation ? {
        down: Number.isFinite(Number(comp.situation.down)) ? Number(comp.situation.down) : null,
        distance: Number.isFinite(Number(comp.situation.distance)) ? Number(comp.situation.distance) : null,
        yardLine: Number.isFinite(Number(comp.situation.yardLine)) ? Number(comp.situation.yardLine) : null,
        // ESPN drops possession at times mid-game; then the team holding
        // the ball at the end of the last play, else the team that ran it
        // (flipped when the play hands the ball over).
        possessionId: comp.situation.possession != null ? Number(comp.situation.possession) : possFromLastPlay(comp.situation.lastPlay, away?.team?.id, home?.team?.id, statusType),
        downDistance: comp.situation.downDistanceText || comp.situation.shortDownDistanceText || null,
        possessionText: comp.situation.possessionText || null,
        isRedZone: !!comp.situation.isRedZone,
        lastPlay: comp.situation.lastPlay?.text || null,
        lastPlayTeamId: comp.situation.lastPlay?.team?.id != null ? Number(comp.situation.lastPlay.team.id) : null,
      } : null,
    };
  });
  return byId;
}

function possFromLastPlay(lp, awayId, homeId, st) {
  if (!lp || st?.state !== "in" || st?.completed) return null;
  // A timeout names the team that called it as the "end" team, so for
  // stoppages the "start" team, the offence, is the one with the ball.
  const pause = /timeout|end period|end of (half|game)|two.?minute|official/i.test(String(lp.type?.text || ""));
  const endTeam = pause ? lp.start?.team?.id : lp.end?.team?.id;
  if (endTeam != null) return Number(endTeam);
  if (pause) return null;
  const t = lp.team?.id != null ? Number(lp.team.id) : null;
  if (t == null) return null;
  const flip = /punt|kickoff|interception|fumble recovery \(opp|turnover on downs|blocked (punt|field goal)|missed field goal|safety/i.test(String(lp.type?.text || ""));
  if (!flip) return t;
  return t === Number(awayId) ? Number(homeId) : t === Number(homeId) ? Number(awayId) : null;
}
// A request that has not answered in this long is treated as failed, so a
// stalled connection can never hold the board blank.
function fetchCapped(url, opts = {}, ms = 5000) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  return fetch(url, ctl ? { ...opts, signal: ctl.signal } : opts).finally(() => clearTimeout(timer));
}
async function fetchLiveFromEspn() {
  const events = [];
  let ok = 0;
  // Every day at once, not one after another: a Thursday to Saturday
  // slate is three requests, and the slowest sets the wait.
  const answers = await Promise.all(espnScoreboardDates().map(async (date) => {
    try {
      const res = await fetchCapped(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}&groups=80&limit=300&t=${Date.now()}`,
        { cache: "no-store" }, 4000
      );
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }));
  for (const data of answers) {
    if (!data) continue;
    ok++;
    if (Array.isArray(data?.events)) events.push(...data.events);
  }
  // No date answered: throw so the caller falls back and retries soon.
  if (!ok) throw new Error("espn scoreboard unavailable");
  espnPartial = ok < answers.length;
  return parseEspnEvents(events);
}

async function fetchLiveFromWorker() {
  if (!WORKER_URL) return {};
  const res = await fetchCapped(`${WORKER_URL}/live?t=${Date.now()}`, { cache: "no-store" }, 8000);
  if (!res.ok) throw new Error(`worker live ${res.status}`);
  const data = await res.json();
  const byId = {};
  (data.games || []).forEach((g) => {
    if (!g || !g.found) return;
    // The Worker passes ESPN's win chance as a fraction (0.80); the app
    // reads percent (80), as parseEspnEvents makes it. Read raw, a team
    // at 80% looked like 0.8% and swung every win chance on the board.
    const wp = g.winProb;
    if (wp && Number.isFinite(wp.home) && Number.isFinite(wp.away) && wp.home <= 1 && wp.away <= 1) g.winProb = { home: wp.home * 100, away: wp.away * 100 };
    byId[g.id] = g;
  });
  return byId;
}

// Latest live map, shared with the picks screen so locked games there show
// the score without their own fetch.
let latestLive = {}, latestLiveWeek = null;
// Whether the last read answered (the board's copy is fresh), and whether
// ESPN answered for only some of the slate's days.
let liveLastOk = false, espnPartial = false;
// How long a live-scores fetch stays good. Every time while a game is on
// (or might be: kicked off within five hours and not final), every minute
// in the two hours before a kickoff, every five minutes otherwise. A
// Tuesday no longer polls ESPN every ten seconds. Coming back to the app
// always fetches fresh.
let liveFetchedAt = 0;
function liveTtl() {
  const now = Date.now();
  if (Object.values(latestLive).some((l) => l?.found && l.state === "in" && !l.completed)) return 0;
  const ks = GAMES.map((g) => ({ g, k: Date.parse(g.kickoff) })).filter((x) => Number.isFinite(x.k));
  if (ks.some(({ g, k }) => now >= k - 10 * 60000 && now < k + 5 * 3600000 && !latestLive[g.id]?.completed)) return 0;
  if (ks.some(({ k }) => k > now && k - now < 2 * 3600000)) return 60000;
  return 5 * 60000;
}
// One request at a time: the board, the picks screen and the timers all
// ask for live scores, and two callers at once now share one answer.
let liveInFlight = null;
function fetchLiveScores(force = false) {
  if (!force && liveFetchedAt && Date.now() - liveFetchedAt < liveTtl()) return Promise.resolve(latestLive);
  if (liveInFlight) return liveInFlight;
  liveInFlight = fetchLiveScoresNow().finally(() => { liveInFlight = null; });
  return liveInFlight;
}
async function fetchLiveScoresNow() {
  let live = {}, answered = false;
  try {
    live = await fetchLiveFromEspn();
    answered = true;
  } catch (err) {
    console.warn("ESPN direct fetch failed, falling back to Worker", err);
  }
  if (!Object.keys(live).length) {
    try { live = await fetchLiveFromWorker(); answered = true; } catch { live = {}; }
  } else if (espnPartial) {
    // A day that timed out would leave its games blank; the Worker fills them.
    try { const w = await fetchLiveFromWorker(); for (const [id, g] of Object.entries(w)) if (!live[id]) live[id] = g; } catch {}
  }
  // A game this phone already saw finish stays finished: a read that
  // missed it is no reason to play it out again.
  if (Object.keys(live).length && latestLiveWeek === currentWeek) for (const [id, g] of Object.entries(latestLive)) if (g?.completed && !live[id]) live[id] = g;
  if (Object.keys(live).length) { latestLive = live; latestLiveWeek = currentWeek; }
  // A failed fetch is never reused; an answer (even "no games yet") is.
  if (answered) liveFetchedAt = Date.now();
  liveLastOk = answered;
  return Object.keys(live).length ? live : latestLive;
}

// Cloud is the source of truth across devices — pull once per manager
// select and merge into local storage before rendering, so a manager who
// submitted a pick on their phone sees it submitted on their laptop too.
// Locked games where this device and the cloud disagree, and the device's
// picks as they were before the cloud copy replaced them.
let lockedMismatch = [];
const phoneSnapshot = {};

// Admin repair from the phone: post this device's picks as the record.
async function restorePhonePicks(name) {
  const snap = phoneSnapshot[name];
  if (!snap) return;
  const key = window.prompt("Admin key (ARCHIVE_LOG_KEY) to make this phone's picks the record:");
  if (!key) return;
  try {
    const res = await fetch(`${WORKER_URL}/picks?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ manager: name, state: snap, week: currentWeek }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.admin) { window.alert("Not restored: the key did not match."); return; }
    delete phoneSnapshot[name];
    lockedMismatch = [];
    const all = loadAll(); all[name] = snap; saveAll(all);
    window.alert("Restored. The cloud now matches this phone.");
    withScrollPreserved(renderPicksScreen);
  } catch {
    window.alert("Not restored: could not reach the Worker.");
  }
}

async function syncManagerFromCloud(name) {
  const cloud = await fetchAllPicks(name);
  if (!cloud) return null;
  const all = loadAll();
  const local = all[name] || { picks: {}, tiebreaker: "" };
  const remote = cloud[name] ? { ...cloud[name], picks: sanitizePicks(cloud[name].picks) } : null;
  // Before the cloud copy replaces locked games on this device, note where
  // the two disagree so the owner can restore this device's picks if the
  // cloud record is the one that is wrong.
  const before = { ...local, picks: sanitizePicks(local.picks) };
  lockedMismatch = GAMES.filter((g) => isGameLocked(g)).filter((g) => {
    const a = before.picks[g.id], b = remote?.picks?.[g.id];
    return (a?.team || "") !== (b?.team || "") || (a?.mode || "") !== (b?.mode || "");
  }).map((g) => ({ id: g.id, phone: before.picks[g.id] || null, cloud: remote?.picks?.[g.id] || null }));
  if (lockedMismatch.length && !phoneSnapshot[name]) phoneSnapshot[name] = before;
  const merged = remote ? mergeStates(remote, local) : { ...local, picks: {} };
  // Games past kickoff are settled: the cloud copy at lock is the record,
  // and nothing on this device may add, change or resurrect a pick for
  // them. Only open games merge.
  GAMES.forEach((game) => {
    if (!isGameLocked(game)) return;
    if (remote && remote.picks[game.id]) merged.picks[game.id] = remote.picks[game.id];
    else delete merged.picks[game.id];
  });
  // The cloud's guess is confirmed by definition; a newer one on this
  // phone stays unconfirmed until the Worker echoes it back.
  const mergedTb = String(merged.tiebreaker ?? "").trim();
  if (remote && String(remote.tiebreaker ?? "").trim() === mergedTb) merged.tiebreakerSavedToCloud = mergedTb;
  else delete merged.tiebreakerSavedToCloud;
  all[name] = merged;
  saveAll(all);
  // If local held an open-game pick or a newer guess the cloud did not, send it up.
  if (remote && (JSON.stringify(merged.picks) !== JSON.stringify(remote.picks) || merged.tiebreakerSavedToCloud !== mergedTb)) pushManagerState(name, merged);
  // Handed back so the standings row can rank from the same payload
  // instead of asking the Worker for it a second time.
  return cloud;
}

// --- Screens / navigation -------------------------------------------------

let currentManager = null;

// Identity is remembered per device ("Who are you?" is answered once),
// so return visits skip the roster and land straight on picks or the
// live board. Switching is an explicit, confirmed act — nobody ends up
// on someone else's card by accident.
const ME_KEY = "brochiefs_me_v1";

function loadMe() {
  const me = localStorage.getItem(ME_KEY);
  return MANAGERS.includes(me) ? me : null;
}

function saveMe(name) {
  localStorage.setItem(ME_KEY, name);
  updateMePill();
}

// Header pill showing who this device is. Tap goes to the roster, where
// picking another card asks before switching.
function updateMePill() {
  const pill = document.getElementById("me-pill");
  if (!pill) return;
  const me = loadMe();
  if (!me) { pill.classList.add("hidden"); return; }
  const idx = MANAGERS.indexOf(me);
  const accent = accentFor(me);
  const av = (typeof avatarOverrides !== "undefined" && avatarOverrides[me]) || shown(me)[0];
  pill.innerHTML = `<span class="me-pill-avatar" style="--accent:${accent}">${av}</span><span class="me-pill-name">${shown(me).toUpperCase()}</span>`;
  pill.classList.remove("hidden");
}

// --- Owner login ------------------------------------------------------
// Each owner claims their name once with a code of their own choosing and
// this device keeps a signed token for them; picks are posted with it so
// the Worker knows the pick is really theirs. Reading the board, the
// archive and trivia never needs any of this.
//
// The Worker's AUTH_MODE decides whether it is live ("off" ships the
// whole path dark). While it is off nothing here shows up, so the league
// sees exactly what it sees today; add ?auth=1 to the URL to try it.
const AUTH_TOKEN_KEY = "brochiefs_token_v1";
const AUTH_PREVIEW_KEY = "brochiefs_auth_preview";
// A random id for this browser, kept alongside the token. It is not an
// identity and carries nothing about the person — it exists so the login
// log can say "a device that has signed in as Dewitt before" instead of
// treating every sign-in as brand new.
const AUTH_DEVICE_KEY = "brochiefs_device_v1";
let authState = { mode: "off", claimed: [] };

function authPreview() {
  try {
    if (new URLSearchParams(location.search).get("auth") === "1") sessionStorage.setItem(AUTH_PREVIEW_KEY, "1");
    return sessionStorage.getItem(AUTH_PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

// Live for the league only once the Worker says so.
function authActive() {
  return authState.mode === "on" || authState.mode === "soft" || authPreview();
}

// Codes are mandatory only in "on". In "soft" a pick still saves without
// one, so the code step is offered rather than required.
function authRequired() {
  return authState.mode === "on";
}

function deviceId() {
  try {
    let id = localStorage.getItem(AUTH_DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/-/g, "").slice(0, 24);
      localStorage.setItem(AUTH_DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

// Only what helps tell one device from another: the screen it is on and
// the timezone it thinks it is in.
function deviceDetails() {
  try {
    return {
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      screen: `${screen.width}x${screen.height}`,
    };
  } catch {
    return {};
  }
}

function loadAuth() {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTH_TOKEN_KEY) || "null");
    return raw && MANAGERS.includes(raw.manager) && typeof raw.token === "string" ? raw : null;
  } catch {
    return null;
  }
}

function saveAuth(manager, token) {
  try { localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify({ manager, token })); } catch {}
}

function clearAuth() {
  try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch {}
}

// The token only counts for the owner it was issued to, so switching
// owners on a device means signing in as the new one.
function tokenFor(name) {
  const held = loadAuth();
  return held && held.manager === name ? held.token : null;
}

async function refreshAuthState() {
  if (!WORKER_URL) return;
  try {
    const res = await fetch(`${WORKER_URL}/auth?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.mode === "string") authState = { mode: data.mode, claimed: Array.isArray(data.claimed) ? data.claimed : [] };
  } catch {
    // Login stays off if the Worker cannot be reached; picks still queue.
  }
}

// The code step. Resolves true once this device holds a token for `name`,
// false if the owner backed out. An unclaimed name is being claimed for
// the first time and sets its code here; a claimed one signs in.
let codeResolve = null;
function requireOwnerAuth(name) {
  if (!authActive() || tokenFor(name)) return Promise.resolve(true);
  const claimed = authState.claimed.includes(name);
  const modal = document.getElementById("code-modal");
  if (!modal) return Promise.resolve(true);
  document.getElementById("code-title").textContent = claimed ? "🔑 YOUR CODE" : "🔑 SET YOUR CODE";
  document.getElementById("code-subtext").textContent = claimed
    ? `Enter the code you set for ${shown(name)}.`
    : `Nobody has claimed ${shown(name)} yet. Pick a code of six characters or more — you will need it on every device.`;
  document.getElementById("code-owner").textContent = shown(name).toUpperCase();
  const input = document.getElementById("code-input");
  input.value = "";
  input.placeholder = claimed ? "your code" : "at least 6 characters";
  document.getElementById("code-ok").textContent = claimed ? "Sign in" : "Claim it";
  setCodeStatus(authRequired() ? "" : "Optional for now — picks still save without it.");
  modal.dataset.owner = name;
  modal.dataset.claimed = claimed ? "1" : "";
  modal.classList.remove("hidden");
  setTimeout(() => input.focus(), 50);
  return new Promise((resolve) => { codeResolve = resolve; });
}

function setCodeStatus(msg, kind = "") {
  const el = document.getElementById("code-status");
  if (el) { el.textContent = msg || ""; el.className = "code-status " + kind; }
}

function closeCodeModal(result) {
  document.getElementById("code-modal")?.classList.add("hidden");
  const done = codeResolve;
  codeResolve = null;
  if (done) done(!!result);
}

async function submitOwnerCode() {
  const modal = document.getElementById("code-modal");
  const name = modal?.dataset.owner;
  const claimed = modal?.dataset.claimed === "1";
  const code = document.getElementById("code-input")?.value.trim() || "";
  if (!name) return;
  if (!code) { setCodeStatus("Enter your code.", "bad"); return; }
  if (!claimed && code.length < 6) { setCodeStatus("Six characters or more.", "bad"); return; }
  const okBtn = document.getElementById("code-ok");
  if (okBtn) okBtn.disabled = true;
  setCodeStatus(claimed ? "Checking…" : "Claiming…");
  let data = null, status = 0;
  try {
    const res = await fetch(`${WORKER_URL}/auth`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ action: claimed ? "login" : "claim", manager: name, code, device: deviceId(), client: deviceDetails() }),
    });
    status = res.status;
    data = await res.json().catch(() => null);
  } catch {
    if (okBtn) okBtn.disabled = false;
    setCodeStatus("Could not reach the Worker.", "bad");
    return;
  }
  if (okBtn) okBtn.disabled = false;
  if (status === 200 && data?.token) {
    saveAuth(name, data.token);
    if (!authState.claimed.includes(name)) authState.claimed = [...authState.claimed, name];
    closeCodeModal(true);
    return;
  }
  // The name was claimed between the roster loading and this tap, or the
  // claim is gone after a reset: flip the step and let them try again.
  if (status === 409 || (status === 404 && data?.claimed === false)) {
    await refreshAuthState();
    setCodeStatus(data?.error || "Try that again.", "bad");
    modal.dataset.claimed = status === 409 ? "1" : "";
    document.getElementById("code-ok").textContent = status === 409 ? "Sign in" : "Claim it";
    return;
  }
  setCodeStatus(data?.error || "That did not work.", "bad");
}

// A 401 from a save means the token is gone, expired, or for someone
// else. Drop it and ask, so the next tap saves.
async function handleAuthFailure(manager) {
  clearAuth();
  await refreshAuthState();
  if (!picksScreen.classList.contains("hidden")) await requireOwnerAuth(manager);
}

document.getElementById("code-ok")?.addEventListener("click", submitOwnerCode);
document.getElementById("code-cancel")?.addEventListener("click", () => closeCodeModal(false));
document.getElementById("code-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); submitOwnerCode(); }
});
document.getElementById("code-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "code-modal") closeCodeModal(false);
});

function firstKickoffPassed() {
  return GAMES.some((g) => isGameLocked(g));
}

const logoScreen = document.getElementById("logo-screen");
const loginScreen = document.getElementById("login-screen");
const picksScreen = document.getElementById("picks-screen");
const scoreboardScreen = document.getElementById("scoreboard-screen");
const managerPicker = document.getElementById("manager-picker");
const gamesList = document.getElementById("games-list");
const tiebreakerInput = document.getElementById("tiebreaker-input");
const tiebreakerStatus = document.getElementById("tiebreaker-status");
const picksProgress = document.getElementById("picks-progress");
const liveScoresList = document.getElementById("live-scores-list");
const rankingsList = document.getElementById("rankings-list");
const scoreboardTable = document.getElementById("scoreboard-table");
const rulesModal = document.getElementById("rules-modal");
const rulesOpenBtn = document.getElementById("rules-open-btn");
const rulesCloseBtn = document.getElementById("rules-close-btn");
const homeHeader = document.getElementById("home-header");
const homeLogoBtn = document.getElementById("home-logo-btn");
const avatarModal = document.getElementById("avatar-modal");
const avatarEditPreview = document.getElementById("avatar-edit-preview");
const avatarEmojiInput = document.getElementById("avatar-emoji-input");
const avatarSaveBtn = document.getElementById("avatar-save-btn");
const avatarResetBtn = document.getElementById("avatar-reset-btn");
const bottomNav = document.getElementById("bottom-nav");
const navPicksBtn = document.getElementById("nav-picks-btn");
const navScoreboardBtn = document.getElementById("nav-scoreboard-btn");
const navHistoryBtn = document.getElementById("nav-history-btn");
const historyScreen = document.getElementById("history-screen");
const navTriviaBtn = document.getElementById("nav-trivia-btn");
const triviaScreen = document.getElementById("trivia-screen");
const identityModal = document.getElementById("identity-modal");
const claimModal = document.getElementById("claim-modal");
const claimGrid = document.getElementById("claim-grid");
const claimSkipBtn = document.getElementById("claim-skip-btn");
// Remember that the viewer dismissed the claim prompt for this visit only,
// so it does not nag on every tab but comes back next time they open the app.
let claimSkippedThisVisit = false;
const identityPreview = document.getElementById("identity-preview");
const identityText = document.getElementById("identity-text");
const identityConfirmBtn = document.getElementById("identity-confirm-btn");
const identityCancelBtn = document.getElementById("identity-cancel-btn");
const brandSub = document.getElementById("brand-sub");

// --- Logo / splash screen ---------------------------------------------

const RULES_SEEN_KEY = "brochiefs_rules_seen_v1";

function openRules() {
  rulesModal.classList.remove("hidden");
}

function closeRules() {
  rulesModal.classList.add("hidden");
  localStorage.setItem(RULES_SEEN_KEY, "1");
  if (!logoScreen.classList.contains("hidden")) return;
  openClaimPrompt();
}

// Every screen opens at the top the first time. Coming back to a screen
// you've already scrolled restores where you left it, so nobody lands at
// the bottom of the scoreboard because they were deep in their picks.
const appScroll = document.getElementById("app-scroll");

// Shrink the header once the page has moved. Hysteresis on the two
// thresholds so a list that sits right on the boundary cannot flicker.
let headerCompact = false;
function syncHeaderSize() {
  const y = appScroll.scrollTop;
  const next = headerCompact ? y > 24 : y > 64;
  if (next === headerCompact) return;
  headerCompact = next;
  homeHeader.classList.toggle("compact", next);
  renderHeadScore();
}

// Your score, in the header's left slot, once the board has scrolled past
// the strip that normally carries it. Scoped to the scoreboard: week
// points mean nothing on Trivia or History, and the strip only exists
// here. The countdown chip shares the slot and yields, which is the right
// trade — what you owe matters when you land, what you are scoring
// matters while you read.
let headScoreHtml = "";
function renderHeadScore() {
  const el = document.getElementById("head-score");
  if (!el) return;
  // On the scoreboard it is always there: it replaces the strip.
  const show = activeScreenName === "scoreboard" && !!headScoreHtml;
  el.innerHTML = show ? headScoreHtml : "";
  el.classList.toggle("hidden", !show);
  // The wordmark gives up a few pixels while the score is beside it.
  homeHeader.classList.toggle("has-score", show);
  fitHeaderLogo();
  if (show) renderHeaderCountdown();
}
// The wordmark sits centred between the left chip and the name pill. The
// chip changes width (KICK 21H 22M, T-1ST 06 PTS +4), so instead of a
// guessed max size the logo is measured to whatever room the chips leave,
// with a small gap either side. No chip on the left, no limit.
function fitHeaderLogo() {
  const img = homeHeader.querySelector(".home-logo-img");
  if (!img) return;
  img.style.maxWidth = "";
  const left = [document.getElementById("head-score"), document.getElementById("header-countdown")].find((el) => el && !el.classList.contains("hidden"));
  if (!left) return;
  const row = homeHeader.querySelector(".head-row") || homeHeader;
  const rb = row.getBoundingClientRect(), mid = rb.left + rb.width / 2;
  const lEdge = left.getBoundingClientRect().right;
  const pill = document.getElementById("me-pill");
  const rEdge = pill && !pill.classList.contains("hidden") ? pill.getBoundingClientRect().left : rb.right;
  const room = 2 * Math.min(mid - lEdge, rEdge - mid) - 16;
  if (room > 40) img.style.maxWidth = `${Math.floor(room)}px`;
}
addEventListener("resize", fitHeaderLogo);
appScroll.addEventListener("scroll", syncHeaderSize, { passive: true });
const savedScroll = {};
let activeScreenName = null;
function rememberScroll() {
  if (activeScreenName) savedScroll[activeScreenName] = appScroll.scrollTop;
}
// Call rememberScroll() BEFORE hiding the current screen: once it's
// hidden the page shrinks and the browser clamps scrollY to the top.
// Re-tapping the tab you are already on sends you to the top of it.
let navToTop = false;
[["nav-picks-btn", "picks"], ["nav-scoreboard-btn", "scoreboard"], ["nav-history-btn", "history"], ["nav-trivia-btn", "trivia"]].forEach(([id, name]) => {
  document.getElementById(id)?.addEventListener("click", () => { navToTop = activeScreenName === name; }, true);
});
function enterScreen(name) {
  if (navToTop) { savedScroll[name] = 0; navToTop = false; }
  activeScreenName = name;
  const y = savedScroll[name] ?? 0;
  appScroll.scrollTop = y;
  // async renders can grow the page after this tick; pin again once painted
  requestAnimationFrame(() => { appScroll.scrollTop = savedScroll[name] ?? 0; syncHeaderSize(); renderHeadScore(); });
  renderHeaderCountdown();
  renderHeadScore();
}

// Leaving the splash: if this device already knows who you are, skip the
// roster and land where the action is — your picks before the first
// kickoff, the live board once games are underway. First-timers get the
// rules once, then "Who are you?".
function goToPlayerSelect() {
  rememberScroll();
  logoScreen.classList.add("hidden");
  homeHeader.classList.remove("hidden");
  bottomNav.classList.remove("hidden");
  updateMePill();

  const me = loadMe();
  if (me) {
    currentManager = me;
    if (firstKickoffPassed()) {
      loginScreen.classList.add("hidden");
      showScoreboard();
    } else {
      selectManager(me);
    }
    return;
  }

  loginScreen.classList.remove("hidden");
  setActiveNav("home");
  renderManagerPicker();
  enterScreen("home");
  if (!localStorage.getItem(RULES_SEEN_KEY)) openRules();
  else openClaimPrompt();
}

// Analytics: one page view per screen, plus a few named events. Wrapped
// so a blocked or slow script never affects the app.
// Stamp an app open for whoever this device is: on open, and on coming
// back after 5 minutes away. Fire and forget; it never blocks anything.
const VISIT_KEY = "brochiefs_visit_v1";
function stampVisit() {
  const me = loadMe();
  // Jake is the admin: his opens don't count toward the league's.
  if (!me || me === "Jake" || !WORKER_URL || window.__adminEntry || window.__liveView) return;
  let last = 0;
  try { last = Number(localStorage.getItem(VISIT_KEY)) || 0; } catch {}
  // One open per five minutes at most (paid plan: writes are cheap now).
  if (Date.now() - last < 5 * 60 * 1000) return;
  try { localStorage.setItem(VISIT_KEY, String(Date.now())); } catch {}
  const d = deviceDetails();
  const standalone = window.navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  const body = { manager: me, device: deviceId().slice(0, 12), screen: d.screen, tz: d.tz, standalone, v: typeof APP_VERSION === "string" ? APP_VERSION : "" };
  if (navigator.onLine === false) { queueTele({ ...body, q: 1, at: Date.now() }); return; }
  fetch(`${WORKER_URL}/visit`, { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true, body: JSON.stringify(body) })
    .then((res) => { if (res.ok) flushTele(); })
    .catch(() => queueTele({ ...body, q: 1, at: Date.now() }));
}

// Opens and visits made with no signal wait on the phone and go out when
// it is back, so the dashboard doesn't lose the stadium. Capped and kept a
// week at most, which is all the Worker accepts.
const TELE_Q_KEY = "brochiefs_tele_q_v1";
function readTeleQ() {
  try { const q = JSON.parse(localStorage.getItem(TELE_Q_KEY) || "[]"); return Array.isArray(q) ? q : []; } catch { return []; }
}
function queueTele(body) {
  try { localStorage.setItem(TELE_Q_KEY, JSON.stringify([...readTeleQ(), body].slice(-40))); } catch {}
}
let teleFlushing = false;
async function flushTele() {
  if (teleFlushing || navigator.onLine === false || !WORKER_URL) return;
  const orig = readTeleQ();
  const q = orig.filter((b) => Date.now() - (Number(b.at ?? b.start) || 0) < 7 * 86400000);
  if (!q.length) { try { localStorage.removeItem(TELE_Q_KEY); } catch {} return; }
  teleFlushing = true;
  const left = [];
  for (const b of q) {
    try {
      // text/plain: a simple request, no CORS preflight, as the beacon is.
      const res = await fetch(`${WORKER_URL}/visit`, { method: "POST", body: JSON.stringify(b), keepalive: true });
      if (!res.ok && res.status >= 500) left.push(b);
    } catch { left.push(b); }
  }
  // Anything queued while this ran is kept too.
  const added = readTeleQ().slice(orig.length);
  try { const rest = [...left, ...added]; if (rest.length) localStorage.setItem(TELE_Q_KEY, JSON.stringify(rest)); else localStorage.removeItem(TELE_Q_KEY); } catch {}
  teleFlushing = false;
}
addEventListener("online", () => flushTele());
setTimeout(stampVisit, 1500);
setTimeout(flushTele, 4000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) stampVisit(); });

// Presence, for the admin's live page: what's open and what's being used.
// Uses go out a moment after they happen (batched), a still-here beat
// every 30 seconds while the app is on screen, and a goodbye when it's put
// away. Beacons only, never awaited, so nothing here can slow the app.
// Jake, the admin console and the preview site aren't reported; nor is
// which team anyone picked.
const presenceQ = [];
let presenceT = null, presenceScreen = "";
const presenceApp = (window.navigator.standalone || matchMedia("(display-mode: standalone)").matches) ? "home" : "browser";
function presenceNote(key, detail) {
  const k = String(key || "").replace(/^\//, "");
  if (!k) return;
  if (/^(picks|scoreboard|history|trivia|home|roster|splash)$/.test(k)) presenceScreen = k;
  presenceQ.push({ k, d: detail == null ? undefined : String(detail), t: Date.now() });
  if (presenceQ.length > 30) presenceQ.shift();
  clearTimeout(presenceT);
  presenceT = setTimeout(() => presenceSend(false), 1500);
}
function presenceSend(bye) {
  clearTimeout(presenceT); presenceT = null;
  const me = loadMe();
  if (!me || me === "Jake" || !WORKER_URL || window.__adminEntry || window.__liveView || PREVIEW || navigator.onLine === false) { presenceQ.length = 0; return; }
  const now = Date.now();
  const body = JSON.stringify({ manager: me, bye, screen: presenceScreen, app: presenceApp, events: presenceQ.splice(0).map((e) => ({ k: e.k, d: e.d, ago: now - e.t })) });
  try {
    if (!(navigator.sendBeacon && navigator.sendBeacon(`${WORKER_URL}/presence`, new Blob([body], { type: "text/plain" })))) fetch(`${WORKER_URL}/presence`, { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {}
}
setTimeout(() => { if (!document.hidden) presenceSend(false); }, 2500);
setInterval(() => { if (!document.hidden) presenceSend(false); }, 30000);
document.addEventListener("visibilitychange", () => presenceSend(document.hidden));
addEventListener("pagehide", () => presenceSend(true));

// Sessions, for the admin dashboard: how long the app was on screen and
// which screens and sheets were used, sent once when the app is put away.
// In memory until then (a Set add per use), and the send is a background
// beacon the browser handles after the page has gone, so nothing here
// touches load or scrolling.
const sessionUse = new Set();
let sessionStart = document.hidden ? null : Date.now();
function noteUse(key, detail) { if (key) { sessionUse.add(String(key).replace(/^\//, "")); presenceNote(key, detail); } }
// Minutes on each game's live view: started when a live game cast opens,
// stopped when the sheet closes or the app is put away.
let gcTime = {}, gcOpen = null;
function gcStart(id) { gcStop(); gcOpen = { id, t: Date.now() }; }
function gcStop() { if (!gcOpen) return; const k = `g${gcOpen.id}`; gcTime[k] = (gcTime[k] || 0) + (Date.now() - gcOpen.t); gcOpen = null; }
(() => {
  const m = document.getElementById("insights-modal");
  if (m && window.MutationObserver) new MutationObserver(() => { if (m.classList.contains("hidden")) gcStop(); }).observe(m, { attributes: true, attributeFilter: ["class"] });
})();
function endSession() {
  if (sessionStart == null) return;
  const start = sessionStart, dur = Date.now() - start;
  sessionStart = null;
  gcStop();
  const f = [...sessionUse]; sessionUse.clear();
  const gt = gcTime; gcTime = {};
  const h = { e: appHealth.e, em: appHealth.em.slice(), ff: { ...appHealth.ff }, sl: { ...appHealth.sl }, ld: appHealth.ld };
  appHealth.e = 0; appHealth.em = []; appHealth.ff = { espn: 0, worker: 0 }; appHealth.sl = { espn: 0, worker: 0 }; appHealth.ld = -1; // load time only once per page
  const me = loadMe();
  if (!me || me === "Jake" || !WORKER_URL || window.__adminEntry || window.__liveView || dur < 3000) return;
  const body = JSON.stringify({ manager: me, kind: "session", start, dur, f, gt, h: h.ld === -1 ? { ...h, ld: null } : h, v: typeof APP_VERSION === "string" ? APP_VERSION : "" });
  try {
    // text/plain keeps the beacon a simple request (no CORS preflight).
    // With no signal a beacon is accepted and then lost; keep it instead.
    if (navigator.onLine === false) { queueTele(JSON.parse(body)); return; }
    if (!(navigator.sendBeacon && navigator.sendBeacon(`${WORKER_URL}/visit`, new Blob([body], { type: "text/plain" })))) fetch(`${WORKER_URL}/visit`, { method: "POST", body, keepalive: true }).catch(() => queueTele(JSON.parse(body)));
  } catch {}
}
document.addEventListener("visibilitychange", () => { if (document.hidden) endSession(); else if (sessionStart == null) sessionStart = Date.now(); });
addEventListener("pagehide", endSession);

function track(path, extra) {
  noteUse(path, extra?.d);
  try {
    if (PREVIEW || window.__liveView || !window.goatcounter || typeof window.goatcounter.count !== "function") return;
    window.goatcounter.count({ path, title: extra?.title || path, event: !!extra?.event });
  } catch {}
}

// Keeps the bottom tab bar's highlighted tab in sync, however the
// screen got navigated to (top links, bottom nav, or the wordmark).
let lastTrackedScreen = null;
function setActiveNav(target) {
  if (target !== lastTrackedScreen) { lastTrackedScreen = target; track(`/${target}`); }
  [navPicksBtn, navScoreboardBtn, navHistoryBtn, navTriviaBtn, document.getElementById("nav-side-btn")].forEach((btn) => btn?.classList.remove("active"));
  // The Side bet screen is only hidden here, the one place every screen
  // change passes through.
  if (target === "side") document.getElementById("nav-side-btn")?.classList.add("active");
  else document.getElementById("side-screen")?.classList.add("hidden");
  if (target === "history") navHistoryBtn.classList.add("active");
  if (target === "trivia") navTriviaBtn.classList.add("active");
  // The roster has no tab of its own — the pill in the header is how you
  // change owner — so no tab lights up while it is showing.
  if (target === "picks") navPicksBtn.classList.add("active");
  if (target === "scoreboard") navScoreboardBtn.classList.add("active");
}

// Roster view from anywhere — the wordmark header is visible on every
// screen except the splash, so this is always reachable, and it is also
// where Picks lands when nobody has been chosen yet. There is no Home
// tab: the pill in the header is how you switch owner. Deliberately does
// NOT forget who you are: your card is marked YOU, and picking a
// different card asks for confirmation before switching.
function goHome() {
  rememberScroll();
  historyScreen.classList.add("hidden");
  triviaScreen.classList.add("hidden");
  picksScreen.classList.add("hidden");
  scoreboardScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  renderManagerPicker();
  setActiveNav("home");
  enterScreen("home");
}

logoScreen.addEventListener("click", () => showNowPlaying(goToPlayerSelect));


rulesOpenBtn.addEventListener("click", openRules);
rulesCloseBtn.addEventListener("click", closeRules);
homeLogoBtn.addEventListener("click", goHome);

// --- Admin surfaces, unlocked by gesture ------------------------------
// Three taps on the header wordmark, in quick succession, asks for a key.
// The Worker says which of two administrators that key belongs to and the
// matching surface opens — nothing else does:
//
//   slate key  →  the slate editor (admin.js). Picking the week's games is
//                 delegated, and that key opens nothing but the editor.
//   app key    →  the app console (console.js). Logs, owner logins, the
//                 login mode, this device, and the editor if wanted.
//
// Every tap still goes home, so the gesture is invisible to anyone not
// looking for it, and neither script is fetched until a key checks out.
const ADMIN_TAP_WINDOW_MS = 900;
const ADMIN_KEY_STORE = "brochiefs_admin_key"; // read back by admin.js
const adminOverlay = document.getElementById("admin-overlay");
const adminGate = document.getElementById("admin-gate");
let adminTaps = 0;
let adminTapTimer = null;
let adminScriptLoaded = false;
let consoleScriptLoaded = false;
// Both cleared when the tab closes, so the gate is back on the next visit.
let adminRole = null;
let adminKeyHeld = "";

homeLogoBtn.addEventListener("click", () => {
  adminTaps += 1;
  clearTimeout(adminTapTimer);
  if (adminTaps >= 3) { adminTaps = 0; requestAdmin(); return; }
  adminTapTimer = setTimeout(() => { adminTaps = 0; }, ADMIN_TAP_WINDOW_MS);
});

// brochiefs.com/admin lands here as /?admin=1: open the key prompt straight
// away, then tidy the address bar so a refresh is just the app.
if (window.__adminEntry) {
  history.replaceState(null, "", location.pathname);
  window.addEventListener("load", () => setTimeout(() => requestAdmin(), 600));
}

// Already unlocked in this tab: straight back to that surface. Otherwise
// the key decides.
function requestAdmin() {
  if (adminRole) { openRole(adminRole); return; }
  if (!adminGate) return;
  let saved = null;
  try { saved = localStorage.getItem(ADMIN_REMEMBER_KEY); } catch {}
  const rem = document.getElementById("admin-remember");
  if (rem) rem.checked = !!saved;
  const input = document.getElementById("admin-gate-key");
  if (input) input.value = "";
  setAdminGateStatus("");
  adminGate.classList.remove("hidden");
  if (saved) { setAdminGateStatus("Remembered device…"); submitAdminKey(saved); return; }
  setTimeout(() => input?.focus(), 50);
}

function setAdminGateStatus(msg, kind = "") {
  const el = document.getElementById("admin-gate-status");
  if (el) { el.textContent = msg || ""; el.className = "admin-status " + kind; }
}

function closeAdminGate() {
  adminGate?.classList.add("hidden");
}

// The Worker is the authority: /admin-check says whether the key is good
// and which console it opens, without handing anything back.
const ADMIN_REMEMBER_KEY = "brochiefs_admin_remember_v1";
let rememberedTry = false;
async function submitAdminKey(remembered) {
  const input = document.getElementById("admin-gate-key");
  rememberedTry = typeof remembered === "string";
  const key = rememberedTry ? remembered : input?.value.trim();
  if (!key) { setAdminGateStatus("Enter the key.", "bad"); return; }
  const okBtn = document.getElementById("admin-gate-ok");
  if (okBtn) okBtn.disabled = true;
  setAdminGateStatus("Checking the key…");
  let role = null, reachable = true, status = 0, err = "";
  try {
    const res = await fetch(`${WORKER_URL}/admin-check?key=${encodeURIComponent(key)}&t=${Date.now()}`, { cache: "no-store" });
    status = res.status;
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) role = data.role;
    if (data.error) err = data.error;
  } catch {
    reachable = false;
  }
  if (okBtn) okBtn.disabled = false;
  if (!reachable) { setAdminGateStatus("Could not reach the Worker to check the key.", "bad"); return; }
  // 403 is a wrong key; 409 means the two keys are set to the same value
  // and the Worker refuses to guess which role was meant.
  if (!role) {
    if (rememberedTry && status === 403) { try { localStorage.removeItem(ADMIN_REMEMBER_KEY); } catch {} setAdminGateStatus("The saved key no longer works. Enter it again.", "bad"); return; }
    setAdminGateStatus(status === 403 ? "That key is not right." : err || "The Worker could not check that key.", "bad"); return;
  }
  adminRole = role;
  window.__adminOpen = true;
  // Remember this device: keep the verified key on this phone so the next
  // visit skips the prompt. Unticked, any key saved earlier is dropped.
  try {
    if (document.getElementById("admin-remember")?.checked) localStorage.setItem(ADMIN_REMEMBER_KEY, key);
    else if (!rememberedTry) localStorage.removeItem(ADMIN_REMEMBER_KEY);
  } catch {}
  // Hands the key to the browser's password manager (Face ID / Touch ID fill).
  try { if (window.PasswordCredential) navigator.credentials.store(new PasswordCredential({ id: "brochiefs-admin", password: key, name: "Brochiefs admin" })); } catch {}
  adminKeyHeld = key;
  setAdminGateStatus(role === "app" ? "App console…" : "Slate editor…", "ok");
  // admin.js reads the key from here rather than from a field on screen.
  try { sessionStorage.setItem(ADMIN_KEY_STORE, key); } catch {}
  if (input) input.value = "";
  closeAdminGate();
  openRole(role);
}

function openRole(role) {
  if (role === "app") openAppConsole();
  else openAdmin();
}

document.getElementById("admin-gate-ok")?.addEventListener("click", () => submitAdminKey());
document.getElementById("admin-gate-cancel")?.addEventListener("click", closeAdminGate);
document.getElementById("admin-gate-key")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); submitAdminKey(); }
});
adminGate?.addEventListener("click", (e) => { if (e.target === adminGate) closeAdminGate(); });

// --- The slate editor (either key, but only the slate key lands here) --
function openAdmin() {
  if (!adminOverlay || !adminRole) return;
  adminOverlay.classList.remove("hidden");
  document.body.classList.add("admin-open");
  adminOverlay.scrollTop = 0;
  if (adminScriptLoaded) return;
  adminScriptLoaded = true;
  const tag = document.createElement("script");
  tag.src = "admin.js?v=202610211201";
  tag.onerror = () => { adminScriptLoaded = false; window.alert("Could not load the slate editor."); closeAdmin(); };
  document.body.appendChild(tag);
}

function closeAdmin() {
  adminOverlay?.classList.add("hidden");
  document.body.classList.remove("admin-open");
  lockAdmin();
}

// Leaving an admin surface locks it again: the next three taps ask for a
// key. Without this the tab kept whichever role it unlocked first, so
// typing the other key appeared to open the wrong surface — and a phone
// left on the table stayed unlocked.
function lockAdmin() {
  adminRole = null;
  adminKeyHeld = "";
  try { sessionStorage.removeItem(ADMIN_KEY_STORE); } catch {}
}
// admin.js calls this from its Exit button instead of navigating away.
window.closeSlateEditor = closeAdmin;
// and the console opens it from its Slate tab.
window.openSlateEditor = openAdmin;

// --- Admin heads-up before lock -------------------------------------------
// On a phone that remembers an admin key: when picks lock within three
// hours and anyone is short, a banner says who, with the nudge message one
// tap away. Counts only (the server hides unlocked picks), checked on open,
// on return to the app and every ten minutes; dismissable for the visit.
const LOCK_ALERT_DISMISS = "brochiefs_lockalert_dismissed";
async function adminLockAlert() {
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let saved = null;
  try { saved = localStorage.getItem(ADMIN_REMEMBER_KEY); } catch {}
  const old = document.getElementById("lock-alert");
  if (!saved || !GAMES.length || document.hidden) { old?.remove(); return; }
  const lock = weekLockTime() ?? Math.min(...GAMES.map((g) => Date.parse(g.kickoff)));
  const left = lock - Date.now();
  let dismissed = null;
  try { dismissed = sessionStorage.getItem(LOCK_ALERT_DISMISS); } catch {}
  if (!(left > 0 && left <= 3 * 3600000) || dismissed === String(lock)) { old?.remove(); return; }
  const all = await fetchAllPicks();
  if (!all) return;
  const short = MANAGERS.map((n) => ({ n, k: GAMES.filter((g) => all[n]?.picks?.[g.id]).length, tb: String(all[n]?.tiebreaker ?? "").trim() !== "" })).filter((x) => x.k < GAMES.length || !x.tb);
  if (!short.length) { old?.remove(); return; }
  const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000);
  const when = h ? `${h}h ${m}m` : `${m}m`;
  const msg = `🏈 Picks lock in ${when}!\n${short.map((x) => `• ${shown(x.n)}: ${x.k < GAMES.length ? `${GAMES.length - x.k} pick${GAMES.length - x.k === 1 ? "" : "s"} left` : ""}${x.k < GAMES.length && !x.tb ? " + " : ""}${!x.tb ? "tiebreaker" : ""}`).join("\n")}\nbrochiefs.com`;
  const el = old || Object.assign(document.createElement("div"), { id: "lock-alert", className: "lock-alert" });
  el.innerHTML = `<div><b>⚠ ${short.length} SHORT · LOCK IN ${esc(when)}</b><span>${short.map((x) => `${esc(shown(x.n))} ${x.k}/${GAMES.length}${x.tb ? "" : " · no TB"}`).join(" · ")}</span></div>
    <button type="button" class="la-nudge">NUDGE</button><button type="button" class="la-x" aria-label="Dismiss">✕</button>`;
  el.querySelector(".la-nudge").onclick = async (e) => {
    const b = e.currentTarget;
    try { if (navigator.share) await navigator.share({ text: msg }); else { await navigator.clipboard.writeText(msg); b.textContent = "COPIED"; } } catch { try { await navigator.clipboard.writeText(msg); b.textContent = "COPIED"; } catch {} }
  };
  el.querySelector(".la-x").onclick = () => { try { sessionStorage.setItem(LOCK_ALERT_DISMISS, String(lock)); } catch {} el.remove(); };
  if (!old) document.body.appendChild(el);
}
setTimeout(() => adminLockAlert().catch(() => {}), 4000);
setInterval(() => adminLockAlert().catch(() => {}), 10 * 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) adminLockAlert().catch(() => {}); });

// --- The app console (the app owner's key only) -----------------------
function openAppConsole() {
  if (adminRole !== "app") return;
  if (consoleScriptLoaded) { window.showAppConsole?.(); return; }
  consoleScriptLoaded = true;
  const tag = document.createElement("script");
  tag.src = "console.js?v=202610211201";
  // console.js shows itself once it loads.
  tag.onerror = () => { consoleScriptLoaded = false; window.alert("Could not load the console."); };
  document.body.appendChild(tag);
}

// What the console needs from the running app: the verified key, a picture
// of this device, and the few actions that belong to the app rather than
// the Worker.
window.appConsoleKey = () => (adminRole === "app" ? adminKeyHeld : "");
// iOS home-screen apps can report a viewport shorter than the screen (873
// tall on a 932 screen: the status bar's 59 taken off the bottom), so a nav
// pinned to bottom: 0 floats with an empty band under it. Measure the
// shortfall and close the gap. Only in the home-screen app, and
// only for a plausible gap, so a browser tab is never touched.
function fixStandaloneGap() {
  const standalone = window.navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  const portrait = innerHeight >= innerWidth;
  const full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const gap = standalone ? full - innerHeight : 0;
  // iOS will not paint fixed elements in that strip (only the page
  // background), so the nav cannot move into it. Instead the nav drops the
  // home-bar padding it no longer needs, and the strip takes the nav's
  // colour so the two read as one bar to the screen edge.
  const on = gap > 10 && gap < 120;
  document.documentElement.style.setProperty("--vp-gap", on ? `${gap}px` : "0px");
  document.documentElement.classList.toggle("vp-gap", on);
}
fixStandaloneGap();
addEventListener("resize", fixStandaloneGap);
addEventListener("orientationchange", () => setTimeout(fixStandaloneGap, 300));

window.appDiagnostics = () => {
  const all = loadAll();
  const cached = Object.keys(all).filter((n) => Object.keys(sanitizePicks(all[n]?.picks)).length);
  let queued = null;
  try { queued = localStorage.getItem(PENDING_KEY); } catch {}
  const mine = currentManager ? getManagerState(currentManager) : null;
  return {
    "Week": `${WEEK_LABEL} · ${GAMES.length} games`,
    "Games locked": `${GAMES.filter(isGameLocked).length} of ${GAMES.length}`,
    "Next kickoff": (() => { const g = gamesByKickoff().find((x) => !isGameLocked(x)); return g ? `${g.awayShort} at ${g.homeShort} · ${kickoffCountdown(g.kickoff)?.text || "—"}` : "all underway"; })(),
    "This device is": loadMe() || "unclaimed",
    "Signed in as": currentManager || "nobody",
    "Picks on this device": mine ? `${Object.keys(mine.picks).length} of ${GAMES.length}${mine.tiebreaker !== "" ? ` · TB ${mine.tiebreaker}` : ""}` : "—",
    "Cached locally": cached.length ? cached.join(", ") : "nothing",
    "Live feed": Object.keys(latestLive).length ? `${Object.keys(latestLive).length} games` : "not fetched yet",
    "Sync": syncStatus + (queued ? ` · queued for ${queued}` : ""),
    "Login token": loadAuth() ? `held for ${loadAuth().manager}` : "none",
    "Login mode": authState.mode,
    "Worker": WORKER_URL || "not configured",
    // Layout numbers, for chasing gaps at the screen edges on a phone.
    "Screen": (() => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden";
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe), sa = `${parseFloat(cs.paddingTop)}/${parseFloat(cs.paddingBottom)}`;
      probe.remove();
      const nav = document.getElementById("bottom-nav")?.getBoundingClientRect();
      const standalone = window.navigator.standalone || matchMedia("(display-mode: standalone)").matches;
      return `gap fix ${getComputedStyle(document.documentElement).getPropertyValue("--vp-gap").trim() || "0px"} · ${innerWidth}×${innerHeight} · visual ${Math.round(visualViewport?.height || 0)} · screen ${screen.width}×${screen.height} · safe top/bottom ${sa} · nav ${nav ? `${Math.round(nav.top)}–${Math.round(nav.bottom)}` : "—"} · ${standalone ? "home-screen app" : "browser"}`;
    })(),
  };
};
window.appResync = async () => {
  await Promise.all([loadSlate(), fetchLiveScores(), refreshAuthState()]);
  if (currentManager) await syncManagerFromCloud(currentManager);
  if (!picksScreen.classList.contains("hidden")) withScrollPreserved(renderPicksScreen);
  if (!scoreboardScreen.classList.contains("hidden")) withScrollPreserved(renderScoreboard);
};
window.appForgetDevice = () => {
  try { localStorage.removeItem(ME_KEY); } catch {}
  updateMePill();
};
window.appClearPicks = () => {
  try { localStorage.removeItem(storageKey()); localStorage.removeItem(PENDING_KEY); } catch {}
  if (!picksScreen.classList.contains("hidden")) withScrollPreserved(renderPicksScreen);
};
window.appRefreshAuth = () => refreshAuthState();
window.appRefreshWeeks = () => loadWeekSummaries();
// console.js calls this when it closes, so Exit locks there too.
window.lockAdminSurfaces = lockAdmin;

// Any tab in the nav is also a way out of the editor: the nav sits above
// the overlay while it is open, and the tab's own handler then runs and
// lands on that screen.
bottomNav.addEventListener("click", () => {
  if (!adminOverlay?.classList.contains("hidden")) closeAdmin();
}, true);
// Tap the pill to switch owner; hold it (550ms) to change your avatar.
(() => {
  const pill = document.getElementById("me-pill");
  if (!pill) return;
  let timer = null, fired = false;
  const cancel = () => clearTimeout(timer);
  pill.addEventListener("pointerdown", () => {
    fired = false;
    const me = loadMe();
    if (!me) return;
    timer = setTimeout(() => {
      fired = true;
      const idx = MANAGERS.indexOf(me);
      openAvatarEditor(me, accentFor(me));
    }, 550);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => pill.addEventListener(ev, cancel));
  pill.addEventListener("contextmenu", (e) => e.preventDefault());
  pill.addEventListener("click", (e) => {
    if (fired) { e.preventDefault(); fired = false; return; }
    openOwnerPicker();
  });
})();

navPicksBtn.addEventListener("click", () => {
  if (!currentManager) {
    goHome();
    return;
  }
  showPicksScreen();
});

// Land on the picks screen and bring it up to date. Draws from what is on
// the phone first so the screen is not blank while the cloud answers, then
// one sync and one redraw. Login used to do the sync twice, back to back,
// once un-awaited and once awaited, and redraw for each.
function showPicksScreen() {
  rememberScroll();
  historyScreen.classList.add("hidden");
  triviaScreen.classList.add("hidden");
  scoreboardScreen.classList.add("hidden");
  loginScreen.classList.add("hidden");
  picksScreen.classList.remove("hidden");
  renderPicksScreen();
  setActiveNav("picks");
  enterScreen("picks");
  maybeShowBoner();
  maybeShowQotw().finally(() => maybeShowPoll());
  return syncManagerFromCloud(currentManager).then((cloud) => {
    if (!picksScreen.classList.contains("hidden")) withScrollPreserved(renderPicksScreen);
    // After the sync, so a phone that has not seen its picks yet does not
    // nag someone whose card is already full on another device.
    if (!picksScreen.classList.contains("hidden")) maybeShowGridCheck();
    // Same payload feeds the standings row. cloud is null when the fetch
    // failed, and then the row fetches for itself, which will fail the
    // same way and leave whatever was on screen.
    refreshPicksStanding(cloud);
  });
}

function showHistory() {
  if (!currentManager) openClaimPrompt();
  rememberScroll();
  loginScreen.classList.add("hidden");
  picksScreen.classList.add("hidden");
  scoreboardScreen.classList.add("hidden");
  triviaScreen.classList.add("hidden");
  historyScreen.classList.remove("hidden");
  setActiveNav("history");
  enterScreen("history");
}
navHistoryBtn.addEventListener("click", showHistory);

function showTrivia() {
  rememberScroll();
  loginScreen.classList.add("hidden");
  picksScreen.classList.add("hidden");
  scoreboardScreen.classList.add("hidden");
  historyScreen.classList.add("hidden");
  triviaScreen.classList.remove("hidden");
  setActiveNav("trivia");
  enterScreen("trivia");
}
navTriviaBtn.addEventListener("click", showTrivia);

navScoreboardBtn.addEventListener("click", () => {
  if (!currentManager) openClaimPrompt();
  loginScreen.classList.add("hidden");
  showScoreboard();
  setActiveNav("scoreboard");
});

// --- Avatar overrides: long-press a player card to swap their letter
// avatar for an emoji. Persisted locally and synced through the Worker
// (/avatars) so the choice shows up for everyone, on every device.
const AVATAR_STORAGE_KEY = "brochiefs_avatars_v1";
let avatarOverrides = loadAvatars();

function loadAvatars() {
  try {
    return JSON.parse(localStorage.getItem(AVATAR_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveAvatars(data) {
  localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(data));
}

async function fetchAvatars() {
  if (!WORKER_URL) return null;
  try {
    const res = await fetch(`${WORKER_URL}/avatars`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.avatars || {};
  } catch {
    return null;
  }
}
async function fetchAvatarsAll() {
  if (!WORKER_URL) return null;
  try {
    const res = await fetch(`${WORKER_URL}/avatars`);
    if (!res.ok) return null;
    const data = await res.json();
    return { avatars: data.avatars || {}, colors: data.colors || {} };
  } catch {
    return null;
  }
}

// Changes that have not reached the Worker yet, kept on the phone and
// retried on the next sync so a save made offline still lands everywhere.
// { manager: { emoji?, color? } }, where null clears that field.
const AVATAR_PENDING_KEY = "brochiefs_avatars_pending_v2";
const AVATAR_COLOR_KEY = "brochiefs_avatar_colors_v1";
let avatarColors = (() => { try { return JSON.parse(localStorage.getItem(AVATAR_COLOR_KEY)) || {}; } catch { return {}; } })();
function loadPendingAvatars() { try { return JSON.parse(localStorage.getItem(AVATAR_PENDING_KEY)) || {}; } catch { return {}; } }
function savePendingAvatars(p) { try { localStorage.setItem(AVATAR_PENDING_KEY, JSON.stringify(p)); } catch { /* private mode */ } }
function saveAvatarColors() { try { localStorage.setItem(AVATAR_COLOR_KEY, JSON.stringify(avatarColors)); } catch { /* private mode */ } }

async function sendAvatar(manager, patch) {
  if (!WORKER_URL) return false;
  try {
    const res = await fetch(`${WORKER_URL}/avatars`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manager, ...patch }) });
    return res.ok;
  } catch {
    return false;
  }
}
async function flushAvatar(manager) {
  const patch = loadPendingAvatars()[manager];
  if (!patch) return;
  const sent = JSON.stringify(patch);
  if (await sendAvatar(manager, patch)) {
    const now = loadPendingAvatars();
    if (JSON.stringify(now[manager]) === sent) { delete now[manager]; savePendingAvatars(now); }
  }
}
async function queueAvatar(manager, patch) {
  const pending = loadPendingAvatars();
  pending[manager] = { ...(pending[manager] || {}), ...patch };
  savePendingAvatars(pending);
  await flushAvatar(manager);
}

// The Worker is the source of truth: what it holds wins, so a reset on one
// phone clears it on every other. Unsent local changes ride on top until
// they go through.
async function syncAvatars() {
  for (const m of Object.keys(loadPendingAvatars())) await flushAvatar(m);
  const cloud = await fetchAvatarsAll();
  if (!cloud) return false;
  const emojis = { ...cloud.avatars }, colors = { ...cloud.colors };
  for (const [m, p] of Object.entries(loadPendingAvatars())) {
    if ("emoji" in p) { if (p.emoji == null) delete emojis[m]; else emojis[m] = p.emoji; }
    if ("color" in p) { if (p.color == null) delete colors[m]; else colors[m] = p.color; }
  }
  const changed = JSON.stringify([emojis, colors]) !== JSON.stringify([avatarOverrides, avatarColors]);
  avatarOverrides = emojis; avatarColors = colors;
  saveAvatars(avatarOverrides); saveAvatarColors();
  if (changed) {
    updateMePill();
    if (!scoreboardScreen.classList.contains("hidden")) withScrollPreserved(renderScoreboard);
  }
  return true;
}

async function renderManagerPicker() {
  const local = loadAll();
  const cloud = await fetchAllPicks();
  const all = cloud ? { ...local, ...cloud } : local; // cloud wins where it has data
  // Once games have started the roster shows points instead of pick counts.
  // Fetched whether or not anything has kicked off: the feed carries each
  // team's poll rank, which the board and the picks cards show all week.
  if (!Object.keys(latestLive).length) { try { await fetchLiveScores(); } catch {} }
  const pickerResults = firstKickoffPassed() ? computeLiveResults(latestLive) : {};
  const scored = Object.keys(pickerResults).length > 0;

  await syncAvatars();
  updateMePill();

  managerPicker.innerHTML = "";
  MANAGERS.forEach((name, i) => {
    const state = all[name];
    const submittedCount = state ? Object.keys(sanitizeRoomPicks(state.picks)).length : 0;
    const tiebreakerDone = !!(state && String(state.tiebreaker || "").trim() !== "");
    const complete = submittedCount === GAMES.length && tiebreakerDone;
    const partial = !complete && (submittedCount > 0 || tiebreakerDone);

    const isChamp = name === "Jake";
    const isMe = name === currentManager;
    const accent = accentFor(name);
    const avatarContent = avatarOverrides[name] || shown(name)[0];

    const btn = document.createElement("button");
    btn.className = "manager-card" + (complete ? " has-picks" : "") + (partial ? " partial-picks" : "") + (isChamp ? " defending-champ" : "") + (isMe ? " is-me" : "");
    btn.style.setProperty("--accent", accent);
    btn.innerHTML = `
      <span class="player-tag">${isMe ? "YOU" : `P${i + 1}`}</span>
      <span class="badge-slot">${isChamp ? `<span class="champ-badge">🏆 Defending Champ</span>` : ""}</span>
      <span class="manager-avatar-ring">
        <span class="manager-avatar">${avatarContent}</span>
      </span>
      <span class="manager-name-plate">
        <span class="manager-name">${shown(name)}</span>
        <span class="manager-pick-status">${scored ? `${computeScore(state || { picks: {} }, pickerResults)} PTS` : complete ? "✓ All in" : partial ? `${submittedCount}/${GAMES.length} in` : ""}</span>
      </span>
    `;

    // Long-press (550ms) opens the avatar editor instead of navigating.
    let longPressTimer = null;
    let longPressFired = false;
    const cancelLongPress = () => clearTimeout(longPressTimer);
    btn.addEventListener("pointerdown", () => {
      longPressFired = false;
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        openAvatarEditor(name, accent);
      }, 550);
    });
    btn.addEventListener("pointerup", cancelLongPress);
    btn.addEventListener("pointerleave", cancelLongPress);
    btn.addEventListener("pointercancel", cancelLongPress);
    btn.addEventListener("click", (e) => {
      if (longPressFired) {
        e.preventDefault();
        longPressFired = false;
        return;
      }
      // Your own card goes straight in; anyone else's asks first.
      if (currentManager === name) {
        selectManager(name);
      } else {
        openIdentityConfirm(name, accent);
      }
    });

    managerPicker.appendChild(btn);
  });

  brandSub.textContent = currentManager
    ? `You're ${currentManager} — tap another name to switch`
    : "Tap your name — this device will remember you";
}

// --- Avatar editor modal ------------------------------------------------

let editingAvatarManager = null;

function openAvatarEditor(name, accent) {
  editingAvatarManager = name;
  const current = avatarOverrides[name] || "";
  avatarEditPreview.textContent = current || shown(name)[0];
  avatarEditPreview.style.setProperty("--accent", accent);
  avatarEmojiInput.value = current;
  editingColor = avatarColors[name] || null;
  renderAvatarPalette(accent);
  avatarModal.classList.remove("hidden");
  avatarEmojiInput.focus();
}

// Background colour picker under the emoji field. null = roster default.
let editingColor = null;
function renderAvatarPalette(accent) {
  let pal = document.getElementById("avatar-palette");
  if (!pal) {
    pal = document.createElement("div");
    pal.id = "avatar-palette";
    pal.className = "avatar-palette";
    avatarEmojiInput.insertAdjacentElement("afterend", pal);
    pal.addEventListener("click", (e) => {
      const sw = e.target.closest("[data-color]");
      if (!sw) return;
      editingColor = sw.dataset.color || null;
      const show = editingColor || accentDefault(editingAvatarManager);
      avatarEditPreview.style.setProperty("--accent", show);
      pal.querySelectorAll("[data-color]").forEach((b) => b.classList.toggle("on", (b.dataset.color || null) === editingColor));
    });
  }
  const def = accentDefault(editingAvatarManager);
  pal.innerHTML = `<button type="button" class="av-sw def${editingColor ? "" : " on"}" data-color="" style="--c:${def}" title="Default" aria-label="Default colour"></button>` +
    AVATAR_PALETTE.map((c) => `<button type="button" class="av-sw${editingColor === c ? " on" : ""}" data-color="${c}" style="--c:${c}" aria-label="${c}"></button>`).join("");
  avatarEditPreview.style.setProperty("--accent", editingColor || def || accent);
}
function accentDefault(name) {
  const i = MANAGERS.indexOf(name);
  return AVATAR_COLORS[(i >= 0 ? i : 0) % AVATAR_COLORS.length];
}

let reopenOwnerAfterAvatar = false;
function closeAvatarEditor() {
  avatarModal.classList.add("hidden");
  editingAvatarManager = null;
  if (reopenOwnerAfterAvatar) { reopenOwnerAfterAvatar = false; openOwnerPicker(); }
}

avatarModal.addEventListener("click", (e) => {
  if (e.target === avatarModal) closeAvatarEditor();
});

avatarEmojiInput.addEventListener("input", () => {
  avatarEditPreview.textContent = avatarEmojiInput.value.trim() || (editingAvatarManager ? editingAvatarManager[0] : "");
});

avatarSaveBtn.addEventListener("click", async () => {
  if (!editingAvatarManager) return;
  const val = avatarEmojiInput.value.trim();
  const who = editingAvatarManager;
  const patch = {};
  if (val && val !== avatarOverrides[who]) { avatarOverrides[who] = val; saveAvatars(avatarOverrides); patch.emoji = val; }
  if ((editingColor || null) !== (avatarColors[who] || null)) {
    if (editingColor) avatarColors[who] = editingColor; else delete avatarColors[who];
    saveAvatarColors();
    patch.color = editingColor || null;
  }
  if (Object.keys(patch).length) await queueAvatar(who, patch);
  closeAvatarEditor();
  renderManagerPicker();
  updateMePill();
});

avatarResetBtn.addEventListener("click", async () => {
  if (!editingAvatarManager) return;
  const who = editingAvatarManager;
  delete avatarOverrides[who]; delete avatarColors[who];
  saveAvatars(avatarOverrides); saveAvatarColors();
  await queueAvatar(who, { emoji: null, color: null });
  closeAvatarEditor();
  renderManagerPicker();
  updateMePill();
});

// --- "Who are you?" confirm --------------------------------------------
// The one deliberate step that locks a device to a name. Shown on first
// visit, and again any time someone taps a card that isn't theirs.

let pendingIdentity = null;

// Compact "Who are you?" for a device with no saved identity. Fires on
// entry from the splash and again if they head for Picks, Scores or
// History without choosing. "Just looking" hides it for this visit.
let openClaimPrompt = function () {
  const me = loadMe();
  if (me || claimSkippedThisVisit) return false;
  claimGrid.innerHTML = MANAGERS.map((name, idx) => {
    const accent = accentFor(name);
    const av = avatarOverrides[name] || shown(name)[0];
    return `<button type="button" class="claim-btn" data-name="${name}"><span class="claim-avatar" style="--accent:${accent}">${av}</span>${shown(name)}</button>`;
  }).join("");
  // Hold your own card to edit your avatar; the picker comes back after.
  const mine = me && claimGrid.querySelector(`.claim-btn[data-name="${me}"]`);
  let held = false;
  if (mine) {
    let t = null;
    const cancel = () => clearTimeout(t);
    mine.addEventListener("pointerdown", () => { held = false; t = setTimeout(() => { held = true; claimModal.classList.add("hidden"); reopenOwnerAfterAvatar = true; openAvatarEditor(me, accentFor(me)); }, 550); });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => mine.addEventListener(ev, cancel));
    mine.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  claimGrid.querySelectorAll(".claim-btn").forEach((btn) => btn.addEventListener("click", async () => {
    if (held && btn === mine) { held = false; return; }
    const name = btn.dataset.name;
    claimModal.classList.add("hidden");
    if (!(await requireOwnerAuth(name))) return;
    saveMe(name);
    selectManager(name);
  }));
  claimModal.classList.remove("hidden");
  return true;
};
claimSkipBtn.addEventListener("click", () => { claimSkippedThisVisit = true; claimModal.classList.add("hidden"); });

// Same picker, opened from the header pill: switch owners in place without
// leaving the screen you are on. The current owner is marked.
function openOwnerPicker() {
  const me = loadMe();
  document.getElementById("claim-title").textContent = "SELECT YOUR OWNER";
  document.getElementById("claim-subtext").innerHTML = (me ? `This phone is ${shown(me)}. Tap a name to switch.` : "Tap your name.") + (me ? `<small class="claim-hint">Hold your name to change your avatar.</small>` : "");
  claimSkipBtn.textContent = "Cancel";
  claimGrid.innerHTML = MANAGERS.map((name, idx) => {
    const accent = accentFor(name);
    const av = avatarOverrides[name] || shown(name)[0];
    return `<button type="button" class="claim-btn${name === me ? " current" : ""}" data-name="${name}"><span class="claim-avatar" style="--accent:${accent}">${av}</span>${shown(name)}${name === me ? '<span class="claim-you">YOU</span>' : ""}</button>`;
  }).join("");
  // Hold your own card to edit your avatar; the picker comes back after.
  const mine = me && claimGrid.querySelector(`.claim-btn[data-name="${me}"]`);
  let held = false;
  if (mine) {
    let t = null;
    const cancel = () => clearTimeout(t);
    mine.addEventListener("pointerdown", () => { held = false; t = setTimeout(() => { held = true; claimModal.classList.add("hidden"); reopenOwnerAfterAvatar = true; openAvatarEditor(me, accentFor(me)); }, 550); });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => mine.addEventListener(ev, cancel));
    mine.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  claimGrid.querySelectorAll(".claim-btn").forEach((btn) => btn.addEventListener("click", async () => {
    if (held && btn === mine) { held = false; return; }
    const name = btn.dataset.name;
    claimModal.classList.add("hidden");
    if (name === me) return;
    if (!(await requireOwnerAuth(name))) return;
    saveMe(name);
    currentManager = name;
    // Re-render whatever screen is showing so "you" markers and picks follow
    if (!picksScreen.classList.contains("hidden")) { await syncManagerFromCloud(name); withScrollPreserved(renderPicksScreen); }
    if (!scoreboardScreen.classList.contains("hidden")) withScrollPreserved(renderScoreboard);
    if (!loginScreen.classList.contains("hidden")) renderManagerPicker();
  }));
  claimModal.classList.remove("hidden");
}
// Restore the first-visit wording whenever the claim prompt is used again
const _openClaimPrompt = openClaimPrompt;
openClaimPrompt = function () {
  if (window.__liveView) return;
  document.getElementById("claim-title").textContent = "WHO ARE YOU?";
  document.getElementById("claim-subtext").textContent = "Pick your name once and this phone will remember you.";
  claimSkipBtn.textContent = "Just looking for now";
  return _openClaimPrompt();
};
claimModal.addEventListener("click", (e) => { if (e.target === claimModal) { claimSkippedThisVisit = true; claimModal.classList.add("hidden"); } });

function openIdentityConfirm(name, accent) {
  pendingIdentity = name;
  identityPreview.textContent = avatarOverrides[name] || shown(name)[0];
  identityPreview.style.setProperty("--accent", accent);
  identityText.textContent = currentManager
    ? `Switch from ${shown(currentManager)} to ${shown(name)}? This device will remember ${shown(name)} from now on.`
    : `Lock in as ${shown(name)}? This device will remember you — use SWITCH later if you need to change.`;
  identityConfirmBtn.textContent = currentManager ? `Switch to ${shown(name)}` : `That's me`;
  identityModal.classList.remove("hidden");
}

function closeIdentityConfirm() {
  identityModal.classList.add("hidden");
  pendingIdentity = null;
}

identityModal.addEventListener("click", (e) => {
  if (e.target === identityModal) closeIdentityConfirm();
});
identityCancelBtn.addEventListener("click", closeIdentityConfirm);
identityConfirmBtn.addEventListener("click", async () => {
  const name = pendingIdentity;
  closeIdentityConfirm();
  if (!name) return;
  if (!(await requireOwnerAuth(name))) return;
  saveMe(name);
  selectManager(name);
});

async function selectManager(name) {
  currentManager = name;
  saveMe(name);
  await showPicksScreen();
}

// Re-render without yanking the page: capture scroll, redraw, restore.
// Works for sync and async renderers.
function withScrollPreserved(fn) {
  const y = appScroll.scrollTop;
  const result = fn();
  const restore = () => { appScroll.scrollTop = y; };
  if (result && typeof result.then === "function") result.then(restore);
  else restore();
  return result;
}

// The only time-driven change on the picks screen is a game locking at
// kickoff, so background refreshes compare this and skip the redraw
// when nothing has flipped.
let lastLockSignature = null;
function lockSignature() {
  return GAMES.map((g) => (isGameLocked(g) ? "1" : "0")).join("");
}

function pickEqual(a, b) {
  if (!a || !b) return a === b;
  return a.team === b.team && a.mode === b.mode;
}

// When a pick was recorded: the Worker's stamp first, the phone's tap
// time as a fallback, nothing for picks made before stamping existed.
function pickTimeLabel(pick) {
  const t = pick?.savedAt || pick?.updatedAt;
  if (!t) return "";
  const d = new Date(t);
  const day = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
  const time = d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
}

function pickLabel(game, pick) {
  if (!pick) return "";
  const pts = pointValue(game, pick.team, pick.mode);
  if (pick.mode === "SU") return `${pick.team} SU (${pts} pt)`;
  const spreadStr = pick.team === game.favorite ? `-${game.spread}` : `+${game.spread}`;
  return `${pick.team} ATS ${spreadStr} (${pts} pt)`;
}

// Hero team-vs-team cards (logo + spread number + name up top, like a
// sportsbook matchup card) with 2 pick buttons per team beneath: the
// One row per team: mark, name, line, then the two bets as flat chips.
// No boxed sub-card, no repeated number, no stacked three-line buttons —
// the label and what it pays on one line each, so a card reads top to
// bottom in four lines instead of being scanned as a grid of panels.
function teamRowHtml(game, team, teamId, isFavorite, short, draft) {
  const sign = isFavorite ? "-" : "+";
  const line = `${sign}${game.spread}`;
  const isHome = teamId === game.homeId;
  // The sign gets its own fixed box. Orbitron's plus is five pixels wider
  // than its minus, which was enough to make the underdog's spread chip
  // start five pixels left of the favourite's on the row below it.
  const lineHtml = `<span class="pk-line"><i class="pk-sign">${sign}</i>${game.spread}</span>`;
  const suPts = pointValue(game, team, "SU");
  const atsSelected = pickEqual(draft, { team, mode: "ATS" });
  const suSelected = pickEqual(draft, { team, mode: "SU" });
  const pts = (n) => `<span class="pk-pts">${n}<i>PT</i></span>`;
  return `
    <div class="tm-row ${atsSelected || suSelected ? "picked" : ""}">
      <div class="tm-id" data-tm="${escapeCd(team)}">
        <span class="tm-logo-wrap"><img class="tm-logo" src="${logoUrl(teamId)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />${latestLiveWeek === currentWeek ? rankBadge(teamId === game.awayId ? latestLive[game.id]?.awayRank : latestLive[game.id]?.homeRank) : ""}</span>
        <span class="tm-name">${isHome ? `<i class="tm-at">@</i>` : ""}<span class="tm-nm">${short}</span>${isFavorite ? `<span class="tm-spread">${line}</span>` : ""}</span>
      </div>
      <div class="tm-chips">
        <button class="pick-mini-btn ats ${atsSelected ? "selected" : ""}" type="button" data-team="${team}" data-mode="ATS" title="${short} ${line} against the spread, 2 points">
          ${lineHtml}${pts(2)}
        </button>
        <button class="pick-mini-btn su ${isFavorite ? "chalk" : "upset"} ${suSelected ? "selected" : ""}" type="button" data-team="${team}" data-mode="SU" title="${short} to win outright, ${suPts} points">
          <span class="pk-label">WIN</span>${pts(suPts)}
        </button>
      </div>
    </div>`;
}

// Underdog on top, favourite on the bottom on every card, so the eye
// lands on the same row for the same kind of bet. The home side is marked
// with an @ since the order no longer says who hosts.
// Long team names shrink instead of breaking mid-word on a phone column.
function nameSizeClass(short) {
  const longest = Math.max(...String(short || "").split(/\s+/).map((w) => w.length), 0);
  return longest >= 11 ? " xl" : longest >= 8 ? " lg" : "";
}

function matchupCardsHtml(game, draft) {
  const awayIsFav = game.favorite === game.away;
  const raw = latestLiveWeek === currentWeek ? latestLive[game.id] : null;
  const live = raw && (!raw.awayTeamId || !game.awayId || raw.awayTeamId === Number(game.awayId)) ? raw : {};
  const side = (team, teamId, isFavorite, short, rank, record) => {
    const sign = isFavorite ? "-" : "+";
    const line = `${sign}${game.spread}`;
    const lineHtml = `<span class="pk-line"><i class="pk-sign">${sign}</i>${game.spread}</span>`;
    const suPts = pointValue(game, team, "SU");
    const atsSelected = pickEqual(draft, { team, mode: "ATS" });
    const suSelected = pickEqual(draft, { team, mode: "SU" });
    const pts = (n) => `<span class="pk-pts">${n}<i>PT</i></span>`;
    const id = `<div class="hz-tm${atsSelected || suSelected ? " picked" : ""}" data-tm="${escapeCd(team)}">
        <img class="tm-logo" src="${logoUrl(teamId)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
        <span class="hz-nm${nameSizeClass(short)}">${short}</span>
        <span class="hz-rec">${record ? String(record).replace(/[^0-9-]/g, "") : ""}${rank ? `<b>#${rank}</b>` : ""}</span>
      </div>`;
    const chips = `<div class="hz-col">
        <button class="pick-mini-btn ats ${atsSelected ? "selected" : ""}" type="button" data-team="${team}" data-mode="ATS" title="${short} ${line} against the spread, 2 points">${lineHtml}${pts(2)}</button>
        <button class="pick-mini-btn su ${isFavorite ? "chalk" : "upset"} ${suSelected ? "selected" : ""}" type="button" data-team="${team}" data-mode="SU" title="${short} to win outright, ${suPts} points"><span class="pk-label">WIN</span>${pts(suPts)}</button>
      </div>`;
    return { id, chips };
  };
  const a = side(game.away, game.awayId, awayIsFav, game.awayShort, live.awayRank, live.awayRecord);
  const h = side(game.home, game.homeId, !awayIsFav, game.homeShort, live.homeRank, live.homeRecord);
  return `
    <div class="matchup-cards-row hz-row">
      ${a.id}${a.chips}<div class="hz-at">AT</div>${h.chips}${h.id}
    </div>
  `;
}

// Tapping a team (logo, name, record) or the status chip opens the game's
// info sheet, like INFO. (Players tapped them expecting something.)
gamesList?.addEventListener("click", (e) => {
  // The status chip (OPEN, your bet, LIVE, FINAL) opens the game, like INFO.
  const chip = e.target.closest(".game-status");
  if (chip) { const id = Number(chip.closest(".game-card")?.dataset.gameId); if (id) { track("status-tap", { event: true }); openInsights(id); } return; }
  // A team's logo or name opens the game's info sheet too.
  const tm = e.target.closest(".hz-tm, .tm-id");
  if (!tm) return;
  const id = Number(tm.closest(".game-card")?.dataset.gameId);
  if (id) { track("team-tap", { event: true }); openInsights(id); }
});

// Tap = saved. There's no separate Submit: every pick is freely
// changeable until that game kicks off anyway, so a confirm step added
// no safety — it only created a way to lose unsaved work on a refresh.
// The card you just tapped gets a brief "SAVED ✓" pulse instead.
let justSavedGameId = null;
// "saved" for a first pick, "updated" when an existing pick was changed.
let justSavedKind = "saved";

// Once a game locks the pick buttons are dead weight, so the card turns
// into a scorebug: both teams with live or final scores, the picked team
// highlighted, and what the pick is worth or has earned.
function lockedResultHtml(game, pick, finalRes, liveG) {
  const src = finalRes || liveG;
  const aS = src && Number.isFinite(src.awayScore) ? src.awayScore : null;
  const hS = src && Number.isFinite(src.homeScore) ? src.homeScore : null;
  const pickedSide = pick ? (pick.team === game.away ? "away" : "home") : null;
  // The badge on the picked row carries the whole bet: which way, what
  // number, what it pays. That is the same information the footer used to
  // spell out in a sentence, in a third of the space and where the eye
  // already is.
  const betBadge = () => {
    if (!pick) return "";
    const isFav = pick.team === game.favorite;
    const worth = pointValue(game, pick.team, pick.mode);
    const terms = pick.mode === "ATS" ? `${isFav ? "-" : "+"}${game.spread}` : "SU";
    // No tick. It marked the side you took, not a correct answer, but a
    // green check on a losing pick reads as "you got this one", and the
    // card already says otherwise twice underneath. The cyan frame and the
    // bar down the row are what say this side is yours.
    return `<span class="lr-bet">${terms}<span class="lr-bet-pts">${worth} PT</span></span>`;
  };
  const team = (side, name, id) => `<div class="hz-tm lr-hz-tm ${pickedSide === side ? "picked" : ""}">
      <img class="tm-logo" src="${logoUrl(id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
      <span class="hz-nm${nameSizeClass(name)}">${name}</span>
      <span class="hz-rec">${(side === "away" ? liveG?.awayRecord : liveG?.homeRecord) ? String(side === "away" ? liveG.awayRecord : liveG.homeRecord).replace(/[^0-9-]/g, "") : ""}${(side === "away" ? liveG?.awayRank : liveG?.homeRank) ? `<b>#${side === "away" ? liveG.awayRank : liveG.homeRank}</b>` : ""}</span>
    </div>`;
  const scoreCell = (side, score, other) => `<div class="lr-sc ${pickedSide === side ? "picked" : ""}">
      <span class="lr-score ${finalRes && score !== null && score > other ? "win" : ""}">${score === null ? "–" : score}</span>
      ${pickedSide === side ? betBadge() : ""}
    </div>`;
  let foot;
  if (!pick) {
    foot = `<div class="lr-foot none">NO PICK MADE</div>`;
  } else {
    const worth = pointValue(game, pick.team, pick.mode);
    const isFav = pick.team === game.favorite;
    const short = pick.team === game.away ? game.awayShort : game.homeShort;
    const pickScore = pickedSide === "away" ? aS : hS;
    const otherScore = pickedSide === "away" ? hS : aS;
    const haveScore = pickScore !== null && otherScore !== null && (pickScore || otherScore);
    const diff = haveScore ? pickScore - otherScore : 0;
    const pts = finalRes ? scorePick(game, pick, finalRes) : null;
    const prov = !finalRes && liveG && haveScore ? scorePick(game, pick, { awayScore: aS, homeScore: hS }) : null;
    let outcome = "", pill = "";
    const byTxt = diff === 0 ? "tied" : `${diff > 0 ? "won" : "lost"} by ${Math.abs(diff)}`;
    const liveByTxt = diff === 0 ? "tied" : `${diff > 0 ? "up" : "down"} ${Math.abs(diff)}`;
    if (pts !== null) {
      const hit = pts > 0;
      const pushed = pick.mode === "ATS" && resultOutcome(game, finalRes)?.push;
      outcome = pick.mode === "ATS"
        ? `${short} ${byTxt} · ${pushed ? "push, nobody scores" : hit ? "covered the number" : "did not cover"}`
        : `${short} ${byTxt} · ${hit ? "won outright" : "lost outright"}`;
      pill = pushed ? `<span class="rd-pts push">PUSH</span>` : `<span class="rd-pts ${ptsValueTier(pts)}">${hit ? "+" + pts : "0"} PTS</span>`;
    } else if (prov !== null) {
      const hit = prov > 0;
      outcome = pick.mode === "ATS"
        ? `${short} ${liveByTxt} · ${resultOutcome(game, { awayScore: aS, homeScore: hS })?.push ? "on the number, a push right now" : hit ? "covering" : "not covering"} right now`
        : `${short} ${liveByTxt} · ${hit ? "winning" : "trailing"} right now`;
      pill = `<span class="rd-pts lean ${hit ? ptsValueTier(worth) : "miss"}">${hit ? "+" + worth : "0"}</span>`;
    } else {
      outcome = pick.mode === "ATS"
        ? (isFav ? `Needs ${short} to win by more than ${game.spread}` : `Needs ${short} to win or lose by less than ${game.spread}`)
        : `Needs ${short} to win the game`;
    }
    const when = pickTimeLabel(pick);
    foot = `<div class="lr-foot">
      <div class="lr-lines"><span class="lr-outcome ${pts !== null ? (pts > 0 ? "hit" : "miss") : prov !== null ? (prov > 0 ? "hit" : "miss") : ""}">${outcome}</span>${when ? `<span class="lr-when">picked ${when}</span>` : ""}</div>
      ${pill}
    </div>`;
  }
  const mid = finalRes ? "FINAL" : liveG?.detail ? String(liveG.detail).replace(/\s*-\s*/, " ").toUpperCase().slice(0, 12) : "LOCKED";
  return `<div class="locked-result ${finalRes ? "final" : liveG ? "live" : ""}">
    <div class="hz-row lr-hz">
      ${team("away", game.awayShort, game.awayId)}
      ${scoreCell("away", aS, hS)}
      <div class="lr-mid">${mid}</div>
      ${scoreCell("home", hS, aS)}
      ${team("home", game.homeShort, game.homeId)}
    </div>
    ${foot}
  </div>`;
}


// Where you stand, and who you are chasing, on the screen where you are
// making the picks. The full table is 499px and lives on the board; two
// copies of it 2000px apart would be a duplicate nobody scrolls to, so
// this is one line and a way to get to the real thing.
//
// Its own data: renderScoreboard only runs while the board is on screen,
// so a cold open straight to Picks has no standings yet. Cached between
// renders so switching tabs does not re-fetch, and refreshed on entry.
let picksStandingRows = null;
// Whether any game in the week has a final score. Banked points stay at
// zero while games are merely in progress, so "has anyone scored" is the
// wrong test for whether there is a standing worth showing; "has anything
// finished" is the right one.
let picksStandingFinals = false;
function renderPicksStanding() {
  const el = document.getElementById("picks-standing");
  if (!el) return;
  const rows = picksStandingRows;
  const me = rows && currentManager && rows.find((r) => r.name === currentManager);
  // Nothing to stand on until somebody has scored: a board of ten zeroes
  // says less than no board at all.
  if (!me || !picksStandingFinals) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const leader = rows[0];
  const chasing = me.place === 1
    // Leading: the gap that matters is to whoever is closest behind you.
    ? rows.find((r) => r.score < me.score)
    : leader;
  // The gap carries its unit. A bare number next to a name reads as that
  // person's score, or their rank, or anything but the six points between
  // you and them.
  const gap = chasing ? Math.abs(me.score - chasing.score) : 0;
  const right = chasing
    ? `<span class="ps-label">${me.place === 1 ? "AHEAD OF" : "CHASING"}</span><span class="ps-who">${escapeCd(shown(chasing.name).toUpperCase())}</span><span class="ps-gap">${gap} ${me.place === 1 ? "UP" : "BACK"}</span>`
    : `<span class="ps-label">CLEAR</span>`;
  el.innerHTML = `<span class="ps-rank">${me.tied ? "T-" : ""}${ordinal(me.place)}</span><span class="ps-score">${String(me.score).padStart(2, "0")} PTS</span>${right}`;
  el.classList.remove("hidden");
}

// One fetch for the picks screen, the same two sources the board uses.
async function refreshPicksStanding(prefetched = null) {
  if (!currentManager) return;
  const fetched = prefetched ?? await fetchAllPicks();
  if (fetched === null) return; // keep whatever was on screen
  const cloudPicks = {};
  MANAGERS.forEach((name) => {
    const state = fetched[name];
    if (state) cloudPicks[name] = { ...state, picks: name === currentManager ? sanitizePicks(state.picks) : sanitizeRoomPicks(state.picks) };
  });
  const hadLive = Object.keys(latestLive).length > 0;
  const results = computeLiveResults(await fetchLiveScores());
  picksStandingFinals = Object.keys(results).length > 0;
  picksStandingRows = rankManagers(cloudPicks, results);
  if (!picksScreen.classList.contains("hidden")) {
    renderPicksStanding();
    // The row arrives a beat after the page, so the progress line above it
    // has to be told to stop repeating the score.
    updatePicksProgress(getManagerState(currentManager));
    // If that call is what first brought the feed in, the cards were drawn
    // without it and are missing their ranks.
    if (!hadLive && Object.keys(latestLive).length) withScrollPreserved(renderPicksScreen);
  }
}

document.getElementById("picks-standing")?.addEventListener("click", () => {
  navScoreboardBtn?.click();
});

function renderPicksScreen() {
  markUsable();
  const state = getManagerState(currentManager);
  lastLockSignature = lockSignature();
  renderPicksCountdown();
  renderSyncBanner();
  renderPicksStanding();

  gamesList.innerHTML = "";
  // Kickoff order, not the order the commissioner happened to tap them
  // in: the card at the top is always the next one to lock, which is what
  // the countdown above is counting down to.
  // The next game still to pick, in kickoff order, wears the glowing edge.
  const nextUpId = gamesByKickoff().find((g) => !isGameLocked(g) && !state.picks[g.id])?.id ?? null;
  gamesByKickoff().forEach((game) => {
    const gameLocked = isGameLocked(game);
    const pick = state.picks[game.id];

    const card = document.createElement("div");
    card.dataset.gameId = game.id;
    card.className =
      "game-card" +
      (gameLocked ? " game-locked" : "") +
      (pick ? " game-submitted" : "") +
      (game.id === nextUpId ? " next-up" : "") +
      (justSavedGameId === game.id ? " just-saved" : "");

    const g = latestLive[game.id];
    const finalRes = gameLocked ? computeLiveResults(latestLive)[game.id] : null;
    const isLive = gameLocked && !finalRes && g && g.found && g.state === "in";
    let statusLabel = "OPEN";
    let statusClass = "open";
    if (finalRes) {
      statusLabel = "FINAL";
      statusClass = "final";
    } else if (isLive) {
      statusLabel = g.detail || "LIVE";
      statusClass = "live";
    } else if (gameLocked) {
      statusLabel = "LOCKED";
      statusClass = "locked";
    } else if (pick && justSavedGameId === game.id && syncStatus === "saving") {
      statusLabel = "SAVING…";
      statusClass = "submitted saving";
    } else if (pick && (pendingPushFor(currentManager) || (justSavedGameId === game.id && syncStatus === "failed"))) {
      statusLabel = "THIS PHONE ⚠";
      statusClass = "submitted failed";
    } else if (pick && justSavedGameId === game.id && justSavedKind === "updated") {
      statusLabel = "UPDATED ✓";
      statusClass = "submitted updated";
    } else if (pick) {
      // The chip carries the bet, so ten cards scan as ten stakes:
      // who, which way, and what it pays.
      const teamId = pick.team === game.away ? game.awayId : game.homeId;
      const way = pick.mode === "SU" ? "WIN" : (pick.team === game.favorite ? `-${game.spread}` : `+${game.spread}`);
      statusLabel = `<img class="gs-logo" src="${logoUrl(teamId)}" alt="${pick.team}"><span class="gs-bet">${way}</span><b>${pointValue(game, pick.team, pick.mode)}<i>PT</i></b> ✓`;
      statusClass = "submitted bet";
    }

    const noteVerb = justSavedGameId === game.id && justSavedKind === "updated" ? "Updated" : "Saved";
    const note = pick && (pendingPushFor(currentManager) || (justSavedGameId === game.id && syncStatus === "failed"))
      ? `⚠ ${pickLabel(game, pick)} is on this phone but has not reached the league yet`
      : pick ? `${noteVerb}${pickTimeLabel(pick) ? ` ${pickTimeLabel(pick)}` : ""}` : "";

    card.innerHTML = `
      <div class="game-meta">
        <span class="game-meta-left"><span>G${game.id} &middot; ${game.kickoffLabel} &middot; ${game.tv}</span>${gameLocked || !note || note.startsWith("⚠") ? "" : `<span class="game-stamp">${note}</span>`}</span>
        <span class="game-meta-right"><button type="button" class="insights-btn" data-insights="${game.id}" aria-label="Insights for ${game.awayShort} at ${game.homeShort}">INFO</button><span class="game-status ${statusClass}">${statusLabel}</span></span>
      </div>
      ${gameLocked ? lockedResultHtml(game, pick, finalRes, isLive ? g : null) : matchupCardsHtml(game, pick)}
      ${gameLocked || !note || !note.startsWith("⚠") ? "" : `<div class="game-submit-row"><span class="game-submit-note">${note}</span></div>`}
    `;

    const infoBtn = card.querySelector(".insights-btn");
    infoBtn?.addEventListener("pointerdown", () => { const id = latestLive[game.id]?.eventId; if (id) fetchEspnSummary(id); }, { passive: true });
    infoBtn?.addEventListener("click", (e) => { e.stopPropagation(); openInsights(game.id); });
    card.querySelectorAll(".pick-mini-btn").forEach((btn) => {
      const team = btn.dataset.team;
      const mode = btn.dataset.mode;
      btn.disabled = gameLocked;
      btn.addEventListener("click", () => {
        const s = getManagerState(currentManager);
        const prev = s.picks[game.id];
        const changed = !!prev && (prev.team !== team || prev.mode !== mode);
        if (prev && !changed) return; // same button again: nothing to save
        s.picks[game.id] = { team, mode, updatedAt: Date.now() };
        setManagerState(currentManager, s);
        pushManagerState(currentManager, s).then(() => { if (!picksScreen.classList.contains("hidden")) withScrollPreserved(renderPicksScreen); });
        justSavedGameId = game.id;
        justSavedKind = changed ? "updated" : "saved";
        track(changed ? "pick-updated" : "pick-saved", { event: true });
        withScrollPreserved(renderPicksScreen);
        setTimeout(() => {
          if (justSavedGameId !== game.id || syncStatus === "failed") return;
          justSavedGameId = null;
          withScrollPreserved(renderPicksScreen);
        }, 2500);
      });
    });

    gamesList.appendChild(card);
  });

  const tiebreakerGame = tiebreakerGameOf();
  const tiebreakerLocked = isGameLocked(tiebreakerGame);
  // The label has to come from the slate: it named week 1's game while the
  // Worker was already serving a different week's tiebreaker.
  const tbLabel = document.querySelector("#picks-screen .tiebreaker-label");
  if (tbLabel) tbLabel.textContent = `TIEBREAKER · G${tiebreakerGame.id} · TOTAL COMBINED POINTS`;
  // The matchup sits on the same line as the box you type into, so the
  // game being guessed and the guess are one thing to look at.
  const tbGameEl = document.getElementById("tb-game");
  if (tbGameEl) {
    const logo = (id) => `<img class="tb-logo" src="${logoUrl(id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />`;
    tbGameEl.innerHTML = `${logo(tiebreakerGame.awayId)}<span class="tb-tm">${escapeCd(tiebreakerGame.awayShort)}</span><span class="tb-at">@</span>${logo(tiebreakerGame.homeId)}<span class="tb-tm">${escapeCd(tiebreakerGame.homeShort)}</span>`;
  }
  // Don't clobber a number someone is mid-typing on a background redraw.
  if (document.activeElement !== tiebreakerInput) {
    tiebreakerInput.value = state.tiebreaker || "";
  }
  tiebreakerInput.disabled = tiebreakerLocked;
  // Locked: show the guess against the real total, live or final.
  const tbFinal = computeLiveResults(latestLive)[tiebreakerGame.id];
  const tbLiveG = !tbFinal && latestLive[tiebreakerGame.id] && latestLive[tiebreakerGame.id].found && latestLive[tiebreakerGame.id].state === "in" ? latestLive[tiebreakerGame.id] : null;
  const tbActual = tbFinal ? tbFinal.awayScore + tbFinal.homeScore : tbLiveG && Number.isFinite(tbLiveG.awayScore) && Number.isFinite(tbLiveG.homeScore) ? tbLiveG.awayScore + tbLiveG.homeScore : null;
  const guess = String(state.tiebreaker ?? "").trim();
  let tbText;
  // An empty box must read as empty, not as a number already filled in
  // (the old "45" placeholder looked like an answer and got skipped).
  document.querySelector("#picks-screen .tiebreaker-card")?.classList.toggle("tb-missing", !tiebreakerLocked && !guess);
  if (!tiebreakerLocked) tbText = !guess ? "Not entered yet. Guess the total points both teams score. Ties go to the closest guess; no guess loses every tie."
    : state.tiebreakerSavedToCloud === guess ? `✓ Saved to cloud: ${guess}`
    : `${guess} on this phone. Tap SAVE to confirm it reached the cloud.`;
  else if (!guess) tbText = `No tiebreaker entered — locked. Any tie this week is lost.${tbActual !== null ? ` · ${tbFinal ? "final" : "now"} ${tbActual}` : ""}`;
  else if (tbFinal) tbText = `Your guess: ${guess} · Final: ${tbActual} · off by ${Math.abs(Number(guess) - tbActual)}`;
  else if (tbLiveG && tbActual !== null) tbText = `Your guess: ${guess} · Now: ${tbActual} · off by ${Math.abs(Number(guess) - tbActual)}`;
  else tbText = `Your guess: ${guess} · waiting on kickoff`;
  tiebreakerStatus.textContent = tbText;
  tiebreakerStatus.classList.toggle("warn", !tiebreakerLocked && (!guess || state.tiebreakerSavedToCloud !== guess));
  tiebreakerStatus.classList.remove("busy");
  const saveBtn = document.getElementById("tiebreaker-save");
  if (saveBtn) saveBtn.classList.toggle("hidden", tiebreakerLocked);

  updatePicksProgress(state);
}

function updatePicksProgress(state) {
  const totalPicked = Object.values(state.picks).filter(Boolean).length;
  const results = computeLiveResults(latestLive);
  const allFinal = GAMES.every((g) => results[g.id]);
  const allLocked = GAMES.every(isGameLocked);
  // Once the standings row is on screen it is saying the score, so this
  // line stops repeating it and keeps only the state of the week.
  const standingShown = !document.getElementById("picks-standing")?.classList.contains("hidden");
  picksProgress.textContent = allFinal
    ? `${WEEK_LABEL} is final` + (standingShown ? "" : ` · you scored ${computeScore(state, results)} pts`)
    : allLocked
      ? `${WEEK_LABEL} is locked` + (standingShown ? "" : ` · ${computeScore(state, results)} pts so far`)
      : `${totalPicked} of ${GAMES.length} games picked` + (state.tiebreaker ? " · tiebreaker set" : " · tiebreaker MISSING");

  // Total row under the cards: what the card pays if every pick lands,
  // and once games settle, what has banked against what is still open.
  let totalRow = document.getElementById("picks-total");
  if (!totalRow) {
    totalRow = document.createElement("div");
    totalRow.id = "picks-total";
    totalRow.className = "picks-total hidden";
    document.getElementById("games-list")?.insertAdjacentElement("afterend", totalRow);
  }
  let maxPts = 0, banked = 0, openPts = 0;
  for (const g of GAMES) {
    const pick = state.picks[g.id];
    if (!pick) continue;
    const worth = pointValue(g, pick.team, pick.mode);
    if (results[g.id]) banked += scorePick(g, pick, results[g.id]);
    else openPts += worth;
    maxPts += results[g.id] ? scorePick(g, pick, results[g.id]) : worth;
  }
  const missing = GAMES.length - totalPicked;
  totalRow.classList.toggle("hidden", totalPicked === 0);
  totalRow.innerHTML = allFinal
    ? `<span class="pt-label">${WEEK_LABEL.toUpperCase()} TOTAL</span><span class="pt-val"><b>${banked}</b><i>PT</i></span>`
    : allLocked || banked > 0 || GAMES.some((g) => results[g.id])
      ? `<span class="pt-label">BANKED <b>${banked}</b><i>PT</i> · STILL OPEN <b>${openPts}</b><i>PT</i></span><span class="pt-val">MAX <b>${maxPts}</b><i>PT</i></span>`
      : `<span class="pt-label">${totalPicked} OF ${GAMES.length} PICKED${missing ? ` · <em>${missing} BLANK</em>` : ""}</span><span class="pt-val">RIDING <b>${maxPts}</b><i>PT</i></span>`;

  // The tiebreaker decides who takes a week, and ten managers on ten games
  // tie constantly. Somebody who never enters one forfeits every tie, so
  // say it plainly rather than letting them find out on a Sunday night.
  let tbWarn = document.getElementById("tb-required");
  if (!tbWarn) {
    tbWarn = document.createElement("div");
    tbWarn.id = "tb-required";
    tbWarn.className = "tb-required hidden";
    picksProgress.insertAdjacentElement("afterend", tbWarn);
  }
  // One quiet line, and only once the card is otherwise done: while picks
  // are still going in, the header chip already says NO TB, and a boxed
  // warning at the top of every visit was too much.
  const needsTb = !allLocked && totalPicked >= GAMES.length && !String(state.tiebreaker ?? "").trim();
  tbWarn.classList.toggle("hidden", !needsTb);
  if (needsTb) {
    tbWarn.innerHTML = `Card complete, no tiebreaker. Blank forfeits ties.
      <button class="tb-jump" type="button">SET IT</button>`;
    tbWarn.querySelector(".tb-jump")?.addEventListener("click", () => {
      tiebreakerInput.scrollIntoView({ block: "center", behavior: "smooth" });
      tiebreakerInput.focus();
    });
  }
  const hint = document.querySelector("#picks-screen .picks-hint");
  if (hint) hint.textContent = allLocked
    ? `${WEEK_LABEL} has kicked off and your card is locked. Scores and results update below as games finish.`
    : `One pick per game: straight up (1 pt favorite, 3 pt underdog) or against the spread (2 pts). Tap to save — change it any time until ${weekLockTime() ? "the week's first kickoff" : "that game kicks off"}.`;
  let warn = document.getElementById("picks-mismatch");
  if (!warn) { warn = document.createElement("button"); warn.id = "picks-mismatch"; warn.type = "button"; warn.className = "picks-mismatch"; picksProgress.insertAdjacentElement("afterend", warn); warn.addEventListener("click", () => restorePhonePicks(currentManager)); }
  // A repair tool, not a message for the league. It only shows on a
  // device that has opened the admin console this session, which is the
  // only device that can act on it.
  let adminHere = false;
  try { adminHere = !!sessionStorage.getItem(ADMIN_KEY_STORE); } catch { /* private mode */ }
  if (adminHere && lockedMismatch.length && phoneSnapshot[currentManager]) {
    const lines = lockedMismatch.map((m) => `G${m.id}: phone ${m.phone ? pickLabel(GAMES.find((g) => g.id === m.id), m.phone) : "none"} · cloud ${m.cloud ? pickLabel(GAMES.find((g) => g.id === m.id), m.cloud) : "none"}`);
    warn.innerHTML = `<b>⚠ This phone and the scoreboard disagree on ${lockedMismatch.length} locked game${lockedMismatch.length === 1 ? "" : "s"}</b><span>${lines.join("<br>")}</span><span class="picks-mismatch-cta">Tap to make this phone's picks the record (needs the admin key)</span>`;
    warn.classList.remove("hidden");
  } else {
    warn.classList.add("hidden");
  }
}

// Tiebreaker saves as you type (debounced) and on the SAVE button, and
// the status line only says "saved" once the Worker has echoed the guess
// back. A tap away from the app flushes any pending save first.
let tiebreakerSaveTimer = null;
const tiebreakerSave = document.getElementById("tiebreaker-save");
function setTbStatus(text, tone) {
  tiebreakerStatus.textContent = text;
  tiebreakerStatus.classList.toggle("warn", tone === "warn");
  tiebreakerStatus.classList.toggle("busy", tone === "busy");
}
async function saveTiebreakerNow() {
  clearTimeout(tiebreakerSaveTimer);
  tiebreakerSaveTimer = null;
  if (!currentManager) return;
  const s = getManagerState(currentManager);
  const guess = tiebreakerInput.value.trim();
  if (guess === String(s.tiebreaker ?? "").trim() && s.tiebreakerSavedToCloud === guess) {
    setTbStatus(guess ? `✓ Saved to cloud: ${guess}` : "Required — ties go to whoever is closest, and no guess loses every tie.", guess ? "" : "warn");
    return;
  }
  s.tiebreaker = guess;
  s.tiebreakerUpdatedAt = Date.now();
  delete s.tiebreakerSavedToCloud;
  setManagerState(currentManager, s);
  updatePicksProgress(s);
  setTbStatus(guess ? `Saving ${guess}…` : "Saving…", "busy");
  lastPushEcho = null;
  const ok = await pushManagerState(currentManager, s);
  if (tiebreakerInput.value.trim() !== guess) return; // typed again meanwhile
  const cloud = lastPushEcho ? String(lastPushEcho.tiebreaker ?? "").trim() : null;
  if (ok && cloud === guess) {
    const now = getManagerState(currentManager);
    now.tiebreakerSavedToCloud = guess;
    setManagerState(currentManager, now);
    setTbStatus(guess ? `✓ Saved to cloud: ${guess}` : "Cleared. Required — no guess loses every tie.", guess ? "" : "warn");
  } else if (ok && cloud !== null) {
    setTbStatus(cloud ? `Locked — the cloud kept ${cloud}` : "Locked — the cloud has no guess for you", "warn");
  } else {
    setTbStatus(`⚠ Not saved to the cloud yet — kept on this phone, tap SAVE to retry`, "warn");
  }
}
tiebreakerInput.addEventListener("input", () => {
  clearTimeout(tiebreakerSaveTimer);
  setTbStatus(tiebreakerInput.value.trim() ? "Tap SAVE, or wait a second" : "", "busy");
  tiebreakerSaveTimer = setTimeout(saveTiebreakerNow, 700);
});
tiebreakerInput.addEventListener("change", saveTiebreakerNow);
tiebreakerInput.addEventListener("blur", () => { if (tiebreakerSaveTimer) saveTiebreakerNow(); });
if (tiebreakerSave) tiebreakerSave.addEventListener("click", () => { tiebreakerInput.blur(); saveTiebreakerNow(); });
tiebreakerInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tiebreakerInput.blur(); saveTiebreakerNow(); } });
document.addEventListener("visibilitychange", () => { if (document.hidden && tiebreakerSaveTimer) saveTiebreakerNow(); });
window.addEventListener("pagehide", () => { if (tiebreakerSaveTimer) saveTiebreakerNow(); });


// --- Scoreboard ------------------------------------------------------------

function showScoreboard() {
  rememberScroll();
  historyScreen.classList.add("hidden");
  triviaScreen.classList.add("hidden");
  loginScreen.classList.add("hidden");
  picksScreen.classList.add("hidden");
  scoreboardScreen.classList.remove("hidden");
  setActiveNav("scoreboard");
  enterScreen("scoreboard");
  withScrollPreserved(renderScoreboard);
}


// The last league-wide copy that actually came from the Worker. Falling
// back to local storage was wrong: it holds this device's picks only, so
// a failed fetch rendered nine managers as 0/10 as though nobody had
// picked. Keeping the last good copy and saying it is stale is honest.
let lastGoodCloudPicks = null;
let cloudPicksStale = false;

// The board's picks, re-used for two minutes except in the last two hours
// before lock (every 20s, when counts move). Our own save, and coming back
// to the app, clear it. Saving and syncing always read fresh.
let boardPicks = { at: 0, data: null };
function boardPicksTtl() {
  const lock = weekLockTime() ?? (GAMES.length ? Math.min(...GAMES.map((g) => Date.parse(g.kickoff))) : null);
  const now = Date.now();
  return lock && lock > now && lock - now < 2 * 3600000 ? 20000 : 120000;
}
let boardPicksInFlight = null;
function fetchBoardPicks() {
  if (boardPicks.data && Date.now() - boardPicks.at < boardPicksTtl()) return Promise.resolve(boardPicks.data);
  if (boardPicksInFlight) return boardPicksInFlight;
  boardPicksInFlight = fetchAllPicks().then((d) => {
    if (d) boardPicks = { at: Date.now(), data: d };
    return d;
  }).finally(() => { boardPicksInFlight = null; });
  return boardPicksInFlight;
}

// The board as last seen on this phone (picks as the Worker served them,
// so nothing hidden before lock is here), drawn once on open while the
// fresh copy loads, so the scoreboard is there at once.
const BOARD_CACHE_KEY = "brochiefs_board_v1";
let bootBoard = null;
function loadBootBoard() {
  try {
    const c = JSON.parse(localStorage.getItem(BOARD_CACHE_KEY) || "null");
    if (c && c.week === currentWeek && c.picks && c.live && Date.now() - c.at < 7 * 86400000) bootBoard = c;
  } catch {}
}
async function renderScoreboard() {
  renderRecap(); // memoised on week and viewer, so this is cheap when nothing changed
  maybeShowBoner();
  maybeShowQotw().finally(() => maybeShowPoll());
  if (bootBoard) {
    const b = bootBoard; bootBoard = null;
    if (!Object.keys(latestLive).length && b.week === currentWeek) { latestLive = b.live; latestLiveWeek = b.week; }
    try { paintScoreboard(b.picks, b.live, true); } catch (err) { console.warn("cached board", err); }
  }
  // Picks and scores together, not picks and then scores.
  const [fetched, live] = await Promise.all([fetchBoardPicks(), fetchLiveScores()]);
  paintScoreboard(fetched, live, false);
}
function boardCloudPicks(rawPicks) {
  const cloudPicks = {};
  MANAGERS.forEach((name) => {
    const state = rawPicks[name];
    if (state) cloudPicks[name] = { ...state, picks: name === currentManager ? sanitizePicks(state.picks) : sanitizeRoomPicks(state.picks) };
  });
  return cloudPicks;
}
function paintScoreboard(fetched, live, cached) {
  cloudPicksStale = fetched === null;
  const rawPicks = fetched !== null ? fetched : (lastGoodCloudPicks || {});
  const cloudPicks = boardCloudPicks(rawPicks);
  if (fetched !== null && !cached) lastGoodCloudPicks = rawPicks;
  // Saved only from a read that answered, so old scores are never saved
  // again as if they were new.
  if (!cached && liveLastOk && fetched !== null && Object.keys(live || {}).length) { try { localStorage.setItem(BOARD_CACHE_KEY, JSON.stringify({ week: currentWeek, at: Date.now(), picks: rawPicks, live })); } catch {} }
  const results = computeLiveResults(live);

  if (!cached) archiveWeekIfFinal(results);
  renderLiveScores(live, cloudPicks);
  // Ranked once and handed to both, so the table and the leaderboard
  // cannot end up in different orders.
  const ranked = rankManagers(cloudPicks, results);
  renderScoreboardTable(cloudPicks, results, live, ranked);
  renderRankings(cloudPicks, results, live, ranked);
  const firstRows = !liveWeekRows.length && ranked.length;
  liveWeekRows = ranked;
  if (firstRows && potOpen()) renderPayouts();
  // The picks screen shows a one-line version of exactly these standings,
  // so it takes the board's copy rather than fetching its own again.
  picksStandingRows = ranked;
  picksStandingFinals = Object.keys(results).length > 0;
  liveWeekFinal = GAMES.length > 0 && GAMES.every((g) => results[g.id]);
  renderMyScore(ranked, cloudPicks, live);
  renderWeekChamp(ranked, results);
  renderInsertCoin(cloudPicks);
  renderSidePot();
  if (!cached) maybeShowPathIntro();
  if (!cached) fetchSidePot().then(() => { renderSidePot(); maybeShowSidePrompt(); });
  // The clock lives inside the strip when there is one, so the board does
  // not spend a whole line on it. Seconds are gone: the poll is every 30,
  // so second-level precision was never true.
  const stamp = document.getElementById("scoreboard-updated");
  if (stamp) {
    const noData = !Object.keys(live).length;
    stamp.textContent = cached ? "updating…" : `${clockLabel()}${noData ? " · no live data" : !liveLastOk ? " · scores not updated" : ""}${cloudPicksStale ? " · ⚠ picks not reloaded" : ""} · tap to refresh`;
    stamp.classList.toggle("stale", cloudPicksStale);
    stamp.classList.remove("busy");
    // Hidden whenever the strip is carrying the clock; shown on its own
    // when there is no strip, so refresh is always reachable.
    stamp.classList.toggle("hidden", !!document.getElementById("my-score")?.querySelector(".ms-refresh"));
  }
}
function clockLabel() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
document.getElementById("scoreboard-updated")?.addEventListener("click", (e) => {
  e.currentTarget.classList.add("busy");
  e.currentTarget.textContent = "refreshing…";
  withScrollPreserved(renderScoreboard);
});

// "INSERT COIN" prompt at the top of the board for the viewer's own
// still-open, still-unpicked games. Tap jumps straight to the picks.
function renderInsertCoin(cloudPicks) {
  const el = document.getElementById("insert-coin");
  if (!el) return;
  if (!currentManager) { el.classList.add("hidden"); return; }
  const state = cloudPicks[currentManager] || getManagerState(currentManager);
  const open = GAMES.filter((g) => !isGameLocked(g) && !state.picks[g.id]);
  if (open.length === 0) { el.classList.add("hidden"); return; }
  const list = open.map((g) => `G${g.id}`).join(" ");
  el.innerHTML = `<span class="coin-blink">INSERT COIN</span><span class="coin-sub">${open.length} GAME${open.length === 1 ? "" : "S"} UNPICKED &middot; ${list} &middot; TAP TO PICK</span>`;
  el.classList.remove("hidden");
}
document.getElementById("insert-coin")?.addEventListener("click", () => navPicksBtn.click());

// --- Side pot --------------------------------------------------------------
// Once the week is decided the commissioner can open a late night side pot
// on a few games still to come (worker/src/side.js). Everyone picks the
// same games, scored like the main pool; most points takes the pot and
// ties split it. Each player is asked once when they open the board, picks
// in one sheet, and the board carries a card: who is in before the games,
// a small leaderboard once they start, who owes whom at the end. The app
// keeps the ledger only; nobody pays through it. College only.
let sidePot = null, sidePotAt = 0, sidePotWeek = 0, sideInFlight = null, sidePromptShown = false;
const potNow = () => (sidePot && sidePotWeek === currentWeek && sidePot.week === currentWeek ? sidePot : null);
const sideOpen = (pot) => !!pot && pot.open && Date.now() < pot.closesAt;
const sideDoneKey = (pot, who) => `brochiefs_side_${pot.week}_${pot.id}_${who}`;
// In the bet but short of picks: games were added after they joined, or a
// tiebreaker was set.
const sideNeedsPicks = (pot, who) => {
  const e = pot?.entrants?.[who];
  if (!e || !e.picks) return false;
  const tot = (id) => (pot.slate || []).find((g) => String(g.id) === String(id))?.total;
  return pot.games.some((id) => !e.picks[id] || (tot(id) != null && !e.picks[id].ou)) || (pot.tbGame != null && !Number.isFinite(e.tb));
};
function fetchSidePot(force = false) {
  if (!WORKER_URL || window.LEAGUE?.sport === "nfl") return Promise.resolve(null);
  if (!force && sidePotWeek === currentWeek && Date.now() - sidePotAt < 20000) return Promise.resolve(potNow());
  if (sideInFlight) return sideInFlight;
  const who = currentManager || loadMe();
  const me = who && MANAGERS.includes(who) ? `&me=${encodeURIComponent(who)}${tokenFor(who) ? `&token=${encodeURIComponent(tokenFor(who))}` : ""}` : "";
  const week = currentWeek;
  sideInFlight = fetchCapped(`${WORKER_URL}/side?week=${week}${me}&t=${Date.now()}`, { cache: "no-store" }, 8000)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d && "pot" in d) { sidePot = d.pot; sidePotAt = Date.now(); sidePotWeek = week; } return fetchSideLive().catch(() => {}); })
    .then(() => potNow())
    .catch(() => potNow())
    .finally(() => { sideInFlight = null; });
  return sideInFlight;
}
// The pot carries its games whole (pot.slate), so a game off this week's
// slate works the same; a slate game uses the slate's copy. Older pots
// held ids only.
// The pot's copy carries the over/under total the slate does not have.
const sideGames = (pot) => pot.own ? pot.slate : (pot.slate || pot.games.map((id) => ({ id }))).map((g) => { const x = GAMES.find((y) => String(y.id) === String(g.id)); return x ? { ...x, ...(g.total != null ? { total: g.total } : {}) } : g.away ? g : null; }).filter(Boolean);
const onSlate = (g) => typeof g.id === "number" && GAMES.some((x) => x.id === g.id);
// A pool game goes by its number; a game off the slate is marked as such.
const sideTag = (g) => (g.half === 2 ? "2ND HALF" : g.half === 1 ? "1ST HALF" : onSlate(g) ? `G${g.id}` : "BONUS");
const sideMatch = (g) => `${g.awayShort} @ ${g.homeShort}${g.half === 2 ? " (2nd half)" : g.half === 1 ? " (1st half)" : ""}`;
// Live scores for side games off the slate, read from ESPN the same way
// the board reads its own.
let sideLive = {}, sideLiveAt = 0, sideLiveKey = "";
async function fetchSideLive(force = false) {
  const pot = potNow();
  const extra = pot ? sideGames(pot).filter((g) => !onSlate(g)) : [];
  if (!extra.length) return sideLive;
  const key = extra.map((g) => g.id).join(",");
  if (!force && key === sideLiveKey && Date.now() - sideLiveAt < 20000) return sideLive;
  const days = [...new Set(extra.map((g) => new Date(g.kickoff).toLocaleDateString("en-CA", { timeZone: "America/New_York" }).replace(/-/g, "")))];
  const answers = await Promise.all(days.flatMap((d) => [80, 81].map((grp) => fetchCapped(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${d}&groups=${grp}&limit=300&t=${Date.now()}`, { cache: "no-store" }, 6000).then((r) => (r.ok ? r.json() : null)).catch(() => null))));
  const events = answers.flatMap((a) => a?.events || []);
  if (events.length) { sideLive = { ...sideLive, ...parseEspnEvents(events, extra) }; sideLiveAt = Date.now(); sideLiveKey = key; }
  return sideLive;
}
const sideRawOf = (g) => (onSlate(g) ? latestLive[g.id] : sideLive[g.id]);
// A second-half bet sees only third quarter and later points: the score
// less the first two quarters. Before the third quarter it has not
// started; without ESPN's quarter scores it cannot be scored yet.
function halfView(l) {
  if (!l?.found) return l;
  const p = Number(l.period) || 0;
  if (!l.completed && p < 3) return { ...l, state: "pre", completed: false, awayScore: 0, homeScore: 0 };
  if (!(l.awayLines?.length >= 2 && l.homeLines?.length >= 2)) return { ...l, state: l.completed ? "in" : l.state, completed: false, awayScore: null, homeScore: null };
  const first = (a) => a[0] + a[1];
  return { ...l, awayScore: l.awayScore - first(l.awayLines), homeScore: l.homeScore - first(l.homeLines) };
}
// A first-half bet is the game until halftime; from the third quarter
// on it is settled at the first two quarters' points.
function firstHalfView(l) {
  if (!l?.found) return l;
  const p = Number(l.period) || 0;
  if (!l.completed && p < 3) return l;
  if (!(l.awayLines?.length >= 2 && l.homeLines?.length >= 2)) return { ...l, completed: false, state: "in", awayScore: null, homeScore: null };
  return { ...l, state: "post", completed: true, awayScore: l.awayLines[0] + l.awayLines[1], homeScore: l.homeLines[0] + l.homeLines[1], detail: "1st half final" };
}
const sideLiveOf = (g) => (g.half === 2 ? halfView(sideRawOf(g)) : g.half === 1 ? firstHalfView(sideRawOf(g)) : sideRawOf(g));
const sideResultOf = (g) => { const l = sideLiveOf(g); if (l?.completed && Number.isFinite(l.awayScore) && Number.isFinite(l.homeScore)) return { awayScore: l.awayScore, homeScore: l.homeScore }; return potNow()?.finals?.[g.id] || null; };
const sideMoney = (x) => `$${Number.isInteger(x) ? x : x.toFixed(2)}`;
const sideNames = (list) => list.map((n) => shown(n)).join(list.length === 2 ? " and " : ", ");
// Each entrant's side points: banked from finals, in flight from games on now.
// An over/under pick is worth 2; landing exactly on the total pays nothing.
const SIDE_OU_PTS = 2;
const scoreOu = (g, ou, score) => (g.total == null || !ou ? null : score.awayScore + score.homeScore === g.total ? 0 : (score.awayScore + score.homeScore > g.total) === (ou === "over") ? SIDE_OU_PTS : 0);
// resOf reads a game's final: live by default, or a past bet's kept
// finals for the season board (no live points there).
function sideStandings(pot, resOf = sideResultOf) {
  const games = sideGames(pot);
  const live = resOf === sideResultOf;
  const rows = Object.entries(pot.entrants || {}).map(([name, e]) => {
    let pts = 0, fly = 0;
    // One cell per pick: the side on each game, then its over/under.
    const cell = (g, pick, ou, worth, score) => {
      const base = { g, pick, ou };
      const res = resOf(g);
      if (res) { const p = score(res) || 0; pts += p; return { ...base, cls: p ? "hit" : "miss", txt: p ? `+${p}` : "0" }; }
      const lv = live ? sideLiveOf(g) : null;
      if (lv?.found && lv.state === "in" && Number.isFinite(lv.awayScore) && Number.isFinite(lv.homeScore)) {
        const p = score(lv) || 0; fly += p;
        return { ...base, cls: p ? "live-hit" : "live-miss", txt: p ? `+${p}` : "0" };
      }
      return { ...base, cls: "open", txt: String(worth) };
    };
    const cells = games.flatMap((g) => {
      const pick = e.picks?.[g.id];
      // No pick: still hidden while open; after the close, a game added
      // later that they never picked scores nothing.
      if (!pick) return [live && sideOpen(pot) ? { g, pick: null, cls: "hidden", txt: "?" } : { g, pick: null, cls: "miss", txt: "—" }];
      const out = [cell(g, pick, null, pointValue(g, pick.team, pick.mode), (sc) => scorePick(g, pick, sc))];
      // An over/under is settled at the final only: 0-0 is under every
      // total, so counting it live would hand everyone points at kickoff.
      if (g.total != null && pick.ou) out.push(resOf(g) ? cell(g, pick, pick.ou, SIDE_OU_PTS, (sc) => scoreOu(g, pick.ou, sc)) : { g, pick, ou: pick.ou, cls: "open", txt: String(SIDE_OU_PTS) });
      return out;
    });
    return { name, pts, fly, cells, paid: !!e.paid, tb: e.tb };
  });
  rows.sort((a, b) => b.pts + b.fly - (a.pts + a.fly) || b.pts - a.pts || a.name.localeCompare(b.name));
  return { rows, games, resOf, final: games.length > 0 && games.every((g) => resOf(g)) };
}
// The money once every pot game is final. Level on points goes to the
// tiebreaker (closest guess at the last game's total); still level splits.
// One entrant, or everyone level all the way, is no bet.
function sideOutcome(pot, st = sideStandings(pot)) {
  const n = st.rows.length, total = n * pot.buyIn;
  const out = { n, total, final: st.final, winners: [], losers: [], share: 0, net: 0 };
  if (!st.final || n < 2) return out;
  const top = Math.max(...st.rows.map((r) => r.pts));
  let lead = st.rows.filter((r) => r.pts === top);
  const tbG = pot.tbGame != null ? st.games.find((g) => String(g.id) === String(pot.tbGame)) : null;
  const tbRes = tbG ? (st.resOf || sideResultOf)(tbG) : null;
  if (lead.length > 1 && tbRes) {
    const actual = tbRes.awayScore + tbRes.homeScore;
    const off = (r) => (Number.isFinite(r.tb) ? Math.abs(r.tb - actual) : Infinity);
    const best = Math.min(...lead.map(off));
    if (Number.isFinite(best)) { lead = lead.filter((r) => off(r) === best); out.tiebreak = { actual, game: tbG }; }
  }
  out.winners = lead.map((r) => r.name);
  out.losers = st.rows.filter((r) => !out.winners.includes(r.name)).map((r) => r.name);
  if (!out.losers.length) return { ...out, push: true };
  out.share = total / out.winners.length;
  out.net = out.share - pot.buyIn; // what each winner collects from the others
  return out;
}
// The side bet scoreboard: a grid, one column per game (logos, where it
// stands), one row per player (tied places share a rank), each cell the
// team picked, spread or WIN, and what it pays, with the over/under under
// it. The total counts live points, labelled as such.
function sideBoardHtml(pot, st, out, me) {
  const esc = escapeCd;
  const games = st.games;
  const total = (r) => r.pts + r.fly;
  const rows = sideRowsInOrder(st, out);
  const rankOf = (r) => 1 + rows.filter((x) => total(x) > total(r)).length;
  const tied = (r) => rows.filter((x) => total(x) === total(r)).length > 1;
  const head = games.map((g) => {
    const l = sideLiveOf(g), fin = !!sideResultOf(g), on = l?.found && l.state === "in" && !l.completed;
    const where = fin ? "FINAL" : on ? `${l.awayScore}-${l.homeScore}` : g.half === 2 && sideRawOf(g)?.state === "in" ? "2H NEXT" : new Date(g.kickoff).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).replace(" ", "");
    const score = fin || on ? `<b>${l.awayScore}</b><i>-</i><b>${l.homeScore}</b>` : `<span>${where}</span>`;
    return `<div class="ssg-h${on ? " live" : fin ? " final" : ""}"><div class="ssg-bug"><img src="${logoUrl(g.awayId)}" alt="" onerror="this.style.visibility='hidden'"><div class="ssg-sc">${score}</div><img src="${logoUrl(g.homeId)}" alt="" onerror="this.style.visibility='hidden'"></div><div class="ssb-tag">${on ? `<u></u>${esc(shortStatus(l.detail || ""))}` : fin ? "FINAL" : sideTag(g)}${String(pot.tbGame) === String(g.id) ? " · ★TB" : ""}</div></div>`;
  }).join("");
  // A pick as a small card: the team's logo, the team in bold with the
  // bet under it, and a points badge coloured by how it stands; an
  // over/under gets its own line and badge.
  const badge = (c) => `<b class="ssp-pts ${c.cls}">${c.cls === "miss" ? "✕" : c.cls === "hit" || c.cls === "live-hit" ? `+${c.ou ? SIDE_OU_PTS : c.txt.replace("+", "")}` : c.cls === "live-miss" ? "0" : c.txt}</b>`;
  const abbr = (g, team) => { const l = sideRawOf(g); const a = team === g.home ? l?.homeAbbr : l?.awayAbbr; return a || (team === g.home ? g.homeShort : g.awayShort); };
  const cell = (r, g) => {
    const side = r.cells.find((c) => c.g.id === g.id && !c.ou), ou = r.cells.find((c) => c.g.id === g.id && c.ou);
    if (!side?.pick) return `<div class="ssp empty"><span>no pick</span></div>`;
    const p = side.pick, id = sideTeamId(g, p.team);
    const what = p.mode === "SU" ? "TO WIN" : `${p.team === g.favorite ? "-" : "+"}${g.spread}`;
    return `<div class="ssp ${side.cls}">
      <div class="ssp-main"><img src="${logoUrl(id)}" alt="" onerror="this.style.visibility='hidden'"><span class="ssp-t"><b>${esc(abbr(g, p.team))}</b><small>${what}</small></span>${badge(side)}</div>
      ${g.total != null ? `<div class="ssp-ou ${ou?.cls || "none"}"><span>${ou ? `${ou.ou === "over" ? "O" : "U"} ${g.total}` : "no O/U"}</span>${ou ? badge(ou) : ""}</div>` : ""}
    </div>`;
  };
  // A player's line (place, name, guess, total), then their picks in a row
  // of equal columns lined up under the game headers.
  // The most a player can still reach: everything not already lost.
  const reach = (r) => r.cells.reduce((t, c) => t + (c.pick && c.cls !== "miss" ? (c.ou ? SIDE_OU_PTS : pointValue(c.g, c.pick.team, c.pick.mode)) : 0), 0);
  const scale = Math.max(1, ...rows.map(reach));
  const body = rows.map((r) => { const rk = rankOf(r), lead = rk === 1 && total(r) > 0; return `<div class="ssg-row${r.name === me ? " me" : ""}${out.winners.includes(r.name) || (!out.final && lead) ? " lead" : ""} rk${Math.min(rk, 4)}">
      <div class="ssg-who"><i class="ssg-rk">${tied(r) ? "T" : ""}${rk}</i><span class="ssg-av" style="--accent:${accentFor(r.name)}">${esc(avatarOverrides[r.name] || shown(r.name)[0])}</span><span class="ssg-nm">${esc(shown(r.name))}${out.winners.includes(r.name) ? " 🏆" : ""}</span>${Number.isFinite(r.tb) ? `<small>TB ${r.tb}</small>` : ""}<b>${total(r)}<em>${out.final ? "final" : !r.fly ? "" : r.pts ? `${r.pts} locked` : "live"}</em></b></div>
      <div class="ssg-race" title="${total(r)} now, ${reach(r)} still possible"><i class="can" style="width:${((reach(r) / scale) * 100).toFixed(1)}%"></i><i class="has" style="width:${((total(r) / scale) * 100).toFixed(1)}%"></i></div>
      <div class="ssg-cells">${games.map((g) => cell(r, g)).join("")}</div>
    </div>`; }).join("");
  return `<div class="ss-sec">SCOREBOARD${out.final ? " · FINAL" : ""}</div>
    <div class="ssg-wrap"><div class="ssg" style="--n:${games.length}"><div class="ssg-heads">${head}</div>${body}</div></div>
    <div class="ss-note">The bar: points now, and how far each player can still get. ✓ paid, ✕ lost, glowing is live.${pot.tbGame != null ? " ★TB is the tiebreaker game." : ""}</div>`;
}
// Winners first (a tiebreaker can put the winner level with someone above).
const sideRowsInOrder = (st, out) => [...st.rows].sort((a, b) => out.winners.includes(b.name) - out.winners.includes(a.name) || b.pts + b.fly - (a.pts + a.fly) || b.pts - a.pts || a.name.localeCompare(b.name));
function sideTeamId(g, team) { return team === g.home ? g.homeId : team === g.away ? g.awayId : null; }
// One pick in a standings row: the team's logo and ATS/SU, or OVR/UND.
function sideCellHtml(c) {
  if (c.ou) return `<span class="sp-c ou ${c.cls}" title="${c.ou} ${c.g.total}"><i>${c.ou === "over" ? "OVR" : "UND"}</i><b>${c.txt}</b></span>`;
  const id = c.pick ? sideTeamId(c.g, c.pick.team) : null;
  return `<span class="sp-c ${c.cls}">${id ? `<img src="${logoUrl(id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : ""}<i>${c.pick ? c.pick.mode : ""}</i><b>${c.txt}</b></span>`;
}
const SIDE_STANDALONE = true;
// Once every side game is final, this phone hands the finals to the
// Worker, which files the bet in the season's side bet record (apart from
// the pool's). Once per bet per phone, unless the Worker had a gap.
const sideFinalsSent = new Set();
let sideHistory = null, sideHistoryAt = 0;
function postSideFinals(pot) {
  if (!pot || sideOpen(pot) || sideFinalsSent.has(pot.id) || !WORKER_URL) return;
  const games = sideGames(pot);
  if (!games.length || games.every((g) => pot.finals?.[g.id])) return;
  const finals = Object.fromEntries(games.map((g) => [g.id, sideResultOf(g)]).filter(([, r]) => r));
  if (Object.keys(finals).length < games.length) return;
  sideFinalsSent.add(pot.id);
  fetch(`${WORKER_URL}/side`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finals", week: pot.week, potId: pot.id, finals }) })
    .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.ok) { pot.finals = { ...(pot.finals || {}), ...finals }; sideHistory = null; } else sideFinalsSent.delete(pot.id); })
    .catch(() => sideFinalsSent.delete(pot.id));
}
function renderSidePot() {
  const el = document.getElementById("side-pot");
  if (!el) return;
  const pot = potNow();
  const names = pot ? Object.keys(pot.entrants || {}) : [];
  try { postSideFinals(pot); } catch {}
  updateSideNav();
  renderSideScreen();
  // The side bet has its own tab now and stays off the pool's board.
  if (SIDE_STANDALONE || !pot || !currentManager || window.LEAGUE?.sport === "nfl" || (!sideOpen(pot) && !names.length)) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const me = currentManager, mine = pot.entrants[me];
  const total = names.length * pot.buyIn;
  const games = sideGames(pot);
  let body;
  if (sideOpen(pot)) {
    const cd = kickoffCountdown(new Date(pot.closesAt).toISOString());
    body = `<div class="sp-head"><span class="sp-kick">💰 LATE NIGHT SIDE POT</span><span class="sp-pot">${sideMoney(total)}</span></div>
      <div class="sp-games">${games.map((g) => `<span>${escapeCd(g.awayShort)} @ ${escapeCd(g.homeShort)}</span>`).join("")}</div>
      <div class="sp-in">${names.length ? `<b>${names.length} IN</b> ${names.map((n) => escapeCd(shown(n))).join(" · ")}` : "Nobody's in yet."}</div>
      <div class="sp-foot"><span class="sp-close">$${pot.buyIn} to get in · closes in <b data-sp-cd>${cd && !cd.past ? cd.text : "now"}</b></span>
        <button type="button" class="sp-btn${mine && !sideNeedsPicks(pot, me) ? " in" : ""}" data-sp="open">${sideNeedsPicks(pot, me) ? "NEW GAMES · FINISH PICKS" : mine ? "✓ YOU'RE IN · EDIT" : `I'M IN · $${pot.buyIn}`}</button></div>`;
  } else {
    const st = sideStandings(pot), out = sideOutcome(pot, st);
    const head = !out.final ? `${names.length} IN · ${sideMoney(total)} POT`
      : out.n < 2 ? "ONE TAKER · NO BET"
      : out.push ? "DEAD HEAT · NO MONEY MOVES"
      : out.winners.length > 1 ? `${escapeCd(sideNames(out.winners).toUpperCase())} SPLIT ${sideMoney(out.total)}`
      : `🏆 ${escapeCd(shown(out.winners[0]).toUpperCase())} TAKES ${sideMoney(out.total)}${out.tiebreak ? " ON THE TIEBREAKER" : ""}`;
    const rows = sideRowsInOrder(st, out).map((r) => `<div class="sp-row${r.name === me ? " me" : ""}${out.winners.includes(r.name) ? " win" : ""}">
      <span class="sp-nm">${escapeCd(shown(r.name))}${Number.isFinite(r.tb) ? `<small class="sp-tb">TB ${r.tb}</small>` : ""}</span>
      <span class="sp-cells">${r.cells.map(sideCellHtml).join("")}</span>
      <span class="sp-pts">${r.pts}${r.fly ? `<small>+${r.fly}</small>` : ""}</span></div>`).join("");
    // Who settles with whom, once it is over: each loser owes the buy-in,
    // each winner collects their share of it.
    const ledger = out.final && out.n >= 2 && !out.push
      ? `<div class="sp-ledger"><span>${out.losers.map((n) => `${escapeCd(shown(n))}${pot.entrants[n]?.paid ? " (paid)" : ""}`).join(", ")} owe${out.losers.length === 1 ? "s" : ""} ${sideMoney(pot.buyIn)}${out.losers.length === 1 ? "" : " each"}</span><span>${escapeCd(sideNames(out.winners))} collect${out.winners.length === 1 ? "s" : ""} ${sideMoney(out.net)}${out.winners.length === 1 ? "" : " each"}</span></div>` : "";
    body = `<div class="sp-head"><span class="sp-kick">💰 SIDE POT</span><span class="sp-pot sm">${head}</span></div>
      <div class="sp-board">${rows}</div>${ledger}`;
  }
  el.innerHTML = `<div class="sp-card${sideOpen(pot) ? " open" : ""}">${body}</div>`;
  el.classList.remove("hidden");
}
document.getElementById("side-pot")?.addEventListener("click", (e) => {
  if (e.target.closest("[data-sp='open']")) return openSideSheet(false);
  if (sideIn()) showSideScreen();
});
// The countdown on the card ticks; at the close the card turns into the
// leaderboard with everyone's picks.
setInterval(() => {
  const pot = potNow();
  if (!pot || document.hidden) return;
  const c = kickoffCountdown(new Date(pot.closesAt).toISOString());
  document.querySelectorAll("[data-sp-cd]").forEach((cd) => { cd.textContent = c && !c.past ? c.text : "now"; });
  if (pot.open && Date.now() >= pot.closesAt) { pot.open = false; document.getElementById("side-modal")?.remove(); fetchSidePot(true).then(renderSidePot); }
}, 1000);

// Asked once, on the board, when it opens. Not over another pop-up: if one
// is up, the next refresh asks again.
function maybeShowSidePrompt() {
  const pot = potNow();
  if (sidePromptShown || !sideOpen(pot) || !currentManager || window.__adminEntry || window.__adminOpen || window.__liveView) return;
  const owes = sideNeedsPicks(pot, currentManager);
  if (!owes && (pot.entrants[currentManager] || pot.declined.includes(currentManager))) return;
  try { if (!owes && localStorage.getItem(sideDoneKey(pot, currentManager))) return; } catch {}
  const busy = () => scoreboardScreen.classList.contains("hidden") || [...document.querySelectorAll(".modal-overlay, .wpx-overlay, .pr-screen, .np-screen")].some((el) => !el.classList.contains("hidden") && getComputedStyle(el).display !== "none");
  if (busy()) return;
  sidePromptShown = true;
  setTimeout(() => { if (busy()) { sidePromptShown = false; return; } openSideSheet(true); }, 1500);
}

// A group text for the side bet, from the console. Final: who won, who
// owes whom (unpaid only), with a Venmo pay link per winner, amount and
// note filled in; a split divides each share between the winners. Before
// that: who is in. Venmo handles are asked for once and kept on this
// device. Shared through the phone's share sheet, else copied.
const VENMO_KEY = "brochiefs_venmo_handles";
function venmoHandle(name) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(VENMO_KEY) || "{}") || {}; } catch {}
  if (all[name]) return all[name];
  const h = (window.prompt(`${shown(name)}'s Venmo username (for the pay link)? Leave blank to skip.`) || "").trim().replace(/^@/, "");
  if (h) { all[name] = h; try { localStorage.setItem(VENMO_KEY, JSON.stringify(all)); } catch {} }
  return h;
}
async function sideVenmoText(pot, out, say) {
  const money = (x) => `$${Number.isInteger(x) ? x : x.toFixed(2)}`;
  const games = sideGames(pot).map((g) => sideMatch(g)).join(", ");
  const ins = Object.keys(pot.entrants || {});
  let text;
  if (!out.final) {
    text = `💰 Late night side bet: ${money(pot.buyIn)} each, ${ins.length} in (${ins.map(shown).join(", ")}). Games: ${games}. Pot ${money(ins.length * pot.buyIn)}. Settle up after the last game.`;
  } else if (out.n < 2 || out.push) {
    text = `💰 Late night side bet is final: ${out.n < 2 ? "only one taker" : "dead heat"}, so no money moves.`;
  } else {
    const share = pot.buyIn / out.winners.length;
    const owing = out.losers.filter((n) => !pot.entrants[n]?.paid);
    const note = encodeURIComponent(`Brochiefs side bet wk${pot.week}`);
    const pay = out.winners.map((w) => { const h = venmoHandle(w); return `Pay ${shown(w)} ${money(share)}${h ? `: https://venmo.com/${encodeURIComponent(h)}?txn=pay&amount=${share}&note=${note}` : ""}`; });
    text = [`💰 Late night side bet is final. 🏆 ${sideNames(out.winners)} ${out.winners.length > 1 ? "split" : "takes"} ${money(out.total)}${out.tiebreak ? ` (tiebreaker, total ${out.tiebreak.actual})` : ""}.`,
      owing.length ? `${owing.map(shown).join(", ")}: please pay ${out.winners.length > 1 ? "each winner " : ""}${money(share)}${out.winners.length > 1 ? ` (${money(pot.buyIn)} total)` : ""} on Venmo.` : "Everyone has paid. Thanks!",
      ...(owing.length ? pay : [])].join("\n");
  }
  try {
    if (navigator.share) { await navigator.share({ text }); say("Shared.", "ok"); return; }
  } catch (e) { if (e?.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); say("Venmo text copied. Paste it in the group chat.", "ok"); }
  catch { window.prompt("Copy this text:", text); }
}

// The side pot's admin panel, mounted by the app owner's console (Side bet
// tab) and the slate editor alike. Pick games, at the slate's lines, that
// are not over (still to come, or on now with the score shown), and a buy-in; once running, it
// shows who is in (never their picks before the close), who said no, who
// has paid, and the result. getKey resolves the admin key; say reports.
const SIDE_LIVE_MS = 5 * 3600000; // matches LIVE_MS in worker/src/side.js
const SIDE_MAX_PICKS = 8;          // matches SIDE_MAX_GAMES there
async function mountSideAdmin(box, getKey, say) {
  if (!box) return;
  const esc = escapeCd;
  const post = async (body) => {
    const key = await getKey();
    if (!key) throw new Error("The admin key is missing.");
    const res = await fetch(`${WORKER_URL}/side?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week: currentWeek, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `Failed (${res.status})`); e.status = res.status; throw e; }
    return data;
  };
  const refreshApp = () => fetchSidePot(true).then(renderSidePot);
  const etTime = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
  // Every game today that is not over, from ESPN (FBS and FCS), one row
  // each, with what can be bet on it: the full game at its line (a pool
  // game at the pool's line), the 1st half before kickoff, the 2nd half
  // until halftime ends. A half's line starts at half the game's line and
  // is the commissioner's to set; a game with no line on ESPN can still go
  // in by its halves.
  let cands = [];
  const poolTotals = new Map();
  const readEspn = async () => {
    cands = []; poolTotals.clear();
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).replace(/-/g, "");
    // ESPN's line for one game from its game page, which keeps a line
    // after kickoff when the scoreboard has dropped it.
    const pageLine = (eventId) => fetchCapped(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${eventId}`, { cache: "no-store" }, 6000)
      .then((r) => (r.ok ? r.json() : null)).then((d) => (Array.isArray(d?.pickcenter) ? d.pickcenter[0] : null)).catch(() => null);
    const hasLine = (o) => Number.isFinite(Number(o?.spread)) && Number(o.spread) !== 0;
    try {
      const boards = await Promise.all([80, 81].map((grp) => fetchCapped(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${day}&groups=${grp}&limit=300&t=${Date.now()}`, { cache: "no-store" }, 8000).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
      const seen = new Set();
      const events = boards.flatMap((b, i) => (b?.events || []).map((ev) => ({ ev, fcs: i === 1 }))).filter(({ ev }) => !seen.has(ev.id) && seen.add(ev.id))
        .filter(({ ev }) => { const c = ev.competitions?.[0] || {}; const st = c.status?.type || ev.status?.type || {}; return !st.completed && st.state !== "post"; });
      const lined = new Map(await Promise.all(events.filter(({ ev }) => !hasLine((ev.competitions?.[0]?.odds || [])[0])).map(async ({ ev }) => [ev.id, await pageLine(ev.id)])));
      await Promise.all(GAMES.map(async (g) => {
        const l = latestLive[g.id];
        if (Number.isFinite(l?.odds?.overUnder)) { poolTotals.set(g.id, l.odds.overUnder); return; }
        if (l?.eventId) { const pc = await pageLine(l.eventId); if (Number.isFinite(Number(pc?.overUnder))) poolTotals.set(g.id, Number(pc.overUnder)); }
      }));
      for (const { ev, fcs } of events) {
        const c = ev.competitions?.[0] || {};
        const away = (c.competitors || []).find((x) => x.homeAway === "away"), home = (c.competitors || []).find((x) => x.homeAway === "home");
        if (!away || !home) continue;
        const st = c.status?.type || ev.status?.type || {};
        const aId = Number(away.team?.id), hId = Number(home.team?.id);
        const pool = GAMES.find((g) => g.awayId === aId && g.homeId === hId) || null;
        const so = (c.odds || [])[0], src = hasLine(so) ? so : lined.get(ev.id);
        const raw = Number(src?.spread);
        const full = pool ? { favHome: pool.favorite === pool.home, spread: Number(pool.spread), total: poolTotals.get(pool.id) ?? null }
          : hasLine(src) ? { favHome: src.homeTeamOdds?.favorite ? true : src.awayTeamOdds?.favorite ? false : raw < 0, spread: Math.abs(raw), total: Number(src.overUnder) > 0 ? Number(src.overUnder) : null } : null;
        cands.push({
          eventId: ev.id, away: away.team?.displayName || "", home: home.team?.displayName || "",
          awayShort: away.team?.shortDisplayName || away.team?.abbreviation || "", homeShort: home.team?.shortDisplayName || home.team?.abbreviation || "",
          awayId: aId, homeId: hId, kickoff: ev.date, kickoffLabel: `${etTime(new Date(ev.date).getTime()).replace(",", "")} ET`, fcs, pool,
          state: st.state || "pre", period: Number(c.status?.period) || 0, full,
          on: st.state === "in" ? { detail: st.shortDetail || "", a: away.score, h: home.score } : null,
        });
      }
    } catch {}
    // ESPN out of reach: the pool's own games still in play, full game only.
    if (!cands.length) for (const g of gamesByKickoff()) {
      const l = latestLive[g.id];
      if (l?.completed || Date.now() >= new Date(g.kickoff).getTime() + SIDE_LIVE_MS) continue;
      cands.push({ eventId: l?.eventId || null, away: g.away, home: g.home, awayShort: g.awayShort, homeShort: g.homeShort, awayId: g.awayId, homeId: g.homeId, kickoff: g.kickoff, kickoffLabel: g.kickoffLabel, fcs: false, pool: g, state: l?.state || "pre", period: Number(l?.period) || 0, full: { favHome: g.favorite === g.home, spread: Number(g.spread), total: null }, on: null, noHalves: true });
    }
    cands.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  };
  const load = async () => {
    const key = await getKey();
    if (!key) return;
    box.classList.remove("hidden");
    box.textContent = "Loading the side pot…";
    try {
      const [res] = await Promise.all([fetch(`${WORKER_URL}/side?week=${currentWeek}&key=${encodeURIComponent(key)}&t=${Date.now()}`, { cache: "no-store" }), fetchLiveScores().catch(() => {}), readEspn()]);
      if (!res.ok) throw new Error(String(res.status));
      render((await res.json()).pot);
    } catch (e) { box.textContent = `Could not load the side pot (${e.message}).`; }
  };
  // render(pot, true) is the selector again, adding to a running bet.
  const render = (pot, adding = false) => {
    const now = Date.now();
    if (!pot || adding) {
      const inBet = new Set(adding ? pot.games.map(String) : []);
      const betGames = adding ? sideGames(pot) : [];
      // The bet's options: a value per box. A pool game's full game is its
      // number (the Worker keeps the pool's line), any other full game "e",
      // a 1st half "f", a 2nd half "h", each plus the ESPN event id.
      const fullVal = (c) => (c.pool ? String(c.pool.id) : `e${c.eventId}`);
      const halfLine = (c) => ({ favHome: c.full ? c.full.favHome : true, spread: c.full ? Math.round(c.full.spread) / 2 : "", total: c.full?.total ? Math.round(c.full.total) / 2 : "" });
      const lineText = (c) => (c.full ? `${c.full.favHome ? esc(c.homeShort) : esc(c.awayShort)} -${c.full.spread}${c.full.total != null ? ` · O/U ${c.full.total}` : ""}` : "No line on ESPN: halves only, at your line");
      const status = (c) => (c.on ? `<b class="as-live">${esc(shortStatus(c.on.detail))} · ${esc(c.on.a ?? 0)}-${esc(c.on.h ?? 0)}</b>` : esc(c.kickoffLabel));
      // An over/under only when asked for: each pick has its own O/U chip,
      // shown once the pick is checked. A pick already in the bet shows its
      // chip as it stands, so an over/under can be taken off or put on.
      const betOf = (v) => betGames.find((g) => String(g.id) === v);
      const ouChip = (v, total, on) => (total == null && !/^[fh]/.test(v) ? "" : `<label class="as-opt ou${inBet.has(v) ? "" : " hidden"}" data-ou-for="${esc(v)}"><input type="checkbox" class="as-ou" value="${esc(v)}"${on ? " checked" : ""}><span>+ O/U${total != null ? ` ${total}` : ""}</span></label>`);
      const opt = (v, label, total) => (inBet.has(v)
        ? `<span class="as-opt in"><span>${label} ✓</span></span>${ouChip(v, betOf(v)?.total ?? total, betOf(v)?.total != null)}`
        : `<label class="as-opt"><input type="checkbox" value="${esc(v)}"><span>${label}</span></label>${ouChip(v, total, false)}`);
      const edit = (c, v, label) => { const h = halfLine(c); return `<div class="as-h-edit hidden" data-for="${esc(v)}"><span>${label}</span><select aria-label="${label} favorite"><option value="away"${h.favHome ? "" : " selected"}>${esc(c.awayShort)}</option><option value="home"${h.favHome ? " selected" : ""}>${esc(c.homeShort)}</option></select><span>-</span><input class="as-h-sp" type="number" inputmode="decimal" step="0.5" min="0" max="40" placeholder="line" value="${h.spread}"><span class="as-ou-in hidden">O/U</span><input class="as-h-tot as-ou-in hidden" type="number" inputmode="decimal" step="0.5" min="10" max="90" placeholder="total" value="${h.total}"></div>`; };
      const rows = cands.map((c) => {
        const pre = c.state === "pre", firstOk = pre && c.eventId && !c.noHalves, secondOk = (pre || c.period <= 2) && c.eventId && !c.noHalves;
        if (!c.full && !firstOk && !secondOk) return "";
        return `<div class="as-g">
          <div class="as-g-top"><span class="as-g-nm">${c.pool ? `G${c.pool.id} · ` : ""}${esc(c.awayShort)} @ ${esc(c.homeShort)}${c.fcs ? ` <small>FCS</small>` : ""}</span><small>${status(c)}</small></div>
          <div class="as-g-line">${lineText(c)}</div>
          <div class="as-g-opts">${c.full ? opt(fullVal(c), "FULL GAME", c.full.total ?? (c.pool ? poolTotals.get(c.pool.id) : null) ?? null) : ""}${firstOk ? opt(`f${c.eventId}`, "1ST HALF", null) : ""}${secondOk ? opt(`h${c.eventId}`, "2ND HALF", null) : ""}</div>
          ${firstOk ? edit(c, `f${c.eventId}`, "1H") : ""}${secondOk ? edit(c, `h${c.eventId}`, "2H") : ""}
        </div>`;
      }).join("");
      box.innerHTML = `${adding ? `<div class="as-lead"><b>Add to the Week ${pot.week} side bet.</b> Everyone in stays in and gets asked for picks on what you add; anyone who doesn't make them scores 0 there. In the bet now: ${betGames.map((g) => esc(`${sideTag(g)} ${sideMatch(g)}`)).join(", ")}.</div>` : ""}<div class="as-lead${adding ? " hidden" : ""}"><b>Week ${currentWeek} side bet.</b> Every game today not over, FBS and FCS. Check any mix of full games and halves, up to ${SIDE_MAX_PICKS}. Full games use the pool's line or ESPN's; a half starts at half the game's line, so set it from your book. Tick + O/U on any pick to add its over/under, and choose a tiebreaker if you want one: closest guess at that game's total points wins a tie.</div>
        ${rows ? `<div class="as-gl">${rows}</div>` : `<div class="as-none">Every game today is over.</div>`}
        <div class="as-count"></div>
        <label class="as-buy as-tbrow">Tiebreaker: <select class="as-tb"><option value="none">none (a tie splits)</option></select></label>
        <label class="as-buy">Entry closes in <input class="as-close" type="number" inputmode="numeric" min="5" max="480" step="1" placeholder="auto"> min</label>
        <div class="as-out">Blank: picks lock at the first kickoff (20 minutes from now if every game is already on). For a 2nd half at halftime, about 15.</div>
        <label class="as-buy${adding ? " hidden" : ""}">Buy-in $<input class="as-buyin" type="number" inputmode="numeric" min="1" max="500" step="1" value="${adding ? pot.buyIn : 25}"></label>
        <button type="button" class="admin-btn primary wide as-start"${rows ? "" : " disabled"}>${adding ? "Add to side bet" : "Start side bet"}</button>
        ${adding ? `<button type="button" class="admin-btn wide as-back">Back</button>` : ""}`;
      box.querySelector(".as-back")?.addEventListener("click", () => render(pot));
      const candOf = (v) => cands.find((c) => fullVal(c) === v || `f${c.eventId}` === v || `h${c.eventId}` === v);
      const nameOf = (v) => { const b = betGames.find((g) => String(g.id) === v); if (b) return sideMatch(b); const c = candOf(v); return c ? `${c.awayShort} @ ${c.homeShort}${v[0] === "f" ? " (1st half)" : v[0] === "h" ? " (2nd half)" : ""}` : v; };
      const checked = () => [...box.querySelectorAll(".as-g-opts input:checked:not(.as-ou)")].map((i) => i.value);
      const ouOn = (v) => !!box.querySelector(`.as-ou[value="${v}"]:checked`);
      // Checking a half opens its line; the tiebreaker offers what is checked.
      const sync = () => {
        const on = checked();
        box.querySelectorAll(".as-h-edit").forEach((el) => { el.classList.toggle("hidden", !on.includes(el.dataset.for)); el.querySelectorAll(".as-ou-in").forEach((x) => x.classList.toggle("hidden", !ouOn(el.dataset.for))); });
        box.querySelectorAll(".as-opt.ou").forEach((el) => { if (!inBet.has(el.dataset.ouFor)) el.classList.toggle("hidden", !on.includes(el.dataset.ouFor)); });
        const sel = box.querySelector(".as-tb");
        const was = sel.dataset.ready ? sel.value : adding && pot.tbGame != null ? String(pot.tbGame) : "none";
        sel.dataset.ready = "1";
        sel.innerHTML = `<option value="none">none (a tie splits)</option>` + [...inBet, ...on].map((v) => `<option value="${esc(v)}"${v === was ? " selected" : ""}>${esc(nameOf(v))}</option>`).join("");
        const n = box.querySelector(".as-count"), total = inBet.size + on.length;
        n.textContent = on.length ? `${total} of ${SIDE_MAX_PICKS} picked` : "";
        n.classList.toggle("bad", total > SIDE_MAX_PICKS);
      };
      box.addEventListener("change", (e) => { if (e.target.matches(".as-g-opts input")) sync(); });
      sync();
      box.querySelector(".as-start")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        const ids = [];
        for (const v of checked()) {
          const c = candOf(v);
          if (!c) continue;
          if (/^\d+$/.test(v)) { ids.push({ id: Number(v), ...(ouOn(v) ? { total: poolTotals.get(Number(v)) ?? c.full?.total ?? undefined } : {}) }); continue; }
          const base = { away: c.away, home: c.home, awayShort: c.awayShort, homeShort: c.homeShort, awayId: c.awayId, homeId: c.homeId, kickoff: c.kickoff };
          if (v[0] === "e") { ids.push({ id: v, ...base, favorite: c.full.favHome ? c.home : c.away, spread: c.full.spread, ...(c.full.total != null && ouOn(v) ? { total: c.full.total } : {}), kickoffLabel: c.kickoffLabel }); continue; }
          const row = box.querySelector(`.as-h-edit[data-for="${v}"]`);
          const sp = Number(row.querySelector(".as-h-sp").value), tot = row.querySelector(".as-h-tot").value.trim();
          const which = v[0] === "f" ? "1st half" : "2nd half";
          if (row.querySelector(".as-h-sp").value.trim() === "" || !Number.isFinite(sp) || sp < 0 || Math.round(sp * 2) !== sp * 2) { say(`Set the ${which} line (whole or half point) for ${c.awayShort} @ ${c.homeShort}.`, "bad"); return; }
          const favHome = row.querySelector("select").value === "home";
          if (ouOn(v) && !(tot !== "" && Number(tot) > 0)) { say(`Set the ${which} over/under for ${c.awayShort} @ ${c.homeShort}, or untick + O/U.`, "bad"); return; }
          ids.push({ id: v, ...base, favorite: favHome ? c.home : c.away, spread: sp, ...(ouOn(v) ? { total: Number(tot) } : {}), kickoffLabel: v[0] === "f" ? c.kickoffLabel : "after halftime" });
        }
        // Picks already in the bet whose over/under was ticked on or off.
        if (adding) for (const v of inBet) {
          const g = betOf(v), had = g?.total != null, want = ouOn(v);
          if (!g || had === want || !box.querySelector(`.as-ou[value="${v}"]`)) continue;
          const c = candOf(v), total = want ? (g.total ?? c?.full?.total ?? (/^\d+$/.test(v) ? poolTotals.get(Number(v)) : null)) : null;
          if (want && total == null) { say(`No over/under is known for ${sideMatch(g)}.`, "bad"); return; }
          if (/^\d+$/.test(v)) { ids.push({ id: Number(v), ...(want ? { total } : {}) }); continue; }
          const { total: _t, eventId, half, ...rest } = g;
          ids.push({ ...rest, ...(want ? { total } : {}) });
        }
        if (!ids.length && !adding) { say("Pick at least one game or half for the side bet.", "bad"); return; }
        if (ids.filter((x) => !inBet.has(String(x.id))).length + inBet.size > SIDE_MAX_PICKS) { say(`${SIDE_MAX_PICKS} picks at most in a bet.`, "bad"); return; }
        const buyIn = Number(box.querySelector(".as-buyin").value);
        const closeMin = Number(box.querySelector(".as-close")?.value);
        const closeAt = Number.isFinite(closeMin) && closeMin >= 5 ? Date.now() + closeMin * 60000 : null;
        const tbPick = box.querySelector(".as-tb")?.value || "none";
        const tbGame = tbPick === "none" ? "none" : /^\d+$/.test(tbPick) ? Number(tbPick) : tbPick;
        btn.disabled = true;
        if (adding) {
          try {
            const d = await post({ action: "edit", games: ids, closeAt, tbGame });
            say(ids.length ? "Added. Everyone in gets asked for picks on the new games." : "Saved.", "ok");
            render(d.pot); refreshApp();
          } catch (e) { say(`Not added: ${e.message}`, "bad"); btn.disabled = false; }
          return;
        }
        try {
          let d;
          try { d = await post({ action: "start", games: ids, buyIn, closeAt, tbGame }); }
          catch (e) {
            if (e.status !== 409 || !confirm("A side bet with players in it is already running. Replace it? Everyone in it is out.")) throw e;
            d = await post({ action: "start", games: ids, buyIn, closeAt, tbGame, replace: true });
          }
          say("Side bet is live. Everyone gets asked when they open the board.", "ok");
          render(d.pot);
          refreshApp();
        } catch (e) { say(`Side bet not started: ${e.message}`, "bad"); btn.disabled = false; }
      });
      return;
    }
    const open = now < pot.closesAt;
    const ins = Object.keys(pot.entrants || {});
    const st = sideStandings(pot), out = sideOutcome(pot, st);
    const net = Number.isInteger(out.net) ? out.net : out.net.toFixed(2);
    const result = !open && out.final ? (out.n < 2 ? "One taker, no bet." : out.push ? "Dead heat, no money moves." : `${out.winners.map(shown).join(" and ")} ${out.winners.length > 1 ? "split" : "takes"} $${out.total}${out.tiebreak ? ` on the tiebreaker (total ${out.tiebreak.actual})` : ""}, collecting $${net}${out.winners.length > 1 ? " each" : ""} from the others.`) : "";
    const owes = (n) => !open && out.final && out.losers.includes(n);
    const won = (n) => !open && out.final && !out.push && out.winners.includes(n);
    box.innerHTML = `<div class="as-lead"><b>Week ${pot.week} side bet</b> · $${pot.buyIn} · ${ins.length} in · $${ins.length * pot.buyIn} pot<br>${open ? `Entry closes ${esc(etTime(pot.closesAt))} ET` : `Closed ${esc(etTime(pot.closesAt))} ET`}</div>
      <div class="as-list">${sideGames(pot).map((g) => `<span>${sideTag(g)} ${esc(g.awayShort)} @ ${esc(g.homeShort)}</span>`).join("")}</div>
      ${(() => { const g = pot.tbGame != null ? sideGames(pot).find((x) => String(x.id) === String(pot.tbGame)) : null; return g ? `<div class="as-out">Tiebreaker: total points in ${esc(sideMatch(g))}${out.tiebreak ? `, final ${out.tiebreak.actual}` : ""}. Closest guess wins a tie on points.</div>` : `<div class="as-out">No tiebreaker on this bet: a tie splits.</div>`; })()}
      ${result ? `<div class="as-result">${esc(result)}</div>` : ""}
      <div class="as-people">${ins.length ? ins.map((n) => `<label class="as-person${owes(n) ? " owes" : ""}"><span>${esc(shown(n))}${!open && Number.isFinite(pot.entrants[n].tb) ? ` <small class="as-tbg">guess ${pot.entrants[n].tb}</small>` : ""}${owes(n) ? ` <small>owes $${pot.buyIn}</small>` : ""}</span>${won(n) ? `<span class="as-won">collects</span>` : `<span class="as-paid"><input type="checkbox" data-paid="${esc(n)}"${pot.entrants[n].paid ? " checked" : ""}> paid</span>`}</label>`).join("") : `<div class="as-none">Nobody in yet.</div>`}</div>
      ${pot.declined?.length ? `<div class="as-out">No thanks: ${pot.declined.map((n) => esc(shown(n))).join(", ")}</div>` : ""}
      ${open ? `<button type="button" class="admin-btn primary wide as-add">＋ Add games or set the tiebreaker</button>` : ""}
      ${ins.length ? `<button type="button" class="admin-btn wide as-venmo">📲 Venmo text${out.final ? "" : " (who's in)"}</button>` : ""}
      <div class="as-btns"><button type="button" class="admin-btn as-refresh">↻ Refresh</button><button type="button" class="admin-btn as-cancel">Cancel side bet</button></div>`;
    box.querySelector(".as-add")?.addEventListener("click", () => render(pot, true));
    box.querySelector(".as-venmo")?.addEventListener("click", () => sideVenmoText(pot, out, say));
    box.querySelectorAll("[data-paid]").forEach((cb) => cb.addEventListener("change", async () => {
      try { render((await post({ action: "paid", manager: cb.dataset.paid, paid: cb.checked })).pot); }
      catch (e) { cb.checked = !cb.checked; say(`Not saved: ${e.message}`, "bad"); }
    }));
    box.querySelector(".as-refresh").addEventListener("click", load);
    box.querySelector(".as-cancel").addEventListener("click", async () => {
      if (!confirm(ins.length ? `Cancel the side bet? ${ins.length} ${ins.length === 1 ? "player is" : "players are"} in.` : "Cancel the side bet?")) return;
      try { await post({ action: "cancel" }); say("Side bet cancelled.", "ok"); render(null); refreshApp(); }
      catch (e) { say(`Not cancelled: ${e.message}`, "bad"); }
    });
  };
  await load();
}

// One sheet to say yes and pick: the pot's games, a team and ATS or straight
// up for each, the same points as the main pool.
function openSideSheet(asked) {
  const pot = potNow();
  if (!sideOpen(pot) || !currentManager) return;
  noteUse(asked ? "side-ask" : "side-open");
  const me = currentManager;
  const was = pot.entrants[me]?.picks || {};
  const draft = Object.fromEntries(Object.entries(was).map(([k, v]) => [k, { ...v }]));
  const games = sideGames(pot);
  // The tiebreaker: a guess at the last game's total points. Kept outside
  // the redraw so typing is never lost to a tap elsewhere.
  const tbG = pot.tbGame != null ? games.find((g) => String(g.id) === String(pot.tbGame)) : null;
  let draftTb = pot.entrants[me]?.tb ?? "";
  const tbOk = () => !tbG || (/^\d{1,3}$/.test(String(draftTb).trim()) && Number(draftTb) <= 200);
  const isReady = () => games.every((g) => draft[g.id]?.team && draft[g.id]?.mode && (g.total == null || draft[g.id]?.ou)) && tbOk();
  document.getElementById("side-modal")?.remove();
  const m = document.createElement("div");
  m.id = "side-modal"; m.className = "wpx-overlay"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "Late night side pot");
  document.body.appendChild(m);
  let busy = false, err = "";
  const close = () => m.remove();
  // One compact row per team: logo, name, line. The side is chosen by
  // tapping a team; ATS or straight up, and over or under, are segmented
  // switches under it.
  const team = (g, t, id, short) => {
    const p = draft[g.id];
    return `<button type="button" class="sp-team${p?.team === t ? " on" : ""}" data-g="${g.id}" data-team="${escapeCd(t)}"><img src="${logoUrl(id)}" alt="" onerror="this.style.visibility='hidden'"><span>${escapeCd(short)}</span><small>${t === g.favorite ? "-" : "+"}${g.spread}</small></button>`;
  };
  const mode = (g, md) => {
    const p = draft[g.id];
    const pts = md === "ATS" ? "2" : p?.team ? String(pointValue(g, p.team, md)) : "1 or 3";
    return `<button type="button" class="sp-seg${(p?.mode || "ATS") === md && p?.team ? " on" : ""}" data-g="${g.id}" data-mode="${md}">${md === "ATS" ? "SPREAD" : "TO WIN"}<small>${pts} PT${pts === "1" ? "" : "S"}</small></button>`;
  };
  const ou = (g, v) => `<button type="button" class="sp-seg${draft[g.id]?.ou === v ? " on" : ""}" data-g="${g.id}" data-ou="${v}">${v === "over" ? "OVER" : "UNDER"} ${g.total}<small>${SIDE_OU_PTS} PTS</small></button>`;
  const status = (g) => { const l = sideRawOf(g); return l?.found && l.state === "in" && !l.completed ? `<b class="sp-on">${escapeCd(shortStatus(l.detail || ""))} · ${l.awayScore}-${l.homeScore}</b>` : escapeCd(g.half ? (g.half === 1 ? "1st half only" : "2nd half only") : (g.kickoffLabel || "").replace(/ ET$/, "")); };
  // What is still to do: a side on every game, an over/under where the bet
  // has one, and the guess when there is a tiebreaker.
  const progress = () => {
    let need = 0, done = 0;
    for (const g of games) { need += 1; if (draft[g.id]?.team) done += 1; if (g.total != null) { need += 1; if (draft[g.id]?.ou) done += 1; } }
    if (tbG) { need += 1; if (tbOk()) done += 1; }
    return { need, done };
  };
  const paint = () => {
    const ready = isReady();
    const inAlready = !!pot.entrants[me];
    const closes = new Date(pot.closesAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
    const pr = progress();
    // A tap redraws the sheet: keep the list where it was, and play the
    // entrance only the first time.
    const y = m.querySelector(".sp-sheet-games")?.scrollTop || 0;
    if (m.firstChild) m.classList.add("painted");
    m.innerHTML = `<div class="wpx-card sp-sheet">
      <div class="sp-sh-top">
        <div class="sp-sh-title"><span>💰 SIDE BET</span><button type="button" class="sp-x" aria-label="Close">✕</button></div>
        <div class="sp-sh-facts">${games.length} ${games.length === 1 ? "game" : "games"} · <b>$${pot.buyIn}</b> · locks ${closes}</div>
        ${sideNeedsPicks(pot, me) ? `<div class="sp-sh-alert">Games were added. Finish your picks below; you're still in.</div>` : asked && !inAlready ? `<div class="sp-sh-sub">The week's decided, but the night isn't.</div>` : ""}
      </div>
      <div class="sp-sheet-games">${games.map((g) => `<div class="sp-game" data-g="${g.id}">
        <div class="sp-game-h"><span>${sideTag(g)}</span><span>${status(g)}</span></div>
        <div class="sp-match">${matchupCardsHtml(g, draft[g.id]?.team ? { team: draft[g.id].team, mode: draft[g.id].mode || "ATS" } : null)}</div>
        ${g.total != null ? `<div class="sp-segs">${ou(g, "over")}${ou(g, "under")}</div>` : ""}
      </div>`).join("")}
      ${tbG ? `<label class="sp-tbin"><span>TIEBREAKER · total points in ${escapeCd(sideMatch(tbG))}</span><input type="number" inputmode="numeric" min="0" max="200" step="1" placeholder="Your guess" value="${escapeCd(String(draftTb))}"></label>` : ""}
      <div class="sp-sheet-note">Most points takes the pot${tbG ? "; a tie goes to the closest guess" : "; a tie splits it"}. Nobody sees your picks until ${closes}. Money is settled between you, not in the app.</div>
      </div>
      <div class="sp-sh-foot">
        ${err ? `<div class="sp-err">${escapeCd(err)}</div>` : ""}
        <div class="sp-sh-prog${ready ? " done" : ""}">${ready ? "All set" : `${pr.done} of ${pr.need} done`}</div>
        <div class="sp-sheet-btns"><button type="button" class="sp-no"${busy ? " disabled" : ""}>${inAlready ? "Back out" : "No thanks"}</button><button type="button" class="sp-go"${ready && !busy ? "" : " disabled"}>${busy ? "Saving…" : inAlready ? "Save picks" : `I'm in · $${pot.buyIn}`}</button></div>
      </div>
    </div>`;
    const list = m.querySelector(".sp-sheet-games");
    if (list) list.scrollTop = y;
  };
  const send = async (action) => {
    busy = true; err = ""; paint();
    try {
      const r = await fetch(`${WORKER_URL}/side`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, week: pot.week, manager: me, token: tokenFor(me) || undefined, ...(action === "join" ? { picks: draft, ...(tbG ? { tb: Number(draftTb) } : {}) } : {}) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Didn't save. Try again.");
      if (d.pot) { sidePot = d.pot; sidePotAt = Date.now(); sidePotWeek = pot.week; }
      try { localStorage.setItem(sideDoneKey(pot, me), action); } catch {}
      noteUse(action === "join" ? "side-join" : "side-decline");
      close();
      renderSidePot();
    } catch (e) { busy = false; err = e.message || "Didn't save. Try again."; paint(); }
  };
  m.addEventListener("input", (e) => {
    if (!e.target.closest(".sp-tbin")) return;
    draftTb = e.target.value;
    const go = m.querySelector(".sp-go");
    if (go && !busy) go.disabled = !isReady();
    const pg = m.querySelector(".sp-sh-prog"), pr = progress();
    if (pg) { pg.textContent = isReady() ? "All set" : `${pr.done} of ${pr.need} done`; pg.classList.toggle("done", isReady()); }
  });
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest(".sp-x")) return close();
    const t = e.target.closest(".sp-team"), md = e.target.closest("[data-mode]");
    const chip = e.target.closest(".pick-mini-btn");
    if (chip) { const id = chip.closest(".sp-game").dataset.g; draft[id] = { ...draft[id], team: chip.dataset.team, mode: chip.dataset.mode }; err = ""; return paint(); }
    const o = e.target.closest("[data-ou]");
    if (o) { const id = o.dataset.g; draft[id] = { ...draft[id], ou: o.dataset.ou }; return paint(); }
    if (t) { const id = t.dataset.g; draft[id] = { ...draft[id], team: t.dataset.team, mode: draft[id]?.mode || "ATS" }; err = ""; return paint(); }
    if (md) { const id = md.dataset.g; draft[id] = { ...draft[id], mode: md.dataset.mode }; return paint(); }
    if (e.target.closest(".sp-go") && !busy) return send("join");
    if (e.target.closest(".sp-no") && !busy) return send("decline");
  });
  paint();
}

// The Side bet tab: only for players in this week's side bet. The bet's
// games with live scores (tap one for the gamecast), your pick on each and
// what it is paying, and who is in. Everyone's picks show once entry has
// closed, never before.
const sideScreen = document.getElementById("side-screen");
const navSideBtn = document.getElementById("nav-side-btn");
// The tab is only for players who opted in.
const sideIn = () => { const pot = potNow(); return !!pot && !!currentManager && window.LEAGUE?.sport !== "nfl" && !!pot.entrants?.[currentManager]; };
function updateSideNav() {
  const on = sideIn();
  navSideBtn?.classList.toggle("hidden", !on);
  if (!on && sideScreen && !sideScreen.classList.contains("hidden")) navScoreboardBtn.click();
}
function showSideScreen() {
  if (!sideIn()) return;
  rememberScroll();
  [loginScreen, picksScreen, scoreboardScreen, historyScreen, triviaScreen].forEach((s) => s.classList.add("hidden"));
  sideScreen.classList.remove("hidden");
  setActiveNav("side");
  enterScreen("side");
  renderSideScreen();
  Promise.all([fetchSidePot(true), fetchLiveScores().catch(() => {})]).then(() => { updateSideNav(); renderSideScreen(); });
}
navSideBtn?.addEventListener("click", showSideScreen);
function renderSideScreen() {
  const body = document.getElementById("side-screen-body");
  if (!body || sideScreen.classList.contains("hidden")) return;
  const pot = potNow();
  if (!pot) { body.innerHTML = `<div class="ss-empty">No side bet this week.</div>`; return; }
  const me = currentManager, mine = pot.entrants[me]?.picks || null;
  const names = Object.keys(pot.entrants || {});
  const open = sideOpen(pot);
  const st = sideStandings(pot), out = sideOutcome(pot, st);
  const myRow = st.rows.find((r) => r.name === me);
  const tbG = pot.tbGame != null ? sideGames(pot).find((x) => String(x.id) === String(pot.tbGame)) : null;
  const cd = open ? kickoffCountdown(new Date(pot.closesAt).toISOString()) : null;
  const lead = st.rows[0];
  // One line that says where things stand, for a player or an onlooker.
  const status = open
    ? (mine ? (sideNeedsPicks(pot, me) ? `New games added. <b>Finish your picks</b>` : `You're in. Picks lock in <b data-sp-cd>${cd && !cd.past ? cd.text : "now"}</b>`) : `Picks lock in <b data-sp-cd>${cd && !cd.past ? cd.text : "now"}</b>`)
    : !out.final ? (() => {
        // Standing on points as they are right now, live ones counted.
        const now = (r) => r.pts + r.fly, top = lead ? now(lead) : 0;
        const leaders = st.rows.filter((r) => now(r) === top);
        if (!myRow) return lead ? `Leader: <b>${escapeCd(sideNames(leaders.map((r) => r.name)))}</b> with ${top}` : "Under way";
        const ahead = st.rows.filter((r) => now(r) > now(myRow)).length, tied = st.rows.filter((r) => now(r) === now(myRow)).length > 1;
        const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
        const place = `${tied ? "tied for " : "in "}${ord(ahead + 1)}`;
        const how = !myRow.fly ? "" : myRow.pts ? ` <span class="ss-fly">(${myRow.pts} locked)</span>` : ` <span class="ss-fly">live</span>`;
        return `You're ${place} with <b>${now(myRow)}</b>${how}${ahead ? ` · leader ${escapeCd(shown(lead.name))} ${top}` : ""}`;
      })()
    : out.n < 2 ? "Final. One taker, no bet." : out.push ? "Final. Dead heat, no money moves."
    : out.winners.includes(me) ? `Final. You ${out.winners.length > 1 ? "split it" : `won${out.tiebreak ? " on the tiebreaker" : ""}`}. You collect <b>${sideMoney(out.net)}</b>.`
    : `Final. ${escapeCd(sideNames(out.winners))} ${out.winners.length > 1 ? "split" : "took"} it${out.tiebreak ? " on the tiebreaker" : ""}.${myRow ? ` You owe <b>${sideMoney(pot.buyIn)}</b>.` : ""}`;
  // Each game, live. A player's own pick rides under it.
  const bug = (g) => {
    const l = sideLiveOf(g), kicked = Date.now() >= new Date(g.kickoff).getTime();
    const on = l?.found && l.state === "in" && !l.completed, fin = !!sideResultOf(g);
    const showScore = kicked && l?.found && (on || fin);
    const pick = mine?.[g.id];
    const cell = myRow?.cells.find((c) => c.g.id === g.id && !c.ou);
    const ouCell = myRow?.cells.find((c) => c.g.id === g.id && c.ou);
    const side = (team, id, short, score) => `<div class="ss-team${pick?.team === team ? " mine" : ""}"><img src="${logoUrl(id)}" alt="" onerror="this.style.visibility='hidden'"><span>${escapeCd(short)}</span><b>${showScore ? score : ""}</b></div>`;
    const raw = g.half === 2 ? sideRawOf(g) : null;
    const stat = fin ? (g.half === 1 ? "1ST HALF FINAL" : "FINAL") : on ? escapeCd(shortStatus(l.detail || `Q${l.period ?? "?"} ${l.clock ?? ""}`))
      : raw?.found && raw.state === "in" ? `${escapeCd(shortStatus(raw.detail || ""))} · ${raw.awayScore}-${raw.homeScore} · 2H NEXT`
      : escapeCd(g.kickoffLabel || "");
    const line = `${g.favorite === g.home ? escapeCd(g.homeShort) : escapeCd(g.awayShort)} -${g.spread}${g.total != null ? ` · O/U ${g.total}` : ""}`;
    const pickTxt = pick ? `${escapeCd(pick.team === g.home ? g.homeShort : g.awayShort)} ${pick.mode === "SU" ? "to win" : `${pick.team === g.favorite ? "-" : "+"}${g.spread}`}` : "";
    return `<button type="button" class="ss-bug${on ? " live" : ""}${fin ? " final" : ""}" data-g="${g.id}">
      <div class="ss-bug-top"><span>${sideTag(g)}${String(pot.tbGame) === String(g.id) ? " · TIEBREAKER" : ""}</span><span class="ss-stat">${on ? "<u></u>" : ""}${stat}</span></div>
      ${side(g.away, g.awayId, g.awayShort, l?.awayScore ?? 0)}${side(g.home, g.homeId, g.homeShort, l?.homeScore ?? 0)}
      ${mine ? `<div class="ss-pick ${cell?.cls || "open"}"><span>YOUR PICK · ${pickTxt || "none yet"}</span><b>${cell ? (cell.cls === "open" ? `${cell.txt} PTS` : cell.txt) : ""}</b></div>
      ${ouCell ? `<div class="ss-pick sub ${ouCell.cls}"><span>${pick.ou === "over" ? "OVER" : "UNDER"} ${g.total}${showScore ? ` · ${fin ? "final" : "now"} ${(l?.awayScore ?? 0) + (l?.homeScore ?? 0)}` : ""}</span><b>${ouCell.cls === "open" ? `${ouCell.txt} PTS` : ouCell.txt}</b></div>` : ""}` : `<div class="ss-pick open"><span>${line}</span></div>`}
    </button>`;
  };
  // The scoreboard: everyone's picks and points once entry has closed.
  const board = open ? "" : sideBoardHtml(pot, st, out, me);
  // Final: the result up top, like a game over screen. The winner (or
  // winners) large with the money, then the next places on a podium.
  const avatar = (n, cls = "") => `<span class="sf-av ${cls}" style="--accent:${accentFor(n)}">${escapeCd(avatarOverrides[n] || shown(n)[0])}</span>`;
  const hero = !out.final || out.n < 2 || out.push ? "" : (() => {
    const tot = (n) => { const r = st.rows.find((x) => x.name === n); return r ? r.pts : 0; };
    const others = sideRowsInOrder(st, out).filter((r) => !out.winners.includes(r.name)).slice(0, 2);
    return `<div class="sf-hero">
      <div class="sf-kick">🏆 ${out.winners.length > 1 ? "SPLIT POT" : "WINNER"}</div>
      <div class="sf-win">${out.winners.map((n) => `<div class="sf-w">${avatar(n, "big")}<b>${escapeCd(shown(n))}</b><span class="sf-pts">${tot(n)} pts</span></div>`).join("")}</div>
      <div class="sf-money">+${sideMoney(out.net)}${out.winners.length > 1 ? " each" : ""}</div>
      <div class="sf-how">${out.tiebreak ? `Won on the tiebreaker · ${escapeCd(sideMatch(st.games.find((g) => String(g.id) === String(pot.tbGame)) || {}))} total ${out.tiebreak.actual}` : `Pot ${sideMoney(out.total)} · ${out.n} in`}</div>
      ${others.length ? `<div class="sf-pod">${others.map((r, i) => `<span>${i === 0 ? "🥈" : "🥉"} ${avatar(r.name)}${escapeCd(shown(r.name))} <b>${r.pts}</b></span>`).join("")}</div>` : ""}
    </div>`;
  })();
  // Settle up: who owes and who collects, with paid marks from the console.
  const settle = !out.final ? "" : out.n < 2 || out.push ? `<div class="ss-sec">SETTLE UP</div><div class="ss-note">${out.n < 2 ? "One taker: no money moves." : "Everyone level: no money moves."}</div>`
    : `<div class="ss-sec">SETTLE UP</div><div class="sf-ledger">${out.losers.map((n) => `<div class="sf-led${pot.entrants[n]?.paid ? " paid" : ""}">${avatar(n)}<span class="sf-nm">${escapeCd(shown(n))}</span><span class="sf-arrow">→ ${out.winners.map((w) => escapeCd(shown(w))).join(" & ")}</span><b>${sideMoney(pot.buyIn)}</b><em>${pot.entrants[n]?.paid ? "PAID ✓" : "UNPAID"}</em></div>`).join("")}</div>`;
  const who = open ? `<div class="ss-sec">WHO'S IN · ${names.length}</div><div class="ss-names">${names.length ? names.map((n) => `<span class="${n === me ? "me" : ""}">${escapeCd(shown(n))}</span>`).join("") : `<em>Nobody yet</em>`}</div><div class="ss-note">Everyone's picks show here when entry closes.</div>` : "";
  const action = open ? `<button type="button" class="sp-btn ss-edit" data-sp="open">${!mine ? `I'M IN · ${sideMoney(pot.buyIn)}` : sideNeedsPicks(pot, me) ? "FINISH MY PICKS" : "EDIT MY PICKS"}</button>` : "";
  body.innerHTML = `<div class="ss-head"><span class="sp-kick">💰 SIDE BET</span><span class="sp-pot">${sideMoney(names.length * pot.buyIn)}</span></div>
    ${hero ? "" : `<div class="ss-status">${status}</div>`}
    <div class="ss-sub">${names.length} in · ${sideMoney(pot.buyIn)} each · most points takes it${tbG ? ` · tiebreaker: ${escapeCd(sideMatch(tbG))}${out.tiebreak ? ` (${out.tiebreak.actual})` : ""}` : ", ties split"}</div>
    ${action}
    ${hero}
    ${settle}
    ${board}
    <div class="ss-sec">GAMES</div>
    <div class="ss-bugs">${sideGames(pot).map(bug).join("")}</div>
    ${who}`;
}
document.getElementById("side-screen-body")?.addEventListener("click", (e) => {
  if (e.target.closest("[data-sp='open']")) return openSideSheet(false);
  const b = e.target.closest(".ss-bug");
  if (b) {
    track("side-game", { event: true, d: b.dataset.g });
    // Our gamecast, for a pool game or any other.
    const g = GAMES.find((x) => String(x.id) === b.dataset.g);
    openInsights(g ? g.id : b.dataset.g);
  }
});

// Results are derived straight from ESPN's live feed once a game goes
// final — no manual score entry. A game only counts once ESPN marks it
// completed, so scores never lock in early off a still-live number.
function computeLiveResults(live) {
  const results = {};
  GAMES.forEach((game) => {
    const g = live[game.id];
    if (g && g.completed && Number.isFinite(g.awayScore) && Number.isFinite(g.homeScore)) {
      results[game.id] = { awayScore: g.awayScore, homeScore: g.homeScore };
    }
  });
  return results;
}

// Which managers picked a given team in a given mode, for the "who's on
// this side" line under each team in the live grid.
function pickersFor(cloudPicks, gameId, team, mode) {
  return MANAGERS.filter((name) => {
    const pick = cloudPicks[name]?.picks?.[gameId];
    return pick && pick.team === team && pick.mode === mode;
  });
}

function teamPickersHtml(cloudPicks, game, team, mode, label) {
  const names = pickersFor(cloudPicks, game.id, team, mode);
  if (names.length === 0) return "";
  return `<span class="picker-line"><strong>${label}</strong> ${names.join(", ")}</span>`;
}

// Whether every game in the week is final. Set while the cards render and
// read by the score strip a moment later, which is the only place that
// fact is now shown.
let boardAllFinal = false;
// Which scorebugs the viewer has expanded to see the pick lists. Kept
// across the 30s refresh so the board doesn't snap shut mid-read.
// Last scores seen per game, so a changed number gets the arcade pop.
const lastScores = {};

function namesListHtml(names) {
  if (names.length === 0) return `<span class="bug-name-line none">&mdash;</span>`;
  return names.map((n) => `<span class="bug-name-line${n === currentManager ? " me" : ""}">${shown(n)}</span>`).join("");
}

// Name chips: avatar initial (or emoji) plus name, wrapping as a unit.
function nameChips(names) {
  return names.map((n) => {
    const idx = MANAGERS.indexOf(n);
    const accent = accentFor(n);
    const av = avatarOverrides[n] || shown(n)[0];
    return `<span class="pick-chip${n === currentManager ? " me" : ""}" data-name="${escapeCd(n)}"><span class="pick-chip-av" style="--accent:${accent}">${av}</span>${shown(n)}</span>`;
  }).join("");
}

// Stacked breakdown: team header carrying the line, then one row per pick
// type that has anyone on it. Empty rows are dropped.
function bugSideDetail(cloudPicks, game, team, short, finalRes) {
  const isFav = team === game.favorite;
  const spreadTxt = isFav ? `-${game.spread}` : `+${game.spread}`;
  const ats = pickersFor(cloudPicks, game.id, team, "ATS");
  const su = pickersFor(cloudPicks, game.id, team, "SU");
  // One small pill per category: what it is worth before the final, what
  // it paid after. Same pills as the All Picks grid.
  const pill = (mode) => {
    const worth = pointValue(game, team, mode);
    if (!finalRes) return `<span class="bug-pick-worth">${worth} PT</span>`;
    const outcome = resultOutcome(game, finalRes);
    if (mode === "ATS" && outcome && outcome.push) return `<span class="pick-pill push">PUSH</span>`;
    const pts = scorePick(game, { team, mode }, finalRes);
    return pts > 0 ? `<span class="pick-pill ${ptsTier(pts)}">+${pts}</span>` : `<span class="pick-pill miss">✗</span>`;
  };
  const rows = [];
  if (ats.length) rows.push(`<div class="bug-pick-group"><span class="bug-pick-tagline"><span class="bug-pick-tag ats">SPREAD ${spreadTxt}</span>${pill("ATS")}</span><div class="pick-chips">${nameChips(ats)}</div></div>`);
  if (su.length) rows.push(`<div class="bug-pick-group"><span class="bug-pick-tagline"><span class="bug-pick-tag su">STRAIGHT UP</span>${pill("SU")}</span><div class="pick-chips">${nameChips(su)}</div></div>`);
  return `
    <div class="bug-side">
      <div class="bug-side-head"><span>${short}</span></div>
      ${rows.length ? rows.join("") : '<div class="bug-pick-group none">nobody</div>'}
    </div>
  `;
}

// ESPN hands back full network names, and "Big Ten Network" has no
// business taking a third of a scorebug. Known networks map to the
// abbreviation people actually say; anything unknown and long falls back
// to initials rather than being cut mid-word by an ellipsis.
const NETWORK_SHORT = {
  "big ten network": "BTN",
  "btn": "BTN",
  "acc network": "ACCN",
  "acc network extra": "ACCNX",
  "accnx": "ACCNX",
  "sec network": "SECN",
  "sec network+": "SECN+",
  "sec network alternate": "SECN",
  "cbs sports network": "CBSSN",
  "pac-12 network": "P12N",
  "longhorn network": "LHN",
  "mountain west network": "MWN",
  "nfl network": "NFLN",
  "big 12 now": "B12",
  "big 12 now on espn+": "B12",
  "the cw": "CW",
  "cw network": "CW",
  "espn+": "ESPN+",
  "espn2": "ESPN2",
  "espn3": "ESPN3",
  "espnu": "ESPNU",
  "espnews": "ESPNEWS",
  "peacock": "PEACOCK",
  "paramount+": "PARA+",
  "amazon prime video": "PRIME",
  "prime video": "PRIME",
  "apple tv+": "APPLE",
  "truv": "TRUTV",
  "trutv": "TRUTV",
};

// ESPN's own short detail is not short: "End of 3rd Quarter" is nineteen
// characters and gets cut off mid-word on a phone. Squeeze the phrases
// it actually sends into scoreboard shorthand.
function shortStatus(raw) {
  let t = String(raw || "").trim();
  if (!t) return "";
  if (/^halftime$/i.test(t)) return "HALF";
  if (/^end of (\d)(st|nd|rd|th) quarter$/i.test(t)) return t.replace(/^end of (\d)(st|nd|rd|th) quarter$/i, "END $1$2").toUpperCase();
  if (/(1st|2nd) half$/i.test(t)) return t.replace(/.*?(1st|2nd) half$/i, (m, h) => "END " + h[0] + "H").toUpperCase();
  if (/^delayed/i.test(t)) return "DELAY";
  if (/^postponed/i.test(t)) return "PPD";
  if (/^canceled|^cancelled/i.test(t)) return "CXL";
  t = t.replace(/^(\d)(st|nd|rd|th)\s+OT/i, "$1OT");  // "2nd OT 0:42" -> "2OT 0:42"
  t = t.replace(/\s+-\s+/g, " ");
  // ESPN's running-clock form is "11:38 - 3rd Quarter", not "11:38 - 3rd".
  // The word never fitted: at 375 and 390 the head clipped it to "3r",
  // which reads as a typo rather than a quarter.
  t = t.replace(/\s*\b(quarter|qtr)s?\.?/i, "");
  return t.trim();
}

function shortNetwork(raw) {
  const name = String(raw || "").trim();
  if (!name) return "";
  const hit = NETWORK_SHORT[name.toLowerCase()];
  if (hit) return hit;
  if (name.length <= 7) return name.toUpperCase();
  // Unknown and long: initials of the words that carry meaning.
  const words = name.split(/[\s|]+/).filter((w) => w && !/^(network|sports|channel|the|tv)$/i.test(w));
  if (words.length > 1) return words.map((w) => w[0]).join("").toUpperCase().slice(0, 6);
  return name.toUpperCase().slice(0, 7);
}

function renderLiveScores(live, cloudPicks) {
  markUsable();
  // Compact scorebugs in a 2-up grid, every game from the start. Tap a
  // bug to expand the who-picked-what lists (only once that game has
  // kicked off). A red pulsing dot marks games that are live right now.
  const ordered = gamesByKickoff();
  const liveCount = ordered.filter((g) => { const l = live[g.id]; return isGameLocked(g) && l && l.found && l.state === "in" && !l.completed; }).length;
  // No title line. Which tab this is comes from the nav, how many games
  // are live comes from the cards themselves, and the one fact neither
  // shows, that the whole week is done, rides in the score strip.
  boardAllFinal = ordered.length > 0 && ordered.every((g) => { const l = live[g.id]; return l && l.found && l.completed; });

  liveScoresList.innerHTML = `<div class="bug-grid ${liveCount > 0 ? "has-live" : ""}">` + ordered
    .map((game) => {
      const locked = isGameLocked(game);
      const g = live[game.id];
      const found = locked && g && g.found;
      // Scores stay behind the lock; a poll rank does not. It is public
      // all week and it is most useful before a game, so it reads from the
      // feed directly rather than from the gate that hides scores.
      const feed = g && g.found ? g : null;
      const isLive = found && g.state === "in" && !g.completed;
      const isFinal = found && g.completed;

      // Every kickoff on the slate is Eastern and the label says so once
      // at the top, so the per-card time drops the suffix to make room
      // for the channel the game is on.
      // The time as before, with the day after it ("7:00 PM Fri"), so a
      // Thursday or Friday game stands out from the Saturday slate.
      const kl = game.kickoffLabel.match(/^(Sat|Sun|Mon|Tue|Wed|Thu|Fri) (.+?)(?: ET)?$/);
      // AM/PM shrinks to a tiny suffix so the hour and the day carry it.
      const timeOnly = (kl ? `${kl[2]} ${kl[1]}` : game.kickoffLabel.replace(/ ET$/, "")).replace(/\s?(AM|PM)\b/, '<small class="ampm">$1</small>');
      const statusText = !locked
        ? timeOnly
        : isFinal
          ? "FINAL"
          : isLive
            ? shortStatus(g.detail || `Q${g.period ?? "?"} ${g.clock ?? ""}`)
            : (found && g.state === "pre" ? timeOnly : found ? shortStatus(g.detail || "Scheduled") : "Waiting…");
      // The channel matters right up to the final whistle, not just before
      // kickoff: on a ten game Saturday the question "which channel is
      // that one on" is asked most often about a game already in
      // progress. It only stops mattering once the game is over.
      const tvTag = !isFinal && game.tv
        ? `<span class="bug-tv" title="${escapeCd(game.tv)}">${escapeCd(shortNetwork(game.tv))}</span>`
        : "";

      const awayScore = found ? g.awayScore ?? "–" : "–";
      const homeScore = found ? g.homeScore ?? "–" : "–";
      const prev = lastScores[game.id] || {};
      const awayPop = found && prev.away !== undefined && prev.away !== awayScore;
      const homePop = found && prev.home !== undefined && prev.home !== homeScore;
      if (found) lastScores[game.id] = { away: awayScore, home: homeScore };
      const hasScores = found && g.awayScore !== null && g.homeScore !== null;
      const awayLead = hasScores && g.awayScore > g.homeScore;
      const homeLead = hasScores && g.homeScore > g.awayScore;
      const awayFav = game.favorite === game.away;

      // Who has the ball, live only and not at a break (the last drive's
      // team means nothing at halftime). Inside the 20 the ball glows and
      // an RZ tag rides with it. Red stays off the card's ring, which in
      // this app means a miss, so the red zone lives on the ball itself.
      const brkNow = /^(HALF|END)/i.test(String(statusText)) || /halftime|end of/i.test(String(g?.detail || ""));
      const possSide = !isLive || brkNow ? null
        : g.situation?.possessionId != null ? (Number(g.situation.possessionId) === Number(game.awayId) ? "away" : Number(g.situation.possessionId) === Number(game.homeId) ? "home" : null)
        : g.possession || null;
      const inRz = !!possSide && !!(g.situation?.isRedZone ?? g.redZone);
      const ballHtml = (side) => possSide === side ? `<i class="bug-ball${inRz ? " rz" : ""}" title="${inRz ? "Has the ball in the red zone" : "Has the ball"}"></i>${inRz ? `<b class="bug-rz">RZ</b>` : ""}` : "";
      const row = (team, short, id, score, lead, fav, pop, rank, side) => `
        <div class="bug-row ${lead ? "leading" : ""} ${myPick && myPick.team === team ? "mine" : ""}">
          <span class="bug-mark">
            <img class="bug-logo" src="${logoUrl(id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
            ${rankBadge(rank)}
          </span>
          <span class="bug-team"><span class="tm-nm">${short.length > 12 ? short.replace(/^(South|North|East|West|Central)\s/, (m, d) => d[0] + " ") : short}</span>${ballHtml(side)}</span>
          ${fav ? `<span class="bug-fav">-${game.spread}</span>` : `<span class="bug-fav dog"></span>`}
          <span class="bug-score ${pop ? "pop" : ""}">${score}</span>
        </div>`;

      const cls = ["scorebug", isLive ? "is-live" : "", isFinal ? "is-final" : "", !locked ? "upcoming" : ""].join(" ");
      // What this game is worth to the viewer, top right. Before kickoff
      // it just states the stake; live it carries a dot, green while the
      // pick is covering and red while it is not; at the final a miss is
      // struck through so a lost game reads as lost at a glance.
      let myPill = "";
      const myPick = currentManager ? cloudPicks[currentManager]?.picks?.[game.id] : null;
      if (myPick) {
        const worth = pointValue(game, myPick.team, myPick.mode);
        const mine = myPick.team === game.away ? game.awayShort : game.homeShort;
        const isFav = myPick.team === game.favorite;
        const terms = myPick.mode === "ATS" ? `${isFav ? "-" : "+"}${game.spread}` : "SU";
        const res = hasScores ? { awayScore: g.awayScore, homeScore: g.homeScore } : null;
        const pts = isFinal && res ? scorePick(game, myPick, res) : null;
        const lean = !isFinal && isLive && res ? scorePick(game, myPick, res) : null;
        const pushed = res && myPick.mode === "ATS" && resultOutcome(game, res)?.push;
        // Points only. The line is already on the row beside the
        // favourite, and the side you took is marked down its edge, so
        // repeating either here just makes the pill wide.
        // Same two rules as every other pill: the colour is the point
        // value, the border says whether it is settled. Before kickoff it
        // states the stake instead, since there is no result to colour.
        let tone = "pending", face = `${worth}<span class="stake-u">PT</span>`;
        if (pts !== null) {
          tone = pushed ? "push" : ptsTier(pts);
          // A final says what you scored, not what you no longer have. A
          // hit reads +2, so a miss reads 0, and the pill is the same
          // shape either way. The struck-through stake it replaces put a
          // 1.5px line across a 10px digit, which turned 1 PT into
          // something closer to 4 PT.
          face = pushed ? "P" : pts > 0 ? `+${pts}` : "0";
        } else if (lean !== null) {
          tone = `lean ${lean > 0 ? ptsTier(worth) : "miss"}`;
          face = lean > 0 ? `+${worth}` : "0";
        }
        myPill = `<span class="stake ${tone}" title="You took ${mine} ${terms} for ${worth} pt">${face}</span>`;
      }
      return `
        <div class="${cls}" data-game="${game.id}" role="button" tabindex="0" aria-label="Open ${game.awayShort} at ${game.homeShort}">
          <div class="bug-head">
            <span class="bug-gnum">G${game.id}</span>
            <span class="bug-status">${statusText}</span>${tvTag}
            ${myPill}
          </div>
          ${row(game.away, game.awayShort, game.awayId, awayScore, awayLead, awayFav, awayPop, feed?.awayRank ?? null, "away")}
          ${row(game.home, game.homeShort, game.homeId, homeScore, homeLead, !awayFav, homePop, feed?.homeRank ?? null, "home")}
        </div>
      `;
    })
    .join("") + `</div>`;

  // One tap opens the game: info before kickoff, the gamecast live, the
  // final view after. The old expand-in-place view is gone.
  liveScoresList.querySelectorAll(".scorebug").forEach((el) => {
    const id = Number(el.dataset.game);
    const open = () => { track("scorebug-open", { event: true, d: id }); openInsights(id); };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
}

function renderScoreboardTable(cloudPicks, results, live = {}, ranked = null) {
  // One ordered list for the header and every row, so the columns read
  // left to right in kickoff order and stay aligned with their labels.
  const ordered = gamesByKickoff();
  const headCells = ordered.map((g) => `<th class="${results[g.id] ? "final" : isGameLocked(g) ? "live" : ""}">G${g.id}</th>`).join("");
  // The tiebreaker is one game and one total, so work it out once rather
  // than per manager.
  const tbGame = tiebreakerGameOf();
  const tbOpen = tbGame ? isGameLocked(tbGame) : false;
  const tbResult = tbGame ? results[tbGame.id] : null;
  const tbActual = tbResult ? tbResult.awayScore + tbResult.homeScore : null;

  // The column holds a distance now, so the label says so, and the actual
  // total the distances are measured from rides in the tooltip.
  const tbHead = tbActual === null ? "TB" : `TB &plusmn;`;
  const tbTitle = tbActual === null ? "Tiebreaker guess" : `Distance from the actual total, ${tbActual}`;
  let html = `<thead><tr><th class="manager-col">Team</th>${headCells}<th title="${tbTitle}">${tbHead}</th><th>PTS</th></tr></thead><tbody>`;

  // Standings order, the same order the leaderboard is in, so scanning
  // from one to the other does not mean re-finding everybody. The roster
  // order it used before is the order the names were written down in,
  // which tells you nothing about the week.
  const order = ranked ? ranked.map((r) => r.name) : MANAGERS;
  // The place reads like a poll rank on a team: the name first, then a
  // small number after it. T marks a tie. The ordinal suffix is dropped
  // because the grid is ten game columns wide and 1ST or T-8TH is four
  // characters saying nothing the digit does not.
  const placeOf = new Map((ranked || []).map((r) => [r.name, `${r.tied ? "T" : ""}${r.place}`]));
  order.forEach((name) => {
    const state = cloudPicks[name] || { picks: {}, tiebreaker: "" };
    let total = 0;
    const cells = ordered.map((game) => {
      const gameStarted = isGameLocked(game);
      const pick = state.picks[game.id];

      if (!gameStarted) {
        return `<td class="pick-cell hidden-pick">🔒</td>`;
      }
      if (!pick) {
        // The game has kicked off and nothing was submitted, so this is a
        // settled zero, not a pending cell.
        return `<td class="pick-cell miss-none" title="No pick submitted"><span class="pick-pill miss">✗</span></td>`;
      }
      const pts = scorePick(game, pick, results[game.id]);
      if (pts) total += pts;
      // In-progress games: a provisional lean from the live score, shown as
      // a soft outline (green covering / pink not) without counting points.
      let lean = "";
      const lg = live[game.id];
      if (pts === null && lg && lg.found && lg.state === "in" && Number.isFinite(lg.awayScore) && Number.isFinite(lg.homeScore) && (lg.awayScore || lg.homeScore)) {
        const prov = scorePick(game, pick, { awayScore: lg.awayScore, homeScore: lg.homeScore });
        lean = prov === null ? "" : prov > 0 ? " lean-hit" : " lean-miss";
      }
      const cls = (pts === null ? "pending" : pts > 0 ? "correct" : "incorrect") + lean;
      // Logo only; the line appears only when the pick was against the
      // spread, so a bare logo reads as straight up at a glance.
      const pickId = pick.team === game.away ? game.awayId : game.homeId;
      const short = pick.team === game.away ? game.awayShort : game.homeShort;
      const spreadTag = pick.mode === "ATS"
        ? `<span class="pick-cell-spread">${pick.team === game.favorite ? "-" : "+"}${game.spread}</span>`
        : "";
      // Final games: points ride as a badge on the logo (+2 in green, ✗ in
      // pink with the logo dimmed) instead of a third stacked line.
      // Final: logo with a small result pill under it and no spread line.
      // Live or upcoming: logo with the spread (if ATS) and a lean dot.
      const pushed = pts !== null && pick.mode === "ATS" && resultOutcome(game, results[game.id])?.push;
      const pill = pts === null ? "" : pushed ? `<span class="pick-pill push">P</span>` : pts > 0 ? `<span class="pick-pill ${ptsTier(pts)}">+${pts}</span>` : `<span class="pick-pill miss">✗</span>`;
      const under = pts === null ? spreadTag : pill;
      return `<td class="pick-cell ${cls}" title="${short} ${pick.mode}${pick.mode === "ATS" ? ` ${pick.team === game.favorite ? "-" : "+"}${game.spread}` : ""}${pts !== null ? ` · ${pts} pt` : ""}"><span class="pick-mark"><img class="pick-cell-logo" src="${logoUrl(pickId)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pick-cell-short',textContent:'${short}'}))" /></span>${under}</td>`;
    }).join("");

    // How far off, not what they said. A column of raw guesses is a column
    // of numbers you have to subtract the actual total from in your head,
    // ten times, to find who is closest. Signed, so over and under read
    // apart at a glance, and the exact hit shows as a zero rather than as
    // a number that happens to match.
    const tbRaw = String(state.tiebreaker ?? "").trim();
    const tbGuess = tbRaw === "" ? null : Number(tbRaw);
    let tbCell;
    if (!tbOpen) tbCell = "🔒";
    else if (tbGuess === null || !Number.isFinite(tbGuess)) tbCell = `<span class="tb-off none">–</span>`;
    else if (tbActual === null) tbCell = `<span class="tb-off pending" title="Guessed ${tbGuess}">${tbGuess}</span>`;
    else {
      const diff = tbGuess - tbActual;
      const face = diff === 0 ? "0" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`;
      tbCell = `<span class="tb-off${diff === 0 ? " exact" : ""}" title="Guessed ${tbGuess}, actual ${tbActual}">${face}</span>`;
    }
    // Count only games on this week's slate. Counting every key in the
    // picks object lets a leftover from another week inflate the number,
    // so the leaderboard and the All Picks grid could disagree.
    const submittedCount = GAMES.filter((g) => state.picks[g.id]).length;

    // The rows are in standings order, and without the place on them you
    // have to take that on trust. Same wording as the leaderboard, ties
    // included, so the two read as one list.
    const place = placeOf.get(name);
    const rankTag = place ? `<span class="ap-place">${place}</span>` : "";
    // No picks count here. Every pick this manager made is on the row
    // beside it, a missing one already shows as a red cross, and the
    // leaderboard above states the count outright, so it was a second line
    // of cell saying what the first line was already showing.
    html += `<tr class="${name === currentManager ? "is-me" : ""}"><td class="manager-col"><span class="ap-who">${shown(name)}</span>${rankTag}</td>${cells}<td>${tbCell}</td><td><strong>${total}</strong></td></tr>`;
  });

  html += "</tbody>";
  scoreboardTable.innerHTML = html;
}

function computeScore(state, results) {
  let total = 0;
  GAMES.forEach((game) => {
    const pts = scorePick(game, state.picks[game.id], results[game.id]);
    if (pts) total += pts;
  });
  return total;
}

// Which rankings rows are open to show that player's game-by-game picks.
const expandedRankings = new Set();

// One plain line on why a manager is out of the week. First the simple
// case, a ceiling below points someone has already banked. Otherwise the
// best case: every open pick of theirs hits, each game ending the way that
// pays them most and their rivals least, and who still finishes ahead.
function outReason(name, results, all = lastGoodCloudPicks || {}) {
  const pickOf = (n, g) => { const p = all[n]?.picks?.[g.id]; return p && p.team && p.mode ? p : null; };
  const pts = (n, g, res) => scorePick(g, pickOf(n, g), res) || 0;
  const now = Object.fromEntries(MANAGERS.map((n) => [n, GAMES.reduce((t, g) => t + (results[g.id] ? pts(n, g, results[g.id]) : 0), 0)]));
  const open = GAMES.filter((g) => !results[g.id]);
  const others = MANAGERS.filter((n) => n !== name);
  let max = now[name];
  for (const g of open) { const p = pickOf(name, g); if (p) max += pointValue(g, p.team, p.mode); }
  const banked = others.filter((n) => now[n] > max).sort((a, b) => now[b] - now[a])[0];
  if (banked) return `Max ${max} can't reach ${shown(banked)}'s ${now[banked]} already banked.`;
  const best = { ...now };
  for (const g of open) {
    const cats = gameCats(g);
    const top = Math.max(...cats.map((c) => pts(name, g, c.res)));
    const res = cats.filter((c) => pts(name, g, c.res) === top)
      .map((c) => ({ c, r: Math.max(0, ...others.map((n) => pts(n, g, c.res))) }))
      .sort((a, b) => a.r - b.r)[0].c.res;
    for (const n of MANAGERS) best[n] += pts(n, g, res);
  }
  const rival = others.sort((a, b) => best[b] - best[a])[0];
  if (!rival) return "";
  if (best[rival] > best[name]) return `Even if every open pick hits (${best[name]}), ${shown(rival)}'s picks on the same games take ${shown(rival)} to ${best[rival]}.`;
  if (best[rival] === best[name]) return `At best a ${best[name]} point tie with ${shown(rival)}, and the tiebreaker goes ${shown(rival)}'s way.`;
  return `No mix of results left puts ${shown(name)} first.`;
}

// When missing the swing pick all but ends a manager's week, the usual
// reason is one rival on the other side of that game who matches them
// nearly everywhere else. Returns that rival, or null.
function mirrorOf(name, sw, results, all = lastGoodCloudPicks || {}) {
  if (!sw || sw.ifMiss >= 0.01) return null;
  const g = sw.game, mine = all[name]?.picks || {};
  const same = (a, b) => a && b && a.team && a.team === b.team && a.mode === b.mode;
  const others = GAMES.filter((x) => x.id !== g.id && !results[x.id] && mine[x.id]?.team);
  let best = null;
  for (const n of MANAGERS) {
    if (n === name) continue;
    const theirs = all[n]?.picks || {}, tp = theirs[g.id];
    if (!tp?.team || same(tp, mine[g.id])) continue;
    const k = others.filter((x) => same(theirs[x.id], mine[x.id])).length;
    if (!best || k > best.k) best = { n, k, tp, total: others.length };
  }
  return best && best.total && best.k >= Math.ceil(best.total / 2) ? best : null;
}
// The one line under the matchup naming that rival and their side.
function mirrorLine(name, m, g) {
  if (!m) return "";
  const side = `${m.tp.team === g.away ? g.awayShort : g.homeShort} ${m.tp.mode === "SU" ? "to win" : `${m.tp.team === g.favorite ? "-" : "+"}${g.spread}`}`;
  const whose = name === currentManager ? "your" : `${shown(name)}'s`;
  const match = m.k === m.total ? `matches ${whose} other ${m.total} open picks` : `matches ${m.k} of ${whose} other ${m.total} open picks`;
  return `<span class="rd-wp-must">Must hit:</span> <b>${escapeCd(shown(m.n))}</b> has <b>${escapeCd(side)}</b> and ${escapeCd(match)}.`;
}
// The swing game drawn as the matchup: both logos, this manager's side lit
// with their pick, and the mirroring rival's name on the other side.
function swingMatchupHtml(name, sw, m) {
  const g = sw.game, pk = sw.pick;
  const terms = (p) => p.mode === "SU" ? "SU" : `${p.team === g.favorite ? "-" : "+"}${g.spread}`;
  const side = (team, id, short) => {
    const mine = pk.team === team, rival = m && m.tp.team === team;
    const tag = mine ? `${shown(name)} ${terms(pk)}` : rival ? `${shown(m.n)} ${terms(m.tp)}` : "";
    return `<span class="rd-sw-team${mine ? " mine" : rival ? " rival" : ""}"><img class="rd-sw-logo" src="${logoUrl(id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" /><span class="rd-sw-name">${escapeCd(short)}</span>${tag ? `<span class="rd-sw-tag">${escapeCd(tag.toUpperCase())}</span>` : `<span class="rd-sw-tag none">&nbsp;</span>`}</span>`;
  };
  return `<span class="rd-sw-label">BIGGEST GAME LEFT</span><span class="rd-swing">${side(g.away, g.awayId, g.awayShort)}<span class="rd-sw-at">@</span>${side(g.home, g.homeId, g.homeShort)}</span>`;
}

// --- Path to win ------------------------------------------------------
// The new feature pop-up.
// Once per phone, on the scoreboard while the week is live and a path can
// be run: a small card showing where to tap, drawn from the real board.
// Never over another popup. GOT IT, the X, or a swipe down closes it.
const PATH_INTRO_KEY = "brochiefs_new_pathtowin_v1";
let pathIntroShownThisLoad = false;
function maybeShowPathIntro(force = false) {
  if (!force) {
    if (pathIntroShownThisLoad || !currentManager || window.__adminEntry || window.__adminOpen || window.__liveView) return;
    if (window.LEAGUE?.sport === "nfl") return; // college only for now
    try { if (localStorage.getItem(PATH_INTRO_KEY)) return; } catch { return; }
    const results = computeLiveResults(latestLive);
    const wd = winChanceMemo.detail?.[currentManager];
    if (!weekIsLive(results) || !wd || wd.alive === false || scoreboardScreen.classList.contains("hidden")) return;
    if ([...document.querySelectorAll(".modal-overlay, .pr-screen, .np-screen")].some((el) => !el.classList.contains("hidden") && getComputedStyle(el).display !== "none")) return;
  }
  pathIntroShownThisLoad = true;
  setTimeout(() => showPathIntro(), force ? 0 : 900);
}
function showPathIntro() {
  if (document.querySelector(".pi-screen")) return;
  const me = currentManager;
  const rows = liveWeekRows.length ? liveWeekRows : MANAGERS.map((name, i) => ({ name, score: 0, place: i + 1 }));
  const at = Math.max(0, rows.findIndex((r) => r.name === me));
  const pick = rows.slice(Math.max(0, Math.min(at - 1, rows.length - 3)), Math.max(0, Math.min(at - 1, rows.length - 3)) + 3);
  const pct = (n) => { const v = winChanceMemo.out?.[n]; return v == null ? null : v; };
  const mini = pick.map((r) => {
    const p = pct(r.name), w = p == null ? 0 : Math.max(3, Math.min(100, p * 100));
    return `<div class="pi-row${r.name === me ? " me" : ""}"><span class="pi-rk">${r.tied ? "T" : ""}${r.place || ""}</span><span class="pi-nm">${escapeCd(shown(r.name).toUpperCase())}</span><span class="pi-bar"><i style="width:${w.toFixed(0)}%"></i></span><span class="pi-pt">${String(r.score ?? 0).padStart(2, "0")}</span>${r.name === me ? `<span class="pi-tap" aria-hidden="true"></span>` : ""}</div>`;
  }).join("");
  const myPct = pct(me);
  const m = document.createElement("div");
  m.className = "pi-screen"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "New feature: path to win");
  m.innerHTML = `<div class="pi-card">
    <div class="pi-head"><span class="pi-new">NEW</span><span class="pi-title">PATH TO WIN</span><button type="button" class="pi-x" aria-label="Close">✕</button></div>
    <p class="pi-lede">See exactly which results you need to win the week, played out game by game.</p>
    <div class="pi-step"><b>1</b><span>Tap your name on the leaderboard</span></div>
    <div class="pi-mini">${mini}</div>
    <div class="pi-step"><b>2</b><span>Tap the button on your card</span></div>
    <div class="pi-mini pi-card2"><div class="pi-card2-top"><span class="pi-cap">CHANCE TO WIN THE WEEK · <b>${myPct == null ? "--" : winChanceLabel(myPct, winChanceMemo.detail?.[me])}</b></span><span class="pi-btnwrap"><span class="rd-path-btn pi-demo"><span class="rd-path-play">▶</span>MY PATH TO WIN</span></span></div><div class="pi-card2-sk"><i></i><i></i></div></div>
    <button type="button" class="pi-ok">GOT IT</button>
  </div>`;
  document.body.appendChild(m);
  // Seen once it's on screen, so closing the app over it doesn't bring it back.
  try { localStorage.setItem(PATH_INTRO_KEY, String(Date.now())); } catch {}
  const done = () => { try { localStorage.setItem(PATH_INTRO_KEY, String(Date.now())); } catch {} m.classList.add("out"); setTimeout(() => m.remove(), 220); };
  m.querySelector(".pi-ok").addEventListener("click", done);
  m.querySelector(".pi-x").addEventListener("click", done);
  m.addEventListener("click", (e) => { if (e.target === m) done(); });
  // Swipe the card down to close it.
  const card = m.querySelector(".pi-card");
  let y0 = null, dy = 0;
  card.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; dy = 0; card.style.transition = "none"; }, { passive: true });
  card.addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    card.style.transform = `translateY(${dy}px)`;
    card.style.opacity = String(Math.max(0.4, 1 - dy / 400));
  }, { passive: true });
  card.addEventListener("touchend", () => {
    if (y0 == null) return;
    y0 = null;
    card.style.transition = "transform .2s ease-out, opacity .2s ease-out";
    if (dy > 80) { card.style.transform = "translateY(100vh)"; done(); } else { card.style.transform = ""; card.style.opacity = ""; }
  });
  track("path-intro", { event: true });
}
// For a preview from the console: previewPathIntro().
window.previewPathIntro = () => maybeShowPathIntro(true);

// The likeliest way the games left can finish with this manager first,
// played out like a DOS program: the standings on the left, each game on
// the right one at a time with its logos and result, points and places
// moving after every game. The path comes from the exact walk behind the
// win chance (exactPaths), so it is a real way to win, not a guess.
function pathScenario(name) {
  const ctx = winChanceMemo.ctx, i = MANAGERS.indexOf(name);
  if (!ctx || i < 0) return null;
  const r = exactPaths([i], ctx.models, ctx.picks, ctx.guesses, ctx.tbGame, ctx.catN, ctx.N)[i];
  if (!r?.path) return null;
  const order = new Map(gamesByKickoff().map((g, k) => [g.id, k]));
  return { ...r.path, all: [...r.path.all].sort((a, b) => order.get(a.g.id) - order.get(b.g.id)), guess: ctx.guesses[i], tbGame: ctx.tbGame };
}
// The chance this manager wins the week with some games already decided
// the way the path says, the rest played out as in the week's simulation.
// Drives the meter that climbs as the run plays.
function pathChance(name, fixed, tbTotal = null, N = 1500) {
  const ctx = winChanceMemo.ctx, i = MANAGERS.indexOf(name);
  if (!ctx || i < 0) return null;
  const rnd = seededRandom(`${name}|${[...fixed.keys()].join(",")}`);
  const M = MANAGERS.length, score = new Array(M);
  let wins = 0;
  for (let s = 0; s < N; s++) {
    score.fill(0);
    let tb = null;
    ctx.models.forEach((m, k) => {
      let res = m.fixed || fixed.get(m.g.id);
      if (!res) {
        let h = m.curH, a = m.curA;
        const n = poissonRand(m.lam, rnd);
        for (let q = 0; q < n; q++) { const v = rnd() < 0.6 ? 7 : 3; if (rnd() < m.pHome) h += v; else a += v; }
        if (h === a) { const v = rnd() < 0.6 ? 7 : 3; if (rnd() < m.pHome) h += v; else a += v; }
        res = { awayScore: a, homeScore: h };
      }
      if (m.g === ctx.tbGame) tb = !m.fixed && fixed.has(m.g.id) && tbTotal != null ? tbTotal : res.awayScore + res.homeScore;
      const o = resultOutcome(m.g, res);
      for (let j = 0; j < M; j++) {
        const p = ctx.picks[j][k];
        if (!p || p.hidden) continue;
        const w = p.mode === "SU" ? o.suWinner : o.atsWinner;
        if (w && w === p.team) score[j] += p.pts;
      }
    });
    const top = Math.max(...score);
    if (score[i] !== top) continue;
    const T = []; for (let j = 0; j < M; j++) if (score[j] === top) T.push(j);
    if (T.length === 1) { wins++; continue; }
    const d = (j) => ctx.guesses[j] == null || tb == null ? Infinity : Math.abs(ctx.guesses[j] - tb);
    const best = Math.min(...T.map(d)), lead = T.filter((j) => d(j) === best);
    if (lead.includes(i)) wins += 1 / lead.length;
  }
  return wins / N;
}
// The team a result line is about, by the name it starts with.
function pathTeamOf(g, txt) {
  const a = txt.startsWith(g.awayShort), h = txt.startsWith(g.homeShort);
  return h && (!a || g.homeShort.length > g.awayShort.length) ? g.homeId : g.awayId;
}
// A picture of the path to share: each result that must happen with its
// team's logo and what it pays, then the win and the odds.
async function sharePath(name, sc) {
  if (!sc) return;
  const all = lastGoodCloudPicks || {};
  const results = computeLiveResults(latestLive);
  const pts = Object.fromEntries(MANAGERS.map((n) => [n, GAMES.reduce((t, g) => t + (results[g.id] ? scorePick(g, all[n]?.picks?.[g.id], results[g.id]) || 0 : 0), 0)]));
  for (const st of sc.all) for (const n of MANAGERS) pts[n] += scorePick(st.g, all[n]?.picks?.[st.g.id], st.res) || 0;
  const need = sc.all.filter((st) => st.need);
  const me = shown(name).toUpperCase();
  try { await document.fonts?.load?.("40px VT323"); } catch {}
  const load = (src) => new Promise((r) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => r(im); im.onerror = () => r(null); im.src = src; });
  const logos = await Promise.all(need.map((st) => load(logoUrl(pathTeamOf(st.g, st.txt)))));
  const W = 1080, rowH = 104, H = 360 + need.length * rowH + 330;
  const draw = (withLogos) => {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.fillStyle = "#06020f"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#1414a8"; x.fillRect(0, 0, W, 130);
    x.fillStyle = "#fff"; x.font = "64px VT323, monospace"; x.textBaseline = "middle";
    x.fillText("PATH TO WIN", 60, 68);
    x.fillStyle = "#ffe45e"; x.textAlign = "right"; x.fillText(me, W - 60, 68); x.textAlign = "left";
    x.fillStyle = "rgba(214,240,226,.6)"; x.font = "40px VT323, monospace";
    x.fillText(`${WEEK_LABEL.toUpperCase()} · RESULTS THAT MUST HAPPEN`, 60, 200);
    need.forEach((st, k) => {
      const y = 260 + k * rowH;
      x.fillStyle = "#ffb000"; x.fillRect(60, y, 5, rowH - 22);
      if (withLogos && logos[k]) x.drawImage(logos[k], 90, y + 6, 70, 70);
      const p = scorePick(st.g, all[name]?.picks?.[st.g.id], st.res) || 0;
      x.fillStyle = "#ffcf5c"; x.font = "52px VT323, monospace"; x.fillText(st.txt, 190, y + 32);
      if (!p) { const w = stopsWho(st.g, st.res, name, pts); if (w) { x.fillStyle = "rgba(255,176,0,.65)"; x.font = "34px VT323, monospace"; x.fillText(`stops ${shown(w)}`, 190, y + 70); } }
      x.textAlign = "right"; x.font = "52px VT323, monospace"; x.fillStyle = p ? "#39ff88" : "rgba(214,240,226,.35)"; x.fillText(p ? `+${p}` : "0", W - 60, y + 32); x.textAlign = "left";
    });
    let y = 260 + need.length * rowH + 20;
    const free = sc.all.length - need.length;
    x.fillStyle = "rgba(214,240,226,.55)"; x.font = "38px VT323, monospace";
    if (free) { x.fillText(`The other ${free} game${free === 1 ? "" : "s"} can go either way.`, 60, y); y += 60; }
    let fs = 92; x.font = `${fs}px VT323, monospace`;
    while (fs > 40 && x.measureText(`${me} WINS THE WEEK`).width > W - 120) { fs -= 4; x.font = `${fs}px VT323, monospace`; }
    x.fillStyle = "#ffe45e"; x.fillText(`${me} WINS THE WEEK`, 60, y + 60);
    const oneIn = sc.p > 0 ? Math.max(2, Math.round(1 / sc.p)) : null;
    x.fillStyle = "rgba(214,240,226,.75)"; x.font = "44px VT323, monospace";
    x.fillText(oneIn ? (oneIn > 10000 ? "Rarer than 1 in 10,000" : `About 1 in ${oneIn.toLocaleString()}`) : "", 60, y + 140);
    x.fillStyle = "rgba(214,240,226,.4)"; x.textAlign = "right"; x.fillText(location.host.toUpperCase(), W - 60, H - 50);
    return c;
  };
  const blobOf = (c) => new Promise((r) => { try { c.toBlob((b) => r(b), "image/png"); } catch { r(null); } });
  let blob = await blobOf(draw(true));
  if (!blob) blob = await blobOf(draw(false)); // a logo host without CORS taints the canvas
  if (!blob) return;
  const file = new File([blob], `path-to-win-${name.toLowerCase()}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], text: `${shown(name)}'s path to win · ${WEEK_LABEL}` }); } catch {} return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
let pathRunToken = 0;
// Which paths this phone has already watched run, when, and with which
// games final at the time. A path opens straight on its card until another
// game goes final or three hours pass; then the next open plays the full
// run again. A first look always plays it.
const PATH_SEEN_KEY = () => `brochiefs_pathseen_w${currentWeek}`;
const PATH_FRESH_MS = 3 * 3600000;
function finalsSig() { const r = computeLiveResults(latestLive); return GAMES.filter((g) => r[g.id]).map((g) => g.id).sort((x, y) => x - y).join(","); }
function pathSeenMap() { try { const v = JSON.parse(localStorage.getItem(PATH_SEEN_KEY()) || "{}"); return v && !Array.isArray(v) && typeof v === "object" ? v : {}; } catch { return {}; } }
function pathSeen(name) { const v = pathSeenMap()[name]; return !!v && v.s === finalsSig() && Date.now() - (Number(v.t) || 0) < PATH_FRESH_MS; }
function markPathSeen(name) {
  try { const v = pathSeenMap(); v[name] = { s: finalsSig(), t: Date.now() }; localStorage.setItem(PATH_SEEN_KEY(), JSON.stringify(v)); } catch {}
}
// A result the path needs that pays this manager nothing is there to stop
// someone: the rival it costs most, the one highest in the standings whose
// pick on that game misses here but would have paid another way.
function stopsWho(g, res, name, standing, all = lastGoodCloudPicks || {}) {
  const cats = gameCats(g);
  const hurt = MANAGERS.filter((n) => {
    if (n === name) return false;
    const pk = all[n]?.picks?.[g.id];
    if (!pk || (scorePick(g, pk, res) || 0) > 0) return false;
    return cats.some((c) => (scorePick(g, pk, c.res) || 0) > 0);
  });
  return hurt.sort((a, b) => (standing[b] || 0) - (standing[a] || 0))[0] || null;
}
// When the fresh read failed, the path says its scores may be behind.
const pathStaleNote = () => (liveLastOk || window.__liveView ? "" : `<div class="pr-stale">Scores didn't refresh, so a game that just ended may still show.</div>`);
// Once a path has been watched, the button opens this instead: a small
// card with only the games that must go a certain way, the team's logo,
// the result, and what it pays, then the win at the bottom.
function openPathCard(name) {
  document.querySelector(".pr-screen")?.remove();
  const sc = pathScenario(name);
  const all = lastGoodCloudPicks || {};
  const me = shown(name).toUpperCase();
  const results = computeLiveResults(latestLive);
  const pts = Object.fromEntries(MANAGERS.map((n) => [n, GAMES.reduce((t, g) => t + (results[g.id] ? scorePick(g, all[n]?.picks?.[g.id], results[g.id]) || 0 : 0), 0)]));
  const teamOf = pathTeamOf;
  let body;
  if (!sc) body = `<div class="pc-none">No path left: ${escapeCd(shown(name))} can't finish first.</div>`;
  else {
    for (const st of sc.all) for (const n of MANAGERS) pts[n] += scorePick(st.g, all[n]?.picks?.[st.g.id], st.res) || 0;
    const top = Math.max(...Object.values(pts)), tied = MANAGERS.filter((n) => pts[n] === top).length > 1;
    const rowsHtml = sc.all.filter((st) => st.need).map((st) => {
      const p = scorePick(st.g, all[name]?.picks?.[st.g.id], st.res) || 0;
      const stop = p ? null : stopsWho(st.g, st.res, name, pts);
      return `<li class="pc-row"><img class="pc-logo" src="${logoUrl(teamOf(st.g, st.txt))}" alt="" onerror="this.style.visibility='hidden'" /><span class="pc-txt">${escapeCd(st.txt)}${stop ? `<small class="pc-why">stops ${escapeCd(shown(stop))}</small>` : ""}</span><span class="pc-pts${p ? "" : " zero"}">${p ? `+${p}` : "0"}</span></li>`;
    }).join("");
    const oneIn = sc.p > 0 ? Math.max(2, Math.round(1 / sc.p)) : null;
    const free = sc.all.length - sc.need.length;
    body = `<ul class="pc-list">${rowsHtml}</ul>
      ${pathStaleNote()}${free ? `<div class="pc-free">The other ${free} game${free === 1 ? "" : "s"} can go either way.</div>` : ""}
      ${tied && sc.guess != null && sc.tbGame ? `<div class="pc-tie">Tied at ${top}: needs the tiebreaker, ${escapeCd(sc.tbGame.awayShort)} @ ${escapeCd(sc.tbGame.homeShort)} total near ${sc.guess}</div>` : ""}
      <div class="pc-win">${escapeCd(me)} WINS THE WEEK</div>
      <div class="pc-foot"><span>${oneIn ? (oneIn > 10000 ? "Rarer than 1 in 10,000" : `About 1 in ${oneIn.toLocaleString()}`) : ""}</span><span class="pc-btns"><button type="button" class="pc-share">↗ Share</button><button type="button" class="pc-replay">▶ Replay</button></span></div>`;
  }
  const m = document.createElement("div");
  m.className = "pr-screen pc"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", `Path to win for ${shown(name)}`);
  m.innerHTML = `<div class="pc-card"><div class="pr-bar"><span class="pr-grip" aria-hidden="true"></span><span class="pr-bar-t">PATH TO WIN <i>·</i> ${escapeCd(me)}</span><button type="button" class="pr-close" aria-label="Close">✕</button></div><div class="pc-body">${body}</div></div>`;
  document.body.appendChild(m);
  const card = m.querySelector(".pc-card");
  const close = () => { m.classList.add("out"); setTimeout(() => m.remove(), 220); };
  m.querySelector(".pr-close").addEventListener("click", close);
  m.addEventListener("click", (e) => { if (e.target === m) close(); });
  m.querySelector(".pc-replay")?.addEventListener("click", () => openPathRun(name, true));
  m.querySelector(".pc-share")?.addEventListener("click", () => { track("path-share", { event: true }); sharePath(name, sc); });
  let y0 = null, dy = 0;
  card.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; dy = 0; card.style.transition = "none"; }, { passive: true });
  card.addEventListener("touchmove", (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); if (dy > 0) card.style.transform = `translateY(${dy}px)`; }, { passive: true });
  card.addEventListener("touchend", () => { if (y0 == null) return; y0 = null; card.style.transition = ""; if (dy > 90) { card.style.transform = "translateY(120%)"; close(); } else card.style.transform = ""; });
  track("path-card", { event: true });
  // Whose path was opened, for the console's path to win tracker.
  noteUse(`path-of-${name}`);
}
function openPathRun(name, replay = false) {
  if (!replay && pathSeen(name)) return openPathCard(name);
  document.querySelector(".pr-screen")?.remove();
  const sc = pathScenario(name);
  const token = ++pathRunToken;
  const all = lastGoodCloudPicks || {};
  const results = computeLiveResults(latestLive);
  const pts = Object.fromEntries(MANAGERS.map((n) => [n, GAMES.reduce((t, g) => t + (results[g.id] ? scorePick(g, all[n]?.picks?.[g.id], results[g.id]) || 0 : 0), 0)]));
  const me = shown(name).toUpperCase();
  // Reduce Motion still plays the run game by game; only the slides (in
  // CSS) and the closing fold are left out.
  let fast = !replay && pathSeen(name);
  const m = document.createElement("div");
  m.className = "pr-screen"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", `Path to win for ${shown(name)}`);
  // A DOS window: the title bar on top (drag it down, or tap X, to close),
  // the standings, then the terminal.
  m.innerHTML = `<div class="pr-win">
    <div class="pr-bar"><span class="pr-grip" aria-hidden="true"></span><span class="pr-bar-t">PATH TO WIN <i>·</i> ${escapeCd(me)}</span>${fast ? "" : `<button type="button" class="pr-skip">SKIP</button>`}<button type="button" class="pr-close" aria-label="Close">✕</button></div>
    <div class="pr-meter"><span class="pr-meter-l">WIN CHANCE</span><span class="pr-meter-bar"><i></i></span><b class="pr-meter-v">--</b></div>${pathStaleNote()}
    <div class="pr-stand"><div class="pr-stand-h"><span>#</span><span>STANDINGS</span>${MANAGERS.length > 5 ? `<button type="button" class="pr-more" aria-expanded="false">ALL ▾</button>` : ""}<span>PTS</span></div><ol class="pr-board"></ol></div>
    <div class="pr-term"><div class="pr-lines"></div><span class="pr-cursor">█</span></div>
  </div>`;
  document.body.appendChild(m);
  const win = m.querySelector(".pr-win"), board = m.querySelector(".pr-board"), lines = m.querySelector(".pr-lines"), term = m.querySelector(".pr-term");
  // Five rows: the top five, or the top four and this manager below a gap.
  // ALL ▾ opens every row; the terminal shrinks to its last few lines.
  const ROW = 24;
  let SHOW = Math.min(5, MANAGERS.length);
  const rows = Object.fromEntries(MANAGERS.map((n) => {
    const li = document.createElement("li");
    li.className = `pr-row${n === name ? " me" : ""}`;
    li.innerHTML = `<span class="pr-rk"></span><span class="pr-nm">${escapeCd(shown(n).toUpperCase())}</span><span class="pr-gain"></span><span class="pr-pt"></span>`;
    board.appendChild(li);
    return [n, li];
  }));
  board.style.height = `${SHOW * ROW}px`;
  // Each game moves the board in two beats: this manager slides to their
  // new place first, then everyone else settles around them.
  const place = (n, slot) => {
    const li = rows[n];
    li.classList.toggle("off", slot < 0);
    li.style.transform = `translateY(${(slot < 0 ? SHOW : slot) * ROW}px)`;
  };
  const paint = async (gains = {}, staged = false) => {
    const order = [...MANAGERS].sort((a, b) => pts[b] - pts[a] || (a === name ? -1 : b === name ? 1 : 0) || MANAGERS.indexOf(a) - MANAGERS.indexOf(b));
    const myAt = order.indexOf(name);
    const shownOrder = myAt < SHOW ? order.slice(0, SHOW) : [...order.slice(0, SHOW - 1), name];
    board.style.height = `${SHOW * ROW}px`;
    order.forEach((n) => {
      const li = rows[n], rank = 1 + order.findIndex((x) => pts[x] === pts[n]), tied = order.filter((x) => pts[x] === pts[n]).length > 1;
      li.querySelector(".pr-rk").textContent = `${tied ? "T" : ""}${rank}`;
      li.querySelector(".pr-pt").textContent = String(pts[n]).padStart(2, "0");
      li.querySelector(".pr-gain").textContent = gains[n] ? `+${gains[n]}` : "";
      // Restart the pop every game, even for a row that gained last game too.
      li.classList.remove("gained");
      if (gains[n]) { void li.offsetWidth; li.classList.add("gained"); }
    });
    rows[name].classList.toggle("jump", myAt >= SHOW);
    if (staged && !fast) {
      place(name, shownOrder.indexOf(name));
      await new Promise((r) => setTimeout(r, 380));
    }
    order.forEach((n) => place(n, shownOrder.indexOf(n)));
  };
  paint();
  // The win chance meter: today's number, then recomputed as each game in
  // the path is decided, counting up to WIN at the end.
  const meterBar = m.querySelector(".pr-meter-bar i"), meterVal = m.querySelector(".pr-meter-v");
  let meterNow = 0;
  const pctText = (v) => v >= 0.995 ? "99%+" : v > 0 && v < 0.01 ? "<1%" : `${Math.round(v * 100)}%`;
  const setMeter = (v, done = false) => {
    meterBar.style.width = `${Math.max(2, Math.min(100, v * 100)).toFixed(1)}%`;
    m.querySelector(".pr-meter").classList.toggle("won", done);
    if (done) { meterVal.textContent = "WIN"; meterNow = 1; return; }
    const from = meterNow; meterNow = v;
    if (fast) { meterVal.textContent = pctText(v); return; }
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 450); meterVal.textContent = pctText(from + (v - from) * k); if (k < 1 && alive()) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  setMeter(winChanceMemo.detail?.[name]?.pct ?? pathChance(name, new Map()) ?? 0);
  const decided = new Map();
  m.querySelector(".pr-more")?.addEventListener("click", (e) => {
    const open = SHOW < MANAGERS.length;
    SHOW = open ? MANAGERS.length : Math.min(5, MANAGERS.length);
    m.classList.toggle("all", open);
    e.currentTarget.textContent = open ? "TOP 5 ▴" : "ALL ▾";
    e.currentTarget.setAttribute("aria-expanded", String(open));
    paint();
    term.scrollTop = term.scrollHeight;
  });
  const alive = () => token === pathRunToken && document.body.contains(m);
  const wait = (ms) => new Promise((r) => setTimeout(r, fast ? 0 : ms));
  const line = (html, cls = "") => { const d = document.createElement("div"); d.className = `pr-line ${cls}`; d.innerHTML = html; lines.appendChild(d); if (!fast) term.scrollTop = term.scrollHeight; return d; };
  const type = async (text, cls = "") => { const d = line("", cls); for (let k = 1; k <= text.length; k++) { if (!alive()) return d; d.textContent = text.slice(0, k); if (!fast) await wait(28); } return d; };
  const close = () => { pathRunToken++; m.classList.add("out"); setTimeout(() => m.remove(), 220); };
  m.querySelector(".pr-close").addEventListener("click", close);
  m.querySelector(".pr-skip")?.addEventListener("click", (e) => { fast = true; markPathSeen(name); e.currentTarget.remove(); });
  // Drag down from the title bar or the standings, or from the top of the
  // terminal, to close; a short drag springs back.
  let y0 = null, dy = 0;
  win.addEventListener("touchstart", (e) => { const fromTop = !!e.target.closest(".pr-bar, .pr-stand"); y0 = fromTop || term.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; win.style.transition = "none"; }, { passive: true });
  win.addEventListener("touchmove", (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); if (dy > 0) win.style.transform = `translateY(${dy}px)`; }, { passive: true });
  win.addEventListener("touchend", () => { if (y0 == null) return; y0 = null; win.style.transition = ""; if (dy > 110) { win.style.transform = "translateY(100%)"; close(); } else win.style.transform = ""; });
  const logo = (id) => `<img class="pr-logo" src="${logoUrl(id)}" alt="" onerror="this.style.visibility='hidden'" />`;
  (async () => {
    await type(`C:\\> PATH ${me}`, "cmd");
    const dots = line("SIMULATING", "dim");
    for (let k = 0; k < 6 && alive() && !fast; k++) { dots.textContent = `SIMULATING${".".repeat(1 + (k % 3))}`; await wait(220); }
    if (!alive()) return;
    if (!sc) { dots.textContent = "SIMULATING..."; line(`No path left: ${escapeCd(shown(name))} can't finish first.`, "bad"); m.querySelector(".pr-skip")?.remove(); return; }
    dots.textContent = `SIMULATING ${sc.all.length} GAME${sc.all.length === 1 ? "" : "S"}...`;
    // The whole slate waits in line, dimmed, and each game lights up and
    // types its result when its turn comes.
    const queue = sc.all.map((st) => line(`<span class="pr-gc"><span class="pr-gl">${logo(st.g.awayId)}${logo(st.g.homeId)}</span><span class="pr-gt">${escapeCd(st.g.awayShort)} @ ${escapeCd(st.g.homeShort)}</span><span class="pr-gp"></span></span>`, "g queued"));
    await wait(400);
    for (const [qi, st] of sc.all.entries()) {
      if (!alive()) return;
      const g = st.g, row = queue[qi];
      // The line types itself: a block cursor blinks, then sweeps right,
      // printing the logos, the result and the points in steps behind it.
      const gains = {};
      for (const n of MANAGERS) { const p = scorePick(g, all[n]?.picks?.[g.id], st.res) || 0; if (p) gains[n] = p; }
      row.className = `pr-line g ${st.need ? "need" : "free"}${fast ? "" : " typing"}`;
      row.innerHTML = `<span class="pr-gc"><span class="pr-gl">${logo(g.awayId)}${logo(g.homeId)}</span><span class="pr-gt">${escapeCd(st.txt)}${(() => { const w = st.need && !gains[name] ? stopsWho(g, st.res, name, pts) : null; return w ? `<small class="pr-why">stops ${escapeCd(shown(w))}</small>` : ""; })()}</span><span class="pr-gp${gains[name] ? "" : " zero"}">${gains[name] ? `+${gains[name]}` : st.need ? "0" : ""}</span></span>${fast ? "" : `<span class="pr-gcur" aria-hidden="true">█</span>`}`;
      if (!fast) term.scrollTop = Math.max(0, row.offsetTop - term.clientHeight + row.offsetHeight + 60);
      // One cursor at a time: the terminal's resting cursor hides while a line types.
      if (!fast) { term.classList.add("typing"); await wait(200); row.classList.add("wipe"); await wait(390); row.classList.remove("typing", "wipe"); term.classList.remove("typing"); }
      for (const n in gains) pts[n] += gains[n];
      decided.set(g.id, st.res);
      const last = qi === sc.all.length - 1;
      if (!fast || last) last ? setMeter(1, true) : setMeter(pathChance(name, decided, sc.guess) ?? meterNow);
      await paint(fast ? {} : gains, true);
      await wait(st.need ? 300 : 150);
    }
    if (!alive()) return;
    paint();
    markPathSeen(name);
    m.querySelector(".pr-skip")?.remove();
    m.querySelector(".pr-cursor")?.remove();
    // The finish, in place: everything but the games that matter folds
    // away, the window closes up around them, and the result fades in at
    // the bottom. One window throughout, nothing flying across it.
    const top = Math.max(...Object.values(pts)), tied = MANAGERS.filter((n) => pts[n] === top).length > 1;
    const oneIn = sc.p > 0 ? Math.max(2, Math.round(1 / sc.p)) : null;
    const free = sc.all.length - sc.need.length;
    const foot = document.createElement("div");
    foot.className = "pr-end";
    foot.innerHTML = `${free ? `<div class="pc-free">The other ${free} game${free === 1 ? "" : "s"} can go either way.</div>` : ""}
      ${tied && sc.guess != null && sc.tbGame ? `<div class="pc-tie">Tied at ${top}: needs the tiebreaker, ${escapeCd(sc.tbGame.awayShort)} @ ${escapeCd(sc.tbGame.homeShort)} total near ${sc.guess}</div>` : ""}
      <div class="pc-win">${escapeCd(me)} WINS THE WEEK</div>
      <div class="pc-foot"><span>${oneIn ? (oneIn > 10000 ? "Rarer than 1 in 10,000" : `About 1 in ${oneIn.toLocaleString()}`) : ""}</span><span class="pc-btns"><button type="button" class="pc-share">↗ Share</button><button type="button" class="pc-replay">▶ Replay</button></span></div>`;
    foot.querySelector(".pc-replay").addEventListener("click", () => openPathRun(name, true));
    foot.querySelector(".pc-share").addEventListener("click", () => { track("path-share", { event: true }); sharePath(name, sc); });
    const folding = [m.querySelector(".pr-meter"), m.querySelector(".pr-stand"), ...lines.querySelectorAll(".pr-line.g.free, .pr-line.cmd, .pr-line.dim")].filter(Boolean);
    const still = fast || matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      folding.forEach((el) => el.remove());
      lines.appendChild(foot);
      m.classList.add("ended");
      term.scrollTop = 0;
      return;
    }
    // One motion: the pieces fold, the window shrinks to fit and glides to
    // centre, and the result fades up, all on the same curve together.
    const winEl = m.querySelector(".pr-win");
    // Ease in and out: a soft start, a glide, a gentle landing.
    const D = 820, EASE = "cubic-bezier(.65, 0, .35, 1)";
    const r0 = winEl.getBoundingClientRect(), h0 = r0.height;
    m.classList.add("ending");
    winEl.style.height = `${h0}px`;
    foot.style.opacity = "0";
    lines.appendChild(foot);
    // Measure the end state in a single frame, then put everything back.
    const sizes = folding.map((el) => el.getBoundingClientRect().height);
    const keepScroll = term.scrollTop;
    folding.forEach((el) => { el.style.display = "none"; });
    winEl.style.height = "auto";
    const h1 = Math.min(winEl.getBoundingClientRect().height, h0);
    folding.forEach((el) => { el.style.display = ""; });
    winEl.style.height = `${h0}px`;
    term.scrollTop = keepScroll;
    // On a phone the window sits at the top; it glides down to centre as it
    // shrinks. On a computer it is already centred and stays so.
    const phone = innerWidth < 700;
    const shift = phone ? Math.max(0, (innerHeight - h1) / 2 - r0.top) : 0;
    term.style.overflow = "hidden";
    term.scrollTo({ top: 0, behavior: "smooth" });
    folding.forEach((el, k) => {
      el.style.overflow = "hidden";
      el.animate([
        { maxHeight: `${sizes[k]}px`, minHeight: "0px", opacity: 1 },
        { opacity: 0, offset: 0.35 },
        // min-height too: a line's own min-height would otherwise hold it
        // open until it is removed, and the rows would jump at the end.
        { maxHeight: "0px", minHeight: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px", marginTop: "0px", marginBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px" },
      ], { duration: D, easing: EASE, fill: "forwards" });
    });
    const shrink = winEl.animate([
      { height: `${h0}px`, transform: "translateY(0)" },
      { height: `${h1}px`, transform: `translateY(${shift}px)` },
    ], { duration: D, easing: EASE, fill: "forwards" });
    foot.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 460, delay: D * 0.6, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both" });
    await shrink.finished.catch(() => {});
    if (!alive()) return;
    folding.forEach((el) => el.remove());
    winEl.style.height = `${h1}px`;
    winEl.style.transform = shift ? `translateY(${shift}px)` : "";
    shrink.cancel();
    term.style.overflow = "";
    foot.style.opacity = "";
    m.classList.add("ended");
  })();
  track("path-run", { event: true });
  noteUse(`path-of-${name}`);
}
// The path is worked out from the board's numbers, which on opening can be
// the copy saved on the last visit. Before a path shows, the scores are
// read fresh and the odds worked out from them, so a game that has
// finished since is never played out again.
async function pathFresh() {
  if (!lastGoodCloudPicks) { const d = await fetchBoardPicks().catch(() => null); if (d) lastGoodCloudPicks = d; }
  const old = liveFetchedAt;
  if (!liveFetchedAt || Date.now() - liveFetchedAt > 60000) await fetchLiveScores(true).catch(() => {});
  if (lastGoodCloudPicks) weekWinChances(boardCloudPicks(lastGoodCloudPicks), computeLiveResults(latestLive), latestLive);
  if (liveFetchedAt !== old && !scoreboardScreen.classList.contains("hidden")) withScrollPreserved(renderScoreboard);
}
// The button lives inside a card the board redraws, so one listener here.
let pathOpening = false;
document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".rd-path-btn");
  if (!b) return;
  e.stopPropagation();
  if (pathOpening) return;
  pathOpening = true; b.classList.add("busy");
  pathFresh().finally(() => { pathOpening = false; b.classList.remove("busy"); openPathRun(b.dataset.path); });
}, true);

function playerBreakdownHtml(name, state, results, live) {
  const ordered = gamesByKickoff();
  let banked = 0, liveCovering = 0, liveOpen = 0, wins = 0, losses = 0, liveFly = 0;
  // How much each open pick matters to this manager's week, from the same
  // simulation and ranked the way the biggest game is (how far the result
  // moves their chance, weighted by how open it still is). Five pixels,
  // scaled to their own biggest game, which is lit amber. No numbers.
  const wd = weekIsLive(results) ? winChanceMemo.detail?.[name] : null;
  // Nothing moves an OUT manager's chance, so no impact is drawn for them.
  const sway = wd?.alive === false ? {} : Object.fromEntries((wd?.games || []).map((e) => [e.game.id, e]));
  const topLev = Math.max(0, ...Object.values(sway).map((e) => e.lev));
  const swayHtml = (e) => {
    const lit = topLev > 0 ? Math.max(e.gap >= 0.01 ? 1 : 0, Math.round(5 * e.lev / topLev)) : 0;
    const top = wd.swing && e.game.id === wd.swing.game.id;
    return `<span class="rd-sway${top ? " top" : ""}" title="Hit it: ${winChanceLabel(e.ifHit, { alive: true })} · Miss it: ${winChanceLabel(e.ifMiss, { alive: true })}"><span class="rd-sway-bar">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= lit ? "on" : ""}"></i>`).join("")}</span></span>`;
  };
  const rows = ordered.map((game) => {
    const locked = isGameLocked(game);
    const pick = state.picks[game.id];
    const g = live[game.id];
    const isFinal = !!results[game.id];
    const isLive = !isFinal && g && g.found && g.state === "in";
    const statusTag = isFinal ? `<span class="rd-tag final">FINAL</span>` : isLive ? `<span class="rd-tag live">${g.detail || "LIVE"}</span>` : locked ? `<span class="rd-tag wait">WAITING</span>` : `<span class="rd-tag time">${game.kickoffLabel.replace(/^(Sat|Sun) /, "")}</span>`;

    let pickHtml, ptsHtml = `<span class="rd-pts none">–</span>`;
    let pickedSide = null;
    if (!locked) {
      pickHtml = `<span class="rd-pickcard hidden-pick">🔒 HIDDEN</span>`;
    } else if (!pick) {
      pickHtml = `<span class="rd-pickcard nopick${isFinal ? " lost" : ""}">NO PICK</span>`;
      // A kicked-off game with nothing submitted scores nothing, so it is
      // a zero rather than a dash. A dash here read the same as the rows
      // still waiting below it.
      if (isFinal) ptsHtml = `<span class="rd-pts miss">0</span>`;
    } else {
      pickedSide = pick.team === game.away ? "away" : "home";
      const pickId = pick.team === game.away ? game.awayId : game.homeId;
      const short = pick.team === game.away ? game.awayShort : game.homeShort;
      const worth = pointValue(game, pick.team, pick.mode);
      // The stake lives inside the mode pill rather than in its own line
      // of text, because the PTS column beside it already says what the
      // pick was worth once the game is decided.
      const terms = pick.mode === "ATS" ? `${pick.team === game.favorite ? "-" : "+"}${game.spread}` : "SU";
      const mode = `<span class="rd-mode ${pick.mode === "ATS" ? "ats" : "su"}">${terms}<span class="rd-mode-pt">${worth}PT</span></span>`;
      pickHtml = `<span class="rd-pickcard"><span class="rd-pickteam"><img class="rd-logo" src="${logoUrl(pickId)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" /><span class="rd-team">${short}</span></span><span class="rd-pickmeta">${mode}${pickTimeLabel(pick) ? `<span class="rd-when">${pickTimeLabel(pick)}</span>` : ""}</span></span>`;
      const pts = scorePick(game, pick, results[game.id]);
      if (pts !== null) {
        banked += pts;
        const pushed = pick.mode === "ATS" && resultOutcome(game, results[game.id])?.push;
        if (!pushed) { if (pts > 0) wins += 1; else losses += 1; }
        ptsHtml = pushed ? `<span class="rd-pts push">PUSH</span>` : pts > 0 ? `<span class="rd-pts ${ptsValueTier(pts)}">+${pts}</span>` : `<span class="rd-pts miss">0</span>`;
      } else if (isLive && Number.isFinite(g.awayScore) && Number.isFinite(g.homeScore) && (g.awayScore || g.homeScore)) {
        const prov = scorePick(game, pick, { awayScore: g.awayScore, homeScore: g.homeScore });
        liveOpen += 1;
        if (prov > 0) { liveCovering += 1; liveFly += worth; ptsHtml = `<span class="rd-pts lean ${ptsValueTier(worth)}">+${worth}</span>`; }
        else ptsHtml = `<span class="rd-pts lean miss">0</span>`;
      }
    }
    if (!isFinal && !isLive && sway[game.id] && ptsHtml.includes("rd-pts none")) ptsHtml = swayHtml(sway[game.id]);
    const src = isFinal ? results[game.id] : isLive ? g : null;
    const aS = src && Number.isFinite(src.awayScore) ? src.awayScore : null;
    const hS = src && Number.isFinite(src.homeScore) ? src.homeScore : null;
    const scoreCell = (s, other) => `<span class="rd-sc ${isFinal && s !== null && s > other ? "win" : ""}">${s === null ? "" : s}</span>`;
    return `<div class="rd-row ${isFinal ? "final" : isLive ? "live" : ""}">
      <div class="rd-game">
        <span class="rd-gline">G${game.id} ${statusTag}</span>
        <span class="rd-matchup"><span class="rd-tm away ${pickedSide === "away" ? "picked" : ""}">${game.awayShort}</span>${scoreCell(aS, hS)}<span class="rd-tm home ${pickedSide === "home" ? "picked" : ""}">${game.homeShort}</span>${scoreCell(hS, aS)}</span>
      </div>
      <div class="rd-pick">${pickHtml}</div>
      <div class="rd-result">${ptsHtml}</div>
    </div>`;
  }).join("");
  // Tiebreaker row: the game, the guess, the real total once final, and
  // the miss, so the tiebreak ordering on the board is explained here.
  const tbGame = tiebreakerGameOf();
  const tbRaw = String(state.tiebreaker ?? "").trim();
  const tbGuess = tbRaw === "" ? null : Number(tbRaw);
  const tbRes = results[tbGame.id];
  const tbLive = !tbRes && live[tbGame.id] && live[tbGame.id].found && live[tbGame.id].state === "in" ? live[tbGame.id] : null;
  const actual = tbRes ? tbRes.awayScore + tbRes.homeScore : tbLive && Number.isFinite(tbLive.awayScore) && Number.isFinite(tbLive.homeScore) ? tbLive.awayScore + tbLive.homeScore : null;
  // Every guess stays sealed until the game kicks off, including your
  // own: a screen shared over someone's shoulder leaks it just the same.
  const tbSealed = !isGameLocked(tbGame);
  // Two plain lines: which game, then guess, actual and miss in order.
  let tbLine;
  if (tbSealed) tbLine = `Guess sealed until kickoff`;
  else if (tbGuess === null) tbLine = `<em>No guess entered</em>`;
  else if (tbRes) tbLine = `Guessed <b>${tbGuess}</b> · Final <b>${actual}</b> · Off by <b class="${Math.abs(tbGuess - actual) === 0 ? "exact" : ""}">${Math.abs(tbGuess - actual)}</b>`;
  else if (tbLive) tbLine = `Guessed <b>${tbGuess}</b> · Now <b>${actual}</b> · Off by <b>${Math.abs(tbGuess - actual)}</b>`;
  else tbLine = `Guessed <b>${tbGuess}</b> · Waiting on kickoff`;
  const tbRow = `<div class="rd-tb">
    <span class="rd-tb-label">TIEBREAKER · ${tbGame.awayShort} @ ${tbGame.homeShort} total</span>
    <span class="rd-tb-line">${tbLine}</span>
  </div>`;
  // One line on the week: settled points and record, plus what is in
  // flight while games are on.
  const summary = `<div class="rd-summary"><span><b>${banked}</b> PTS</span><span>${wins}-${losses}</span>${liveOpen ? `<span class="live"><b>+${liveFly}</b> LIVE · ${liveCovering} OF ${liveOpen} COVERING</span>` : ""}</div>`;
  // The arithmetic behind the leaderboard percentage, for this manager.
  let wpRow = "";
  if (wd) {
    const pc = (v) => winChanceLabel(v, { alive: true });
    const sw = wd.swing;
    const why = wd.alive === false ? outReason(name, results) : "";
    const canPath = wd.alive !== false && winChanceMemo.ctx && !winChanceMemo.ctx.picks.some((row) => row.some((p) => p?.hidden));
    wpRow = `<div class="rd-wp"><span class="rd-wp-top"><span class="rd-wp-label">CHANCE TO WIN THE WEEK · <b>${winChanceLabel(wd.pct, wd)}</b></span>${canPath ? `<button type="button" class="rd-path-btn" data-path="${escapeCd(name)}"><span class="rd-path-play">▶</span>${name === currentManager ? "MY " : ""}PATH TO WIN</button>` : ""}</span>${why ? `<span class="rd-wp-line">${escapeCd(why)}</span>` : sw ? (() => { const m = mirrorOf(name, sw, results); return `${swingMatchupHtml(name, sw, m)}<span class="rd-wp-line">Hit it → <b class="up">${pc(sw.ifHit)}</b> to win the week · Miss it → <b class="dn">${pc(sw.ifMiss)}</b></span>${m ? `<span class="rd-wp-why">${mirrorLine(name, m, sw.game)}</span>` : ""}`; })() : `<span class="rd-wp-line">No open pick moves it much now.</span>`}${Object.keys(sway).length ? `<span class="rd-wp-key">Impact bars: how much each game matters to ${name === currentManager ? "your" : `${escapeCd(shown(name))}'s`} chance this week</span>` : ""}</div>`;
  }
  // A Scouting Report published from the Creative Studio, under the week.
  const scout = creativeArt?.art?.[`owner-card:owner:${name}`]?.text;
  const scoutRow = scout ? `<div class="rd-scout"><em>📋 SCOUTING REPORT</em><b>${escapeCd(scout.headline)}</b>${String(scout.body).split(/\n\s*\n/).map((p) => `<p>${escapeCd(p)}</p>`).join("")}</div>` : "";
  return `<div class="rank-detail">${wpRow}${scoutRow}<div class="rd-head"><span>GAME</span><span>PICK</span><span>${Object.keys(sway).length ? "PTS<br>IMPACT" : "PTS"}</span></div>${rows}${tbRow}${summary}</div>`;
}

// Second line under a leaderboard name. How many picks are in is fair
// game: it says who still has work to do, not what they chose. The
// tiebreaker guess is a number to bid against, so it stays sealed for
// everyone until that game kicks off.
// Three fields, always the same three, in the same order. It used to be a
// sentence that grew and shrank per manager: the picks made only appeared
// when somebody had missed one, so nine rows read "TB 55 · OFF BY 8" and
// the tenth read "9/10 PICKED · TB 35 · OFF BY 12". Nothing lined up and
// the odd row out looked like a different kind of row rather than the same
// row with worse news. A dash holds a slot that has no value yet, so every
// line has the same shape whatever the week is doing.
// While games are in progress the third slot carries what that manager
// has in flight, in green, instead of a dash waiting on the tiebreaker.
function rankingSubline(row, actualTotal, tbGame, inFlight = null, results = null) {
  const picked = `${row.submittedCount}/${GAMES.length}`;
  if (!GAMES.some(isGameLocked)) return picked;
  const guess = row.tbGuess === null ? "TB –" : `TB ${row.tbGuess}`;
  if (results) {
    // Record on games already final, the most this card can still reach,
    // and what is in flight this minute.
    let w = 0, l = 0, max = row.score;
    for (const g of GAMES) {
      const pick = row.state.picks[g.id];
      if (results[g.id]) {
        if (!pick) continue;
        // A push on the spread is neither a win nor a loss.
        const o = resultOutcome(g, results[g.id]);
        if (pick.mode === "ATS" && o?.push) continue;
        if (scorePick(g, pick, results[g.id]) > 0) w += 1; else l += 1;
      } else if (pick) max += pointValue(g, pick.team, pick.mode);
    }
    const lead = row.submittedCount < GAMES.length ? `${picked} · ` : "";
    return `${lead}${w}-${l} · <span class="rank-max">MAX <b>${max}</b></span>${inFlight ? ` · <span class="rank-inflight">+${inFlight} LIVE</span>` : ""}`;
  }
  const off = row.tbGuess === null || actualTotal === null ? "OFF –" : `OFF ${row.tbDiff}`;
  return `${picked} · ${guess} · ${off}`;
}

function ordinal(n) {
  const s = ["TH", "ST", "ND", "RD"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// --- The pot ----------------------------------------------------------
// Ten managers at $140 each, paid out entirely week by week: $100 to
// whoever wins the week, fourteen weeks, which spends the pot exactly.
// The weekly tiebreaker settles ties, so one winner takes the hundred.
// Change these numbers and every figure below follows.
const POT = {
  buyIn: 140,
  members: 10,
  weeks: 14,   // weeks the league plays
  weekly: 100, // to the winner of each week
  season: [],  // nothing held back for the season
};
POT.total = POT.buyIn * POT.members;
POT.weeklyTotal = POT.weekly * POT.weeks;
POT.seasonTotal = POT.season.reduce((a, b) => a + b, 0);

const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

// Earnings come from the sealed summaries, which are the Worker's own
// record rather than anything a phone computed. A week with co-winners
// splits that week's money, though the tiebreaker should prevent it.
// This week's standings, handed over by the board so the pot can show a
// week in progress. Sealed weeks are the Worker's record; this is not.
let liveWeekRows = [];
let liveWeekFinal = false;

function payoutLedger() {
  const allSealed = Object.values(weekSummaries).filter((s) => s && s.complete);
  // Season points count every week, week 1 included (league call). An
  // exhibition week keeps its picks, points and trophy, but pays
  // nothing and does not count toward the weeks the pot is spread over.
  const sealed = allSealed.filter((s) => !s.exhibition);
  const rows = new Map(MANAGERS.map((n) => [n, { name: n, weeksWon: 0, earned: 0, points: 0, played: 0 }]));
  for (const s of allSealed) {
    const share = s.exhibition || !(s.winners || []).length ? 0 : POT.weekly / s.winners.length;
    for (const w of s.winners || []) {
      const r = rows.get(w); if (!r) continue;
      r.weeksWon += 1; r.earned += share;
    }
    for (const row of s.rows || []) {
      const r = rows.get(row.name); if (!r) continue;
      r.points += row.score || 0; r.played += 1;
    }
  }
  // A week that has not sealed yet contributes points but no money, so
  // the table is not a wall of zeros all Saturday while games play.
  const sealedWeeks = new Set(sealed.map((s) => s.week));
  const liveWeek = !sealedWeeks.has(currentWeek) && liveWeekRows.length ? currentWeek : null;
  if (liveWeek) {
    for (const r of liveWeekRows) {
      const row = rows.get(r.name);
      if (row) { row.livePoints = r.score || 0; row.points += r.score || 0; }
    }
  }
  const list = [...rows.values()].sort((a, b) => b.points - a.points || b.earned - a.earned || a.name.localeCompare(b.name));
  // Season money is a projection until the last week is sealed, so it is
  // labelled as one rather than added to what someone has actually won.
  const done = sealed.length >= POT.weeks;
  // Competition ranking, so a tie on points is shown as a tie rather than
  // broken by whatever order the names happened to land in. Season money
  // is real money, so a tie across a prize line has to be visible.
  let place = 0;
  list.forEach((r, i) => {
    const prev = list[i - 1];
    if (!prev || prev.points !== r.points) place = i + 1;
    r.seasonPlace = place;
    r.tied = (prev && prev.points === r.points) || (list[i + 1] && list[i + 1].points === r.points);
    r.seasonPrize = POT.season[place - 1] || 0;
  });
  const contested = POT.season.length > 0 && list.some((r) => r.tied && r.seasonPrize);
  return { list, sealed: sealed.length, done, contested, liveWeek, liveWeekFinal };
}

function renderPayouts() {
  const panel = document.getElementById("payouts-panel");
  if (!panel || panel.classList.contains("hidden")) return;
  // No record on this phone yet: say so rather than draw a wall of zeros.
  if (!weekSummariesReady) { panel.innerHTML = `<div class="pot-empty">Reading the record…</div>`; return; }
  const { list, sealed, done, contested, liveWeek, liveWeekFinal } = payoutLedger();
  const paid = list.reduce((a, r) => a + r.earned, 0);
  const left = POT.total - paid - POT.seasonTotal;
  // Season pick record: every correct and missed pick across the weeks on
  // the record (pushes and blanks count neither way).
  const rec = {};
  for (const w of Object.values(weekSummaries)) {
    if (!w?.complete) continue;
    for (const r of w.rows || []) { const x = rec[r.name] = rec[r.name] || { w: 0, l: 0 }; x.w += r.hits || 0; x.l += r.misses || 0; }
  }
  // One LED segment per week of the season: settled weeks carry the
  // winner's avatar, the live week pulses, the rest wait.
  const settled = Object.values(weekSummaries).filter((w) => w?.complete && !w.exhibition).sort((x, y) => x.week - y.week);
  const avOf = (n) => `<span class="ps-av" style="--accent:${accentFor(n)}" title="${shown(n)}">${avatarOverrides[n] || shown(n)[0]}</span>`;
  // Exhibition weeks lead the bar in silver: a trophy, no money.
  const exh = Object.values(weekSummaries).filter((w) => w?.complete && w.exhibition).sort((x, y) => x.week - y.week);
  const exhSegs = exh.map((w) => `<button type="button" class="ps-seg won exh" data-week="${w.week}" data-name="${(w.winners || [])[0] || ""}" title="Week ${w.week} · exhibition">${(w.winners || []).slice(0, 2).map(avOf).join("")}</button>`).join("");
  const seasonSegs = exhSegs + Array.from({ length: POT.weeks }, (_, i) => {
    const w = settled[i];
    if (w) return `<button type="button" class="ps-seg won" data-week="${w.week}" data-name="${(w.winners || [])[0] || ""}">${(w.winners || []).slice(0, 2).map(avOf).join("")}</button>`;
    if (i === settled.length && liveWeek) return `<span class="ps-seg live"></span>`;
    return `<span class="ps-seg"></span>`;
  }).join("");
  panel.innerHTML = `
    <div class="pot-jackpot">
      <div class="pj-label">★ JACKPOT · STILL IN PLAY ★</div>
      <div class="pj-amount">${money(Math.max(0, left + (POT.seasonTotal || 0)))}</div>
      <div class="pj-sub">${money(POT.total)} pot · ${POT.members} × ${money(POT.buyIn)} · ${money(POT.weekly)} a week${POT.season.length ? ` · season ${POT.season.map(money).join(" / ")}` : " · 1st only"}</div>
    </div>
    <div class="pot-season">
      <div class="ps-head"><span>SEASON</span><b>${sealed} / ${POT.weeks}</b></div>
      <div class="ps-bar" style="grid-template-columns: repeat(${POT.weeks + exh.length}, 1fr)">${seasonSegs}</div>
      <div class="pot-note">${money(paid)} paid out${POT.season.length && !done ? " · season money is a projection" : ""}</div>
    </div>
    ${liveWeek ? `<div class="pot-live">${liveWeekFinal ? `WEEK ${liveWeek} UNSEALED` : `WEEK ${liveWeek} ACTIVE`}</div>` : ""}
    ${contested ? `<div class="pot-warn">⚠ Season places are tied on points where the money sits. The weekly tiebreaker does not settle the season, so the league needs a rule for this before the last week.</div>` : ""}
    <div class="pot-table">
      <div class="pot-row head"><span>#</span><span>MANAGER</span><span>PTS</span><span>REC</span><span>WON</span><span>EARNED</span></div>
      ${list.map((r) => `<div class="pot-row${r.name === currentManager ? " me" : ""}${r.seasonPrize ? " inmoney" : ""}${r.seasonPlace === 1 && r.points > 0 ? " leader" : ""}" data-pot-row="${escapeCd(r.name)}" role="button" tabindex="0">
        <span class="pot-place">${r.tied ? "T" : ""}${r.seasonPlace}</span>
        <span class="pot-name"><span class="pot-av" style="--accent:${accentFor(r.name)}">${avatarOverrides[r.name] || shown(r.name)[0]}</span>${r.seasonPlace === 1 && r.points > 0 ? `<i class="pot-crown">♛</i>` : ""}${shown(r.name).toUpperCase()}${r.seasonPrize ? `<span class="pot-proj">+${money(r.seasonPrize)} ${done ? "" : "proj"}</span>` : ""}</span>
        <span class="pot-pts"><b>${r.points}</b><i class="pot-livemark">${r.livePoints ? "•" : ""}</i></span>
        <span class="pot-rec">${rec[r.name] ? `${rec[r.name].w}-${rec[r.name].l}` : "–"}</span>
        <span class="pot-won">${(() => { const wk = Object.values(weekSummaries).filter((w) => w?.complete && (w.winners || []).includes(r.name)).sort((x, y) => x.week - y.week); return wk.length ? wk.map((w) => `<button type="button" class="pot-tro${w.exhibition ? " exh" : ""}" data-week="${w.week}" data-name="${r.name}" title="Week ${w.week} win">🏆</button>`).join("") : "–"; })()}</span>
        <span class="pot-earned">${r.earned ? money(r.earned) : "–"}</span>
      </div>`).join("")}
    </div>
    ${sealed ? "" : `<div class="pot-empty">No weeks settled yet. Earnings appear once a week's last game is final.</div>`}`;
}

// --- Season head to head ------------------------------------------------
// Two managers' seasons side by side, opened from the pot: week by week
// who outscored whom, a tale of the tape from the sealed record and the
// pick ledger, and how often they were on the same side. Pool data only;
// side bets stay out.
const sh2h = { a: null, b: null };
// Pure: everything the panel shows for two names, from the sealed weeks
// (with their ledgers when the detail has loaded) and the pot's ledger.
function seasonH2H(a, b, weeks, ledger, pot) {
  const mk = () => ({ pts: 0, wk: 0, hits: 0, misses: 0, atsW: 0, atsL: 0, dogs: 0, best: null, tbSum: 0, tbN: 0, blanks: 0 });
  const s = { [a]: mk(), [b]: mk() };
  const meetings = [];
  let same = 0, both = 0, splitA = 0, splitB = 0, splitN = 0, splitPtsA = 0, splitPtsB = 0, swing = null;
  for (const w of weeks) {
    const ra = (w.rows || []).find((r) => r.name === a), rb = (w.rows || []).find((r) => r.name === b);
    for (const [n, r] of [[a, ra], [b, rb]]) {
      if (!r) continue;
      const m = s[n];
      m.pts += r.score || 0; m.wk += 1;
      if (!m.best || r.score > m.best.score) m.best = { score: r.score, week: w.week };
      if (r.tbDiff != null) { m.tbSum += r.tbDiff; m.tbN += 1; }
    }
    if (ra && rb) meetings.push({ week: w.week, a: ra.score || 0, b: rb.score || 0, live: !!w.live });
  }
  for (const w of ledger || []) {
    const la = (w.rows || []).find((r) => r.name === a)?.ledger || [], lb = (w.rows || []).find((r) => r.name === b)?.ledger || [];
    for (const [n, list] of [[a, la], [b, lb]]) for (const l of list) {
      if (l.result === "pending") continue;
      const m = s[n];
      if (!l.team) { m.blanks += 1; continue; }
      if (l.result === "hit") m.hits += 1; else if (l.result === "miss") m.misses += 1;
      if (l.mode === "ATS") { if (l.result === "hit") m.atsW += 1; else if (l.result === "miss") m.atsL += 1; }
      if (l.mode === "SU" && l.team !== l.favorite && l.result === "hit") m.dogs += 1;
    }
    for (const x of la) {
      const y = lb.find((l) => l.g === x.g);
      if (!x.team || !y?.team || x.result === "pending") continue;
      both += 1;
      if (x.team === y.team) same += 1;
      else {
        // A split: they took different sides. Who was right, what it paid,
        // and the one that swung the most points between them.
        splitN += 1;
        const pa = x.result === "hit" ? x.pts || 0 : 0, pb = y.result === "hit" ? y.pts || 0 : 0;
        splitPtsA += pa; splitPtsB += pb;
        if (x.result === "hit" && y.result !== "hit") splitA += 1;
        else if (y.result === "hit" && x.result !== "hit") splitB += 1;
        if (!swing || Math.abs(pa - pb) > Math.abs(swing.pa - swing.pb)) swing = { week: w.week, matchup: x.matchup, a: x.team, b: y.team, la: x.line, lb: y.line, pa, pb };
      }
    }
  }
  const potRow = (n) => pot.list.find((r) => r.name === n) || {};
  // The week in progress shows, but only sealed weeks count in the record.
  const done = meetings.filter((m) => !m.live);
  const rec = { a: done.filter((m) => m.a > m.b).length, b: done.filter((m) => m.b > m.a).length, t: done.filter((m) => m.a === m.b).length };
  return { s, meetings, rec, same, both, splitA, splitB, splitN, splitPtsA, splitPtsB, swing, potA: potRow(a), potB: potRow(b) };
}
async function openSeasonH2H() {
  noteUse("season-h2h");
  const { list } = payoutLedger();
  if (!sh2h.a) sh2h.a = currentManager && MANAGERS.includes(currentManager) ? currentManager : list[0]?.name || MANAGERS[0];
  if (!sh2h.b || sh2h.b === sh2h.a) sh2h.b = list.find((r) => r.name !== sh2h.a)?.name || MANAGERS.find((n) => n !== sh2h.a);
  renderSeasonH2H();
  document.getElementById("sh2h-modal")?.classList.remove("hidden");
  // The pick ledger comes with the detail, which season stats also reads.
  if (!seasonLedger) { await fetchSeasonLedger(); renderSeasonH2H(); }
}
function renderSeasonH2H() {
  const modal = document.getElementById("sh2h-modal");
  if (!modal) return;
  const esc = escapeCd;
  const pot = payoutLedger();
  const sealed = Object.values(weekSummaries).filter((w) => w?.complete).sort((x, y) => x.week - y.week);
  // The week in progress counts too, marked live, so the race is current.
  const weeks = pot.liveWeek && liveWeekRows.some((r) => r.score) ? [...sealed, { week: pot.liveWeek, live: true, rows: liveWeekRows.map((r) => ({ name: r.name, score: r.score })) }] : sealed;
  const a = sh2h.a, b = sh2h.b;
  const d = seasonH2H(a, b, weeks, seasonLedger, pot);
  modal.querySelectorAll(".sh2h-select").forEach((el) => {
    const side = el.dataset.side;
    el.innerHTML = pot.list.map((r) => `<option value="${esc(r.name)}"${sh2h[side] === r.name ? " selected" : ""}>${esc(shown(r.name).toUpperCase())}</option>`).join("");
  });
  const fill = (side, name, pr) => {
    const card = modal.querySelector(`.h2h-fighter.${side}`);
    card.style.setProperty("--accent", accentFor(name));
    card.querySelector(".h2h-f-av").textContent = avatarOverrides[name] || shown(name)[0];
    card.querySelector(".h2h-f-name").textContent = shown(name).toUpperCase();
    card.querySelector(".h2h-f-meta").innerHTML = `<span>${pr.tied ? "T" : "#"}${pr.seasonPlace || "–"}</span><span>${pr.earned ? money(pr.earned) : "$0"}</span>`;
    card.querySelector(".h2h-f-score").textContent = String(pr.points || 0).padStart(2, "0");
    card.classList.toggle("ahead", (pr.points || 0) > ((side === "a" ? d.potB : d.potA).points || 0));
  };
  fill("a", a, d.potA); fill("b", b, d.potB);
  const A = d.s[a], B = d.s[b];
  const pct = (w, l) => (w + l ? Math.round((100 * w) / (w + l)) : null);
  // [label, a shown, b shown, a number, b number, lower wins]
  const tape = [
    ["SEASON PTS", A.pts, B.pts, A.pts, B.pts],
    ["PER WEEK", A.wk ? (A.pts / A.wk).toFixed(1) : "–", B.wk ? (B.pts / B.wk).toFixed(1) : "–", A.wk ? A.pts / A.wk : 0, B.wk ? B.pts / B.wk : 0],
    ["WEEKS WON", d.potA.weeksWon || 0, d.potB.weeksWon || 0, d.potA.weeksWon || 0, d.potB.weeksWon || 0],
    ["EARNED", money(d.potA.earned || 0), money(d.potB.earned || 0), d.potA.earned || 0, d.potB.earned || 0],
    ["BEST WEEK", A.best ? A.best.score : "–", B.best ? B.best.score : "–", A.best?.score || 0, B.best?.score || 0],
    ...(seasonLedger ? [
      ["PICKS RIGHT", `${A.hits}-${A.misses}`, `${B.hits}-${B.misses}`, pct(A.hits, A.misses) || 0, pct(B.hits, B.misses) || 0],
      ["ATS", `${A.atsW}-${A.atsL}`, `${B.atsW}-${B.atsL}`, pct(A.atsW, A.atsL) || 0, pct(B.atsW, B.atsL) || 0],
      ["DOG HITS", A.dogs, B.dogs, A.dogs, B.dogs],
      ["NO SHOWS", A.blanks, B.blanks, A.blanks, B.blanks, true],
    ] : []),
    ["TB MISS", A.tbN ? (A.tbSum / A.tbN).toFixed(1) : "–", B.tbN ? (B.tbSum / B.tbN).toFixed(1) : "–", A.tbN ? A.tbSum / A.tbN : Infinity, B.tbN ? B.tbSum / B.tbN : Infinity, true],
  ];
  const side = (x, y, low) => (x === y ? "" : (low ? x < y : x > y) ? "win" : "lose");
  const tapeHtml = tape.map(([lab, as, bs, an, bn, low]) => {
    const tot = Number.isFinite(an) && Number.isFinite(bn) && an + bn > 0 ? an + bn : 0;
    const wa = tot ? Math.round((100 * (low ? bn : an)) / tot) : 50;
    return `<div class="sh-row"><b class="sh-v a ${side(an, bn, low)}">${esc(as)}</b><span class="sh-mid"><span class="sh-lab">${lab}</span><span class="sh-bar"><u class="a" style="width:${wa}%"></u><u class="b" style="width:${100 - wa}%"></u></span></span><b class="sh-v b ${side(bn, an, low)}">${esc(bs)}</b></div>`;
  }).join("");
  const r = d.rec;
  const lead = r.a === r.b ? `Level at ${r.a}-${r.b}${r.t ? `-${r.t}` : ""}` : `${esc(shown(r.a > r.b ? a : b))} leads ${Math.max(r.a, r.b)}-${Math.min(r.a, r.b)}${r.t ? `-${r.t}` : ""}`;
  // A small scoreboard: weeks across, one row per player, the week's
  // winner lit in their side's colour, ties left plain.
  const nmA = escapeCd(shown(sh2h.a).toUpperCase()), nmB = escapeCd(shown(sh2h.b).toUpperCase());
  const weeksHtml = d.meetings.length ? `<div class="sh-board" style="--n:${d.meetings.length}">
      <span class="sh-bh"></span>${d.meetings.map((m) => `<span class="sh-bh">W${m.week}${m.live ? "•" : ""}</span>`).join("")}
      <span class="sh-bn a">${nmA}</span>${d.meetings.map((m) => `<span class="sh-bc a${m.a > m.b ? " win" : ""}">${m.a}</span>`).join("")}
      <span class="sh-bn b">${nmB}</span>${d.meetings.map((m) => `<span class="sh-bc b${m.b > m.a ? " win" : ""}">${m.b}</span>`).join("")}
    </div>` : `<div class="sh-none">No weeks on the record yet.</div>`;
  // The arguments: the games they picked opposite sides, and who was right.
  const short = (t) => String(t || "").split(" ").slice(0, -1).join(" ") || t;
  const agree = d.both ? (() => {
    const A = esc(shown(a)), B = esc(shown(b)), n = d.splitN, wa = d.splitA, wb = d.splitB;
    const tot = Math.max(1, wa + wb), lead = wa === wb ? "Dead even on the arguments" : `${wa > wb ? A : B} wins the arguments by ${Math.abs(wa - wb)}`;
    const sw = d.swing && d.swing.pa !== d.swing.pb ? `<div class="sh-swing"><small>BIGGEST SWING · WEEK ${d.swing.week}</small><span>${esc(d.swing.matchup || "")}: ${d.swing.pa > d.swing.pb ? A : B} took ${esc(short(d.swing.pa > d.swing.pb ? d.swing.a : d.swing.b))} for +${Math.max(d.swing.pa, d.swing.pb)}, ${d.swing.pa > d.swing.pb ? B : A} got 0</span></div>` : "";
    return `<div class="sh-agree sh-args">
      <div class="sh-agree-h"><span>THE ARGUMENTS</span><small>${n} game${n === 1 ? "" : "s"} on opposite sides</small></div>
      ${n ? `<div class="sh-argrow"><b class="a">${wa}</b><i><u class="a" style="width:${(wa / tot) * 100}%"></u><u class="b" style="width:${(wb / tot) * 100}%"></u></i><b class="b">${wb}</b></div>
      <div class="sh-argwho"><span class="a">${A} right</span><em>${lead}</em><span class="b">${B} right</span></div>
      ${d.splitPtsA + d.splitPtsB ? `<div class="sh-argpts">Points from those games: ${A} +${d.splitPtsA} · ${B} +${d.splitPtsB}</div>` : ""}${sw}` : `<div class="sh-agree-s">They have not split on a game yet.</div>`}
      <div class="sh-argfoot">${n - wa - wb > 0 ? `${n - wa - wb} split${n - wa - wb === 1 ? "" : "s"} where neither (or both) cashed · ` : ""}Same side on ${d.same} of ${d.both} games (${Math.round((100 * d.same) / d.both)}%)</div>
    </div>`;
  })() : "";
  document.getElementById("sh2h-body").innerHTML = `<div class="h2h-sec">WEEK BY WEEK · ${lead}</div>
    <div class="sh-weeks">${weeksHtml}</div>
    <div class="h2h-sec">TALE OF THE TAPE</div>
    <div class="sh-tape">${tapeHtml}</div>
    ${agree}
    ${seasonLedger ? "" : `<div class="sh-none">Loading pick records…</div>`}`;
}
document.getElementById("sh2h-open")?.addEventListener("click", (e) => { e.stopPropagation(); openSeasonH2H(); });
document.getElementById("sh2h-close")?.addEventListener("click", () => document.getElementById("sh2h-modal").classList.add("hidden"));
document.getElementById("sh2h-modal")?.addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden"); });
document.querySelectorAll(".sh2h-select").forEach((el) => el.addEventListener("change", () => {
  const side = el.dataset.side, other = side === "a" ? "b" : "a";
  if (sh2h[other] === el.value) sh2h[other] = sh2h[side]; // picking the other card swaps them
  sh2h[side] = el.value;
  renderSeasonH2H();
}));

// --- Weekly performance and trophies ----------------------------------
// The board is computed live from ESPN, so a week that has finished has
// to be handed to the Worker or it is never kept. Whichever phone is on
// the scoreboard when the last game goes final posts the finals; the
// Worker seals the week from its own copy of the slate and picks, and
// hands back the standings. One trophy per week won, drawn next to the
// name on the leaderboard.
let weekTrophies = {};
let weekSummaries = {};
const SEALED_KEY = "brochiefs_sealed_v1";
// The season record, kept on the phone so the pot and the replay open on
// real numbers while the Worker is asked again. weekSummariesReady says
// whether there is any record at all yet, cached or fresh.
const WEEKS_CACHE_KEY = "brochiefs_weeks_v1";
let weekSummariesReady = false;
try {
  const c = JSON.parse(localStorage.getItem(WEEKS_CACHE_KEY) || "null");
  if (c?.summaries) { weekSummaries = c.summaries; weekTrophies = c.trophies || {}; weekSummariesReady = true; }
} catch { /* private mode or a bad copy */ }
const potOpen = () => !document.getElementById("payouts-panel")?.classList.contains("hidden");

async function loadWeekSummaries() {
  if (!WORKER_URL) return;
  try {
    const res = await fetch(`${WORKER_URL}/weeks?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    weekTrophies = data.trophies || {};
    weekSummaries = data.summaries || {};
    weekSummariesReady = true;
    try { localStorage.setItem(WEEKS_CACHE_KEY, JSON.stringify({ summaries: weekSummaries, trophies: weekTrophies })); } catch { /* full or private */ }
    renderRecap();
    if (potOpen()) renderPayouts();
  } catch {
    // Leave whatever we had; trophies are decoration, not the score.
  }
}

// Once every game in the week is final, push the finals up. Tracked per
// week on this device so ten phones do not each post it ten times.
async function archiveWeekIfFinal(results) {
  if (!WORKER_URL || !GAMES.length) return;
  if (!GAMES.every((g) => results[g.id])) return;
  let done = [];
  try { done = JSON.parse(localStorage.getItem(SEALED_KEY) || "[]"); } catch {}
  if (done.includes(currentWeek)) return;
  try {
    const res = await fetch(`${WORKER_URL}/season`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ week: currentWeek, results }),
    });
    if (!res.ok) return;
    try { localStorage.setItem(SEALED_KEY, JSON.stringify([...done, currentWeek])); } catch {}
    await loadWeekSummaries();
  } catch {
    // Try again on the next refresh.
  }
}

// The standings themselves, with no DOM in them. Two screens show these
// now, the board's full table and the picks screen's one-line summary, and
// they must never disagree about who is leading.
function rankManagers(cloudPicks, results) {
  const tiebreakerGame = tiebreakerGameOf();
  const tbResult = tiebreakerGame ? results[tiebreakerGame.id] : null;
  const actualTotal = tbResult ? tbResult.awayScore + tbResult.homeScore : null;

  const rows = MANAGERS.map((name) => {
    const state = cloudPicks[name] || { picks: {} };
    // Count only games on this week's slate. Counting every key in the
    // picks object lets a leftover from another week inflate the number,
    // so the leaderboard and the All Picks grid could disagree.
    const submittedCount = GAMES.filter((g) => state.picks[g.id]).length;
    const tbRaw = String(state.tiebreaker ?? "").trim();
    const tbGuess = tbRaw === "" ? NaN : Number(tbRaw);
    const tbDiff = actualTotal !== null && Number.isFinite(tbGuess) ? Math.abs(tbGuess - actualTotal) : Infinity;
    return { name, state, score: computeScore(state, results), submittedCount, tbGuess: Number.isFinite(tbGuess) ? tbGuess : null, tbDiff };
  }).sort((a, b) => b.score - a.score || a.tbDiff - b.tbDiff);

  // Competition ranking: equal score and equal tiebreaker distance share a
  // place and show as T-3RD. Before the tiebreaker game is final every
  // equal score is a tie; after it, only identical guesses stay tied.
  let place = 0;
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    const tiedWithPrev = prev && prev.score === row.score && prev.tbDiff === row.tbDiff;
    if (!tiedWithPrev) place = i + 1;
    row.place = place;
  });
  rows.forEach((row, i) => {
    const next = rows[i + 1];
    row.tied = (rows[i - 1] && rows[i - 1].place === row.place) || (next && next.place === row.place);
    row.subline = rankingSubline(row, actualTotal, tiebreakerGame, null, results);
  });
  return rows;
}

// --- Live chance to win the week -------------------------------------------
// From lock until every game is final: simulate the rest of the week a
// couple of thousand times and count how often each manager finishes first.
// Final games are fixed; live games start from the score and the clock;
// games not yet started start from the line. The tiebreaker total is
// simulated too, so ties split the way the rules split them.
function weekIsLive(results) {
  return GAMES.length > 0 && GAMES.some(isGameLocked) && !GAMES.every((g) => results[g.id]);
}
// Poisson draw (Knuth), fine for the handful of scores left in a game.
function poissonRand(lam, rnd = Math.random) { if (!(lam > 0)) return 0; const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; }
// A seeded random stream (mulberry32). The week's simulation draws from
// one seeded by the picks and scores, so the same board always gives the
// same chances and the same path to win, until a result actually moves.
function seededRandom(text) {
  let h = 2166136261;
  for (let k = 0; k < text.length; k++) { h ^= text.charCodeAt(k); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gaussRand() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// Inverse of the standard normal CDF (Acklam's approximation, |error| < 1.2e-9).
function invNorm(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q0 = Math.min(Math.max(p, 1e-9), 1 - 1e-9), pl = 0.02425;
  if (q0 < pl) { const q = Math.sqrt(-2 * Math.log(q0)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (q0 > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - q0)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = q0 - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
// College football: final margins land about 16 points either side of the
// line (one standard deviation), totals about 14. The share still to be
// played scales both by the square root of the time left.
const CFB_MARGIN_SD = 16, CFB_TOTAL_SD = 14;
function timeLeftFrac(l) {
  if (!l || l.state !== "in") return 1;
  const p = Number(l.period) || 1;
  if (p > 4) return 0.03;
  const [m, sec] = String(l.clock || "15:00").split(":").map(Number);
  const clk = (Number.isFinite(m) ? m : 15) * 60 + (Number.isFinite(sec) ? sec : 0);
  return Math.min(1, Math.max(0.01, ((4 - p) * 900 + clk) / 3600));
}
// The scoring engine below, solved exactly instead of sampled: the chance
// the home side wins from margin m (home minus away) with lam scores left,
// each going home with probability p, worth 7 (60%) or 3 (40%). Level at
// the end goes to one more score, home with probability p.
function engineHomeWin(lam, p, m) {
  let nmax = 0, term = Math.exp(-lam), cdf = term;
  while (cdf < 1 - 1e-9 && nmax < 60) { nmax++; term *= lam / nmax; cdf += term; }
  const R = 7 * nmax + Math.abs(m) + 1, W = 2 * R + 1;
  let cur = new Float64Array(W), nxt = new Float64Array(W);
  cur[R + m] = 1;
  const steps = [[7, p * 0.6], [3, p * 0.4], [-3, (1 - p) * 0.4], [-7, (1 - p) * 0.6]];
  let win = 0, tie = 0, pn = Math.exp(-lam);
  for (let n = 0; n <= nmax; n++) {
    let w = 0;
    for (let d = R + 1; d < W; d++) w += cur[d];
    win += pn * w; tie += pn * cur[R];
    nxt.fill(0);
    for (let d = 0; d < W; d++) { const v = cur[d]; if (!v) continue; for (const [st, q] of steps) { const e = d + st; if (e >= 0 && e < W) nxt[e] += v * q; } }
    [cur, nxt] = [nxt, cur];
    pn *= lam / (n + 1);
  }
  return win + tie * p;
}
// Live games: tune the engine to ESPN's live win probability, which knows
// what a scoreboard does not (who has the ball, where, the timeouts). The
// split of the remaining scores is solved so the engine's chance of the
// home side winning equals ESPN's. When even a 97/3 split cannot get
// there (a team on the goal line late), the market is saying a score is
// likelier than the clock alone implies, so the scores left rise until it
// does. Before kickoff, and whenever ESPN has no number, the line rules.
const calibrateMemo = new Map();
function calibrateLive(lam, m, target) {
  const key = `${lam.toFixed(4)}|${m}|${target.toFixed(4)}`;
  if (calibrateMemo.has(key)) return calibrateMemo.get(key);
  if (calibrateMemo.size > 200) calibrateMemo.clear();
  const out = calibrateLiveRaw(lam, m, target);
  calibrateMemo.set(key, out);
  return out;
}
function calibrateLiveRaw(lam, m, target) {
  const t = Math.min(0.995, Math.max(0.005, target));
  const LO = 0.03, HI = 0.97;
  const solveP = (L) => { let a = LO, b = HI; for (let i = 0; i < 40; i++) { const mid = (a + b) / 2; if (engineHomeWin(L, mid, m) < t) a = mid; else b = mid; } return (a + b) / 2; };
  if (engineHomeWin(lam, LO, m) <= t && t <= engineHomeWin(lam, HI, m)) return { lam, p: solveP(lam) };
  const pb = t > engineHomeWin(lam, HI, m) ? HI : LO;
  const reach = (L) => pb === HI ? engineHomeWin(L, HI, m) >= t : engineHomeWin(L, LO, m) <= t;
  let a = lam, b = lam + 8;
  if (!reach(b)) return { lam: b, p: pb };
  for (let i = 0; i < 30; i++) { const mid = (a + b) / 2; if (reach(mid)) b = mid; else a = mid; }
  return { lam: b, p: solveP(b) };
}
// The ways a game can still end, as far as any pick cares: the favorite
// covers, wins by exactly the spread, wins without covering, or the
// underdog wins. Each has a stand in score (30 + margin against 30), and
// two that pay every pick the same count once (a 1 point favorite winning
// by 1 is the push, not a win without a cover).
const catSig = (g, o) => `${o.suWinner}|${o.push ? "push" : o.atsWinner}`;
function gameCats(g) {
  const sp = Number(g.spread) || 0, favHome = g.favorite === g.home;
  const dog = favHome ? g.awayShort : g.homeShort, fav = favHome ? g.homeShort : g.awayShort;
  const list = [{ m: Math.floor(sp) + 1, txt: sp ? `${fav} covers -${sp}` : `${fav} wins` }];
  if (Number.isInteger(sp) && sp > 0) list.push({ m: sp, txt: `${fav} by exactly ${sp}` });
  if (Math.floor(sp) >= 1) list.push({ m: 1, txt: `${fav} wins, no cover` });
  list.push({ m: -1, txt: `${dog} wins` });
  const seen = new Set(), out = [];
  for (const o of list) {
    const res = favHome ? { homeScore: 30 + o.m, awayScore: 30 } : { awayScore: 30 + o.m, homeScore: 30 };
    const sig = catSig(g, resultOutcome(g, res));
    if (!seen.has(sig)) { seen.add(sig); out.push({ ...o, res, sig }); }
  }
  return out;
}

// The week's win chance as shown. Never "0%": a manager the simulation
// never saw win is either out (no way left to finish first, checked
// exactly) or a long shot the 5,000 runs were too few to catch.
function winChanceLabel(x, d) {
  if (x > 0) return x >= 0.995 ? "99%+" : x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`;
  return d?.alive === false ? "OUT" : "<1%";
}

// Exact check for managers the simulation never saw win. Every open game
// can still end each of its few ways (gameCats), so walking every
// combination answers "is there any way left?" for certain, where 5,000
// random runs can only say "not seen". The walk drops a branch as soon as a
// manager's ceiling falls below someone's points already banked, so even
// a full slate is quick. Among the ways that work it keeps the likeliest
// (each way's odds come from the simulation), then frees every game whose
// result does not matter to it, leaving the short list a manager needs.
// Ties go through the tiebreaker as the league plays it: closest guess to
// the total wins, an exact tie or no guesses shares. An open tiebreaker
// game can still land on any total from its current one up.
function exactPaths(targets, models, picks, guesses, tbGame, catN, N) {
  const M = picks.length;
  const base = new Array(M).fill(0);
  const games = [];
  let tbFixed = null, tbCur = null;
  models.forEach((m, k) => {
    if (m.fixed) {
      for (let i = 0; i < M; i++) if (picks[i][k]) base[i] += scorePick(m.g, picks[i][k], m.fixed);
      if (m.g === tbGame) tbFixed = m.fixed.awayScore + m.fixed.homeScore;
      return;
    }
    if (m.g === tbGame) tbCur = (m.curA || 0) + (m.curH || 0);
    const raw = gameCats(m.g).map((c, ci) => ({ ...c, n: Math.max(catN[k]?.[ci] || 0, 0.5) }));
    const tot = raw.reduce((s, c) => s + c.n, 0);
    const cats = raw.map((c) => ({ ...c, p: c.n / tot, lp: Math.log(c.n / tot), pts: picks.map((row) => row[k] ? scorePick(m.g, row[k], c.res) : 0) })).sort((a, b) => b.p - a.p);
    games.push({ g: m.g, cats });
  });
  const D = games.length;
  const remMax = Array.from({ length: D + 1 }, () => new Array(M).fill(0)), remLog = new Array(D + 1).fill(0);
  for (let d = D - 1; d >= 0; d--) {
    for (let i = 0; i < M; i++) remMax[d][i] = remMax[d + 1][i] + Math.max(...games[d].cats.map((c) => c.pts[i]));
    remLog[d] = remLog[d + 1] + games[d].cats[0].lp;
  }
  // 2: wins the tie outright, 1: shares it, 0: loses it.
  let tbRange = null;
  if (tbFixed != null) tbRange = [tbFixed];
  else if (tbCur != null) {
    const hi = Math.max(tbCur, ...guesses.filter((v) => v != null)) + 2;
    tbRange = [];
    for (let t = tbCur; t <= hi && tbRange.length < 400; t++) tbRange.push(t);
  }
  const tbMemo = new Map();
  const tbFor = (i, T) => {
    const key = `${i}:${T.join(",")}`;
    if (tbMemo.has(key)) return tbMemo.get(key);
    let r = tbRange ? 0 : 1;
    if (tbRange) for (const t of tbRange) {
      const dist = (j) => guesses[j] == null ? Infinity : Math.abs(guesses[j] - t);
      const mine = dist(i);
      let alone = true, beat = false;
      for (const j of T) if (j !== i) { const dj = dist(j); if (dj < mine) { beat = true; break; } if (dj === mine) alone = false; }
      if (!beat) { r = Math.max(r, alone ? 2 : 1); if (r === 2) break; }
    }
    tbMemo.set(key, r);
    return r;
  };
  // Does manager i finish first (or share it) with these points?
  const firstWith = (i, score) => {
    let top = -1;
    for (const s of score) if (s > top) top = s;
    if (score[i] !== top) return 0;
    const T = [];
    for (let j = 0; j < M; j++) if (score[j] === top) T.push(j);
    return T.length === 1 ? 2 : tbFor(i, T);
  };
  const best = new Map();
  const assign = new Int8Array(D);
  const score = base.slice();
  let nodes = 0, blown = false;
  const BUDGET = 2e6;
  const dfs = (d, lp, live) => {
    if (++nodes > BUDGET) { blown = true; return; }
    let top = -1, topI = -1, second = -1;
    for (let j = 0; j < M; j++) { if (score[j] > top) { second = top; top = score[j]; topI = j; } else if (score[j] > second) second = score[j]; }
    const next = live.filter((i) => score[i] + remMax[d][i] >= (i === topI ? second : top) && !(best.has(i) && lp + remLog[d] <= best.get(i).lp));
    if (!next.length) return;
    if (d === D) {
      for (const i of next) { const r = firstWith(i, score); if (r) best.set(i, { lp, assign: assign.slice(), tie: r === 1 || score.filter((s) => s === score[i]).length > 1 }); }
      return;
    }
    const cats = games[d].cats;
    for (let c = 0; c < cats.length && !blown; c++) {
      const pts = cats[c].pts;
      for (let i = 0; i < M; i++) score[i] += pts[i];
      assign[d] = c;
      dfs(d + 1, lp + cats[c].lp, next);
      for (let i = 0; i < M; i++) score[i] -= pts[i];
    }
  };
  dfs(0, 0, targets.slice());
  const out = {};
  for (const i of targets) {
    if (blown) { out[i] = { alive: best.has(i) ? true : undefined }; if (!best.has(i)) continue; }
    const b = best.get(i);
    if (!b) { out[i] = { alive: false }; continue; }
    // Free each game the win doesn't depend on: every way it can end, with
    // the games already freed also free, still leaves i first.
    const free = [];
    const holds = (fr) => {
      const sc = base.slice();
      const fixedOf = (d) => games[d].cats[b.assign[d]].pts;
      for (let d = 0; d < D; d++) if (!fr.includes(d)) { const p = fixedOf(d); for (let j = 0; j < M; j++) sc[j] += p[j]; }
      const walk = (x) => {
        if (x === fr.length) return firstWith(i, sc) > 0;
        for (const c of games[fr[x]].cats) {
          for (let j = 0; j < M; j++) sc[j] += c.pts[j];
          const ok = walk(x + 1);
          for (let j = 0; j < M; j++) sc[j] -= c.pts[j];
          if (!ok) return false;
        }
        return true;
      };
      return walk(0);
    };
    let combos = 1;
    for (let d = 0; d < D; d++) {
      const n = games[d].cats.length;
      if (combos * n > 20000) break;
      if (holds([...free, d])) { free.push(d); combos *= n; }
    }
    const need = [];
    for (let d = 0; d < D; d++) if (!free.includes(d)) need.push({ g: games[d].g, txt: games[d].cats[b.assign[d]].txt, p: games[d].cats[b.assign[d]].p });
    // Every open game in the path: the needed result, or for a game that
    // does not matter, its likeliest result (any result keeps i first).
    const all = games.map((G, d) => { const free_ = free.includes(d), c = free_ ? G.cats[0] : G.cats[b.assign[d]]; return { g: G.g, need: !free_, txt: c.txt, res: c.res, p: c.p }; });
    out[i] = { alive: true, path: { need, all, p: need.reduce((s, x) => s * x.p, 1), tie: b.tie } };
  }
  return out;
}

let winChanceMemo = { key: "", out: null };
function weekWinChances(cloudPicks, results, live) {
  const key = JSON.stringify([GAMES.map((g) => { const l = live[g.id]; return [g.id, results[g.id] ? `${results[g.id].awayScore}-${results[g.id].homeScore}` : l ? `${l.state}${l.awayScore}-${l.homeScore}@${l.period}${l.clock}~${l.winProb ? Math.round(l.winProb.home * 10) : ""}` : ""]; }), MANAGERS.map((n) => JSON.stringify(cloudPicks[n]?.picks || {}) + (cloudPicks[n]?.tiebreaker ?? ""))]);
  if (winChanceMemo.key === key) return winChanceMemo.out;
  const N = 5000;
  const rnd = seededRandom(key);
  const tbGame = tiebreakerGameOf();
  const guesses = MANAGERS.map((n) => { const raw = String(cloudPicks[n]?.tiebreaker ?? "").trim(); const v = Number(raw); return raw !== "" && Number.isFinite(v) ? v : null; });
  const models = GAMES.map((g) => {
    if (results[g.id]) return { g, fixed: results[g.id] };
    const l = live[g.id];
    const odds = l?.odds && l.odds.spread != null ? l.odds : null;
    const homeEdge = odds ? (odds.favoriteSide === "home" ? odds.spread : -odds.spread) : (g.favorite === g.home ? Number(g.spread) : -Number(g.spread));
    const rem = timeLeftFrac(l);
    const inGame = l && l.state === "in";
    // The rest of the game is played as scoring plays, because a margin
    // only moves by a field goal or a touchdown. Expected points still to
    // come are the over/under times the share of the game left; at about
    // 5.4 points a score (60% touchdowns, 40% field goals) that sets how
    // many scores to draw. Each score goes to the home side with
    // probability 0.5 + edge / (2 x over/under), so on average the line is
    // what the remaining time is worth. A full game comes out about 16 to
    // 18 points either side of the line, matching college results; late
    // in a game it correctly makes "needs one more score" unlikely.
    const ou = odds?.overUnder ?? 52;
    const lam = Math.max(0, (ou * rem) / 5.4);
    const pHome = Math.min(0.95, Math.max(0.05, 0.5 + homeEdge / (2 * Math.max(30, ou))));
    const curA = inGame ? (l.awayScore || 0) : 0, curH = inGame ? (l.homeScore || 0) : 0;
    const espnWp = inGame && l.winProb && Number.isFinite(l.winProb.home) ? l.winProb.home / 100 : null;
    if (espnWp != null) { const c = calibrateLive(lam, curH - curA, espnWp); return { g, rem, lam: c.lam, pHome: c.p, curA, curH, espn: espnWp }; }
    return { g, rem, lam, pHome, curA, curH };
  });
  // Each manager's pick on each game, with what it pays.
  const picks = MANAGERS.map((n) => GAMES.map((g) => { const p = cloudPicks[n]?.picks?.[g.id]; return p ? { team: p.team, mode: p.mode, pts: pointValue(g, p.team, p.mode) } : null; }));
  const wins = new Array(MANAGERS.length).fill(0);
  const score = new Array(MANAGERS.length);
  // For each manager and each open game they picked: runs where the pick
  // hit, and how many of those they won; same for misses.
  const open = models.map((m) => !m.fixed);
  const hitN = MANAGERS.map(() => new Array(models.length).fill(0)), hitW = MANAGERS.map(() => new Array(models.length).fill(0));
  const hitThis = MANAGERS.map(() => new Array(models.length).fill(false));
  // For the per-player breakdown: final points reached (and wins at each),
  // runs with the top score, wins that needed the tiebreaker, and who wins
  // the runs a player loses.
  const finN = MANAGERS.map(() => ({})), finW = MANAGERS.map(() => ({}));
  const topN = new Array(MANAGERS.length).fill(0), tbW = new Array(MANAGERS.length).fill(0);
  const lostTo = MANAGERS.map(() => new Array(MANAGERS.length).fill(0));
  // How often each open game ended each of its ways, for the exact check.
  const catIx = models.map((m) => m.fixed ? null : new Map(gameCats(m.g).map((c, ci) => [c.sig, ci])));
  const catN = models.map((m, k) => m.fixed ? null : new Array(catIx[k].size).fill(0));
  for (let s = 0; s < N; s++) {
    score.fill(0);
    let tbTotal = null;
    for (let k = 0; k < models.length; k++) {
      const m = models[k];
      let res = m.fixed;
      if (!res) {
        let h = m.curH, a = m.curA;
        const n = poissonRand(m.lam, rnd);
        for (let q = 0; q < n; q++) { const pts = rnd() < 0.6 ? 7 : 3; if (rnd() < m.pHome) h += pts; else a += pts; }
        // Level at the end: overtime, decided by a score for one side.
        if (h === a) { const pts = rnd() < 0.6 ? 7 : 3; if (rnd() < m.pHome) h += pts; else a += pts; }
        res = { awayScore: a, homeScore: h };
      }
      if (m.g === tbGame) tbTotal = res.awayScore + res.homeScore;
      const o = resultOutcome(m.g, res);
      if (!m.fixed) { const c = catIx[k].get(catSig(m.g, o)); if (c != null) catN[k][c]++; }
      for (let i = 0; i < MANAGERS.length; i++) {
        const p = picks[i][k];
        if (!p) continue;
        const winner = p.mode === "SU" ? o.suWinner : o.atsWinner;
        const hit = !!(winner && winner === p.team);
        if (hit) score[i] += p.pts;
        hitThis[i][k] = hit;
      }
    }
    let best = -1, bestDiff = Infinity, lead = [];
    for (let i = 0; i < MANAGERS.length; i++) {
      const diff = guesses[i] === null || tbTotal === null ? Infinity : Math.abs(guesses[i] - tbTotal);
      if (score[i] > best || (score[i] === best && diff < bestDiff)) { best = score[i]; bestDiff = diff; lead = [i]; }
      else if (score[i] === best && diff === bestDiff) lead.push(i);
    }
    for (const i of lead) wins[i] += 1 / lead.length;
    const share = new Array(MANAGERS.length).fill(0);
    for (const i of lead) share[i] = 1 / lead.length;
    const atTop = score.filter((x) => x === best).length;
    for (let i = 0; i < MANAGERS.length; i++) {
      const f = score[i];
      finN[i][f] = (finN[i][f] || 0) + 1;
      finW[i][f] = (finW[i][f] || 0) + share[i];
      if (f === best) { topN[i]++; if (atTop > 1) tbW[i] += share[i]; }
      if (share[i] < 1) for (const j of lead) if (j !== i) lostTo[i][j] += 1 / lead.length;
    }
    for (let i = 0; i < MANAGERS.length; i++) for (let k = 0; k < models.length; k++) {
      if (!open[k] || !picks[i][k]) continue;
      if (hitThis[i][k]) { hitN[i][k]++; hitW[i][k] += share[i]; }
    }
  }
  // Swing game: the open pick whose result moves a manager's chance most.
  // If it hits: wins-when-hit / runs-when-hit; if it misses: the rest.
  const detail = {};
  const zeroes = MANAGERS.map((_, i) => i).filter((i) => wins[i] === 0);
  const exact = zeroes.length ? exactPaths(zeroes, models, picks, guesses, tbGame, catN, N) : {};
  MANAGERS.forEach((n, i) => {
    let best = null;
    const all = [];
    for (let k = 0; k < models.length; k++) {
      if (!open[k] || !picks[i][k]) continue;
      const hN = hitN[i][k], mN = N - hN;
      if (hN < 100 || mN < 100) continue;
      const ifHit = hitW[i][k] / hN, ifMiss = (wins[i] - hitW[i][k]) / mN;
      const gap = Math.abs(ifHit - ifMiss), p = hN / N;
      // Leverage: how far the result moves you, times how open it still is.
      // A pick that is 97% in barely matters however big the gap, so
      // p(1-p) weighs it down; a coin flip with the same gap ranks first.
      const lev = gap * p * (1 - p);
      const entry = { gap, lev, ifHit, ifMiss, pHit: p, game: models[k].g, pick: picks[i][k] };
      all.push(entry);
      if (!best || lev > best.lev) best = entry;
    }
    all.sort((x, y) => y.lev - x.lev);
    // Final points they could finish on, how often, and how often that wins.
    const finals = Object.keys(finN[i]).map(Number).sort((x, y) => x - y).map((f) => ({ pts: f, p: finN[i][f] / N, win: finW[i][f] / finN[i][f] }));
    const threats = MANAGERS.map((m, j) => ({ name: m, p: lostTo[i][j] / N })).filter((x) => x.p > 0).sort((x, y) => y.p - x.p).slice(0, 3);
    const pct = wins[i] / N;
    detail[n] = { pct, swing: best, games: all, finals, top: topN[i] / N, tb: tbW[i] / N, threats, moe: 1.96 * Math.sqrt(pct * (1 - pct) / N), runs: N, alive: wins[i] > 0 ? true : exact[i]?.alive, path: exact[i]?.path || null };
  });
  const out = Object.fromEntries(MANAGERS.map((n, i) => [n, wins[i] / N]));
  winChanceMemo = { key, out, detail, ctx: { models, picks, guesses, tbGame, catN, N } };
  return out;
}

// Double tap a player's chance: why they read what they read, right now.
function openPlayerChance(name) {
  const ctx = window.__wpCtx || {};
  const rows = ctx.rows || [], picks = ctx.cloudPicks || {}, results = ctx.results || {};
  const row = rows.find((r) => r.name === name);
  const wd = winChanceMemo?.detail?.[name];
  if (!row || !wd) return;
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pc = (x) => winChanceLabel(x, { alive: true });
  const short = (g, t) => t === g.home ? g.homeShort : g.awayShort;
  const terms = (g, pk) => pk.mode === "SU" ? "to win" : `${pk.team === g.favorite ? "-" : "+"}${g.spread}`;
  const maxOf = (n) => { let m = rows.find((r) => r.name === n)?.score || 0; for (const g of GAMES) { const pk = picks[n]?.picks?.[g.id]; if (pk && !results[g.id]) m += pointValue(g, pk.team, pk.mode); } return m; };
  const top = rows[0]?.score ?? 0;
  const leaders = rows.filter((r) => r.score === top).map((r) => r.name);
  const myMax = maxOf(name);
  const bestRival = rows.filter((r) => r.name !== name).map((r) => ({ n: r.name, m: maxOf(r.name), pct: winChanceMemo.detail?.[r.name]?.pct ?? 0 })).sort((x, y) => y.pct - x.pct)[0];
  // Standing, in one plain line.
  const gap = top - row.score;
  const stand = gap > 0 ? `${gap} back of the lead with ${myMax - row.score} still in play.` : leaders.length > 1 ? (leaders.length > 4 ? `Tied for the lead with ${leaders.length - 1} others.` : `Tied for the lead with ${leaders.filter((n) => n !== name).map(shown).join(", ")}.`) : `Leading by ${row.score - (rows[1]?.score ?? 0)}.`;
  // Reasons, in order of weight.
  const why = [];
  if (myMax < top) why.push(`Your max (${myMax}) is below the lead (${top}). You can't catch up.`);
  else {
    const hi = rows.filter((r) => r.name !== name).map((r) => ({ n: r.name, m: maxOf(r.name) })).sort((x, y) => y.m - x.m)[0];
    if (hi && hi.m > myMax) why.push(`Your ceiling is ${myMax}; ${esc(shown(hi.n))} can still reach ${hi.m}.`);
    else if (hi) why.push(`Your ceiling of ${myMax} is as high as anyone's.`);
  }
  if (wd.pct === 0 && wd.alive === false && myMax >= top) why.unshift(`Every way the games left can finish, someone else ends with more points or wins the tiebreaker.`);
  else if (wd.pct === 0 && wd.top === 0 && myMax >= top) why.unshift(`In none of the ${wd.runs.toLocaleString()} runs do you finish with the most points, but it can still happen (see the best path).`);
  else if (wd.top > 0 && wd.pct < wd.top * 0.6) why.push(`You tie for the most points in ${pc(wd.top)} of runs but win only ${pc(wd.pct)}: the tiebreaker usually goes against you.`);
  // Who else rides each open pick: shared picks move everyone together.
  const open = GAMES.filter((g) => !results[g.id] && picks[name]?.picks?.[g.id]);
  const share = open.map((g) => {
    const pk = picks[name].picks[g.id];
    const with_ = MANAGERS.filter((n) => n !== name && picks[n]?.picks?.[g.id]?.team === pk.team).length;
    return { g, pk, with_ };
  });
  const lone = share.filter((x) => x.with_ <= 2), herd = share.filter((x) => x.with_ >= 6);
  if (lone.length) why.push(`Different from the room on ${lone.map((x) => `<b>${esc(short(x.g, x.pk.team))}</b>`).join(", ")}: a hit there jumps you past people.`);
  if (herd.length) why.push(`Most of the room shares ${herd.map((x) => esc(short(x.g, x.pk.team))).join(", ")}, so those barely move you.`);
  const tb = tiebreakerGameOf?.();
  const tbGuess = picks[name]?.tiebreaker;
  if (tb && tbGuess && leaders.length > 1 && leaders.includes(name)) why.push(`Ties go to the tiebreaker: you guessed ${esc(tbGuess)} for ${esc(tb.awayShort)} at ${esc(tb.homeShort)}.`);
  const games = (wd.games || []).filter((x) => x.gap >= 0.005).slice(0, 3).map((x) => `<li><span>${esc(short(x.game, x.pick.team))} ${esc(terms(x.game, x.pick))}</span><b class="up">${pc(x.ifHit)}</b><b class="dn">${pc(x.ifMiss)}</b></li>`).join("");
  // Every point total still reachable, highest first; the bar is how
  // often. Nothing folded away, so the column adds to 100%.
  const fins = (wd.finals || []).filter((f) => f.p > 0).sort((x, y) => y.pts - x.pts);
  const fmax = Math.max(...fins.map((f) => f.p), 0.01);
  // More points can win less often: the results that get you there tend to
  // lift the rest of the room too. Say so when the table shows it (rows
  // under 2% of runs are too thin to count).
  const solid = fins.filter((f) => f.p >= 0.02);
  const dips = solid.some((f, i) => i < solid.length - 1 && f.win + 0.02 < solid[i + 1].win);
  const backfire = (wd.games || []).filter((x) => x.ifHit + 0.01 < x.ifMiss);
  if (dips) why.push(`Finishing higher doesn't always help: your big totals come from results that lift others more (see the table).`);
  if (backfire.length) why.push(`${backfire.map((x) => `<b>${esc(short(x.game, x.pick.team))}</b>`).join(", ")} hitting actually <em>lowers</em> your chance: rivals ride the same result for more points.`);
  const finHtml = fins.map((f) => `<div class="wpp-fin-r${f.win >= 0.5 ? " good" : ""}${f.p < 0.02 ? " thin" : ""}"><b>${f.pts}</b><span class="wpp-bar"><i style="width:${Math.max(2, f.p / fmax * 100).toFixed(0)}%"></i><em>${pc(f.p)}</em></span><strong>${pc(f.win)}</strong></div>`).join("");
  const threatHtml = (wd.threats || []).map((t) => `<span class="wpp-th"><span class="pick-chip-av" style="--accent:${accentFor(t.name)}">${esc(avatarOverrides[t.name] || shown(t.name)[0])}</span>${esc(shown(t.name))}<b>${pc(t.p)}</b></span>`).join("");
  // You versus the one player who beats you most often: every game left,
  // what each of you has on it, and the best that game can do for you
  // against them. Summed, that is the most you can still gain on them.
  const rivalName = (wd.threats || [])[0]?.name || (leaders[0] !== name ? leaders[0] : rows.find((r) => r.name !== name)?.name);
  let vsHtml = "", verdict = "";
  // Someone else's card speaks in their name, not "you".
  const isMe = name === currentManager;
  const N = esc(shown(name));
  if (rivalName) {
    const rRow = rows.find((r) => r.name === rivalName);
    const outcomes = gameCats;
    const lines = [];
    let gain = 0, theirGain = 0, nSame = 0, nLeft = 0;
    const splits = [];
    for (const g of GAMES) {
      if (results[g.id]) continue;
      const mine = picks[name]?.picks?.[g.id], theirs = picks[rivalName]?.picks?.[g.id];
      if (!mine && !theirs) continue;
      let best = null, worst = null;
      for (const o of outcomes(g)) {
        const net = (mine ? scorePick(g, mine, o.res) : 0) - (theirs ? scorePick(g, theirs, o.res) : 0);
        if (!best || net > best.net) best = { net, txt: o.txt };
        if (!worst || net < worst.net) worst = { net, txt: o.txt };
      }
      gain += Math.max(0, best.net);
      theirGain += Math.max(0, -worst.net);
      const same = mine && theirs && mine.team === theirs.team && mine.mode === theirs.mode;
      nLeft++;
      if (same) nSame++; else splits.push({ g, mine, theirs, best, worst });
      const lab = (pk) => pk ? `${esc(short(g, pk.team))} ${esc(terms(g, pk))}` : "–";
      lines.push(`<li class="${same ? "same" : best.net > 0 ? "edge" : "dead"}"><span>${lab(mine)}</span><span>${lab(theirs)}</span><b>${same ? "same" : best.net > 0 ? `+${best.net}` : "0"}</b><em>${same ? "" : best.net > 0 ? `if ${esc(best.txt)}` : "can't gain here"}</em></li>`);
    }
    const back = (rRow?.score ?? 0) - row.score;
    const R = esc(shown(rivalName));
    // Plain words, scoreboard style: a short headline, one line per game
    // that can separate you, the same-pick games in one line, and a bottom line.
    const sameGames = [];
    for (const g of GAMES) {
      if (results[g.id]) continue;
      const a1 = picks[name]?.picks?.[g.id], b1 = picks[rivalName]?.picks?.[g.id];
      if (a1 && b1 && a1.team === b1.team && a1.mode === b1.mode) sameGames.push(esc(short(g, a1.team)));
    }
    const n = splits.length;
    const head = back > 0 ? `${back} back of ${R}.` : back === 0 ? `Tied with ${R}.` : `${-back} ahead of ${R}.`;
    const sub = n === 0 ? "Every pick left is the same, so nothing can change the gap." : `${n === 1 ? "One game" : `${n} games`} can change that.`;
    const gameLines = splits.map((x) => {
      const you = x.best.net > 0 ? `<span class="up">${esc(x.best.txt)} → ${isMe ? "you" : esc(shown(name))} +${x.best.net}</span>` : "";
      const them = x.worst.net < 0 ? `<span class="dn">${esc(x.worst.txt)} → ${R} +${-x.worst.net}</span>` : "";
      return `<li><b>${esc(x.g.awayShort)} at ${esc(x.g.homeShort)}</b>${you}${them}</li>`;
    }).join("");
    let bottom;
    const you = isMe ? "you" : N, You = isMe ? "You" : N;
    if (back > 0 && gain < back) bottom = `The most ${you} can gain is ${gain}. Not enough to catch ${R}.`;
    else if (back > 0) bottom = `${You} ${isMe ? "need" : "needs"} +${back + 1} from these to pass ${R} (+${back} ties, then the tiebreaker). The most ${you} can get is +${gain}.`;
    else if (back === 0) bottom = n ? `Whoever gains more on ${n === 1 ? "this game" : "these games"} finishes ahead. Even means the tiebreaker.` : "The tiebreaker decides it.";
    else bottom = theirGain > -back ? `${R} needs +${-back + 1} from these to pass ${you}. The most they can get is +${theirGain}.` : `${R} can gain at most ${theirGain}. They can't pass ${you} on points.`;
    const zero = wd.pct === 0 && wd.alive === false ? `<div class="wpp-zero">Why OUT: ${esc(outReason(name, results, picks) || "every way the games left can finish, someone else in the league still ends higher.")}</div>` : "";
    verdict = `<b class="wpp-vh">${head}</b> ${sub}`;
    vsHtml = `${n ? `<ul class="wpp-lines">${gameLines}</ul>` : ""}<div class="wpp-bottom">${bottom}</div>${zero}${sameGames.length ? `<div class="wpp-same">Same pick, no effect: ${sameGames.join(", ")}</div>` : ""}`;
  }
  // Zero wins in the simulation is two different things: out for certain,
  // or a long shot the runs missed. The exact check says which, and for a
  // long shot, the likeliest set of results that still gets there.
  let verdictTop = `${isMe ? "You win" : `${N} wins`} the week in <b>${pc(wd.pct)}</b> of simulated finishes.`;
  let pathHtml = "";
  if (wd.pct === 0 && wd.alive === false) verdictTop = `${isMe ? "You're" : `${N} is`} <b>out</b> this week: no way the games left can finish puts ${isMe ? "you" : "them"} first.`;
  else if (wd.pct === 0) {
    verdictTop = `${isMe ? "You" : N} won none of the ${wd.runs.toLocaleString()} simulated finishes, but ${isMe ? "you're" : "they're"} <b>not out</b>.`;
    const pt = wd.path;
    if (pt) {
      // Each result's odds come from 5,000 runs, so past 1 in 10,000 the
      // product is too fine to state.
      const oneIn = pt.p > 0 ? Math.max(2, Math.round(1 / pt.p)) : null;
      const list = [...pt.need].sort((a, b) => (Date.parse(a.g.kickoff) || 0) - (Date.parse(b.g.kickoff) || 0)).map((x) => `<li><span>${esc(x.txt)}</span><b>${pc(x.p)}</b></li>`).join("");
      const rest = `${pt.need.length ? "Every other game can go either way." : "Any results work."}${pt.tie ? ` It ends in a tie on points, so the tiebreaker has to go ${isMe ? "your" : "their"} way too.` : ""}`;
      pathHtml = `<div class="wpx-h">BEST PATH TO WIN</div><div class="wpp-cap">The likeliest results that still put ${isMe ? "you" : N} first. ${rest}</div>${list ? `<ul class="wpp-path">${list}</ul>` : ""}${oneIn ? `<div class="wpp-bottom">All of these together: ${oneIn > 10000 ? "<b>rarer than 1 in 10,000</b>" : `about <b>1 in ${oneIn.toLocaleString()}</b>`}.</div>` : ""}`;
    }
  }
  let m = document.getElementById("wp-player");
  if (!m) {
    m = document.createElement("div");
    m.id = "wp-player";
    m.className = "wpx-overlay hidden";
    m.setAttribute("role", "dialog");
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".wpx-x")) m.classList.add("hidden"); });
  }
  m.innerHTML = `<div class="wpx-card wpp">
    <button type="button" class="wpx-x" aria-label="Close">✕</button>
    <div class="wpp-head"><span class="wpp-av" style="--accent:${accentFor(name)}">${esc(avatarOverrides[name] || shown(name)[0])}</span><div><b>${esc(shown(name).toUpperCase())}</b><small>${row.score} PTS · MAX ${myMax}</small></div><i>${winChanceLabel(wd.pct, wd)}</i></div>
    <div class="wpp-verdict">${verdictTop}</div>
    ${pathHtml}
    ${games ? `<div class="wpx-h">THE PICKS THAT MATTER MOST</div><div class="wpp-cap">${isMe ? "Your" : `${N}'s`} chance to win the week if each one hits or misses.</div><div class="wpp-gh wpp-gh3"><span>PICK</span><span>IF IT HITS</span><span>IF IT MISSES</span></div><ul class="wpp-games wpp-games3">${games}</ul>` : ""}
    ${threatHtml ? `<div class="wpx-h">MOST LIKELY TO BEAT ${isMe ? "YOU" : N.toUpperCase()}</div><div class="wpp-thr">${threatHtml}</div>` : ""}
    <details class="wpp-more"><summary>SHOW THE MATH</summary>
      <div class="wpp-stand">${stand}</div>
      ${verdict ? `<div class="wpx-h">HEAD TO HEAD</div><div class="wpp-verdict small">${verdict}</div>${vsHtml}` : ""}
      <ul class="wpp-why">${why.map((w) => `<li>${w}</li>`).join("")}</ul>
      <div class="wpp-math"><span><b>${pc(wd.top)}</b>finish with most pts</span><span><b>${pc(wd.tb)}</b>win via tiebreak</span><span><b>±${(wd.moe * 100).toFixed(1)}%</b>sampling range</span></div>
      ${finHtml ? `<div class="wpx-h">WHERE YOU FINISH</div><div class="wpp-fin"><div class="wpp-fin-h"><span>PTS</span><span>HOW OFTEN YOU END THERE</span><span>THEN WIN</span></div>${finHtml}</div>` : ""}
      <div class="wpp-foot">From ${wd.runs.toLocaleString()} simulated finishes of this week, using live scores, ESPN's live win probability and the betting lines. Sampling range is the 95% band. Tap ? on WIN% for the method.</div>
    </details>
  </div>`;
  m.classList.remove("hidden");
  track("wp-player", { event: true });
}

// How chance to win works: a small arcade sheet, opened by tapping a
// chance bar or the LIVE note above the board.
function openWinChanceExplainer() {
  let m = document.getElementById("wp-explain");
  if (!m) {
    m = document.createElement("div");
    m.id = "wp-explain";
    m.className = "wpx-overlay hidden";
    m.setAttribute("role", "dialog");
    m.setAttribute("aria-label", "How chance to win works");
    m.innerHTML = `<div class="wpx-card">
      <button type="button" class="wpx-x" aria-label="Close">✕</button>
      <div class="wpx-title"><span>HOW</span> CHANCE TO WIN <span>WORKS</span></div>
      <div class="wpx-big">We play the rest of the week <b>5,000</b> times.<br>Your % is how often you finish <b>1st</b>.</div>
      <ol class="wpx-steps">
        <li><i>1</i><div><b>LOCK WHAT'S DONE</b><span>Final games count as they ended. Live games start from the real score and clock.</span></div></li>
        <li><i>2</i><div><b>PLAY OUT THE REST</b><span>Each game is played as scoring drives: about one score per 5.4 points of the over/under still to play. 60% are touchdowns, 40% field goals.</span></div></li>
        <li><i>3</i><div><b>FOLLOW THE MARKET</b><span>Before kickoff each score goes to the favourite a little more often, so on average the betting line holds. Once a game is live, the split is tuned until it matches ESPN's live win probability, which knows who has the ball and where.</span></div></li>
        <li><i>4</i><div><b>SCORE EVERY CARD</b><span>Your real picks and point values. Ties go to the tiebreaker; an exact tie splits the win.</span></div></li>
        <li><i>5</i><div><b>COUNT THE WINS</b><span>Finish 1st in 1,500 of 5,000 runs and you read 30%. Everyone adds up to 100%.</span></div></li>
      </ol>
      <div class="wpx-h">WHAT MOVES YOUR %</div>
      <div class="wpx-chips"><span>YOUR MAX POINTS</span><span>LIVE SCORES</span><span>TIME LEFT</span><span>THE LINE</span><span>ESPN WIN %</span><span>EVERYONE ELSE'S PICKS</span></div>
      <div class="wpx-ex"><b>EXAMPLE</b> Favourite up 7 on a 7.5 line. With 8:00 left they cover about <em>39%</em> of the time. With 1:00 left, about <em>8%</em>: they'd need one more score.</div>
      <div class="wpx-foot">No way left to finish first? You read OUT. Still a way, but too rare to show up in 5,000 runs? You read &lt;1%. Tap your row to see the pick that matters most for you.</div>
    </div>`;
    document.body.appendChild(m);
    const close = () => m.classList.add("hidden");
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".wpx-x")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }
  m.classList.remove("hidden");
  track("wp-explain", { event: true });
}

function renderRankings(cloudPicks, results, live = {}, precomputed = null) {
  const rows = precomputed || rankManagers(cloudPicks, results);
  if (anyGameLive(live)) {
    const tbGame = tiebreakerGameOf() || GAMES[0];
    const tbRes = tbGame && results[tbGame.id];
    const actualTotal = tbRes ? tbRes.awayScore + tbRes.homeScore : null;
    for (const row of rows) { row.inFlight = inFlightPoints(cloudPicks[row.name]?.picks || {}, live); row.subline = rankingSubline(row, actualTotal, tbGame, null, results); }
  }
  if (!anyGameLive(live)) for (const row of rows) delete row.inFlight;
  rankingsList.innerHTML = "";
  rankingsList.classList.toggle("wp-live", weekIsLive(results));
  if (weekIsLive(results)) {
    const ch = weekWinChances(cloudPicks, results, live);
    for (const row of rows) row.winPct = ch[row.name] ?? 0;
    window.__wpCtx = { rows, cloudPicks, results };
  } else for (const row of rows) delete row.winPct;
  renderRankingRows(rows, cloudPicks, results, live);
  drawChalkLine(rows, results);
  return rows;
}

// Once every game is final, the week's high score flashes above the
// board. Ties that the tiebreaker did not split show every name.
function renderWeekChamp(rows, results) {
  const el = document.getElementById("week-champ");
  if (!el) return;
  const allFinal = GAMES.every((g) => results[g.id]);
  if (!allFinal || !rows.length) { el.classList.add("hidden"); return; }
  const top = rows.filter((r) => r.place === rows[0].place);
  const names = top.map((r) => shown(r.name).toUpperCase()).join(" & ");
  const trophy = `<img class="wc-trophy" src="${awardArt("recap/trophy")}" alt="" aria-hidden="true" decoding="async">`;
  el.innerHTML = `<span class="wc-label"><span class="wc-rule"></span>${WEEK_LABEL.toUpperCase()} HIGH SCORE<span class="wc-rule"></span></span><span class="wc-line">${trophy}<span class="wc-name">${names}</span><span class="wc-pts">${String(rows[0].score).padStart(2, "0")}<small>PTS</small></span>${trophy}</span>`;
  el.classList.remove("hidden");
}

// Points a set of picks would bank if every game in progress ended as it
// stands. Games that are final are already in the score; games not yet
// started have nothing to say.
function inFlightPoints(picks, live) {
  let pts = 0;
  for (const game of GAMES) {
    const g = live[game.id];
    if (!g || !g.found || g.state !== "in" || g.completed) continue;
    if (!Number.isFinite(g.awayScore) || !Number.isFinite(g.homeScore)) continue;
    const pick = picks[game.id];
    if (!pick) continue;
    const p = scorePick(game, pick, { awayScore: g.awayScore, homeScore: g.homeScore });
    if (p > 0) pts += p;
  }
  return pts;
}
function anyGameLive(live) {
  return GAMES.some((game) => { const g = live[game.id]; return g && g.found && g.state === "in" && !g.completed; });
}

// "1UP" strip under the refresh line: the viewer's score and place, in
// arcade type. Tap jumps to their leaderboard row.
function renderMyScore(rows, cloudPicks = {}, live = {}) {
  const el = document.getElementById("my-score");
  if (!el) return;
  const me = currentManager && rows.find((r) => r.name === currentManager);
  if (!me) { el.classList.add("hidden"); headScoreHtml = ""; renderHeadScore(); return; }
  // Banked points sit at zero until games go final, which reads as a
  // contradiction next to a scorebug saying a pick is covering. Count what
  // is still in flight separately and show both.
  const inFlight = inFlightPoints(cloudPicks[currentManager]?.picks || {}, live);
  // Where you stand on the left, the board's own state on the right, one
  // row across the full width of the frame it caps. This replaces the two
  // centred lines that used to sit above it.
  // Before the first kickoff the board has nothing live to say, so the
  // right side counts down to the opener instead. The 1s timer keeps it
  // moving; see renderBoardCountdown.
  const next = gamesByKickoff().find((g) => !isGameLocked(g));
  const pre = next && !GAMES.some(isGameLocked);
  const state = boardAllFinal ? `<span class="ms-state final">FINAL</span>`
    : pre ? `<span class="ms-state kick" title="${next.awayShort} at ${next.homeShort}">KICK <b class="ms-kick">${kickoffCountdown(next.kickoff)?.brief || ""}</b></span>`
    : "";
  const clock = `<button class="ms-refresh${cloudPicksStale ? " stale" : ""}" type="button" title="${cloudPicksStale ? "Picks did not reload. Tap to try again" : "Tap to refresh"}">${cloudPicksStale ? "⚠ " : ""}${pre ? "" : clockLabel()}${!pre && !boardAllFinal && anyGameLive(live) ? `<span class="ms-onair" title="Games in progress" aria-label="Live"><i></i></span>` : ""}<span class="ms-cyc">⟳</span></button>`;
  // No name here. The header's own pill says who you are eight pixels
  // above, and the room it gives back pays for LIVE on the pill, which
  // reads better than a bare +6.
  const banked = `<span class="ms-score">${String(me.score).padStart(2, "0")} PTS</span>`;
  const livePill = inFlight ? `<span class="ms-live"><span class="stake-dot"></span>+${inFlight} LIVE</span>` : "";
  el.innerHTML = `<span class="ms-rank">${me.tied ? "T-" : ""}${ordinal(me.place)}</span>${banked}${livePill}${state}${clock}`;
  // The strip stays built (its refresh and countdown hooks still run) but
  // is not shown: the header carries the same thing now.
  el.classList.add("hidden");
  // Same numbers, ready for the header to pick up on scroll. The word
  // LIVE stays behind: the strip has room for it, the header's left slot
  // does not, and 30 PTS +30 LIVE ran under the wordmark at 320px.
  // Before kickoff the header carries nothing on the left (the picks
  // screen has the countdown); from kickoff on, your place and points.
  headScoreHtml = pre
    ? ""
    : `${cloudPicksStale ? `<span class="ms-warn" title="Picks did not reload">⚠</span>` : ""}<span class="ms-rank">${me.tied ? "T-" : ""}${ordinal(me.place)}</span>${banked}${inFlight ? `<span class="ms-live"><span class="stake-dot"></span>+${inFlight}</span>` : ""}${boardAllFinal ? `<span class="ms-state final">FINAL</span>` : ""}`;
  renderHeadScore();
}
// Ticks the strip's countdown without redrawing the strip.
function renderBoardCountdown() {
  const next = gamesByKickoff().find((g) => !isGameLocked(g));
  const cd = next && kickoffCountdown(next.kickoff);
  const text = cd && !cd.past ? cd.brief : "";
  let changed = false;
  document.querySelectorAll("#my-score .ms-kick, #head-score .ms-kick").forEach((el) => { if (el.textContent !== text) { el.textContent = text; changed = true; } });
  if (changed) fitHeaderLogo();
  headScoreHtml = headScoreHtml.replace(/(<b class="ms-kick">)[^<]*(<\/b>)/, `$1${text}$2`);
}
document.getElementById("my-score")?.addEventListener("click", (e) => {
  const refresh = e.target.closest(".ms-refresh");
  if (refresh) {
    refresh.classList.add("busy");
    withScrollPreserved(renderScoreboard);
    return;
  }
  const row = [...document.querySelectorAll(".ranking-row")].find((r) => r.querySelector(".ranking-name")?.textContent.startsWith((currentManager || "").toUpperCase()));
  row?.scrollIntoView({ block: "center", behavior: "smooth" });
});

// Chalk line: what a card of every favorite against the spread would have
// scored so far, drawn across the board like a golf cut line. Above it you
// beat the chalk; on it counts as above. Shown once any game is final.
function chalkScore(results) {
  let pts = 0;
  for (const g of GAMES) {
    const res = results[g.id];
    if (!res) continue;
    pts += scorePick(g, { team: g.favorite, mode: "ATS" }, res) || 0;
  }
  return pts;
}
function drawChalkLine(rows, results) {
  if (!GAMES.some((g) => results[g.id])) return;
  const chalk = chalkScore(results);
  const els = [...rankingsList.querySelectorAll(".ranking-row:not(.rank-hd)")];
  const i = rows.findIndex((r) => r.score < chalk);
  const beat = i === -1 ? rows.length : i;
  const line = document.createElement("div");
  line.className = "chalk-line";
  line.title = "Score of a card with every favorite against the spread";
  line.innerHTML = `<span>CHALK LINE <b>${String(chalk).padStart(2, "0")}</b></span><em>${beat} of ${rows.length} above</em>`;
  if (i === -1 || !els[i]) rankingsList.appendChild(line);
  else rankingsList.insertBefore(line, els[i]);
  const note = document.createElement("p");
  note.className = "chalk-note";
  note.textContent = "* Chalk line: every favorite ATS, 2 pts per cover, finals only";
  rankingsList.appendChild(note);
}

// Week over: the board reads top to bottom as recap, the pot, the
// leaderboard, then the game scores, all open and each foldable. The
// first time a finished week is seen, the pot opens itself.
let weekOverSeen = null;
function setWeekOverLayout(on) {
  const screen = document.getElementById("scoreboard-screen");
  if (!screen) return;
  screen.classList.toggle("week-over", on);
  // The week-over overview: the replay, the pot and season stats, in that
  // order, all open the first time the finished week is drawn. Each still
  // folds by hand.
  if (on && weekOverSeen !== currentWeek) {
    weekOverSeen = currentWeek;
    for (const id of ["payouts-toggle", "season-toggle"]) {
      const t = document.getElementById(id);
      if (t && !t.classList.contains("open")) t.click();
    }
    const recap = document.getElementById("recap-panel");
    if (recap?.classList.contains("folded")) {
      recap.classList.remove("folded");
      recap.querySelector(".recap-marquee")?.setAttribute("aria-expanded", "true");
    }
  }
}
document.getElementById("scores-toggle")?.addEventListener("click", (e) => {
  const t = e.currentTarget, list = document.getElementById("live-scores-list");
  const open = !t.classList.contains("open");
  t.classList.toggle("open", open); t.setAttribute("aria-expanded", String(open));
  list?.classList.toggle("folded", !open);
});

function renderRankingRows(rows, cloudPicks, results, live) {
  const top = rows.length ? rows[0].score : 0;
  // A quiet column key, same flex layout as the rows so labels line up.
  const weekDone = GAMES.length > 0 && GAMES.every((g) => results?.[g.id]);
  rankingsList.classList.toggle("week-done", weekDone);
  setWeekOverLayout(weekDone);
  const lbt = document.getElementById("leaderboard-toggle");
  if (lbt?.firstChild && currentWeek) lbt.firstChild.textContent = `🏆 WEEK ${currentWeek} LEADERBOARD `;
  // Same number of slots on every row (the most anyone hit), so logos
  // are one size and line up in columns down the board.
  if (weekDone) rankingsList.style.setProperty("--hits", Math.max(1, ...rows.map((r) => gamesByKickoff().filter((g) => { const pk = r.state.picks?.[g.id]; return pk && scorePick(g, pk, results[g.id]) > 0; }).length)));
  if (rows.length) {
    const anyWp = rows.some((r) => r.winPct != null);
    const hd = document.createElement("div");
    hd.className = "ranking-row rank-hd";
    hd.setAttribute("aria-hidden", "true");
    hd.innerHTML = `<div class="ranking-main"><span class="ranking-place">#</span><span class="ranking-name">PLAYER</span>${weekDone ? `<span class="rank-hits hd">CORRECT PICKS</span>` : `<i class="rank-live mid">LIVE</i>`}${weekDone ? "" : anyWp ? `<span class="rank-wp"><span class="rank-wp-bar"></span><b class="rank-hd-wp" role="button" tabindex="0" title="How chance to win is worked out">WIN% ?</b></span>` : `<span class="ranking-dots"></span>`}<span class="ranking-score">PTS</span></div>`;
    hd.querySelector(".rank-hd-wp")?.addEventListener("click", openWinChanceExplainer);
    rankingsList.appendChild(hd);
  }
  rows.forEach((row, i) => {
    const open = expandedRankings.has(row.name);
    const div = document.createElement("div");
    // A thin break wherever the score changes, so ties read as one tier.
    const tierBreak = i > 0 && row.score !== rows[i - 1].score;
    const leads = top > 0 && row.score === top;
    div.className = "ranking-row" + (i === 0 && row.score > 0 ? " rank-1" : "") + (leads ? " leads" : "") + (tierBreak ? " tier-break" : "") + (row.name === currentManager ? " is-me" : "") + (open ? " open" : "");
    div.innerHTML = `
      <div class="ranking-main" role="button" tabindex="0" aria-expanded="${open}">
        <span class="ranking-place${row.score > 0 && row.place <= 3 ? ` medal m${row.place}` : ""}">${row.tied ? "T" : ""}${row.place}</span>
        <span class="ranking-name"><span class="rank-nameline"><span class="rank-who">${shown(row.name).toUpperCase()}</span></span><span class="ranking-lock">${row.subline}</span></span>
        <i class="rank-live mid${row.inFlight > 0 ? " on" : row.inFlight === 0 ? " zero" : ""}" title="${row.inFlight != null ? "Points from live games if they ended now" : "No games live"}">${row.inFlight != null ? `+${row.inFlight}` : "–"}</i>
        ${(() => {
          // The week at a glance: one square per game in kickoff order.
          // Green cashed, pink missed, yellow push, pulsing while live
          // (green covering, pink not), dim not started, empty no pick.
          // A gold edge marks a 3-point pick. Never shows a team.
          const strip = gamesByKickoff().map((g) => {
            const pk = row.state.picks?.[g.id];
            if (!pk) return `<i class="sq none"></i>`;
            const big = pointValue(g, pk.team, pk.mode) >= 3 ? " big" : "";
            const fin = results?.[g.id];
            if (fin) { const o = resultOutcome(g, fin); if (pk.mode === "ATS" && o?.push) return `<i class="sq push${big}"></i>`; return `<i class="sq ${scorePick(g, pk, fin) > 0 ? "hit" : "miss"}${big}"></i>`; }
            const l = live?.[g.id];
            if (l && l.found && l.state === "in" && l.awayScore != null) return `<i class="sq live ${scorePick(g, pk, { awayScore: l.awayScore, homeScore: l.homeScore }) > 0 ? "up" : "dn"}${big}"></i>`;
            return `<i class="sq wait${big}"></i>`;
          }).join("");
          const pct = row.winPct != null ? row.winPct * 100 : null;
          const txt = pct == null ? "" : winChanceLabel(row.winPct, winChanceMemo.detail?.[row.name]);
          void strip;
          // Week over: the picks that cashed, in kickoff order, logo plus points.
          if (weekDone) {
            const hits = gamesByKickoff().map((g) => { const pk = row.state.picks?.[g.id]; const p = pk && results?.[g.id] ? scorePick(g, pk, results[g.id]) : 0; return p > 0 ? { g, pk, p } : null; }).filter(Boolean);
            return `<span class="rank-hits">${hits.map((h) => `<span class="rh" title="${h.pk.team} ${h.pk.mode === "SU" ? "to win" : "ATS"} · +${h.p}"><img src="${logoUrl(h.pk.team === h.g.home ? h.g.homeId : h.g.awayId)}" alt="" loading="lazy"><b class="t${h.p}">+${h.p}</b></span>`).join("") || `<em>No hits</em>`}</span>`;
          }
          return pct != null ? `<span class="rank-wp${pct >= 50 ? " hot" : ""}${txt === "OUT" ? " out" : ""}" title="Chance to win the week"><span class="rank-wp-bar"><i style="width:${Math.max(pct, pct > 0 ? 2 : 0).toFixed(1)}%"></i></span><b>${txt}</b></span>` : `<span class="ranking-dots" aria-hidden="true"></span>`;
        })()}
        <span class="ranking-score">${String(row.score).padStart(2, "0")}</span>
      </div>
      ${open ? playerBreakdownHtml(row.name, row.state, results, live) : ""}
    `;
    // Double tap the chance bar: that player's scenario. A single tap still
    // opens the row, just a beat later so a second tap can cancel it.
    div.querySelector(".ranking-main").addEventListener("click", (e) => {
      if (e.target.closest(".rank-wp") && row.winPct != null) {
        const t = (window.__wpTap = window.__wpTap || {});
        if (t.name === row.name && Date.now() - t.at < 320) { clearTimeout(t.timer); t.name = null; openPlayerChance(row.name); return; }
        clearTimeout(t.timer);
        t.name = row.name; t.at = Date.now();
        t.timer = setTimeout(() => { t.name = null; toggleRow(); }, 320);
        return;
      }
      toggleRow();
    });
    const toggleRow = () => {
      if (expandedRankings.has(row.name)) expandedRankings.delete(row.name); else { expandedRankings.add(row.name); track("ranking-expand", { event: true, d: row.name }); }
      withScrollPreserved(() => renderRankings(cloudPicks, results, live));
    };
    rankingsList.appendChild(div);
  });
}

// --- Kickoff countdown ------------------------------------------------
// How long until a kickoff, on an arcade clock that always runs to the
// second: "1D 08:36:12" with a day left, "08:36:12" inside a day,
// "36:12" inside an hour. Shared with the slate editor (admin.js), which
// counts down to the opener of the week it has loaded.
function kickoffCountdown(iso) {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return null;
  const ms = at - Date.now();
  if (ms <= 0) return { text: "KICKED OFF", past: true, ms };
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const clock = d || h ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  // The header chip sits between a wordmark and a name pill, so it gets a
  // coarse form until the last hour, when the seconds start mattering.
  const brief = d ? `${d}D ${h}H` : h ? `${h}H ${pad(m)}M` : `${pad(m)}:${pad(s)}`;
  return { text: d ? `${d}D ${clock}` : clock, brief, past: false, ms };
}

// The week in kickoff order, earliest first — the slate comes from the
// ESPN pull in whatever order it was picked, so this is what "first game"
// and "next game" mean.
function gamesByKickoff() {
  return [...GAMES].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff) || a.id - b.id);
}

// Stays up for as long as the queue holds this manager, across renders,
// navigation and reloads. Retrying is a button rather than only a timer so
// somebody who just walked back into signal is not left waiting.
function renderSyncBanner() {
  const el = document.getElementById("sync-banner");
  if (!el) return;
  if (!currentManager || !pendingPushFor(currentManager)) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const state = getManagerState(currentManager);
  const n = Object.values(state.picks || {}).filter(Boolean).length;
  const busy = syncStatus === "saving";
  el.className = "sync-banner";
  el.innerHTML = `<span class="sb-text">⚠ <b>${n} pick${n === 1 ? "" : "s"} on this phone only.</b> ${n === 1 ? "It has" : "They have"} not reached the league yet, so ${n === 1 ? "it will" : "they will"} not score. Keep this page open${busy ? " — retrying now" : " and it keeps retrying"}.</span>
    <button class="sb-retry" type="button" ${busy ? "disabled" : ""}>${busy ? "RETRYING…" : "RETRY NOW"}</button>`;
  el.querySelector(".sb-retry")?.addEventListener("click", () => { flushPendingPush().then(renderSyncBanner); renderSyncBanner(); });
}

// Any change in sync state redraws the banner immediately, so it appears
// the moment the retries give up rather than on the next render.
syncListeners.add(() => {
  renderSyncBanner();
  if (!picksScreen.classList.contains("hidden")) withScrollPreserved(renderPicksScreen);
});

// Counts down to the week's opener, then to each next game as they kick
// off, and disappears once the whole slate is underway.
function renderPicksCountdown() {
  const el = document.getElementById("picks-countdown");
  if (!el) return;
  const ordered = gamesByKickoff();
  const first = ordered[0];
  const next = ordered.find((g) => !isGameLocked(g));
  if (!first || !next) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const cd = kickoffCountdown(next.kickoff);
  if (!cd || cd.past) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const lockAll = weekLockTime() !== null;
  const label = lockAll ? "PICKS LOCK IN" : next.id === first.id ? "1ST KICKOFF" : "NEXT KICKOFF";
  const game = `${next.awayShort} at ${next.homeShort} · ${next.kickoffLabel}`;
  // Your card at a glance, inside the clock: games picked and tiebreaker.
  const st = currentManager ? getManagerState(currentManager) : null;
  const picked = st ? GAMES.filter((g) => st.picks[g.id]).length : 0;
  const tbSet = !!(st && String(st.tiebreaker ?? "").trim());
  const chip = (ok, txt) => `<span class="cd-chip ${ok ? "ok" : "miss"}">${txt} ${ok ? "✓" : "!"}</span>`;
  const riding = st ? GAMES.reduce((n, g) => n + (st.picks[g.id] ? pointValue(g, st.picks[g.id].team, st.picks[g.id].mode) : 0), 0) : 0;
  const status = st ? `<span class="cd-card"><em>YOUR CARD</em><span class="cd-riding"><b>${riding}</b><i>PT<br>RIDING</i></span><span class="cd-status">${chip(picked === GAMES.length, `${picked}/${GAMES.length}`)}${chip(tbSet, "TB")}</span></span>` : "";
  // Under an hour the whole slate is about to lock, so the strip goes hot.
  el.classList.remove("hidden"); el.classList.toggle("soon", cd.ms < 3600000);
  // Scoreboard digits: DAYS / HRS / MIN / SEC boxes, days dropped at zero.
  const tot = Math.max(0, Math.floor(cd.ms / 1000));
  const parts = [["DAYS", Math.floor(tot / 86400)], ["HRS", Math.floor((tot % 86400) / 3600)], ["MIN", Math.floor((tot % 3600) / 60)], ["SEC", tot % 60]].filter(([k, v], i) => i > 0 || v > 0);
  const cells = parts.map(([k, v]) => `<span class="cd-cell"><b>${String(v).padStart(2, "0")}</b><em>${k}</em></span>`).join('<i class="cd-colon">:</i>');
  const logoImg = (id) => id ? `<img class="cd-logo" src="${logoUrl(id)}" alt="" loading="lazy">` : "";
  const match = `<em class="cd-first">${lockAll || next.id === first.id ? "FIRST UP" : "NEXT UP"}</em><span class="cd-match">${logoImg(next.awayId)}<span>${escapeCd(next.awayShort)} <i>at</i> ${escapeCd(next.homeShort)}</span>${logoImg(next.homeId)}</span><span class="cd-when"><i>KICK</i>${escapeCd(next.kickoffLabel.replace(/\s*ET$/, ""))}</span>`;
  // Fuse: burns from when the slate opened (Monday's seal, 10:00 UTC) to lock.
  const lockAt = new Date(next.kickoff).getTime();
  const opened = (() => { const d = new Date(lockAt); const back = (d.getUTCDay() + 6) % 7; const m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back, 10); return m < lockAt ? m : lockAt - 5 * 86400000; })();
  const left = Math.max(0, Math.min(1, (lockAt - Date.now()) / Math.max(1, lockAt - opened)));
  const fuse = `<span class="cd-fuse" aria-hidden="true"><i style="width:${(left * 100).toFixed(2)}%"><u></u></i></span>`;
  // Only the digits and the fuse change from second to second. Rebuilding
  // the whole board every tick reloaded the logos and made them flash, so
  // the frame is built once and each tick just patches the numbers.
  const frameKey = `${label}|${status}|${match}|${parts.length}`;
  if (el.dataset.frame === frameKey && el.querySelectorAll(".cd-cell").length === parts.length) {
    el.querySelectorAll(".cd-cell b").forEach((b, i) => {
      const txt = String(parts[i][1]).padStart(2, "0");
      // A fresh node, not a text edit: Safari can skip repainting text that
      // changes inside an animated element, which froze the clock on iPhone.
      if (b.textContent !== txt) { const nb = document.createElement("b"); nb.textContent = txt; b.replaceWith(nb); const cell = nb.parentElement; cell.classList.remove("tick"); void cell.offsetWidth; cell.classList.add("tick"); }
    });
    const f = el.querySelector(".cd-fuse i");
    if (f) f.style.width = `${(left * 100).toFixed(2)}%`;
    if (!el.dataset.fit) fitCountdown(el);
  } else {
    el.innerHTML = `<span class="cd-top"><span class="cd-left"><span class="cd-label"><u></u>${label}</span><span class="cd-cells">${cells}</span></span>${status}</span><span class="cd-game">${match}</span>${fuse}`;
    el.dataset.frame = frameKey;
    delete el.dataset.fit;
    fitCountdown(el);
  }
  // The clock carries the card status, so the separate line hides.
  document.getElementById("picks-progress")?.classList.toggle("hidden", !!st);
}

// Measure, don't guess: the pixel font is wider on iPhone than anywhere we
// can test, so after drawing, shrink the digits until the clock fits the
// space left of YOUR CARD. Runs again once the web font has loaded.
function fitCountdown(el) {
  const cells = el?.querySelector(".cd-cells"), left = el?.querySelector(".cd-left");
  if (!cells || !left || !left.clientWidth) return;
  cells.style.setProperty("--cd-k", "1");
  el.dataset.fit = "1";
  let k = 1;
  for (let i = 0; i < 12 && cells.scrollWidth > left.clientWidth + 0.5 && k > 0.55; i++) {
    k -= 0.05;
    cells.style.setProperty("--cd-k", k.toFixed(2));
  }
}
document.fonts?.ready.then(() => fitCountdown(document.getElementById("picks-countdown") || document.querySelector(".picks-countdown")));
window.addEventListener("resize", () => fitCountdown(document.querySelector(".picks-countdown")));

function escapeCd(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// The same clock, shrunk into the header for every page except Picks,
// which already carries the full strip above the slate. Tapping it goes
// to Picks, since that is what the deadline is for.
// The chip is a reminder, not a status display. It shows up only when the
// viewer has something left to do before the slate locks: a game
// unpicked or no tiebreaker. Games in progress are already reported by
// the score strip, so it stays out of the way once the week is underway.
function renderHeaderCountdown() {
  const el = document.getElementById("header-countdown");
  if (!el) return;
  const hide = () => { if (!el.classList.contains("hidden")) { el.classList.add("hidden"); el.innerHTML = ""; delete el.dataset.drawn; fitHeaderLogo(); } };
  if (!picksScreen.classList.contains("hidden") || !currentManager) return hide();
  // One chip in the left slot at a time. Scrolled down the board, the
  // score wins it.
  if (!document.getElementById("head-score")?.classList.contains("hidden")) return hide();

  const next = gamesByKickoff().find((g) => !isGameLocked(g));
  if (!next) return hide();
  const cd = kickoffCountdown(next.kickoff);
  if (!cd || cd.past) return hide();

  const state = getManagerState(currentManager);
  const unpicked = GAMES.filter((g) => !isGameLocked(g) && !state.picks[g.id]).length;
  const noTb = !String(state.tiebreaker ?? "").trim();
  if (!unpicked && !noTb) return hide();

  const what = unpicked ? `${unpicked} TO PICK` : "NO TB";
  const cls = "head-cd" + (cd.ms < 3600000 ? " soon" : "");
  // The tooltip uses the coarse form on purpose: a seconds clock in the
  // key would defeat the memo below.
  const title = `${cd.brief} to ${next.awayShort} at ${next.homeShort}`;
  // Called every second for the countdown, but the words change once a
  // minute at most and the chip itself changes when a pick goes in. Touch
  // the DOM only when something it shows has actually moved.
  const key = `${cls}|${what}|${title}`;
  if (el.dataset.drawn === key && !el.classList.contains("hidden")) return;
  el.dataset.drawn = key;
  el.className = cls;
  el.innerHTML = `<span class="hcd-dot"></span>${what}`;
  el.title = title;
  el.dataset.go = "picks";
  el.classList.remove("hidden");
  fitHeaderLogo();
}

// Tapping it goes back to the strip it came from.
document.getElementById("head-score")?.addEventListener("click", () => {
  document.getElementById("my-score")?.scrollIntoView({ block: "start", behavior: "smooth" });
});

document.getElementById("header-countdown")?.addEventListener("click", (e) => {
  if (e.currentTarget.dataset.go === "scores") navScoreboardBtn?.click();
  else navPicksBtn?.click();
});

// Its own second-by-second timer, separate from the 20s refresh: the clock
// has to move, but nothing else on the page needs redrawing that often.
setInterval(() => {
  if (!currentManager || document.hidden) return;
  if (!picksScreen.classList.contains("hidden")) renderPicksCountdown();
  if (!scoreboardScreen.classList.contains("hidden")) renderBoardCountdown();
  renderHeaderCountdown();
}, 1000);

// A new week, or a corrected line, is published from the commissioner's
// phone; every other phone has to notice on its own. Once a minute, and
// whenever the app comes back to the front, ask for the slate and adopt
// it if anything about it changed. The slate is what everything else on
// screen hangs off, so a change redraws whichever screen is showing.
const slateSignature = () => `${currentWeek}|` + GAMES.map((g) => `${g.id}:${g.favorite}:${g.spread}:${g.kickoff}`).join(",");
let lastSlateSignature = slateSignature();
async function refreshSlateIfChanged() {
  const was = lastSlateSignature;
  if (!(await loadSlate())) return;
  const now = slateSignature();
  if (now === was) return;
  lastSlateSignature = now;
  if (currentManager) await syncManagerFromCloud(currentManager);
  if (!picksScreen.classList.contains("hidden")) withScrollPreserved(renderPicksScreen);
  if (!scoreboardScreen.classList.contains("hidden")) withScrollPreserved(renderScoreboard);
  refreshPicksStanding();
}
setInterval(() => { if (!document.hidden) refreshSlateIfChanged(); }, 60 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshSlateIfChanged(); });

// Re-render periodically so games auto-lock the moment kickoff passes,
// and the scoreboard/rankings stay live without a manual refresh.
// Background refresh. The picks list only redraws when a game's lock
// state actually flips (a kickoff), so it never yanks the page out from
// under someone mid-scroll for no reason. The board is meant to be live,
// so it refreshes every tick, but keeps the scroll position.
setInterval(() => {
  if (document.hidden) return;
  if (currentManager && !picksScreen.classList.contains("hidden")) {
    if (lockSignature() !== lastLockSignature) {
      withScrollPreserved(renderPicksScreen);
    } else if (GAMES.some(isGameLocked)) {
      // Locked cards carry live scores now, so keep them moving too.
      fetchLiveScores().then(() => { if (!picksScreen.classList.contains("hidden")) withScrollPreserved(renderPicksScreen); });
    }
  }
  if (!scoreboardScreen.classList.contains("hidden")) {
    withScrollPreserved(renderScoreboard);
    // Only while someone is looking at it. It is collapsed by default, and
    // rendering into a hidden panel every twenty seconds bought nothing.
    if (!document.getElementById("payouts-panel")?.classList.contains("hidden")) renderPayouts();
  renderRecap(); // memoised: only the Thursday cutoff can change anything here
  }
  // The Side bet tab keeps its scores and standings moving the same way.
  if (!sideScreen.classList.contains("hidden")) Promise.all([fetchLiveScores().catch(() => {}), fetchSidePot(), fetchSideLive().catch(() => {})]).then(() => withScrollPreserved(() => { updateSideNav(); renderSideScreen(); }));
  // The off-board branch that fetched live scores here every tick is gone.
  // It fed the header chip back when the chip reported live games; the
  // chip is a to-do reminder now and reads nothing from the feed.
  flushPendingPush();
}, 20000);

// Timers pause while the phone is locked or the app is in the background.
// Refresh the moment it comes back so the board never shows stale scores.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  liveFetchedAt = 0; boardPicks.at = 0;
  flushPendingPush();
  if (!scoreboardScreen.classList.contains("hidden")) withScrollPreserved(renderScoreboard);
  if (currentManager && !picksScreen.classList.contains("hidden")) fetchLiveScores().then(() => withScrollPreserved(renderPicksScreen));
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted && !scoreboardScreen.classList.contains("hidden")) withScrollPreserved(renderScoreboard);
});


// The recap runs from the seal until the next week's slate is published,
// with 6 AM Eastern on the following Thursday as the latest it can stay.
function recapExpiry(summary) {
  const sealed = Number(summary.sealedAt) || 0;
  if (!sealed) return 0;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", timeZoneName: "shortOffset" });
  for (let i = 0; i < 8; i++) {
    const day = sealed + i * 86400000;
    const parts = Object.fromEntries(fmt.formatToParts(new Date(day)).map((p) => [p.type, p.value]));
    if (parts.weekday !== "Thu") continue;
    // 6 AM that day in New York, built from the day's own UTC offset.
    const off = Number((parts.timeZoneName.match(/[+-]\d+/) || ["-4"])[0]);
    const thu6 = thursdaySixAM(day, off);
    if (thu6 > sealed) return thu6;
  }
  return sealed + 4 * 86400000;
}
function thursdaySixAM(ms, offsetHours) {
  // The New York calendar date of `ms`, then 06:00 local expressed in UTC.
  const d = new Date(ms + offsetHours * 3600000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6 - offsetHours);
}

// --- The Boner Amendment, announced on every open this weekend ---------
// Week 4 only, once the week has locked, through Monday night. Once per
// page load, whichever screen the app opens on; a tap anywhere closes it.
// --- Grid check --------------------------------------------------------
// Opening the picks page while the week is open: are you in, part in,
// or not in at all, plus a clock to the lock. Only while something is
// still blank: once per twelve hours per week, every two inside the last day.
const GRID_REPEAT_MS = 12 * 3600 * 1000;
const GRID_NAG_MS = 24 * 3600 * 1000;
let gridTimer = null;
function gridKey() { return `brochiefs_grid_v1_w${currentWeek}`; }
function maybeShowGridCheck(force = false) {
  const el = document.getElementById("grid-modal");
  if (!el || !currentManager || !GAMES.length) return;
  const lockAt = weekLockTime() ?? Math.min(...GAMES.map((g) => new Date(g.kickoff).getTime()));
  const ms = lockAt - Date.now();
  if (ms <= 0) return;
  if (!force) {
    const st = getManagerState(currentManager);
    const incomplete = GAMES.some((g) => !st.picks[g.id]) || !String(st.tiebreaker ?? "").trim();
    if (!incomplete) return;
    let last = 0;
    try { last = Number(localStorage.getItem(gridKey()) || 0); } catch {}
    const repeat = incomplete && ms < GRID_NAG_MS ? 2 * 3600 * 1000 : GRID_REPEAT_MS;
    if (Date.now() - last < repeat) return;
    try { localStorage.setItem(gridKey(), String(Date.now())); } catch {}
  }
  renderGridCheck();
  el.classList.remove("hidden");
  clearInterval(gridTimer);
  gridTimer = setInterval(() => {
    if (el.classList.contains("hidden")) { clearInterval(gridTimer); return; }
    renderGridCheck();
  }, 1000);
}
function renderGridCheck() {
  const el = document.getElementById("grid-modal");
  const state = getManagerState(currentManager);
  const picked = GAMES.filter((g) => state.picks[g.id]).length;
  const tb = String(state.tiebreaker ?? "").trim();
  const riding = GAMES.reduce((n, g) => n + (state.picks[g.id] ? pointValue(g, state.picks[g.id].team, state.picks[g.id].mode) : 0), 0);
  const lockAt = weekLockTime() ?? Math.min(...GAMES.map((g) => new Date(g.kickoff).getTime()));
  const ms = Math.max(0, lockAt - Date.now());
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  el.querySelector("#grid-sub").textContent = `${WEEK_LABEL.toUpperCase()} · ALL PICKS LOCK AT FIRST KICKOFF`;
  el.querySelector("#grid-clock").innerHTML = d ? `${d}<small>D</small> ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
  // Five starting lights read the card, not the clock: all green when the
  // card is full, yellow and flashing while it is partly in, dark red
  // when nothing is in. Four lights for picks, the fifth for the tiebreaker.
  const picksOkL = picked === GAMES.length, tbOk = !!tb;
  const lit = (picksOkL ? 4 : Math.floor((picked / GAMES.length) * 4)) + (tbOk ? 1 : 0);
  const mode = picksOkL && tbOk ? "go" : picked === 0 && !tbOk ? "none" : "warn";
  const lights = el.querySelector("#grid-lights");
  lights.className = `grid-lights ${mode}`;
  lights.querySelectorAll("i").forEach((i, k) => i.classList.toggle("on", mode === "go" || k < lit));
  const row = (id, v, ok, warn) => {
    const r = el.querySelector(id);
    r.querySelector(".gr-v").textContent = v;
    r.querySelector(".gr-s").textContent = ok ? "✓" : "!";
    r.classList.toggle("ok", ok); r.classList.toggle("warn", !ok);
    r.title = ok ? "" : warn;
  };
  const picksOk = picked === GAMES.length;
  row("#grid-row-picks", `${picked} / ${GAMES.length}`, picksOk, `${GAMES.length - picked} left blank`);
  row("#grid-row-tb", tb ? tb : "MISSING", !!tb, "Blank forfeits ties");
  row("#grid-row-pts", `${riding} PT`, riding > 0, "Nothing riding yet");
  const ready = picksOk && !!tb;
  const verdict = el.querySelector("#grid-verdict");
  const nothing = picked === 0 && !tb;
  verdict.textContent = ready ? "SUBMITTED · READY" : nothing ? "PENDING · PICKS + TIEBREAKER" : "INCOMPLETE";
  verdict.className = `grid-verdict ${ready ? "ok" : nothing ? "none" : "part"}`;
  const go = el.querySelector("#grid-go");
  go.textContent = ready ? "READY TO RACE" : nothing ? "START PICKING" : "FILL THE BLANKS";
  go.classList.toggle("ready", ready);
}
(() => {
  const el = document.getElementById("grid-modal");
  if (!el) return;
  const close = () => { el.classList.add("hidden"); clearInterval(gridTimer); };
  el.addEventListener("click", (e) => { if (e.target === el) close(); });
  el.querySelector("#grid-go")?.addEventListener("click", () => {
    close();
    if (el.querySelector("#grid-go").classList.contains("ready")) return;
    setTimeout(() => {
      const state = getManagerState(currentManager);
      const blank = GAMES.find((g) => !state.picks[g.id]);
      const target = blank ? document.querySelector(`.game-card[data-game-id="${blank.id}"]`) : document.getElementById("tiebreaker-input");
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 250);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.classList.contains("hidden")) close(); });
})();

const BONER_UNTIL = Date.parse("2026-09-29T03:59:00Z"); // Mon 11:59 PM ET
let bonerShownThisLoad = false;
function maybeShowBoner() {
  const el = document.getElementById("boner-modal");
  if (!el || bonerShownThisLoad || !currentManager || window.__liveView) return;
  if (currentWeek !== 4 || Date.now() >= BONER_UNTIL || !GAMES.length || !GAMES.every(isGameLocked)) return;
  bonerShownThisLoad = true;
  // The GIF is half a megabyte; fetch it only when the popup actually shows.
  const art = el.querySelector("img[data-src]"); if (art && !art.src) art.src = art.dataset.src;
  el.classList.remove("hidden");
}
// Any touch, click or key anywhere closes it; the first one wins and
// does not fall through to whatever was under it.
(() => {
  const el = document.getElementById("boner-modal");
  if (!el) return;
  const close = (e) => {
    if (el.classList.contains("hidden")) return;
    el.classList.add("hidden");
    e.preventDefault(); e.stopPropagation();
  };
  document.addEventListener("pointerdown", close, true);
  document.addEventListener("touchstart", close, { capture: true, passive: false });
  document.addEventListener("keydown", close, true);
})();

// --- Now playing ----------------------------------------------------------
// A full-screen poster between the splash and the app, once a day per
// device. Tap anywhere to carry on. Swap NOW_PLAYING to feature something
// else; a new id shows again the same day.
// Nothing showing right now. Set { id, where, title, poster, link } to run one.
const NOW_PLAYING = null;
// Whether the poster still has its once-a-day showing to make.
function nowPlayingDue() {
  if (!NOW_PLAYING || window.__adminEntry) return false;
  try { return localStorage.getItem(`brochiefs_nowplaying_${NOW_PLAYING.id}`) !== new Date().toLocaleDateString("en-CA"); } catch { return false; }
}
function showNowPlaying(then) {
  const key = `brochiefs_nowplaying_${NOW_PLAYING?.id}`;
  const today = new Date().toLocaleDateString("en-CA");
  let seen = true;
  try { seen = localStorage.getItem(key) === today; } catch {}
  if (!NOW_PLAYING || seen || window.__adminEntry) return then();
  try { localStorage.setItem(key, today); } catch {}
  const m = document.createElement("div");
  m.className = "np-screen"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", `Coming attraction: ${NOW_PLAYING.title} on ${NOW_PLAYING.where}`);
  // A theatre lobby one-sheet: marquee lights round the frame, the poster
  // in a gilt case, a ticket to watch. Any tap that is not the ticket closes it.
  m.innerHTML = `<button type="button" class="np-close" aria-label="Close">✕</button>
    <div class="np-marquee"><span>★ COMING ATTRACTION ★</span></div>
    <div class="np-case"><img class="np-poster" src="${NOW_PLAYING.poster}" alt="${NOW_PLAYING.title}" draggable="false"></div>
    <div class="np-bill">NOW SHOWING ON <b>${NOW_PLAYING.where.toUpperCase()}</b></div>
    <a class="np-go" href="${NOW_PLAYING.link}" target="_blank" rel="noopener"><span>ADMIT ONE</span>WATCH NOW ↗</a>
    <div class="np-tap">TAP ANYWHERE TO SKIP</div>`;
  document.body.appendChild(m);
  let done = false;
  const go = () => { if (done) return; done = true; m.classList.add("out"); setTimeout(() => m.remove(), 250); then(); };
  m.querySelector(".np-go").addEventListener("click", (e) => { e.stopPropagation(); setTimeout(go, 0); });
  // pointerup closes on the first lift anywhere, poster included; click is
  // the fallback for browsers that skip pointer events.
  m.addEventListener("pointerup", (e) => { if (!e.target.closest(".np-go")) { e.preventDefault(); go(); } });
  m.addEventListener("click", (e) => { if (!e.target.closest(".np-go")) go(); });
}

// --- Question of the week ------------------------------------------------
// Pops up on every open until this manager answers or cops out. Change
// QOTW to ask a new one; the id keeps answers apart.
const QOTW = { id: "gooey-belly", q: "What actually is a “gooey belly”?", qHtml: `What actually is a<span class="qotw-pop">“gooey belly”?</span>` };
window.QOTW = QOTW;
let qotwShownThisLoad = false;
// --- League poll: lock of the week scoring ------------------------------------
// Pops up once per open until this manager votes. Votes can change; the
// tally (counts only) shows after voting. Names are admin only (?all=1).
const POLL = { live: true, id: "lock-of-week-v2", q: "Add a lock 🔒 of the week to scoring.", opts: [
  { k: "A", t: "Free bonus", hit: "+2", miss: "0" },
  { k: "B", t: "Bonus with risk", hit: "+2", miss: "−1" },
  { k: "C", t: "High stakes", hit: "+3", miss: "−3" },
  { k: "N", t: "No lock", none: "Keep scoring as is" },
] };
let pollShownThisLoad = false;
async function maybeShowPoll(force) {
  // Held back until POLL.live: preview with ?poll=1.
  if (!POLL.live && !/[?&]poll=1/.test(location.search)) return;
  if ((!force && pollShownThisLoad) || !currentManager || !WORKER_URL || window.__adminEntry || window.__adminOpen || window.__liveView) return;
  const doneKey = `brochiefs_poll_${POLL.id}_${currentManager}`;
  try { if (!force && localStorage.getItem(doneKey)) { refreshPollStrip(); return; } } catch {}
  // Not on top of the question of the week: try again on the next open.
  const q = document.getElementById("qotw-modal");
  if (q && !q.classList.contains("hidden") && q.isConnected) return;
  pollShownThisLoad = true;
  let st;
  try { const r = await fetch(`${WORKER_URL}/poll?id=${POLL.id}&manager=${encodeURIComponent(currentManager)}`); if (!r.ok) return; st = await r.json(); } catch { return; }
  if (st.vote && !force) { try { localStorage.setItem(doneKey, st.vote); } catch {} drawPollStrip(st); return; }
  let m = document.getElementById("poll-modal");
  if (!m) {
    m = document.createElement("div");
    m.id = "poll-modal"; m.className = "wpx-overlay"; m.setAttribute("role", "dialog");
    document.body.appendChild(m);
    m.addEventListener("change", (e) => {
      if (!e.target.closest(".poll-note")) return;
      const on = m.querySelector(".poll-opt.on");
      if (on) fetch(`${WORKER_URL}/poll`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: POLL.id, manager: currentManager, choice: on.dataset.k, note: e.target.value, token: tokenFor(currentManager) || undefined }) }).catch(() => {});
    });
    m.addEventListener("click", async (e) => {
      if (e.target === m || e.target.closest(".wpx-x, .poll-done, .poll-later")) { m.classList.add("hidden"); return; }
      const b = e.target.closest(".poll-opt");
      if (!b || b.disabled) return;
      m.querySelectorAll(".poll-opt").forEach((x) => (x.disabled = true));
      try {
        const r = await fetch(`${WORKER_URL}/poll`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: POLL.id, manager: currentManager, choice: b.dataset.k, note: m.querySelector(".poll-note")?.value || "", token: tokenFor(currentManager) || undefined }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Vote failed");
        try { localStorage.setItem(doneKey, j.vote); } catch {}
        noteUse?.("poll", j.vote);
        draw({ ...j, note: m.querySelector(".poll-note")?.value || "" }, true);
        drawPollStrip(j);
      } catch (err) { m.querySelector(".poll-err").textContent = err.message; m.querySelectorAll(".poll-opt").forEach((x) => (x.disabled = false)); }
    });
  }
  const RISK = { A: 0, B: 1, C: 3, N: -1 };
  const draw = (s, fresh) => {
    const max = Math.max(1, ...Object.values(s.counts || {}));
    m.innerHTML = `<div class="wpx-card poll${s.vote ? " voted" : ""}${fresh ? " fresh" : ""}">
      <button type="button" class="wpx-x" aria-label="Close">✕</button>
      <div class="poll-top"><span class="poll-lock">🔒</span><div><div class="poll-kicker">${s.vote ? "YOU'RE LOCKED IN" : "LEAGUE VOTE · 5 SECONDS"}</div><div class="poll-q">${POLL.q}</div></div></div>
      <div class="poll-opts">${POLL.opts.map((o) => `<button type="button" class="poll-opt opt-${o.k}${s.vote === o.k ? " on" : ""}${o.none ? " no" : ""}" data-k="${o.k}">
        <span class="poll-t"><b>${o.t}</b><small>${o.none ? o.none : `Hit <i class="up">${o.hit}</i> · Miss <i class="dn">${o.miss}</i>`}</small></span>
        ${s.vote ? `<em class="poll-c">${s.counts[o.k] || 0}</em>` : RISK[o.k] >= 0 ? `<span class="poll-risk" title="Risk">${[1, 2, 3].map((i) => `<s class="${i <= RISK[o.k] ? "f" : ""}"></s>`).join("")}<small>${["NO RISK", "SOME RISK", "", "BIG RISK"][RISK[o.k]]}</small></span>` : ""}
        ${s.vote ? `<span class="poll-bar"><u style="--w:${Math.round(((s.counts[o.k] || 0) / max) * 100)}%"></u></span>` : ""}
      </button>`).join("")}</div>
      <textarea class="poll-note" rows="1" maxlength="1000" placeholder="Optional feedback">${(s.note || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</textarea>
      <div class="poll-err"></div>
      ${s.vote ? `<div class="poll-foot"><span>${s.voted} of ${s.of} voted · tap another to switch</span><button type="button" class="poll-done">Done</button></div>` : `<button type="button" class="poll-later wpx-x-alt">Not now</button>`}
    </div>`;
  };
  draw(st);
  m.classList.remove("hidden");
  noteUse("poll-view", POLL.id);
  fetch(`${WORKER_URL}/poll`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: POLL.id, manager: currentManager, action: "view" }) }).catch(() => {});
}
window.maybeShowPoll = maybeShowPoll;
// Until they vote: show it again each time the app comes back to the front.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !POLL.live || !currentManager) return;
  try { if (localStorage.getItem(`brochiefs_poll_${POLL.id}_${currentManager}`)) return; } catch {}
  if (!document.getElementById("poll-modal")?.classList.contains("hidden") && document.getElementById("poll-modal")) return;
  pollShownThisLoad = false; maybeShowPoll();
});
// After voting: the running result on the board, counts only, never names.
function drawPollStrip(s) {
  const el = document.getElementById("poll-strip");
  if (!el || !s?.vote || !s.counts) return;
  const max = Math.max(1, ...Object.values(s.counts));
  el.innerHTML = `<div class="ps-h"><b>🔒 LOCK OF THE WEEK VOTE</b><span>${s.voted} of ${s.of} voted · tap to change</span></div>
    <div class="ps-rows">${POLL.opts.map((o) => `<div class="ps-r${s.vote === o.k ? " on" : ""}"><span>${o.t}${s.vote === o.k ? " <i>YOU</i>" : ""}</span><u><s style="width:${Math.round(((s.counts[o.k] || 0) / max) * 100)}%"></s></u><b>${s.counts[o.k] || 0}</b></div>`).join("")}</div>`;
  el.classList.remove("hidden");
}
async function refreshPollStrip() {
  if (!POLL.live || !currentManager || !WORKER_URL) return;
  try { const r = await fetch(`${WORKER_URL}/poll?id=${POLL.id}&manager=${encodeURIComponent(currentManager)}`); if (r.ok) drawPollStrip(await r.json()); } catch {}
}
document.getElementById("poll-strip")?.addEventListener("click", () => { pollShownThisLoad = false; maybeShowPoll(true); });

async function maybeShowQotw() {
  // Not on the way into the admin panel: the prompt would sit on top of the key gate.
  if (qotwShownThisLoad || !currentManager || !WORKER_URL || !QOTW || window.__adminEntry || window.__adminOpen || window.__liveView) return;
  const doneKey = `brochiefs_qotw_${QOTW.id}_${currentManager}`;
  try { if (localStorage.getItem(doneKey)) return; } catch {}
  qotwShownThisLoad = true;
  try {
    const r = await fetch(`${WORKER_URL}/qotw?id=${encodeURIComponent(QOTW.id)}&manager=${encodeURIComponent(currentManager)}`);
    if (r.ok && (await r.json()).answered) { try { localStorage.setItem(doneKey, "1"); } catch {} return; }
  } catch { return; }
  let m = document.getElementById("qotw-modal");
  if (!m) {
    m = document.createElement("div");
    m.id = "qotw-modal"; m.className = "wpx-overlay"; m.setAttribute("role", "dialog");
    m.innerHTML = `<div class="wpx-card qotw">
      <div class="qotw-kicker">★ BROCHIEFS QUESTION OF THE WEEK ★</div>
      <div class="qotw-q">${QOTW.qHtml || QOTW.q}</div>
      <div class="qotw-field"><textarea class="qotw-in" rows="4" placeholder="Your answer…"></textarea></div>
      <div class="qotw-err" hidden></div>
      <div class="qotw-btns"><button type="button" class="qotw-cop">COP OUT:<br>I have no clue!</button><button type="button" class="qotw-go">Submit</button></div>
    </div>`;
    document.body.appendChild(m);
    const send = async (copout) => {
      const text = m.querySelector(".qotw-in").value.trim();
      const err = m.querySelector(".qotw-err");
      if (!copout && !text) { err.hidden = false; err.textContent = "Type an answer, or cop out."; return; }
      m.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        const r = await fetch(`${WORKER_URL}/qotw`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manager: currentManager, id: QOTW.id, answer: text, copout, token: tokenFor(currentManager) || undefined }) });
        if (!r.ok) throw new Error(r.status === 401 ? "Sign in first, then answer." : "Didn't save. Try again.");
        try { localStorage.setItem(doneKey, "1"); } catch {}
        m.remove();
      } catch (e) { err.hidden = false; err.textContent = e.message || "Didn't save. Try again."; m.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
    };
    m.querySelector(".qotw-go").addEventListener("click", () => send(false));
    // The cop out button plays hard to get: the first tap sends it to the
    // top right of the text box, the second next to Submit, and only the
    // third actually cops out. Each hop slides from where it was (FLIP).
    let dodges = 0;
    const cop = m.querySelector(".qotw-cop");
    const hop = (place) => {
      const a = cop.getBoundingClientRect();
      place();
      const b = cop.getBoundingClientRect();
      cop.style.transition = "none";
      cop.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        cop.style.transition = "transform .45s cubic-bezier(.2, 1.4, .4, 1)";
        cop.style.transform = "";
      }));
    };
    cop.addEventListener("click", () => {
      dodges += 1;
      if (dodges === 1) return hop(() => { cop.classList.add("at-corner"); m.querySelector(".qotw-field").appendChild(cop); });
      if (dodges === 2) return hop(() => { cop.classList.remove("at-corner"); cop.classList.add("at-right"); m.querySelector(".qotw-btns").appendChild(cop); });
      send(true);
    });
  }
}

// --- Game insights ------------------------------------------------------
// One sheet per game: the auto brief, how the line has moved since the
// seal, both injury reports, headlines, and links out. Data comes from
// the Worker's twice-daily run; links need nothing but ids we already
// hold, so the sheet is useful even before the first run.
let insightsCache = { week: null, at: 0, data: null };
async function fetchInsights() {
  if (insightsCache.week === currentWeek && Date.now() - insightsCache.at < 5 * 60 * 1000) return insightsCache.data;
  if (!WORKER_URL) return null;
  try {
    const res = await fetch(`${WORKER_URL}/insights?week=${currentWeek}&t=${Math.floor(Date.now() / 300000)}`);
    if (!res.ok) return insightsCache.data;
    const data = await res.json();
    insightsCache = { week: currentWeek, at: Date.now(), data };
    return data;
  } catch { return insightsCache.data; }
}
function insightsLinks(game) {
  const live = insLive(game.id);
  const eventId = live?.eventId || insightsCache.eventIds?.[game.id] || insightsCache.data?.briefs?.[game.id]?.eventId || null;
  const q = encodeURIComponent(`${game.away} ${game.home} football`);
  const links = [];
  if (eventId) links.push({ label: "ESPN Gamecast", sub: "preview, odds tab, matchup stats", href: `https://www.espn.com/college-football/game/_/gameId/${eventId}` });
  // ESPN's college injury pages are usually empty, so these search this
  // week's news for injury reporting on each team instead.
  const injQ = (team) => encodeURIComponent(`"${team}" football injury OR injured OR questionable OR "out for"`);
  links.push({ label: `${game.awayShort} injury news`, sub: "Google News, past week", href: `https://news.google.com/search?q=${injQ(game.away)}+when:7d` });
  links.push({ label: `${game.homeShort} injury news`, sub: "Google News, past week", href: `https://news.google.com/search?q=${injQ(game.home)}+when:7d` });
  links.push({ label: "Latest news", sub: "Google News search", href: `https://news.google.com/search?q=${q}` });
  links.push({ label: "Public betting splits", sub: "Action Network consensus", href: "https://www.actionnetwork.com/ncaaf/public-betting" });
  links.push({ label: "Line shopping", sub: "ESPN odds board", href: "https://www.espn.com/college-football/odds" });
  return links;
}
function sparkline(series) {
  if (!series || series.length < 2) return "";
  const min = Math.min(...series), max = Math.max(...series);
  const span = max - min || 1;
  const w = 120, h = 28;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`).join(" ");
  return `<svg class="ins-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${w}" cy="${pts.split(" ").pop().split(",")[1]}" r="2.5" fill="currentColor"/></svg>`;
}
function fmtWhen(t) {
  return new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
}
// ESPN's edge turns away Cloudflare's servers on some paths, so the game
// summary is fetched from the browser, the same way the scoreboard is.
// It carries both injury lists, the current line, records, ATS, FPI,
// weather, venue and leaders in one call.
const summaryCache = {};
async function fetchEspnSummary(eventId, fresh = false) {
  if (!eventId) return null;
  const hit = summaryCache[eventId];
  if (!fresh && hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.promise;
  // Share one request between the touch prefetch and the tap. A live
  // refresh asks for a copy no CDN has seen (the old 15-minute stamp kept
  // the play log a drive behind the scoreboard).
  const stamp = fresh ? Date.now() : Math.floor(Date.now() / 900000);
  const promise = fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${eventId}&t=${stamp}`, fresh ? { cache: "no-store" } : undefined)
    .then((res) => res.ok ? res.json() : null)
    .catch(() => null)
    .then((data) => { if (!data) delete summaryCache[eventId]; return data; });
  summaryCache[eventId] = { at: Date.now(), promise };
  return promise;
}
function parseSummaryClient(data, game) {
  if (!data || typeof data !== "object" || !data.header) return null;
  const comp = data.header?.competitions?.[0] || {};
  const side = (ha) => (comp.competitors || []).find((c) => c.homeAway === ha) || {};
  const rec = (c) => {
    const list = Array.isArray(c.record) ? c.record : [];
    return { overall: list.find((r) => r.type === "total" || r.name === "overall")?.summary || list[0]?.summary || null };
  };
  const ats = (teamId) => {
    const row = (data.againstTheSpread || []).find((r) => Number(r?.team?.id) === Number(teamId));
    const r = row?.records?.find((x) => /overall/i.test(x?.type || x?.name || "")) || row?.records?.[0];
    return r?.summary || null;
  };
  const pr = data.predictor;
  const h = Number(pr?.homeTeam?.gameProjection), a = Number(pr?.awayTeam?.gameProjection);
  const fpi = Number.isFinite(h) && Number.isFinite(a) ? { home: Math.round(h), away: Math.round(a) } : null;
  const w = data.weather || comp.weather || null;
  const weather = w ? { text: w.displayValue || null, temp: Number.isFinite(Number(w.temperature)) ? Number(w.temperature) : null, precip: Number.isFinite(Number(w.precipitation)) ? Number(w.precipitation) : null } : null;
  const venue = data.gameInfo?.venue ? { name: data.gameInfo.venue.fullName || null, indoor: !!data.gameInfo.venue.indoor } : null;
  const inj = (teamId) => {
    const block = (data.injuries || []).find((b) => Number(b?.team?.id) === Number(teamId));
    return (block?.injuries || []).map((i) => ({ name: i?.athlete?.displayName || null, pos: i?.athlete?.position?.abbreviation || null, status: i?.status || i?.type?.description || null, detail: i?.shortComment || i?.details?.detail || null })).filter((i) => i.name && i.status).slice(0, 12);
  };
  const leaders = (teamId) => {
    const block = (data.leaders || []).find((l) => Number(l?.team?.id) === Number(teamId));
    return (block?.leaders || []).slice(0, 3).map((cat) => { const top = cat?.leaders?.[0]; return top ? { cat: cat.displayName || cat.name || "", name: top.athlete?.displayName || "", line: top.displayValue || "" } : null; }).filter((x) => x && x.name);
  };
  const pc = Array.isArray(data.pickcenter) ? data.pickcenter[0] : null;
  const pcSpread = Number(pc?.spread);
  const odds = pc ? { spread: Number.isFinite(pcSpread) ? Math.abs(pcSpread) : null, favoriteSide: pc.homeTeamOdds?.favorite === true ? "home" : pc.awayTeamOdds?.favorite === true ? "away" : Number.isFinite(pcSpread) ? (pcSpread < 0 ? "home" : "away") : null, overUnder: Number.isFinite(Number(pc.overUnder)) ? Number(pc.overUnder) : null } : null;
  const away = side("away"), home = side("home");
  const awayId = Number(away.team?.id ?? game.awayId), homeId = Number(home.team?.id ?? game.homeId);
  // Preview story: ESPN files one per game once it is written.
  const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/\s+/g, " ").trim();
  const art = data.article || null;
  const paras = art?.story ? String(art.story).split(/<\/p>|\n\n/).map(strip).filter((t) => t.length > 40) : [];
  const preview = art && (art.headline || paras.length) ? { headline: art.headline || null, byline: art.byline || null, paras: paras.slice(0, 8) } : null;
  // Last five: result, score, opponent, home or away.
  const lastFive = (teamId) => {
    const block = (data.lastFiveGames || []).find((b) => Number(b?.team?.id) === teamId);
    return (block?.events || []).slice(0, 5).map((e) => ({
      result: e.gameResult || null, score: e.score || null,
      opp: e.opponent?.abbreviation || e.opponent?.displayName || null, oppName: e.opponent?.displayName || e.opponent?.location || null, oppId: e.opponent?.id || null, oppLogo: e.opponent?.logo || e.opponent?.logos?.[0]?.href || null,
      at: e.atVs || null, date: e.gameDate || null,
    })).filter((e) => e.result || e.score);
  };
  // Team stats: whatever ESPN lists for both sides, matched by name.
  const teamStats = (() => {
    const teams = data.boxscore?.teams || [];
    const t = (id) => teams.find((x) => Number(x?.team?.id) === id)?.statistics || [];
    const a = t(awayId), h = t(homeId);
    const rows = [];
    for (const st of a) {
      const other = h.find((x) => x.name === st.name);
      if (!other || st.displayValue == null || other.displayValue == null) continue;
      rows.push({ label: st.label || st.displayName || st.name, away: st.displayValue, home: other.displayValue });
    }
    return rows.slice(0, 10);
  })();
  // Series history and related articles.
  const series = (data.seasonseries || data.headToHeadGames || []).flatMap((ss) => ss?.events || []).slice(0, 5).map((e) => {
    const comps = e.competitors || [];
    const win = comps.find((c) => c.winner);
    return { date: e.date || e.gameDate || null, summary: e.summary || e.shortName || null, score: comps.map((c) => `${c.team?.abbreviation || ""} ${c.score ?? ""}`.trim()).join(" · ") || e.score || null, winner: win?.team?.abbreviation || null };
  }).filter((e) => e.summary || e.score);
  const related = (data.news?.articles || []).filter((a) => !isVideoArticle(a)).map((a) => ({ headline: a.headline || null, blurb: a.description || null, published: a.published || null, link: a.links?.web?.href || null, source: "ESPN" })).filter((a) => a.headline).slice(0, 6);
  return {
    preview, lastFive: { away: lastFive(awayId), home: lastFive(homeId) }, teamStats, series, related,
    injuriesListed: Array.isArray(data.injuries),
    injuries: { away: inj(away.team?.id ?? game.awayId), home: inj(home.team?.id ?? game.homeId) },
    records: { away: rec(away), home: rec(home) },
    ats: { away: ats(away.team?.id ?? game.awayId), home: ats(home.team?.id ?? game.homeId) },
    fpi, weather, venue, odds,
    leaders: { away: leaders(away.team?.id ?? game.awayId), home: leaders(home.team?.id ?? game.homeId) },
  };
}
// ESPN's feeds mix in clips; keep written stories only.
// Written stories only: ESPN tags each item with a type, and anything
// that is not a story type (clips, media, podcasts) is left out.
const ARTICLE_TYPES = new Set(["story", "headlinenews", "recap", "preview", "dstory", "blog", "column", "feature", "news"]);
function isVideoArticle(a) {
  const t = String(a?.type || "").toLowerCase();
  if (t && !ARTICLE_TYPES.has(t)) return true;
  const href = a?.links?.web?.href || "";
  return /\/video\/|\/watch\/|\/clip\/|tiktok\.com/.test(href) || /^(watch|video)\b/i.test(a?.headline || "");
}
async function fetchWiderNews(gameId) {
  if (!WORKER_URL) return [];
  try {
    const res = await fetch(`${WORKER_URL}/insights/news?week=${currentWeek}&game=${gameId}&t=${Math.floor(Date.now() / 600000)}`);
    if (!res.ok) return [];
    const j = await res.json();
    const items = j.items || [];
    items.errors = j.errors || [];
    return items;
  } catch { return []; }
}
// Injuries read out of the news by the Worker's model, for schools that
// file no report ESPN can see. Cached on the Worker for three hours.
// The phone sends along the articles it could reach (ESPN team news,
// GDELT), since Google and Bing throttle the Worker's own searches.
async function fetchNewsInjuries(gameId, items) {
  if (!WORKER_URL) return null;
  try {
    const res = items
      ? await fetch(`${WORKER_URL}/insights/injuries?week=${currentWeek}&game=${gameId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) })
      : await fetch(`${WORKER_URL}/insights/injuries?week=${currentWeek}&game=${gameId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
// GDELT straight from the phone: a free news index whose API allows
// browser requests, so wider news no longer hangs on the Worker reaching
// Google. Same shape as the Worker's items.
// Expert picks for the game, extracted by the Worker from the pieces the
// feeds runner found. A warm cache answers at once; a stale one is
// refreshed behind the response.
async function fetchExpertPicks(gameId) {
  if (!WORKER_URL) return null;
  try {
    const res = await fetch(`${WORKER_URL}/insights/picks?week=${currentWeek}&game=${gameId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function fetchGdeltNews(game) {
  const clean = (n) => String(n || "").replace(/^#\d+\s+/, "").replace(/[()]/g, "").trim();
  const A = clean(game.away), H = clean(game.home);
  const url = (q, about) => ({ about, url: `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${q} sourcelang:english`)}&mode=artlist&format=json&maxrecords=20&sort=DateDesc&timespan=7d` });
  const qs = [url(`"${A}" "${H}" football`, "game"), url(`"${A}" football`, "away"), url(`"${H}" football`, "home")];
  const skip = /espn\.com|youtube\.|tiktok\.|covers\.com|actionnetwork|oddsshark|pickdawgz|sportsbook|draftkings|fanduel|betmgm/i;
  const out = await Promise.all(qs.map(async (x) => {
    try {
      const res = await fetch(x.url);
      if (!res.ok) return [];
      const j = await res.json();
      return (j.articles || []).filter((a) => a?.url && a?.title && !skip.test(a.url)).map((a) => {
        const d = String(a.seendate || "");
        const iso = /^\d{8}T\d{6}Z$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z` : null;
        return { headline: a.title, source: String(a.domain || "").replace(/^www\./, ""), link: a.url, blurb: null, published: iso, about: x.about };
      });
    } catch { return []; }
  }));
  return out.flat();
}
// Feeds pulled by the scheduled GitHub Action and served from this site:
// Google and Bing results the Worker cannot fetch for itself.
let siteFeedsCache = null;
async function fetchSiteFeeds() {
  if (siteFeedsCache && siteFeedsCache.week === currentWeek && Date.now() - siteFeedsCache.loadedAt < 10 * 60 * 1000) return siteFeedsCache.data;
  try {
    const res = await fetch(`data/feeds/w${currentWeek}.json?t=${Math.floor(Date.now() / 600000)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    siteFeedsCache = { week: currentWeek, loadedAt: Date.now(), data };
    return data;
  } catch { return null; }
}
const teamNewsCache = {};
async function fetchTeamNews(teamId) {
  const hit = teamNewsCache[teamId];
  if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.items;
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/news?team=${teamId}&limit=6`);
    if (!res.ok) return [];
    const data = await res.json();
    const items = (data.articles || []).filter((a) => !isVideoArticle(a)).map((a) => ({ headline: a.headline || null, blurb: a.description || null, published: a.published || null, link: a.links?.web?.href || null, source: "ESPN" })).filter((a) => a.headline);
    teamNewsCache[teamId] = { at: Date.now(), items };
    return items;
  } catch { return []; }
}
// Sealed line to the latest number, signed from the sealed favourite.
function movementFrom(game, samples) {
  if (!samples.length) return null;
  const favSide = game.favorite === game.home ? "home" : "away";
  const signed = (x) => x.spread === null || x.favoriteSide === null ? null : x.favoriteSide === favSide ? x.spread : -x.spread;
  const pts = samples.map((x) => ({ at: x.at, v: signed(x), live: !!x.live })).filter((x) => x.v !== null);
  if (!pts.length) return null;
  const last = samples[samples.length - 1];
  const sealed = Number(game.spread) || 0;
  const nowV = pts[pts.length - 1].v;
  const delta = Math.round((nowV - sealed) * 2) / 2;
  const favShort = game.favorite === game.home ? game.homeShort : game.awayShort;
  const dogShort = game.favorite === game.home ? game.awayShort : game.homeShort;
  return { sealed, sealedFavorite: favShort, now: Math.abs(nowV), nowFavorite: nowV >= 0 ? favShort : dogShort, overUnder: last.overUnder ?? null, delta, toward: delta === 0 ? null : delta > 0 ? favShort : dogShort, points: pts };
}
let insightsOpenToken = 0;
const lineReported = new Set();
function reportLine(gameId, odds) {
  if (!WORKER_URL || !odds || odds.spread == null || !odds.favoriteSide) return;
  const key = `${currentWeek}:${gameId}`;
  if (lineReported.has(key)) return;
  lineReported.add(key);
  fetch(`${WORKER_URL}/insights/line?week=${currentWeek}&game=${gameId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spread: odds.spread, favoriteSide: odds.favoriteSide, overUnder: odds.overUnder ?? null }) }).catch(() => {});
}
const aiPreviewCache = {};
async function fetchAiPreview(game, d) {
  if (!WORKER_URL || !d) return null;
  const key = `${currentWeek}:${game.id}`;
  if (aiPreviewCache[key]) return aiPreviewCache[key];
  const side = (list) => (list || []).slice(0, 5).map((x) => ({ ...x }));
  const inj = (list) => (list || []).slice(0, 6).map((i) => `${i.name} (${i.pos || "?"}) ${i.status}`);
  const live = insLive(game.id)?.odds?.spread != null ? insLive(game.id).odds : d.odds;
  const favNow = live?.favoriteSide ? (live.favoriteSide === "home" ? game.home : game.away) : null;
  const bottom = (d.preview?.paras || []).find((t) => /bottom line:/i.test(t)) || null;
  // Storylines worth leading with, most interesting first. The model is
  // told to build around one of these rather than "QB heads into X".
  const hooks = [];
  const nm = { away: game.away, home: game.home };
  const byDate = (list) => (list || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  for (const side of ["away", "home"]) {
    const games = byDate(d.lastFive?.[side]);
    if (games.length) {
      const g0 = games[0];
      const opp = g0.oppName || null;
      const [a, b] = String(g0.score || "").split("-").map(Number);
      const margin = Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) : null;
      if (margin !== null) g0.score = `${Math.max(a, b)}-${Math.min(a, b)}`;
      if (g0.result === "L") hooks.push(`${nm[side]} are coming off a ${g0.score} loss${opp ? ` to ${opp}` : ""}${margin !== null && margin <= 7 ? " (one-score game)" : margin >= 21 ? " (blowout)" : ""}`);
      else if (g0.result === "W" && margin !== null && margin >= 28) hooks.push(`${nm[side]} are coming off a ${g0.score} rout${opp ? ` of ${opp}` : ""}`);
      let streak = 0; for (const x of games) { if (x.result === g0.result) streak += 1; else break; }
      if (streak >= 3) hooks.push(`${nm[side]} have ${g0.result === "W" ? "won" : "lost"} ${streak} straight`);
    }
    const rec = d.records?.[side]?.overall || "";
    if (/^\d+-0$/.test(rec) && Number(rec.split("-")[0]) >= 3) hooks.push(`${nm[side]} are unbeaten at ${rec}`);
    if (/^0-\d+$/.test(rec) && Number(rec.split("-")[1]) >= 3) hooks.push(`${nm[side]} are still winless at ${rec}`);
    const split = d.records?.[side]?.split;
    if (split) hooks.push(`${nm[side]} are ${split} ${side === "home" ? "at home" : "on the road"}`);
    const ats = d.ats?.[side];
    if (ats && /^(\d+)-0|^0-(\d+)/.test(ats) && ats !== "0-0") hooks.push(`${nm[side]} are ${ats} against the spread`);
    for (const i of d.injuries?.[side] || []) {
      if (/^(QB|RB|WR)$/.test(i.pos || "") && /out|doubtful/i.test(i.status || "")) hooks.push(`${nm[side]} ${i.pos} ${i.name} is listed ${i.status}; a backup would take his snaps`);
    }
  }
  // Matchup edge: best offence against the leakier defence.
  const stat = (label) => (d.teamStats || []).find((r) => r.label && r.label.toLowerCase() === label);
  const ppg = stat("points per game"), pa = stat("points allowed per game");
  if (ppg && pa) {
    const n = (v) => parseFloat(String(v).replace(/[^0-9.]/g, ""));
    for (const [off, def] of [["away", "home"], ["home", "away"]]) {
      const o = n(ppg[off]), dd = n(pa[def]);
      if (o >= 38 && dd >= 24) hooks.push(`${nm[off]} score ${ppg[off]} a game; ${nm[def]} allow ${pa[def]}`);
      if (o <= 20 && dd <= 15) hooks.push(`${nm[off]} score just ${ppg[off]} a game against a ${nm[def]} defence allowing ${pa[def]}`);
    }
  }
  const rk = (side) => insLive(game.id)?.[side === "away" ? "awayRank" : "homeRank"];
  if (rk("away") && rk("home")) hooks.push(`Top-25 matchup: No. ${rk("away")} ${game.away} at No. ${rk("home")} ${game.home}`);
  else if (rk("away") || rk("home")) { const sd = rk("away") ? "away" : "home"; hooks.push(`No. ${rk(sd)} ${nm[sd]} ${sd === "away" ? "go on the road" : "host an unranked opponent"}`); }
  if (/\b(7|8|9|10|11):\d\d\s*PM/i.test(game.kickoffLabel || "") || /\b(7|8|9|10|11)\s*PM/i.test(game.kickoffLabel || "")) hooks.push(`Night kickoff (${game.kickoffLabel})`);
  if (d.weather && ((d.weather.precip ?? 0) >= 40 || (d.weather.temp ?? 60) <= 40 || (d.weather.temp ?? 60) >= 90)) hooks.push(`Weather: ${d.weather.temp ?? ""}° ${d.weather.text || ""}${d.weather.precip ? `, ${d.weather.precip}% chance of rain` : ""}`);
  const last = (d.series || [])[0];
  if (last?.summary) hooks.push(`Last meeting: ${last.summary}${last.score ? ` (${last.score})` : ""}`);
  if (live?.spread != null && favNow) {
    const sealedFav = game.favorite === game.home ? "home" : "away";
    const nowSigned = live.favoriteSide === sealedFav ? live.spread : -live.spread;
    const moved = Math.round((nowSigned - Number(game.spread)) * 2) / 2;
    if (Math.abs(moved) >= 1.5) hooks.push(`The line has moved ${Math.abs(moved)} points toward ${moved > 0 ? game.favorite : (game.favorite === game.home ? game.away : game.home)} this week`);
  }
  const facts = {
    hooks,
    away: game.away, home: game.home,
    records: { [game.away]: d.records?.away?.overall, [game.home]: d.records?.home?.overall },
    againstTheSpread: { [game.away]: d.ats?.away, [game.home]: d.ats?.home },
    espnWinChance: d.fpi ? { [game.away]: `${d.fpi.away}%`, [game.home]: `${d.fpi.home}%` } : null,
    venue: d.venue?.name || null,
    weather: d.weather?.text ? `${d.weather.temp ?? ""}° ${d.weather.text}` : null,
    seasonLeaders: { [game.away]: side(d.leaders?.away), [game.home]: side(d.leaders?.home) },
    lastFive: { [game.away]: side(d.lastFive?.away), [game.home]: side(d.lastFive?.home) },
    injuries: { [game.away]: inj(d.injuries?.away), [game.home]: inj(d.injuries?.home) },
    line: { sealed: `${game.favorite} -${game.spread}`, now: favNow && live?.spread != null ? `${favNow} -${live.spread}` : null, total: live?.overUnder ?? null },
    series: (d.series || []).slice(0, 3),
    espnBottomLine: bottom ? bottom.replace(/^bottom line:\s*/i, "").slice(0, 400) : null,
  };
  const p = fetch(`${WORKER_URL}/insights/preview?week=${currentWeek}&game=${game.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facts }) })
    .then((r) => r.ok ? r.json() : null).then((j) => (j && j.text ? j : null)).catch(() => null)
    .then((j) => { if (!j) delete aiPreviewCache[key]; return j; });
  aiPreviewCache[key] = p;
  return p;
}
function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}
async function fetchGameSnapshot(gameId) {
  if (!WORKER_URL) return null;
  try {
    const res = await fetch(`${WORKER_URL}/insights/game?week=${currentWeek}&game=${gameId}&t=${Math.floor(Date.now() / 300000)}`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
function dayLabel(t) {
  return new Date(t).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" }).toUpperCase();
}
// The game cast's full play log: open or closed per game, kept while the
// sheet repaints; open, it fills the screen under the score.
document.getElementById("insights-body")?.addEventListener("click", (e) => {
  const b = e.target.closest(".gc-more");
  if (!b) return;
  const body = e.currentTarget, id = body.__gcGame;
  if (id == null) return;
  const open = !(window.__gcFull = window.__gcFull || {})[id];
  window.__gcFull[id] = open;
  if (open) noteUse("gamecast-log", id);
  body.__gcPaint?.();
});
// The gamecast also opens for a side bet game off the pool's slate: the
// game comes from the side bet, its live data from the side bet's own
// ESPN read. A half bet shows its whole game.
const sideGuestGame = (id) => (GAMES.some((g) => g.id === id) ? null : potNow()?.slate?.find((g) => String(g.id) === String(id)) || null);
const insLive = (id) => latestLive[id] ?? sideLive[id];
async function openInsights(gameId) {
  const modal = document.getElementById("insights-modal");
  const game = GAMES.find((g) => g.id === gameId) || sideGuestGame(gameId);
  if (!modal || !game) return;
  { const l = insLive(gameId); const kind = l?.found && l.state === "in" && !l.completed ? "gamecast" : l?.found && l.completed ? "game-final" : "game-info"; noteUse(kind, gameId); if (kind === "gamecast") { sessionUse.add(`gamecast-g${gameId}`); gcStart(gameId); } }
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const body = modal.querySelector("#insights-body");
  if (window.__gcFull) window.__gcFull[gameId] = false;
  modal.classList.remove("gc-full");
  const favShort = game.favorite === game.home ? game.homeShort : game.awayShort;
  const lg = (id, cls = "") => `<img class="ins-logo ${cls}" src="${logoUrl(id)}" alt="" loading="lazy">`;
  // The sealed line rides next to the favourite's name: "Indiana -7 at Nebraska".
  const ln = (team) => team === game.favorite && Number(game.spread) ? ` <b class="ins-ln">-${esc(game.spread)}</b>` : "";
  const titleEl = modal.querySelector("#insights-title");
  titleEl.innerHTML = `${lg(game.awayId, "hd")}<span>${esc(game.awayShort)}${ln(game.away)}<i>at</i>${esc(game.homeShort)}${ln(game.home)}</span>${lg(game.homeId, "hd")}`;
  // Long matchups shrink to fit on one line rather than cut off the line.
  titleEl.style.fontSize = "";
  requestAnimationFrame(() => {
    const t = titleEl.querySelector("span");
    let px = parseFloat(getComputedStyle(titleEl).fontSize) || 11;
    while (t && t.scrollWidth > t.clientWidth + 1 && px > 7) { px -= 0.5; titleEl.style.fontSize = `${px}px`; }
  });
  const guest = !GAMES.includes(game);
  modal.querySelector("#insights-sub").textContent = [game.kickoffLabel, game.tv].filter(Boolean).join(" · ");
  const links = () => `<div class="ins-h">MORE</div><div class="ins-chips">${insightsLinks(game).map((l) => `<a class="ins-chip" href="${l.href}" target="_blank" rel="noopener">${esc(l.label)} ›</a>`).join("")}</div>`;
  body.innerHTML = `<div class="ins-loading">Pulling injuries, the line and the numbers…</div>${links()}`;
  modal.classList.remove("hidden");
  // Paint as each source lands instead of waiting for the slowest. The
  // ESPN game page (from the phone) fills most of the sheet; news and the
  // Worker's extras slot in after, and slow Worker calls are capped.
  const token = ++insightsOpenToken;
  let data = null, snap = null, summaryRaw = null, awayNews = [], homeNews = [], wider = [], newsInj = null, gdelt = [], siteFeed = null;
  const pend = { summary: true, news: true, wider: true, ai: true, inj: true, gdelt: true, site: true, picks: true };
  let xpicks = null;
  let aiPv = null;
  const alive = () => token === insightsOpenToken && !modal.classList.contains("hidden");
  const land = (promise, set, key) => promise.then((v) => { set(v); }).catch(() => {}).finally(() => { if (key) pend[key] = false; if (alive()) paint(); });
  const paint = () => {
  const brief = data?.briefs?.[gameId] || null;
  const direct = parseSummaryClient(summaryRaw, game);
  // Browser-fetched summary first (ESPN lets phones in where it turns the
  // Worker away), then the Worker's snapshot, then the stored brief.
  const feedInj = direct?.injuriesListed ? direct.injuries : snap?.injuries || brief?.injuries || null;
  // ESPN's feed first, then whatever the beat writers reported, de-duplicated by name.
  const mergeInj = (side) => {
    const a = (feedInj?.[side] || []).slice();
    const seen = new Set(a.map((i) => String(i.name).toLowerCase()));
    for (const p of newsInj?.[side] || []) { const k = p.name.toLowerCase(); if (seen.has(k)) continue; seen.add(k); a.push({ name: p.name, pos: p.pos || null, status: p.status.charAt(0) + p.status.slice(1).toLowerCase(), detail: [p.detail, p.source && !p.quote ? `via ${p.source}` : ""].filter(Boolean).join(" · "), quote: p.quote || null, note: p.note || null, link: p.link || null, source: p.source || null, published: p.published || null }); }
    return a;
  };
  const injuries = feedInj || newsInj ? { away: mergeInj("away"), home: mergeInj("home") } : null;
  const glance = direct || snap?.glance || brief?.glance || null;
  const news = awayNews.length || homeNews.length ? { away: awayNews, home: homeNews } : snap?.news || brief?.news || null;
  if (snap?.eventId) insightsCache.eventIds = { ...(insightsCache.eventIds || {}), [gameId]: snap.eventId };
  const eventId = insLive(gameId)?.eventId || insightsCache.eventIds?.[gameId] || snap?.eventId || null;
  // Line: the Worker's logged samples plus whatever the browser sees now.
  const samples = (snap?.samples || []).filter((x) => !x.live).slice();
  const nowOdds = insLive(gameId)?.odds && insLive(gameId).odds.spread !== null ? insLive(gameId).odds : direct?.odds && direct.odds.spread !== null ? direct.odds : null;
  if (nowOdds) { samples.push({ ...nowOdds, at: Date.now(), live: true }); reportLine(gameId, nowOdds); }
  const mv = movementFrom(game, samples) || snap?.movement || brief?.movement || null;
  const feedErr = (side) => direct ? null : snap?.feeds?.[side];
  // Live or final: a gamecast in our theme at the top. Score and clock
  // from the scoreboard, where the ball is and the last play from its
  // situation, the current drive and scoring plays from ESPN's game page.
  const liveGame = () => { const l = insLive(gameId); return !!(l && l.found && l.state === "in" && !l.completed); };
  const finalGame = () => { const l = insLive(gameId); return !!(l && l.found && l.completed && l.awayScore != null && l.homeScore != null); };
  // FINAL: the score on the VS board, how the line settled, your pick and
  // the room as CASHED or MISSED, the game's top performers, ESPN's recap
  // and the scoring plays. Nothing about the build-up (preview, line
  // movement, sim) once it is over.
  const finalHtml = () => {
    const lv = insLive(gameId);
    const A = abbrOf("away"), H = abbrOf("home");
    const sc = summaryRaw?.header?.competitions?.[0]?.competitors || [];
    const colorOf = (id, fb) => { const c = sc.find((x) => Number(x.team?.id) === Number(id))?.team?.color; return c ? `#${c}` : fb || null; };
    const aCol = colorOf(game.awayId, lv.awayColor) || "#05d9e8", hCol = colorOf(game.homeId, lv.homeColor) || "#ff2079";
    const aS = lv.awayScore, hS = lv.homeScore, res = { awayScore: aS, homeScore: hS };
    const led = (v, cls = "") => `<span class="gc-led ${cls}">${esc(String(v))}</span>`;
    const tm = (id, ab, side, won) => `<div class="gc-t ${side}${won ? " won" : ""}" style="--tc:${side === "a" ? aCol : hCol}">${lg(id, "gc-tlogo")}<span class="gc-tn"><b>${esc(ab)}</b></span></div>`;
    const board = `<div class="gc-cab vs fin" style="--ac:${aCol};--hc:${hCol}"><div class="gc-row">${tm(game.awayId, A, "a", aS > hS)}${led(aS, "sc" + (aS > hS ? " win" : " lose"))}<div class="gc-clock"><b class="gc-final">FINAL</b>${/OT/i.test(String(lv.detail || "")) ? `<i class="gc-per">${esc(shortStatus(lv.detail).replace(/^FINAL\s*/i, "") || "OT")}</i>` : ""}</div>${led(hS, "sc" + (hS > aS ? " win" : " lose"))}${tm(game.homeId, H, "h", hS > aS)}</div></div>`;
    // How the sealed line settled.
    const out = resultOutcome(game, res);
    const favAb = game.favorite === game.away ? A : H, dogAb = game.favorite === game.away ? H : A;
    const favMargin = (game.favorite === game.home ? hS - aS : aS - hS);
    // Which side covered, then the game margin people actually watched
    // (not the margin over the spread, which reads oddly on a scoreboard).
    const winAb = aS > hS ? A : H, by = Math.abs(aS - hS);
    const cover = out?.push ? `PUSH ON ${favAb} -${game.spread} · ${winAb} WON BY ${by}` : favMargin > Number(game.spread) ? `${favAb} -${game.spread} COVERED · ${winAb} WON BY ${by}` : `${dogAb} +${game.spread} COVERED · ${winAb} WON BY ${by}`;
    const upset = favMargin < 0 ? `<em>UPSET</em>` : "";
    const lineHtml = `<div class="gc-settle"><b>${esc(cover)}</b>${upset}</div>`;
    // Your pick and the room.
    const cloudAll = lastGoodCloudPicks || {};
    const pickOf = (name) => sanitizePicks(cloudAll[name]?.picks || {})[game.id] || (name === currentManager ? getManagerState(name).picks?.[game.id] : null) || null;
    const termsOf = (pk) => pk.mode === "SU" ? "TO WIN" : `${pk.team === game.favorite ? "-" : "+"}${game.spread}`;
    const abOf = (pk) => pk.team === game.away ? A : H;
    const mine = currentManager ? pickOf(currentManager) : null;
    let mineHtml = "";
    if (mine) {
      const pts = scorePick(game, mine, res), pushed = mine.mode === "ATS" && out?.push;
      const st = pushed ? "push" : pts > 0 ? "up" : "down";
      mineHtml = `<div class="gc-mine ${st}"><span class="gc-mtag">YOUR PICK</span>${lg(mine.team === game.away ? game.awayId : game.homeId, "gc-mlogo")}<b>${esc(abOf(mine))} ${esc(termsOf(mine))}</b><span class="gc-msay"><i></i>${pushed ? "PUSH · 0 PT" : pts > 0 ? `CASHED · +${pts} PT${pts === 1 ? "" : "S"}` : "MISSED · 0 PT"}</span></div>`;
    }
    const room = MANAGERS.map((name) => ({ name, pick: pickOf(name) })).filter((r) => r.pick).map((r) => { const pts = scorePick(game, r.pick, res); const pushed = r.pick.mode === "ATS" && out?.push; return { ...r, pts, state: pushed ? "push" : pts > 0 ? "up" : "down" }; });
    let roomHtml = "";
    if (room.length) {
      const idx = (n) => MANAGERS.indexOf(n);
      const chip = (r) => { const accent = accentFor(r.name); const av = avatarOverrides[r.name] || shown(r.name)[0]; return `<li class="gc-rc ${r.state}${r.name === currentManager ? " me" : ""}"><span class="pick-chip-av" style="--accent:${accent}">${av}</span><b>${esc(shown(r.name))}</b><span class="gc-rt">${lg(r.pick.team === game.away ? game.awayId : game.homeId, "gc-rlogo")}${esc(termsOf(r.pick))}</span><i class="gc-rpts">${r.state === "up" ? `+${r.pts}` : r.state === "push" ? "P" : "0"}</i></li>`; };
      const up = room.filter((r) => r.state === "up").sort((x, y) => y.pts - x.pts), down = room.filter((r) => r.state === "down"), push = room.filter((r) => r.state === "push");
      const col = (cls, title, list) => `<div class="gc-rcol ${cls}"><div class="gc-rh"><i></i>${title}<span>${list.length}</span></div>${list.length ? `<ul>${list.map(chip).join("")}</ul>` : `<div class="gc-rnone">Nobody</div>`}</div>`;
      if (!guest) roomHtml = `<div class="gc-room"><div class="gc-h">THE ROOM · FINAL</div><div class="gc-rcols">${col("up", "CASHED", up)}${col("down", "MISSED", down)}</div>${push.length ? col("push", "PUSH", push) : ""}</div>`;
    }
    // Top performers: this game's leaders from ESPN, one row per category.
    const lb = Array.isArray(summaryRaw?.leaders) ? summaryRaw.leaders : [];
    const topOf = (teamId) => { const blk = lb.find((x) => Number(x?.team?.id) === Number(teamId)); return (blk?.leaders || []).map((cat) => { const t = cat?.leaders?.[0]; return t ? { cat: String(cat.displayName || cat.name || "").replace(/ ?Yards$/i, "").toUpperCase(), name: t.athlete?.displayName || t.athlete?.shortName || "", shot: t.athlete?.headshot?.href || null, line: t.displayValue || "" } : null; }).filter((x) => x && x.name); };
    const tA = topOf(game.awayId), tH = topOf(game.homeId);
    const cats = [...new Set([...tA, ...tH].map((x) => x.cat))].slice(0, 3);
    const perf = (x, side) => x ? `<div class="gc-pf ${side}">${x.shot ? `<img class="gc-pfshot" src="${esc(x.shot)}" alt="" loading="lazy">` : lg(side === "a" ? game.awayId : game.homeId, "gc-pfshot")}<div><b>${esc(x.name)}</b><span>${esc(x.line)}</span></div></div>` : `<div class="gc-pf ${side} none">-</div>`;
    const perfHtml = cats.length ? `<div class="gc-h">TOP PERFORMERS</div><div class="gc-perf">${cats.map((c) => `<div class="gc-pfrow"><span class="gc-pfcat">${esc(c)}</span>${perf(tA.find((x) => x.cat === c), "a")}${perf(tH.find((x) => x.cat === c), "h")}</div>`).join("")}</div>` : "";
    // Recap: ESPN's article once it is the recap (filed after kickoff).
    const art = summaryRaw?.article || null;
    const kick = Date.parse(game.kickoff || "");
    const isRecap = art && (/recap/i.test(String(art.type || "")) || (art.published && Number.isFinite(kick) && Date.parse(art.published) > kick));
    const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/\s+/g, " ").trim();
    const paras = isRecap && art.story ? String(art.story).split(/<\/p>|\n\n/).map(strip).filter((t) => t.length > 40).slice(0, 3) : [];
    const recapHtml = isRecap && (art.headline || paras.length) ? `<div class="gc-h">RECAP</div><div class="gc-recap">${art.headline ? `<b>${esc(art.headline)}</b>` : ""}${paras.map((t) => `<p>${esc(t)}</p>`).join("")}</div>` : "";
    // Scoring plays, cleaned, newest last for a read top to bottom.
    const spl = Array.isArray(summaryRaw?.scoringPlays) ? summaryRaw.scoringPlays : [];
    const clean = (t) => String(t || "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+for\s+(\d+)\s+yds?/i, ", $1 yds").replace(/,?\s*for a TD\b/i, " TOUCHDOWN").replace(/\s{2,}/g, " ").trim();
    const gold = (h) => h.replace(/\b(TOUCHDOWN|Field Goal|FG GOOD|SAFETY)\b/g, '<b class="gc-score">$1</b>');
    const spHtml = spl.length ? `<div class="gc-h">SCORING</div><ul class="lv-sp">${spl.map((q) => { const tid = q.team?.id != null ? Number(q.team.id) : null; return `<li>${tid ? lg(tid, "lv-splogo") : ""}<span class="lv-spq">Q${q.period?.number ?? "?"} ${esc(q.clock?.displayValue || "")}</span><span class="lv-sptxt">${gold(esc(clean(q.text || q.type?.text || "")))}</span><b class="lv-spsc">${q.awayScore ?? ""}-${q.homeScore ?? ""}</b></li>`; }).join("")}</ul>` : "";
    return `<div class="gc gc-fin">${board}${lineHtml}${mineHtml}${roomHtml}${perfHtml}${recapHtml}${spHtml}</div>`;
  };
  // The live gamecast: scoreboard strip, a field with both end zones, the
  // ball at the spot with the offence's logo over it and the line to
  // gain, down and distance, then the last three plays and the scoring.
  // Away defends the left goal, home the right, as on the scorebug.
  const gamecastHtml = () => {
    const lv = insLive(gameId), sit = lv.situation || {};
    const A = abbrOf("away"), H = abbrOf("home");
    const sc = summaryRaw?.header?.competitions?.[0]?.competitors || [];
    const colorOf = (id, fb) => { const c = sc.find((x) => Number(x.team?.id) === Number(id))?.team?.color; return c ? `#${c}` : fb || null; };
    const aCol = colorOf(game.awayId, lv.awayColor) || "#05d9e8", hCol = colorOf(game.homeId, lv.homeColor) || "#ff2079";
    const atBreak = /^(HALF|END \d)/i.test(shortStatus(lv.detail || "")) || /halftime|end of/i.test(String(lv.detail || ""));
    // Who has the ball: the scoreboard's situation, else (between plays it
    // often drops it) the team holding it after the game page's newest
    // play, else the team on the current drive.
    const curPlays = summaryRaw?.drives?.current?.plays || [];
    const lastP = curPlays.length ? curPlays[curPlays.length - 1] : null;
    const lastEnd = !lastP ? null : /timeout|end period|end of (half|game)|two.?minute|official/i.test(String(lastP.type?.text || "")) ? lastP.start?.team?.id : lastP.end?.team?.id;
    const possId = sit.possessionId ?? summaryRaw?.situation?.possession ?? lastEnd ?? summaryRaw?.drives?.current?.team?.id ?? null;
    const possA = !atBreak && possId != null && Number(possId) === Number(game.awayId);
    const possH = !atBreak && possId != null && Number(possId) === Number(game.homeId);
    // Where the ball is, 0 at the away goal to 100 at the home goal. ESPN's
    // text says "at VT 34" (34 yards from VT's goal); its yardLine number
    // is the same spot counted from the home goal on most feeds, so the
    // text wins when both are present.
    const dd = String(sit.downDistance || "");
    let x = null;
    const m = dd.match(/\bat\s+([A-Za-z&.' -]+?)\s+(\d{1,2})\s*$/);
    if (m) { const who = m[1].trim().toUpperCase(), yd = Number(m[2]); x = who === String(H).toUpperCase() ? 100 - yd : who === String(A).toUpperCase() ? yd : null; }
    else if (/\bat\s+50\b/.test(dd)) x = 50;
    // Between plays there is no "at VT 34" text. The last play says where
    // it ended ("to the VT 25"), which is the spot; ESPN's raw yardLine
    // number is not reliable for which goal it counts from, so it is only
    // used as a last resort, and then without a line to gain.
    const fromText = (t) => { const mm = String(t || "").match(/\bto the ([A-Za-z]+)\s?(\d{1,2})\b(?![^]*\bto the [A-Za-z]+\s?\d)/); if (!mm) return null; const who = mm[1].toUpperCase(), yd = Number(mm[2]); const nm = (summaryRaw?.header?.competitions?.[0]?.competitors || []).map((c) => ({ id: Number(c.team?.id), keys: [c.team?.abbreviation, c.team?.name, c.team?.location, c.team?.shortDisplayName].filter(Boolean).map((k) => String(k).toUpperCase()) })); const t1 = nm.find((c) => c.keys.includes(who)); const isHome = (t1 ? t1.id === Number(game.homeId) : who === String(H).toUpperCase()); const isAway = (t1 ? t1.id === Number(game.awayId) : who === String(A).toUpperCase()); if (yd === 50) return 50; return isHome ? 100 - yd : isAway ? yd : null; };
    const between = x === null;
    if (x === null) x = fromText(sit.lastPlay);
    if (x === null && sit.yardLine != null) x = 100 - sit.yardLine;
    const dir = possA ? 1 : possH ? -1 : 0;
    const goalToGo = /goal/i.test(dd);
    const dist = sit.distance != null ? sit.distance : (dd.match(/&\s*(\d+)/) ? Number(dd.match(/&\s*(\d+)/)[1]) : null);
    const toGo = !between && x !== null && dir && (dist != null || goalToGo) ? Math.max(0, Math.min(100, goalToGo ? (dir > 0 ? 100 : 0) : x + dir * dist)) : null;
    const pct = (v) => (8 + v * 0.84).toFixed(2);
    const ticks = Array.from({ length: 9 }, (_, i) => (i + 1) * 10).map((v) => `<i class="gc-yl${v === 50 ? " mid" : ""}" style="left:${pct(v)}%"></i><span class="gc-num" style="left:${pct(v)}%">${v <= 50 ? v : 100 - v}</span>`).join("");
    // Slide, don't jump: each marker is drawn where it was last refresh
    // and moved to its new spot after paint (data-to). Remembered per game.
    const mem = { ...((window.__gcSpot = window.__gcSpot || {})[gameId] || {}) };
    const at = (key, v) => { const prev = mem[key]; return `style="left:${prev != null ? prev : v}%" data-to="${v}"`; };
    (window.__gcSpot[gameId] = window.__gcSpot[gameId] || {});
    if (x !== null) window.__gcSpot[gameId].spot = pct(x);
    if (toGo !== null) window.__gcSpot[gameId].first = pct(toGo);
    const ball = x === null ? "" : `<div class="gc-spot gc-slide" ${at("spot", pct(x))}>${possA || possH ? `<img class="gc-off" src="${logoUrl(possA ? game.awayId : game.homeId)}" alt="">` : ""}<i class="gc-ball"></i></div>${dir ? `<span class="gc-chev gc-slide ${dir > 0 ? "r" : "l"}" ${at("spot", pct(x))}>${dir > 0 ? "&gt;&gt;&gt;" : "&lt;&lt;&lt;"}</span>` : ""}<i class="gc-los gc-slide" ${at("spot", pct(x))}></i>`;
    const gain = toGo === null ? "" : `<i class="gc-first gc-slide" ${at("first", pct(toGo))}></i>`;
    const drive = x !== null && toGo !== null ? `<i class="gc-drive" style="left:${pct(Math.min(x, toGo))}%;width:${(Math.abs(toGo - x) * 0.84).toFixed(2)}%"></i>` : "";
    // Midfield: the home team's logo painted on the turf, as at the stadium.
    const mid = `<img class="gc-mid" src="${logoUrl(game.homeId)}" alt="">`;
    // A break in play (halftime, end of a quarter): the last drive's ball
    // and lines are stale, so the field dims under a banner instead.
    const st0 = shortStatus(lv.detail || "");
    const brk = /^(HALF|END \d|END \dH)/i.test(st0) || /halftime|end of/i.test(String(lv.detail || ""));
    const brkLabel = /half/i.test(st0) || /halftime/i.test(String(lv.detail || "")) ? "HALFTIME" : (st0 || "BREAK");
    const field = `<div class="gc-stage">${brk ? `<div class="gc-brk"><span>${esc(brkLabel)}</span></div>` : ""}<div class="gc-field crt${brk ? " brk" : ""}">${mid}
      <div class="gc-ez l" style="--tc:${aCol}"><span>${esc(A)}</span></div>
      <div class="gc-ez r" style="--tc:${hCol}"><span>${esc(H)}</span></div>
      ${ticks}${brk ? "" : drive + gain + ball}
    </div></div>`;
    const status = shortStatus(lv.detail || `Q${lv.period ?? "?"} ${lv.clock ?? ""}`);
    const aS = lv.awayScore ?? 0, hS = lv.homeScore ?? 0;
    // Fighting-game header: P1 and P2 portraits, LED scores with ghost
    // segments, the game clock as the round timer, win probability as two
    // health bars draining toward the middle.
    const led = (v, cls = "") => { const t = String(v); return `<span class="gc-led ${cls}" data-ghost="${"8".repeat(t.length)}">${esc(t)}</span>`; };
    const clockOnly = /^\d{1,2}:\d{2}$/.test(String(lv.clock || "")) && !/half|end|ot|delay/i.test(status) ? lv.clock : null;
    const per = lv.period ? (lv.period > 4 ? `OT${lv.period > 5 ? lv.period - 4 : ""}` : `Q${lv.period}`) : "";
    // One scoreboard row: logo, score, clock, score, logo. Names sit under
    // the logos with the possession football beneath; the win probability
    // bar runs under the row. Scanlines live behind the content.
    // The football floats on the inside of the name, toward the clock, out
    // of the flow, so the names stay centred under their logos and nothing
    // moves when the ball changes hands.
    const pb = (poss) => poss ? `<i class="gc-pball gc-pfloat" title="Has the ball"></i>` : "";
    const tm = (id, ab, poss, side) => `<div class="gc-t ${side}${poss ? " poss" : ""}" style="--tc:${side === "a" ? aCol : hCol}">${lg(id, "gc-tlogo")}<span class="gc-tn">${side === "h" ? pb(poss) : ""}<b>${esc(ab)}</b>${side === "a" ? pb(poss) : ""}</span></div>`;
    const wp = lv.winProb;
    // Win probability: amber LED numbers with each logo at the ends, a
    // thin neon bar in the app's cyan and pink, and a bright notch where
    // the two meet. Nothing printed inside the bar.
    const wA = Math.round(wp?.away ?? 0), wH = 100 - wA;
    const hp = wp ? `<div class="gc-wp4"><span class="gc-led wpn a" data-ghost="88%">${wA}%</span><div class="gc-seg2" style="--wa:${wA}%"></div><span class="gc-led wpn h" data-ghost="88%">${wH}%</span></div><div class="gc-wpcap">WIN PROBABILITY</div>` : "";
    const strip = `<div class="gc-cab vs" style="--ac:${aCol};--hc:${hCol}"><i class="gc-sweep"></i><div class="gc-row">${tm(game.awayId, A, possA, "a")}${led(aS, "sc")}<div class="gc-clock"><span class="gc-live"><i class="lv-dot"></i>LIVE</span>${clockOnly ? `<i class="gc-per">${esc(per)}</i>${led(clockOnly, "clk")}` : `<b class="gc-stat">${esc(status)}</b>`}</div>${led(hS, "sc")}${tm(game.homeId, H, possH, "h")}</div></div>`;
    // Your pick, called out under the HUD: the side and terms, what it is
    // worth, and whether it is cashing on this score and by how much.
    const cloudAll = lastGoodCloudPicks || {};
    const pickOf = (name) => sanitizePicks(cloudAll[name]?.picks || {})[game.id] || (name === currentManager ? getManagerState(name).picks?.[game.id] : null) || null;
    const mine = currentManager ? pickOf(currentManager) : null;
    let mineHtml = "";
    if (mine) {
      const mySide = mine.team === game.away ? "away" : "home";
      const fav = mine.team === game.favorite;
      const terms = mine.mode === "SU" ? "TO WIN" : `${fav ? "-" : "+"}${game.spread}`;
      const worth = pointValue(game, mine.team, mine.mode);
      const mineS = mySide === "away" ? aS : hS, oppS = mySide === "away" ? hS : aS;
      const margin = (mineS - oppS) + (mine.mode === "SU" ? 0 : (fav ? -1 : 1) * Number(game.spread));
      const res = { awayScore: aS, homeScore: hS };
      const pushed = mine.mode === "ATS" && resultOutcome(game, res)?.push;
      const cash = pushed ? "push" : scorePick(game, mine, res) > 0 ? "up" : "down";
      const by = Math.abs(margin) % 1 ? Math.abs(margin).toFixed(1) : String(Math.abs(margin));
      const say = cash === "push" ? "PUSH RIGHT NOW" : cash === "up" ? (mine.mode === "SU" ? `WINNING BY ${by}` : `COVERING BY ${by}`) : (mine.mode === "SU" ? (margin === 0 ? "TIED" : `DOWN ${by}`) : `NEEDS ${by} MORE`);
      mineHtml = `<div class="gc-mine ${cash}"><span class="gc-mtag">YOUR PICK</span>${lg(mySide === "away" ? game.awayId : game.homeId, "gc-mlogo")}<b>${esc(mySide === "away" ? A : H)} ${esc(terms)}</b><span class="gc-mpts">${worth} PT</span><span class="gc-msay"><i></i>${esc(say)}</span></div>`;
    }
    // At a break, a mini box score replaces down and distance.
    const bsTeams = summaryRaw?.boxscore?.teams || [];
    const stat = (id, ...names) => { const t = bsTeams.find((x) => Number(x.team?.id) === Number(id)); const st = (t?.statistics || []).find((x) => names.includes(x.name)); return st?.displayValue ?? null; };
    const bsRow = (label, ...names) => { const a = stat(game.awayId, ...names), h = stat(game.homeId, ...names); return a == null && h == null ? "" : `<div class="gc-bs-r"><b>${esc(a ?? "-")}</b><span>${label}</span><b>${esc(h ?? "-")}</b></div>`; };
    const boxHtml = brk ? (() => { const rows = bsRow("TOTAL YARDS", "totalYards") + bsRow("PASSING", "netPassingYards", "passingYards") + bsRow("RUSHING", "rushingYards") + bsRow("TURNOVERS", "turnovers") + bsRow("POSSESSION", "possessionTime"); return rows ? `<div class="gc-bs"><div class="gc-bs-h"><span>${esc(A)}</span><span>${esc(brkLabel === "HALFTIME" ? "FIRST HALF" : "SO FAR")}</span><span>${esc(H)}</span></div>${rows}</div>` : ""; })() : "";
    const ddLine = brk ? boxHtml : dd ? `<div class="gc-dd${sit.isRedZone ? " rz" : ""}"><b>${esc(dd.replace(/\s+at\s+.*$/i, ""))}</b>${/\bat\s+/.test(dd) ? `<span>${esc(dd.replace(/^.*?\bat\s+/i, "at "))}</span>` : ""}${sit.isRedZone ? `<em>RED ZONE</em>` : ""}</div>` : `<div class="gc-dd"><b>${esc(sit.possessionText || (possA ? `${A} ball · between plays` : possH ? `${H} ball · between plays` : "Between plays"))}</b></div>`;
    // Last three plays: the current drive first, the previous drive if the
    // current one is too short, else the scoreboard's last play.
    const drives = summaryRaw?.drives || {};
    const pool = [...(drives.current?.plays || []), ...(drives.previous?.length ? drives.previous[drives.previous.length - 1].plays || [] : [])];
    // Newest first: the current drive, then earlier drives back as far as
    // it takes to fill the log.
    const prevDrives = Array.isArray(drives.previous) ? drives.previous : [];
    const driveOfPlay = new Map();
    for (const d of [...prevDrives, ...(drives.current ? [drives.current] : [])]) for (const pl of d?.plays || []) if (pl?.id != null) driveOfPlay.set(String(pl.id), d === drives.current ? { ...d, live: true } : d);
    // The full game log (opened from the log's header) goes back to the
    // kickoff; otherwise the last few plays.
    const full = !!(window.__gcFull || {})[gameId], LOGN = full ? Infinity : 5;
    const ordered = [...(drives.current?.plays || [])].reverse().concat(...(full ? prevDrives : prevDrives.slice(-4)).slice().reverse().map((d) => [...(d.plays || [])].reverse()));
    const totalPlays = new Set([...prevDrives, drives.current].flatMap((d) => (d?.plays || []).map((p) => p.id ?? p.text))).size;
    // ESPN's play text carries the clock, the formation, jersey numbers,
    // the tacklers and mascot-glued yard lines ("Hokies49"). Strip it to
    // the play itself and turn mascots into the abbreviations on screen.
    const mascot = {};
    for (const c of sc) { const nm = String(c.team?.name || "").trim(); if (nm) mascot[nm.toLowerCase()] = Number(c.team?.id) === Number(game.awayId) ? A : H; }
    const tidy = (t) => String(t || "")
      .replace(/^\(\d{1,2}:\d{2}(?:\s*-\s*\w+)?\)\s*/, "")
      .replace(/\b(No Huddle-?|Shotgun|Under Center|Pistol)\s*/gi, "")
      .replace(/\s*\([^)]*#\d[^)]*\)/g, "")
      .replace(/#\d{1,2}\s+/g, "")
      .replace(/\b([A-Z][a-z]+)(\d{1,2})\b/g, (m0, w, n) => `${mascot[w.toLowerCase()] || w} ${n}`)
      .replace(/\bthe\s+[A-Z&.]{2,6}\s?00\b/g, "the end zone")
      .replace(/\.?\s*The previous play is under (?:automatic )?review[\s\S]*?(CALL (?:OVERTURNED|STANDS|CONFIRMED))[\s\S]*$/i, " · $1")
      .replace(/,?\s*clock\s+\d{1,2}:\d{2}/gi, "")
      .replace(/(TOUCHDOWN[^.]*?),?\s*1ST DOWN/i, "$1")
      .replace(/\s*\(\s*\)/g, "")
      .replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
    // A touchdown's text runs on into the try and any flag on it ("...
    // TOUCHDOWN G.Spetic kick attempt good PENALTY OU Leverage 15 yards
    // from OU00 to UT50"). Stop at the score and say the try in a word;
    // the flag has its own row.
    const shortScore = (t) => {
      const m = String(t).match(/^([\s\S]*?\bTOUCHDOWN\b)([\s\S]*)$/);
      if (!m) return t;
      const rest = m[2];
      // A score wiped out by a flag keeps its whole text: the "NO PLAY"
      // is the point.
      if (/\bno play\b/i.test(rest)) return t;
      const tryRes = /two.?point|2.?pt/i.test(rest) ? (/fail|no good|incomplete|intercept/i.test(rest) ? "2PT FAILED" : /good|success|complete/i.test(rest) ? "2PT GOOD" : "")
        : /(kick|extra point|pat)[^.]*?(no good|blocked|missed)/i.test(rest) ? "PAT MISSED"
        : /(kick|extra point|pat)[^.]*?good/i.test(rest) ? "PAT GOOD" : "";
      return m[1] + (tryRes ? ` · ${tryRes}` : "");
    };
    // Quarter ends, timeouts and the like are markers, not plays: no badge.
    const isMarker = (p) => /^(end of|end quarter|end period|end of half|end of game|timeout|two-minute|official timeout|kickoff\b.*coin)/i.test(String(p.text || "").trim()) || /end period|end of half|timeout|end of game|coin toss/i.test(p.type?.text || "");
    // The scoring word in a play, gold, bold and underlined.
    const hiScore = (h) => h.replace(/\b(TOUCHDOWN|touchdown|for a TD|FIELD GOAL GOOD|field goal is good|FG GOOD|Field Goal GOOD|SAFETY|yd FG GOOD)\b/g, '<b class="gc-score">$1</b>');
    // A summary pill on every play: what happened, in a word or three,
    // so the log reads without parsing ESPN's sentence. "COMPLETE · 23
    // YDS", "RUSH · 1 YD LOSS", "SACK · 7 YD LOSS", "PENALTY · OU 15 YDS",
    // "TD CALLED BACK", "FG NO GOOD". A first down gets its own small pill,
    // and a flag on a play that still counted rides as a second pill.
    const yds = (n) => `${n} YD${n === 1 ? "" : "S"}`;
    const yardsOf = (p, t) => {
      const y = Number(p.statYardage);
      if (p.statYardage != null && Number.isFinite(y)) return y;
      if (/for no gain|no gain/i.test(t)) return 0;
      const loss = t.match(/for a loss of (\d+)|for (\d+) (?:yds?|yards?) loss|loss of (\d+)/i);
      if (loss) return -Number(loss[1] || loss[2] || loss[3]);
      const g = t.match(/for (-?\d+) (?:yds?|yards?)/i);
      return g ? Number(g[1]) : null;
    };
    // Who a flag helps, from the side with the ball: the spot moving
    // toward the end zone (ESPN's yardsToEndzone before and after) is the
    // surest read; else the flagged team matched against the offence;
    // else ESPN's own signed yardage. Returns signed yards for the
    // offence, or null when it can't tell.
    const teamKeys = new Map(sc.map((c) => [Number(c.team?.id), [c.team?.abbreviation, c.team?.name, c.team?.location, c.team?.shortDisplayName, c.team?.displayName].filter(Boolean).map((k) => String(k).toUpperCase())]));
    teamKeys.set(Number(game.awayId), [...(teamKeys.get(Number(game.awayId)) || []), String(A).toUpperCase()]);
    teamKeys.set(Number(game.homeId), [...(teamKeys.get(Number(game.homeId)) || []), String(H).toUpperCase()]);
    const teamOfAb = (ab, txt) => {
      const k = String(ab || "").toUpperCase();
      for (const [id, ks] of teamKeys) if (ks.includes(k)) return id;
      // ESPN's play text has its own abbreviations ("UT" for a Texas the
      // scorebug calls TEX). If the text names the other side somewhere,
      // in a spot like "OU30", an unknown one is the team that isn't it.
      if (txt) {
        const ids = [Number(game.awayId), Number(game.homeId)];
        const seen = new Set();
        for (const m of String(txt).toUpperCase().matchAll(/\b([A-Z&]{2,6})(?=\s?\d{1,2}\b)/g)) { if (m[1] === k) continue; for (const id of ids) if ((teamKeys.get(id) || []).includes(m[1])) seen.add(id); }
        if (seen.size === 1) return ids.find((id) => !seen.has(id)) ?? null;
      }
      return null;
    };
    const abOfId = (id) => Number(id) === Number(game.awayId) ? A : Number(id) === Number(game.homeId) ? H : "";
    const penSigned = (p, penAb, n, wholePlay) => {
      const off = p.start?.team?.id != null ? Number(p.start.team.id) : null;
      const s0 = Number(p.start?.yardsToEndzone), s1 = Number(p.end?.yardsToEndzone);
      if (wholePlay && Number.isFinite(s0) && Number.isFinite(s1) && s0 !== s1 && String(p.end?.team?.id ?? off) === String(off)) return s0 - s1;
      const pid = teamOfAb(penAb, p.text);
      if (pid != null && off != null && n != null) return pid === off ? -n : n;
      const y = Number(p.statYardage);
      return wholePlay && p.statYardage != null && Number.isFinite(y) && y ? y : null;
    };
    // "PENALTY ON OU · TEX +15": who was flagged, then the yards for the
    // side with the ball. Green when it helps the offence, pink when it
    // hurts it, the same as a gain or a loss.
    const penPill = (p, txt, wholePlay) => {
      const m = txt.match(/PENALTY\s+([A-Z&.]{2,6})\b[^0-9]*?(\d+)\s*(?:yds?|yards?)/i);
      if (!m) return ["PENALTY", "flag"];
      const ab = m[1].toUpperCase(), n = Number(m[2]);
      const pid = teamOfAb(ab, txt);
      const who = pid != null ? abOfId(pid) || ab : ab;
      const off = p.start?.team?.id != null ? Number(p.start.team.id) : null;
      const v = penSigned(p, ab, n, wholePlay);
      if (v == null || off == null || !abOfId(off)) return [`PENALTY ON ${who} · ${yds(n)}`, "flag"];
      return [`PENALTY ON ${who} · ${abOfId(off)} ${v > 0 ? "+" : "-"}${Math.abs(v)}`, v > 0 ? "flag up" : "flag dn"];
    };
    const badgeOf = (p) => {
      if (isMarker(p)) return null;
      const txt = String(p.text || ""), type = String(p.type?.text || ""), t = `${type} ${txt}`;
      const pills = [];
      const noPlay = /\bno play\b/i.test(txt);
      const td = /touchdown|for a td\b/i.test(t) && !/overturned[^.]*no touchdown/i.test(t);
      const first = /1ST DOWN/i.test(txt) || (p.end?.down === 1 && p.start?.down > 0 && p.end?.team?.id != null && String(p.end.team.id) === String(p.start?.team?.id) && !/kickoff|punt/i.test(t));
      const y = yardsOf(p, txt);
      const fl = /declined/i.test(txt) ? ["FLAG DECLINED", "dim"] : /offsetting/i.test(txt) ? ["OFFSETTING FLAGS", "flag"] : null;
      if (noPlay && td) return [["TD CALLED BACK", "to"], penPill(p, txt, false)];
      if (noPlay || /^penalty$/i.test(type) || /^\s*penalty\b/i.test(txt)) {
        if (fl) return [fl];
        const pp = penPill(p, txt, true);
        return [pp, ...(noPlay ? [["NO PLAY", "dim"]] : []), ...(/1ST DOWN/i.test(txt) && /\bup\b/.test(pp[1]) ? [["1ST DOWN", "first"]] : [])];
      }
      if (/safety/i.test(t)) pills.push(["SAFETY", "td"]);
      else if (td) pills.push(["TOUCHDOWN", "td"]);
      else if (/field goal|\bfg\b/i.test(t)) pills.push(/blocked/i.test(t) ? ["FG BLOCKED", "to"] : /no good|missed|wide (left|right)/i.test(t) ? ["FG NO GOOD", "to"] : ["FG GOOD", "td"]);
      else if (/two.?point|2.?pt conversion/i.test(t)) pills.push(/fail|no good|incomplete|intercept/i.test(t) ? ["2PT FAILED", "to"] : ["2PT GOOD", "td"]);
      else if (/extra point|kick attempt|\bpat\b/i.test(t)) pills.push(/no good|blocked|missed/i.test(t) ? ["PAT MISSED", "to"] : ["PAT GOOD", "dim"]);
      else if (/turnover on downs/i.test(t)) pills.push(["TURNOVER ON DOWNS", "to"]);
      else if (/intercept/i.test(t)) pills.push(["INTERCEPTED", "to"]);
      else if (/fumble/i.test(t)) pills.push(/opponent/i.test(type) || (p.end?.team?.id != null && p.start?.team?.id != null && String(p.end.team.id) !== String(p.start.team.id)) ? ["FUMBLE LOST", "to"] : ["FUMBLE · KEPT", "dim"]);
      else if (/\bsack/i.test(t)) pills.push([y != null && y < 0 ? `SACK · ${yds(-y)} LOSS` : "SACK", "loss"]);
      else if (/\bpunt/i.test(t)) { const n = txt.match(/punts?\s+(?:for\s+)?(\d+)\s*(?:yds?|yards?)/i); pills.push([`PUNT${n ? ` · ${yds(Number(n[1]))}` : ""}${/touchback/i.test(txt) ? " · TOUCHBACK" : /fair catch/i.test(txt) ? " · FAIR CATCH" : /blocked/i.test(txt) ? " · BLOCKED" : ""}`, "dim"]); }
      else if (/kickoff|kicks off|on-?side/i.test(t)) pills.push([/on-?side/i.test(t) ? "ONSIDE KICK" : /touchback/i.test(txt) ? "KICKOFF · TOUCHBACK" : (() => { const r = txt.match(/return(?:ed)?\s+(?:for\s+)?(\d+)\s*(?:yds?|yards?)/i); return r ? `KICKOFF · ${yds(Number(r[1]))} RETURN` : "KICKOFF"; })(), "dim"]);
      else if (/kneel/i.test(t)) pills.push(["KNEEL", "dim"]);
      else if (/incomplete/i.test(t)) pills.push(["INCOMPLETE", "dim"]);
      else if (/pass|complete/i.test(t)) pills.push(y == null ? ["COMPLETE", "gain"] : y < 0 ? [`COMPLETE · ${yds(-y)} LOSS`, "loss"] : [`COMPLETE · ${yds(y)}`, "gain"]);
      else if (/rush|run|scramble/i.test(t)) pills.push(y == null ? ["RUSH", "gain"] : y < 0 ? [`RUSH · ${yds(-y)} LOSS`, "loss"] : y === 0 ? ["RUSH · NO GAIN", "dim"] : [`RUSH · ${yds(y)}`, "gain"]);
      else if (y != null) pills.push([y < 0 ? `${yds(-y)} LOSS` : `${yds(y)}`, y < 0 ? "loss" : "gain"]);
      if (first && !td) pills.push(["1ST DOWN", "first"]);
      if (/penalty/i.test(txt) && !noPlay && !td) pills.push(fl || penPill(p, txt, false));
      return pills.length ? pills : null;
    };
    const secsOf = (c) => { const mm = String(c || "").match(/^(\d{1,2}):(\d{2})$/); return mm ? Number(mm[1]) * 60 + Number(mm[2]) : null; };
    // The current and previous drive can share a play (a kickoff, a score),
    // so drop repeats before taking three.
    const seenP = new Set();
    let plays = ordered.filter((p) => p && p.text).filter((p) => { const k = p.id || `${p.period?.number}|${p.clock?.displayValue}|${p.text}`; if (seenP.has(k)) return false; seenP.add(k); return true; }).slice(0, LOGN).map((p) => ({ key: p.id || p.text, drv: p.id != null ? driveOfPlay.get(String(p.id)) || null : null, per: Number(p.period?.number) || null, secs: secsOf(p.clock?.displayValue), text: shortScore(tidy(p.text)), sc: p.scoringPlay && p.awayScore != null && p.homeScore != null ? `${A} ${p.awayScore} · ${H} ${p.homeScore}` : "", when: `Q${p.period?.number ?? "?"} ${p.clock?.displayValue || ""}`.trim(), dd: p.start?.shortDownDistanceText || p.start?.downDistanceText || "", tid: p.start?.team?.id ?? null, badge: badgeOf(p), marker: isMarker(p) }));
    // The scoreboard feed updates faster than the game page. If its last
    // play is not the log's newest, put it on top.
    // Two feeds word the same play differently ("J.Turner rush right for
    // 5 yards gain" vs "Jalen Turner run for 5 yds"), so a play counts as
    // the same when its words and numbers mostly overlap.
    const words = (t) => new Set(tidy(t).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !/^(the|to|for|at|a|of|and|yds?|yards?|gain)$/.test(w)));
    const samePlay = (x, y) => { const A = words(x), B = words(y); if (!A.size || !B.size) return false; let n = 0; for (const w of A) if (B.has(w)) n++; const nums = (t) => [...new Set((String(t).match(/\d+/g) || []).map(Number))].sort((a, b) => a - b).join(","); return nums(tidy(x)) === nums(tidy(y)) && n / Math.min(A.size, B.size) >= 0.5; };
    if (sit.lastPlay) {
      const lp = tidy(sit.lastPlay);
      if (!plays.length || (lp && !plays.slice(0, 5).some((p) => samePlay(p.text, sit.lastPlay)))) {
        const t0 = { type: { text: "" }, text: sit.lastPlay };
        plays = [{ key: sit.lastPlay, per: Number(lv.period) || null, secs: secsOf(lv.clock), text: shortScore(lp), when: lv.period ? `Q${lv.period} ${lv.clock || ""}`.trim() : status || "", dd: "", tid: sit.lastPlayTeamId, badge: badgeOf(t0), marker: isMarker(t0) }, ...plays].slice(0, LOGN);
      }
    }
    // The newest play types itself in once, the first time it is seen.
    // Two plays ESPN numbered apart are never the same play, however alike
    // they read ("rush for 4 yds" happens a lot in a full game).
    const ided = (p) => /^\d+$/.test(String(p.key));
    plays = plays.filter((p, i) => p.marker || !plays.slice(0, i).some((q) => !q.marker && !(ided(q) && ided(p) && q.key !== p.key) && samePlay(q.text, p.text)));
    // Milestones the feed skips: the end of each quarter, halftime and the
    // two minute warning, read off the period and clock between plays (and
    // off the live clock above the newest one). ESPN's own marker wins.
    {
      const endLabel = (n) => n === 2 ? "HALFTIME" : n === 4 ? "END OF REGULATION" : n > 4 ? `END OF OT${n > 5 ? n - 4 : ""}` : `END OF ${["", "1ST", "", "3RD"][n]} QUARTER`;
      const has = (re, n) => plays.some((p) => p.marker && p.per === n && re.test(p.text));
      const endRe = /end|half/i, twoRe = /two.?minute|2.?minute/i;
      const mk = (text, per) => ({ key: `ms:${text}:${per}`, text, per, secs: null, marker: true, ms: true });
      const out = [];
      const livePer = Number(lv.period) || null, liveSecs = secsOf(lv.clock);
      const top = plays.find((p) => !p.marker && p.per);
      if (top && livePer) {
        if (brk && top.per === livePer && !has(endRe, livePer)) out.push(mk(endLabel(livePer), livePer));
        else if (!brk && livePer > top.per && !has(endRe, top.per)) out.push(mk(endLabel(top.per), top.per));
        if (!brk && (livePer === 2 || livePer === 4) && liveSecs != null && liveSecs <= 120 && top.per === livePer && top.secs != null && top.secs > 120 && !has(twoRe, livePer)) out.unshift(mk("TWO MINUTE WARNING", livePer));
      }
      plays.forEach((p, i) => {
        out.push(p);
        const q = plays.slice(i + 1).find((x) => !x.marker);
        if (p.marker || !q || !p.per || !q.per) return;
        if (q.per < p.per && !has(endRe, q.per)) out.push(mk(endLabel(q.per), q.per));
        else if (q.per === p.per && (p.per === 2 || p.per === 4) && p.secs != null && q.secs != null && p.secs <= 120 && q.secs > 120 && !has(twoRe, p.per)) out.push(mk("TWO MINUTE WARNING", p.per));
      });
      plays = out.filter((p, i) => !(p.ms && out.findIndex((x) => x.key === p.key) !== i));
    }
    // Group the log by possession: a header with the team's logo above
    // each run of plays by one side, so a change of hands reads at a
    // glance. And a clock time that repeats the row above is dropped
    // (ESPN often stamps a whole sequence with one time).
    // Headers name drives ("UK DRIVE · DOWNS"), not who has the ball now.
    // Who has it now is a lit row on top: when the side with the ball has
    // no plays in the log yet (a turnover on downs, a punt, a pick), it
    // reads "LSU BALL · NOW" above the drive that just ended, so the log
    // never shows the old offence as if it still had it.
    {
      const abOf = (t) => t === Number(game.awayId) ? A : t === Number(game.homeId) ? H : "";
      const nowT = possA ? Number(game.awayId) : possH ? Number(game.homeId) : null;
      const resOf = (d) => { const r = String(d?.displayResult || d?.result || "").trim(); return d?.live || !r ? "" : r.toUpperCase().replace(/^END OF (HALF|GAME)$/, "END OF $1"); };
      const out = []; let cur = null, lastWhen = null, first = true;
      for (const p of plays) {
        if (p.marker) { out.push(p); continue; }
        const t = p.tid != null ? Number(p.tid) : null;
        if (t != null && t !== cur) {
          if (first && nowT != null && t !== nowT) out.push({ key: `now:${nowT}`, marker: true, drive: true, now: true, tid: nowT, text: `${abOf(nowT)} BALL · NOW` });
          const isNow = first && t === nowT;
          const res = resOf(p.drv);
          out.push({ key: `drv:${t}:${p.key}`, marker: true, drive: true, now: isNow, tid: t, text: isNow ? `${abOf(t)} BALL · NOW` : `${abOf(t)} DRIVE${res ? ` · ${res}` : ""}` });
          cur = t; first = false;
        }
        out.push({ ...p, when: p.when === lastWhen ? "" : p.when });
        lastWhen = p.when;
      }
      plays = out;
    }
    const seenAll = (window.__gcSeen = window.__gcSeen || {});
    const typed = (seenAll[gameId] = Array.isArray(seenAll[gameId]) ? seenAll[gameId] : []);
    const real = plays.filter((p) => !p.marker);
    const fresh = !!real[0] && !typed.some((t) => samePlay(t, real[0].text));
    for (const p of plays) if (!typed.some((t) => samePlay(t, p.text))) typed.push(p.text);
    if (typed.length > 60) typed.splice(0, typed.length - 60);
    // Two corners facing apart to open the full log, facing in to close it.
    const corners = full
      ? `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 1v5H1M10 15v-5h5"/></svg>`
      : `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 6V1h5M15 10v5h-5"/></svg>`;
    const more = totalPlays > 5 ? `<button type="button" class="gc-more" data-gcfull="1" aria-expanded="${full}" aria-label="${full ? "Close the full game log" : `Open the full game log, ${totalPlays} plays`}" title="${full ? "Close full log" : "Full game log"}">${corners}</button>` : "";
    const playsHtml = plays.length ? `<div class="gc-log${full ? " full" : ""}"><div class="gc-logh"><span>PLAY LOG${full ? ` · ALL ${totalPlays}` : ""}</span>${more}</div><ol class="gc-plays${full ? " full" : ""}">${plays.map((p) => [p, real.indexOf(p)]).map(([p, i]) => p.drive ? `<li class="gc-drv${p.now ? " now" : ""}">${lg(p.tid, "gc-dlogo")}<span>${esc(p.text.toUpperCase())}</span></li>` : p.marker ? `<li class="gc-mark${p.ms || /end|half|two.?minute/i.test(p.text) ? " ms" : ""}"><span>${esc(p.text.replace(/\.$/, "").toUpperCase())}</span></li>` : `<li class="${i === 0 ? "new" : `old${i}`}${i === 0 && fresh ? " type" : ""}"><span class="gc-prompt">&gt;</span><div><span class="gc-pmeta">${esc([p.dd, p.when].filter(Boolean).join(" · "))}${p.sc ? `<em class="gc-psc">${esc(p.sc)}</em>` : ""}${p.badge ? `<span class="gc-pills">${p.badge.map(([bt, bc]) => `<b class="gc-badge ${bc}">${esc(bt)}</b>`).join("")}</span>` : ""}</span><span class="gc-ptxt">${hiScore(esc(p.text))}</span></div></li>`).join("")}</ol></div>` : "";
    void pool;
    const wpHtml = "";
    const sp = Array.isArray(summaryRaw?.scoringPlays) ? summaryRaw.scoringPlays : [];
    // "M. Heintschel pass to C. Hicks for 22 yds, for a TD (A. Chadha KICK)"
    // becomes "M. Heintschel pass to C. Hicks, 22 yds TOUCHDOWN".
    const cleanScore = (t) => String(t || "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+for\s+(\d+)\s+yds?/i, ", $1 yds").replace(/,?\s*for a TD\b/i, " TOUCHDOWN").replace(/\bFG GOOD\b/i, "FIELD GOAL GOOD").replace(/\s{2,}/g, " ").trim();
    const spHtml = sp.length ? `<div class="gc-h">SCORING</div><ul class="lv-sp">${sp.slice().reverse().map((q) => { const tid = q.team?.id != null ? Number(q.team.id) : null; return `<li>${tid ? lg(tid, "lv-splogo") : ""}<span class="lv-spq">Q${q.period?.number ?? "?"} ${esc(q.clock?.displayValue || "")}</span><span class="lv-sptxt">${hiScore(esc(cleanScore(q.text || q.type?.text || "")))}</span><b class="lv-spsc">${q.awayScore ?? ""}-${q.homeScore ?? ""}</b></li>`; }).join("")}</ul>` : "";
    const room = MANAGERS.map((name) => ({ name, pick: pickOf(name) })).filter((r) => r.pick);
    let roomHtml = "";
    if (room.length) {
      const res = { awayScore: aS, homeScore: hS };
      const pushed = resultOutcome(game, res)?.push;
      const rows = room.map((r) => {
        const side = r.pick.team === game.away ? "away" : "home";
        const fav = r.pick.team === game.favorite;
        const terms = r.pick.mode === "SU" ? "WIN" : `${fav ? "-" : "+"}${game.spread}`;
        const state = r.pick.mode === "ATS" && pushed ? "push" : scorePick(game, r.pick, res) > 0 ? "up" : "down";
        return { ...r, side, terms, state, worth: pointValue(game, r.pick.team, r.pick.mode) };
      });
      const idx = (n) => MANAGERS.indexOf(n);
      const chip = (r) => { const accent = accentFor(r.name); const av = avatarOverrides[r.name] || shown(r.name)[0]; return `<li class="gc-rc ${r.state}${r.name === currentManager ? " me" : ""}"><span class="pick-chip-av" style="--accent:${accent}">${av}</span><b>${esc(shown(r.name))}</b><span class="gc-rt">${lg(r.side === "away" ? game.awayId : game.homeId, "gc-rlogo")}${esc(r.terms)}</span><i class="gc-rpts">${r.state === "up" ? `+${r.worth}` : r.state === "push" ? "P" : "0"}</i></li>`; };
      const up = rows.filter((r) => r.state === "up"), down = rows.filter((r) => r.state === "down"), push = rows.filter((r) => r.state === "push");
      const col = (cls, title, list) => `<div class="gc-rcol ${cls}"><div class="gc-rh"><i></i>${title}<span>${list.length}</span></div>${list.length ? `<ul>${list.map(chip).join("")}</ul>` : `<div class="gc-rnone">Nobody</div>`}</div>`;
      if (!guest) roomHtml = `<div class="gc-room"><div class="gc-h">THE ROOM · ON THIS SCORE</div><div class="gc-rcols">${col("up", "CASHING", up)}${col("down", "SWEATING", down)}</div>${push.length ? col("push", "PUSH", push) : ""}</div>`;
    }
    // The full game log takes the whole screen: the score and the down on
    // top as ever, then every play.
    if (full) return `<div class="gc gc-fs">${strip}${ddLine}${playsHtml}</div>`;
    return `<div class="gc">${strip}${mineHtml}${field}${ddLine}${playsHtml}${roomHtml}${wpHtml}${spHtml}</div>`;
  };
  // Built as a function and prepended once abbrOf exists below.
  const liveBlock = () => {
  const lv = insLive(gameId);
  const liveNow = !!(lv && lv.found && lv.state === "in" && !lv.completed);
  const finalNow = !!(lv && lv.found && lv.completed);
  let liveHtml = "";
  if (liveNow || finalNow) {
    const sit = lv.situation || null;
    const possA = sit?.possessionId != null && Number(sit.possessionId) === Number(game.awayId), possH = sit?.possessionId != null && Number(sit.possessionId) === Number(game.homeId);
    const aS = lv.awayScore ?? 0, hS = lv.homeScore ?? 0;
    const status = finalNow ? shortStatus(lv.detail || "Final") : shortStatus(lv.detail || `Q${lv.period ?? "?"} ${lv.clock ?? ""}`);
    const row = (id, ab, sc, poss, lead) => `<div class="lv-row ${lead ? "lead" : ""}">${lg(id, "lv-logo")}<b class="lv-ab">${esc(ab)}</b>${poss && liveNow ? `<i class="lv-poss" title="Possession"></i>` : ""}<span class="lv-sc">${sc}</span></div>`;
    const drives = summaryRaw?.drives || null;
    const cur = liveNow ? drives?.current || null : null;
    const curTeamId = cur?.team?.id != null ? Number(cur.team.id) : null;
    const curAb = curTeamId === Number(game.awayId) ? abbrOf("away") : curTeamId === Number(game.homeId) ? abbrOf("home") : "";
    const sp = Array.isArray(summaryRaw?.scoringPlays) ? summaryRaw.scoringPlays : [];
    const spRows = sp.slice(-8).reverse().map((x) => {
      const tid = x.team?.id != null ? Number(x.team.id) : null;
      const ab = tid === Number(game.awayId) ? abbrOf("away") : tid === Number(game.homeId) ? abbrOf("home") : "";
      return `<li>${tid ? lg(tid, "lv-splogo") : ""}<span class="lv-spq">Q${x.period?.number ?? "?"} ${esc(x.clock?.displayValue || "")}</span><span class="lv-sptxt">${esc(x.text || x.type?.text || "")}</span><b class="lv-spsc">${x.awayScore ?? ""}-${x.homeScore ?? ""}</b></li>`;
    }).join("");
    const wp = lv.winProb;
    liveHtml = `<div class="lv ${liveNow ? "on" : "fin"}">
      <div class="lv-head"><span class="lv-tag">${liveNow ? `<i class="lv-dot"></i>LIVE` : "FINAL"}</span><span class="lv-clock">${esc(status)}</span>${lv.detail && liveNow && sit?.isRedZone ? `<span class="lv-rz">RED ZONE</span>` : ""}</div>
      ${row(game.awayId, abbrOf("away"), aS, possA, aS > hS)}
      ${row(game.homeId, abbrOf("home"), hS, possH, hS > aS)}
      ${liveNow && (sit?.downDistance || sit?.possessionText) ? `<div class="lv-sit">${esc([sit.downDistance, sit.possessionText].filter(Boolean).join(" · "))}${curAb && cur?.description ? ` <em>· ${esc(curAb)} drive: ${esc(cur.description)}</em>` : ""}</div>` : ""}
      ${liveNow && sit?.lastPlay ? `<div class="lv-last"><b>LAST</b> ${esc(sit.lastPlay)}</div>` : ""}
      ${wp && liveNow ? `<div class="win-prob-bar"><div class="win-prob-fill away" style="width:${wp.away}%"></div><div class="win-prob-fill home" style="width:${wp.home}%"></div></div><div class="win-prob-labels"><span>${Math.round(wp.away)}% ${esc(abbrOf("away"))}</span><span>${Math.round(wp.home)}% ${esc(abbrOf("home"))}</span></div>` : ""}
      ${spRows ? `<div class="lv-sph">SCORING</div><ul class="lv-sp">${spRows}</ul>` : ""}
    </div>`;
  }
  return liveHtml;
  };
  // Before kickoff: who is on which side, one column per team, one row per
  // bet. Other cards stay hidden until the game locks.
  const roomPre = (() => {
    const all = lastGoodCloudPicks || {};
    const locked = isGameLocked(game);
    const chip = (n) => `<span class="rp-chip${n === currentManager ? " me" : ""}"><span class="pick-chip-av" style="--accent:${accentFor(n)}">${esc(avatarOverrides[n] || shown(n)[0])}</span>${esc(shown(n))}</span>`;
    if (!locked) {
      const mine = all[currentManager]?.picks?.[game.id];
      const inN = MANAGERS.filter((n) => all[n]?.picks?.[game.id]).length;
      // Your own pick gets its own badge: team logo, the pick in words
      // (WIN or the spread) and what it pays, so it is never hunted for.
      const mineTeam = mine ? (mine.team === game.away ? game.awayShort : game.homeShort) : "";
      const mineId = mine ? (mine.team === game.away ? game.awayId : game.homeId) : null;
      // The short name, as the line and the expert tiles use it.
      const mineAb = mine ? ((summaryRaw?.header?.competitions?.[0]?.competitors || []).find((c) => Number(c.team?.id) === Number(mineId))?.team?.abbreviation || mineTeam) : "";
      const mineTerms = mine ? (mine.mode === "SU" ? "WIN" : `${mine.team === game.favorite ? "-" : "+"}${game.spread}`) : "";
      const minePts = mine ? pointValue(game, mine.team, mine.mode === "SU" ? "SU" : "ATS") : 0;
      // Before kickoff there is nothing to reveal, so no room box: just
      // your own pick on one slim line under the header.
      return mine
        ? `<div class="ins-mypick"><span class="k">YOUR PICK</span>${lg(mineId, "sm")}<b>${esc(mineAb)} ${esc(mineTerms)}</b><i>${mine.mode === "SU" ? "STRAIGHT UP" : "SPREAD"} · ${minePts} PT${minePts === 1 ? "" : "S"}</i></div>`
        : `<button type="button" class="ins-mypick none" id="ins-mypick-go"><span class="k">YOUR PICK</span><b>NO PICK YET</b><i>TAP TO PICK ›</i></button>`;
    }
    const side = (team, short, id) => {
      const bets = [["ATS", `${team === game.favorite ? "-" : "+"}${game.spread}`], ["SU", "WIN"]].map(([mode, label]) => {
        const who = MANAGERS.filter((n) => { const pk = all[n]?.picks?.[game.id]; return pk && pk.team === team && pk.mode === mode; });
        if (!who.length) return "";
        return `<div class="rp-bet"><div class="rp-bh"><b>${esc(label)}</b><em>${pointValue(game, team, mode)} PT</em><i>${who.length}</i></div><div class="rp-chips">${who.map(chip).join("")}</div></div>`;
      }).join("");
      const n = MANAGERS.filter((m) => all[m]?.picks?.[game.id]?.team === team).length;
      return `<div class="rp-col"><div class="rp-team">${lg(id, "rp-logo")}<span>${esc(short)}</span><b>${n}</b></div>${bets || `<div class="rp-none">Nobody</div>`}</div>`;
    };
    const none = MANAGERS.filter((n) => !all[n]?.picks?.[game.id]);
    if (guest) return "";
    return `<div class="rp"><div class="rp-h">THE ROOM · WHO HAS WHAT</div><div class="rp-cols">${side(game.away, game.awayShort, game.awayId)}${side(game.home, game.homeShort, game.homeId)}</div>${none.length ? `<div class="rp-np">NO PICK · ${none.map((n) => esc(shown(n))).join(", ")}</div>` : ""}</div>`;
  })();
  // Simulate is a pre-lock toy: once picks lock, it goes away.
  let html = roomPre + (isGameLocked(game) ? "" : `<button type="button" class="ins-sim ins-sim-pill" id="ins-sim" aria-label="Simulate game" title="Simulate game"><span class="ins-sim-gb" aria-hidden="true"><i></i></span><b>SIM</b></button>`);
  const hdrComps = summaryRaw?.header?.competitions?.[0]?.competitors || [];
  const abbrOf = (side) => {
    const id = side === "away" ? game.awayId : game.homeId;
    const c = hdrComps.find((x) => Number(x.team?.id) === Number(id));
    return c?.team?.abbreviation || (side === "away" ? game.awayShort : game.homeShort);
  };

  // 2. Line: OPENED -> SEALED -> NOW, each step saying how far and toward
  // whom, then one plain sentence. Values are signed from the sealed
  // favourite: positive means they are favoured by that much.
  // The simulate pill lives in the header; clear the last one first.
  modal.querySelector(".h2h-top #ins-sim")?.remove();
  modal.classList.toggle("gc-mode", liveGame() || finalGame());
  modal.classList.toggle("gc-full", liveGame() && !!(window.__gcFull || {})[gameId]);
  if (finalGame()) {
    body.innerHTML = finalHtml() + links() + `<div class="ins-foot">Final from ESPN.</div>`;
    return;
  }
  if (liveGame()) {
    body.__gcPaint = paint; body.__gcGame = gameId;
    const logTop = body.querySelector(".gc-plays.full")?.scrollTop ?? null;
    body.innerHTML = gamecastHtml() + links() + `<div class="ins-foot">Live from ESPN. Refreshes every 8 seconds.</div>`;
    if (logTop != null) { const l = body.querySelector(".gc-plays.full"); if (l) l.scrollTop = logTop; }
    const sliders = body.querySelectorAll(".gc-slide[data-to]");
    if (sliders.length) { void body.offsetWidth; requestAnimationFrame(() => sliders.forEach((el) => { el.style.left = `${el.dataset.to}%`; })); }
    // Type the newest play on, a character at a time. Done in script so it
    // renders the same on every browser (Safari never ran the CSS version).
    const tp = body.querySelector(".gc-log li.type .gc-ptxt");
    if (tp) {
      const full = tp.textContent, html = tp.innerHTML; tp.textContent = ""; tp.classList.add("typing");
      let n = 0; const step = Math.max(1, Math.round(full.length / 45));
      const t = setInterval(() => { n += step; tp.textContent = full.slice(0, n); if (n >= full.length || !tp.isConnected) { clearInterval(t); tp.innerHTML = html; tp.classList.remove("typing"); } }, 28);
    }
    return;
  }
  html = liveBlock() + html;
  html += `<div class="ins-h">LINE</div>`;
  {
    const favId = game.favorite === game.home ? game.homeId : game.awayId, dogId = game.favorite === game.home ? game.awayId : game.homeId;
    const dogShort = game.favorite === game.home ? game.awayShort : game.homeShort;
    const sealedV = Number(game.spread) || 0;
    // Opening line from ESPN's preview text: "Opening Line: Virginia Tech by 5.5."
    let openV = null;
    const openTxt = (direct?.preview?.paras || []).map((t) => t.match(/opening line:\s*(.+?)\s+by\s+(\d+(?:\.\d+)?)/i)).find(Boolean);
    if (openTxt) {
      const n = openTxt[1].toLowerCase();
      const isDog = [game.favorite === game.home ? game.away : game.home, dogShort].some((x) => { const y = String(x || "").toLowerCase().replace(/^#\d+\s+/, ""); return y && (n.includes(y) || y.includes(n) || y.startsWith(n.slice(0, 4))); });
      openV = isDog ? -Number(openTxt[2]) : Number(openTxt[2]);
    }
    const nowV = mv ? (mv.nowFavorite === favShort ? mv.now : -mv.now) : null;
    // Line meter: one axis from the dog's side to the favourite's side.
    // Every marker is a number on that axis, so a half point is one tick
    // and the band between SEALED and NOW is the edge the market has moved.
    const favAb = abbrOf(game.favorite === game.home ? "home" : "away"), dogAb = abbrOf(game.favorite === game.home ? "away" : "home");
    // One comparison: the line you locked (the sealed line) against where
    // the market sits now. The opening line is small print, not a marker.
    const myPick = currentManager ? getManagerState(currentManager).picks?.[game.id] : null;
    const myFav = myPick ? myPick.team === game.favorite : null;
    const mySU = !!myPick && myPick.mode === "SU";
    // Numbers read from your side when you took the dog: NEB +7, not IU -7.
    const dogView = myPick && !myFav;
    const lab = (v) => v === 0 ? "PK" : dogView ? `${dogAb} ${v > 0 ? "+" : "-"}${Math.abs(v)}` : `${v > 0 ? favAb : dogAb} -${Math.abs(v)}`;
    const vals = [sealedV, nowV].filter((v) => v !== null);
    let lo = Math.min(...vals) - 0.5, hi = Math.max(...vals) + 0.5;
    if (hi - lo < 3) { const mid = (hi + lo) / 2; lo = mid - 1.5; hi = mid + 1.5; }
    lo = Math.floor(lo * 2) / 2; hi = Math.ceil(hi * 2) / 2;
    const pos = (v) => (((v - lo) / (hi - lo)) * 100).toFixed(1);
    const ticks = Math.round((hi - lo) * 2);
    const nowMoved = nowV !== null && nowV !== sealedV;
    // A bigger favourite number helps whoever holds the favourite at the
    // smaller sealed number and hurts the dog holder, and vice versa.
    const forMe = !myPick || !nowMoved ? null : (nowV > sealedV) === myFav;
    const tone = forMe === null ? "" : forMe ? " good" : " bad";
    // The numbers live in the strip above; the rail only says where.
    const seal = `<i class="lm-pt seal" style="left:${pos(sealedV)}%"></i><span class="lm-lab seal up" style="left:${pos(sealedV)}%">${!nowMoved && nowV !== null ? (myPick && !mySU ? "YOU = MKT" : "LINE = MKT") : myPick && !mySU ? "YOU" : "LINE"}</span>`;
    const now = nowV === null || !nowMoved ? "" : `<i class="lm-pt now" style="left:${pos(nowV)}%"></i><span class="lm-lab now dn" style="left:${pos(nowV)}%">MKT ${esc(lab(nowV))}</span>`;
    const bandL = nowMoved ? pos(Math.min(sealedV, nowV)) : 0, bandW = nowMoved ? (Math.abs(nowV - sealedV) / (hi - lo) * 100).toFixed(1) : 0;
    const band = nowMoved ? `<i class="lm-band ${nowV > sealedV ? "r" : "l"}${tone}" style="left:${bandL}%;width:${bandW}%"></i>` : "";
    const zero = lo < 0 && hi > 0 ? `<i class="lm-zero" style="left:${pos(0)}%"></i>` : "";
    const dS = nowV === null ? 0 : Math.round(Math.abs(nowV - sealedV) * 2) / 2;
    const pts = dS === 0.5 ? "Half a point" : dS === 1 ? "1 point" : `${dS} points`;
    const myAb = myPick ? (myFav ? favAb : dogAb) : "";
    // Win odds for your team (or the favourite) at the sealed line and now.
    const cdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - q : q; };
    const wp = (v) => Math.round(cdf((dogView ? -v : v) / 15) * 100);
    const oddsAb = myPick ? myAb : favAb;
    // The one sentence: what the move means for you.
    // One short verdict; the strip above already carries both numbers.
    const pickTeam = myPick ? esc(myAb) : "";
    const say = nowV === null ? `No live line yet.`
      : !nowMoved ? `At market. No edge either way.`
      : mySU ? (forMe ? `<em class="good">✓ Market likes ${pickTeam} more</em> than when you picked.` : `<em class="bad">✗ Market likes ${pickTeam} less</em> than when you picked.`)
      : myPick ? (forMe ? `<em class="good">✓ Moved your way:</em> ${pts.toLowerCase()} better than the market.` : `<em class="bad">✗ Moved against you:</em> ${pts.toLowerCase()} worse than the market.`)
      : `${pts} better for ${esc(nowV > sealedV ? favAb : dogAb)} pickers.`;
    const ouSmall = mv?.overUnder ?? direct?.odds?.overUnder ?? null;
    const small = [nowV !== null && nowMoved ? `${esc(oddsAb)} win odds ${wp(sealedV)}% → ${wp(nowV)}%` : "", openV !== null ? `Opened ${esc(lab(openV))}` : "", ouSmall !== null ? `O/U ${esc(ouSmall)}` : ""].filter(Boolean).join(" · ");
    const read = "";
    const l1 = say, l2 = small ? `<small class="lm-small">${small}</small>` : "";
    const open = "", move = "";
    const ou = mv?.overUnder ?? direct?.odds?.overUnder ?? null;
    // Ticker strip across the top, like a quote line on an old terminal:
    // the market number, the move since your seal and which way it went.
    const chip = nowV === null ? "" : nowMoved ? `<i class="${tone.trim() || "flat"}">${forMe === false ? "▼" : "▲"}${dS}</i>` : `<i class="flat">■ 0</i>`;
    const tk = `<span class="k">${myPick && !mySU ? "YOU" : "LINE"}</span><b class="you">${esc(lab(sealedV))}</b>`
      + (nowV === null ? `<span class="k">NO QUOTE</span>` : !nowMoved ? `<i class="flat">AT MARKET</i>` : `<span class="k">MKT</span><b class="mkt">${esc(lab(nowV))}</b>${chip}`);
    // No quote strip: your pick is in the chip above the line, and the
    // market number sits on its marker.
    void tk;
    // Nothing moved (or no quote yet): no rail, just a terminal line.
    if (!nowMoved) {
      const msg = nowV === null ? "NO LIVE LINE YET" : `NO CHANGE · ${esc(lab(sealedV))}`;
      html += `<div class="lm lm-term lm-slim lm-still"><div class="lm-cmd"><span class="p">&gt;</span> ${msg}<span class="lm-cur">█</span></div>${small ? `<div class="lm-small">${small}</div>` : ""}</div>`;
    } else
    html += `<div class="lm lm-term lm-slim"><div class="lm-axis" style="--ticks:${ticks}">
      <span class="lm-end l">${lg(dogId, "sm")}<em>${esc(dogAb)}</em></span><span class="lm-end r">${lg(favId, "sm")}<em>${esc(favAb)}</em></span>
      ${zero}${band}${open}${seal}${now}${move}</div>
      <div class="lm-read"><span><span>${l1}</span>${l2}</span></div>${read}</div>`;
  }

  // Preview: same layout as ever (headline, text, "Read the rest"). The
  // written preview supplies the headline and text when it is ready; ESPN's
  // own paragraphs sit under "Read the rest". The ESPN opening-line
  // paragraph still fills the ATS row in the grid below.
  let previewAts = null;
  if (direct?.preview || aiPv?.text) {
    const pv = direct?.preview || { headline: null, paras: [] };
    const sideOf = (name) => {
      const n = String(name || "").toLowerCase().replace(/\(.*?\)/g, "").trim();
      const hit = (sd) => [sd === "away" ? game.away : game.home, sd === "away" ? game.awayShort : game.homeShort, abbrOf(sd)]
        .map((x) => String(x || "").toLowerCase().replace(/^#\d+\s+/, "").trim()).filter(Boolean)
        .some((x) => n.includes(x) || x.includes(n) || (n.length >= 4 && x.startsWith(n.slice(0, 4))));
      return hit("away") ? "away" : hit("home") ? "home" : null;
    };
    for (const t of pv.paras) {
      const ats = t.match(/against the spread:\s*(.+?)\s+(\d+-\d+(?:-\d+)?),\s*(.+?)\s+(\d+-\d+(?:-\d+)?)/i);
      if (ats) { previewAts = {}; [[ats[1], ats[2]], [ats[3], ats[4]]].forEach(([n, r]) => { const sd = sideOf(n); if (sd) previewAts[sd] = r; }); }
    }
    const headline = aiPv?.headline || pv.headline;
    const lead = aiPv?.text ? [aiPv.text] : pv.paras.slice(0, 2);
    html += `<div class="ins-h">PREVIEW</div>${headline ? `<div class="ins-pv-h">${esc(headline)}</div>` : ""}`;
    html += `<div class="ins-pv">${lead.map((t) => `<p>${esc(t)}</p>`).join("")}${!aiPv?.text && pend.ai ? `<p class="pv-wait">Writing a sharper preview…</p>` : ""}</div>`;
  }

  // 3. Insights: the numbers, then the written brief.
  html += `<div class="ins-h">INSIGHTS</div>`;
  // Matchup: one table under one team header. Record, ATS and FPI first,
  // then the season stats, the better number in green.
  const better = (label, a, h) => {
    const x = parseFloat(String(a).replace(/[^0-9.\-]/g, "")), y = parseFloat(String(h).replace(/[^0-9.\-]/g, ""));
    if (!Number.isFinite(x) || !Number.isFinite(y) || x === y) return [false, false];
    const lowerWins = /allow|against|turnover(?!.*margin)|penalt|sack(?:s)? allowed|interception/i.test(label);
    return lowerWins ? [x < y, y < x] : [x > y, y > x];
  };
  if (glance) {
    const cell = (k, a, h, aCls = "", hCls = "", plain = false) => a == null && h == null ? "" : `<div class="ins-g"><span class="ins-gk${plain ? " plain" : ""}">${esc(k)}</span><span class="ins-gv ${aCls}">${esc(a ?? "—")}</span><span class="ins-gv ${hCls}">${esc(h ?? "—")}</span></div>`;
    const w = glance.weather ? [glance.weather.temp !== null ? `${glance.weather.temp}°` : null, glance.weather.text, glance.weather.precip ? `${glance.weather.precip}% rain` : null].filter(Boolean).join(" · ") : null;
    // Four rows that say the most; the rest fold under MORE STATS.
    const KEY = [/^points per game/i, /^points allowed/i, /^total yards$|^yards per game|^total offense/i, /^yards allowed$|^total yards allowed|^total defense/i];
    const allStats = direct?.teamStats || [];
    const isKey = (r) => KEY.some((re) => re.test(r.label));
    const statRow = (r) => { const [ab, hb] = better(r.label, r.away, r.home); return cell(r.label, r.away, r.home, ab ? "lead" : "", hb ? "lead" : "", true); };
    const keyStats = allStats.filter(isKey).sort((a, b) => KEY.findIndex((re) => re.test(a.label)) - KEY.findIndex((re) => re.test(b.label)));
    const restStats = allStats.filter((r) => !isKey(r));
    const statRows = (keyStats.length ? keyStats : allStats.slice(0, 4)).map(statRow).join("");
    const moreStats = (keyStats.length ? restStats : allStats.slice(4)).map(statRow).join("");
    html += `<div class="ins-glance ins-stats"><div class="ins-g head"><span></span><span>${lg(game.awayId)}${esc(abbrOf("away"))}</span><span>${lg(game.homeId)}${esc(abbrOf("home"))}</span></div>`
      + cell("RECORD", glance.records?.away?.overall, glance.records?.home?.overall)
      + cell("ATS", glance.ats?.away || previewAts?.away, glance.ats?.home || previewAts?.home)
      + cell("ESPN FPI", glance.fpi ? `${glance.fpi.away}%` : null, glance.fpi ? `${glance.fpi.home}%` : null, glance.fpi && glance.fpi.away > glance.fpi.home ? "lead" : "", glance.fpi && glance.fpi.home > glance.fpi.away ? "lead" : "")
      + (statRows ? `<div class="ins-g divider"><span>SEASON</span></div>${statRows}` : "")
      + `</div>`
      + (moreStats ? `<details class="ins-more-news ins-more-stats"><summary><span>▶</span> MORE STATS</summary><div class="ins-glance ins-stats">${moreStats}</div></details>` : "")
      + (w ? `<div class="ins-wx"><span>${esc(w)}</span></div>` : "");
    if (glance.venue?.name) modal.querySelector("#insights-sub").textContent = [game.kickoffLabel, game.tv, `${glance.venue.name}${glance.venue.indoor ? " (indoors)" : ""}`].filter(Boolean).join(" · ");
    // Leaders: two columns in the same away/home order, logo only.
    const catShort = (c) => /pass/i.test(c) ? "PASS" : /rush/i.test(c) ? "RUSH" : /receiv/i.test(c) ? "REC" : /tackle/i.test(c) ? "TKL" : /sack/i.test(c) ? "SACK" : String(c).toUpperCase().slice(0, 5);
    const lead = (list, teamId) => `<div class="ins-lead"><b>${lg(teamId)}</b>${(list || []).map((l) => `<span><em class="ins-cat">${esc(catShort(l.cat))}</em>${esc(l.name)}<i>${esc(l.line)}</i></span>`).join("")}</div>`;
    if (glance.leaders?.away?.length || glance.leaders?.home?.length) html += `<div class="ins-sub-h">LEADERS</div><div class="ins-leads">${lead(glance.leaders.away, game.awayId)}${lead(glance.leaders.home, game.homeId)}</div>`;
  }
  // Last five: opponent logos, result and score; a small @ for road games.
  const form = direct?.lastFive;
  if (form && (form.away.length || form.home.length)) {
    const chip = (e) => `<span class="ins-fchip ${e.result === "W" ? "w" : e.result === "L" ? "l" : ""}" title="${esc(`${e.result || ""} ${e.at === "@" ? "at" : "vs"} ${e.oppName || e.opp || ""} ${e.score || ""}`)}">${e.at === "@" ? `<u>@</u>` : ""}${e.oppId || e.oppLogo ? `<img src="${e.oppId ? logoUrl(e.oppId) : esc(e.oppLogo)}" alt="${esc(e.opp || "")}" loading="lazy">` : `<i>${esc(e.opp || "")}</i>`}<b>${esc(e.result || "·")}</b><i>${esc(e.score || "")}</i></span>`;
    const row = (teamId, list) => `<div class="ins-form"><span class="ins-form-t">${lg(teamId)}</span><span class="ins-form-r">${list.map(chip).join("") || `<span class="ins-det">No games yet.</span>`}</span></div>`;
    html += `<div class="ins-h">LAST FIVE</div>${row(game.awayId, form.away)}${row(game.homeId, form.home)}`;
  }
  // Series history.
  if (direct?.series?.length) {
    html += `<div class="ins-sub-h">SERIES</div><ul class="ins-news">${direct.series.map((e) => `<li>${esc(e.summary || "")}${e.score ? `<span class="ins-det">${esc(e.score)}${e.date ? ` · ${esc(new Date(e.date).getFullYear())}` : ""}</span>` : ""}</li>`).join("")}</ul>`;
  }
  if (!glance && pend.summary) html += `<div class="ins-loading">Loading ESPN's game page…</div>`;
  else if (!glance) html += `<div class="ins-empty">ESPN has not published this week's game page yet. Numbers land here once it does.${!eventId ? ` <i class="ins-err">game not on the scoreboard feed yet</i>` : ""}</div>`;
  // Mix sources: game-specific first, then alternate the wider press with
  // ESPN so no single outlet fills the list.
  const seen = new Set();
  const norm = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70);
  const aboutLabel = (a) => a === "game" ? "This game" : a === "away" ? game.awayShort : a === "home" ? game.homeShort : a;
  // Every source, same rule: the headline itself has to name one of the
  // two teams, and it cannot be another sport. GDELT searches full text,
  // so a Stanford wrestling schedule that lists Pitt matched "Pitt".
  const names = [game.away, game.home, game.awayShort, game.homeShort, abbrOf("away"), abbrOf("home")]
    .map((n) => String(n || "").replace(/^#\d+\s+/, "").trim().toLowerCase()).filter((n) => n.length >= 3);
  const OTHER_SPORT = /\b(wrestling|basketball|hoops|volleyball|soccer|hockey|baseball|softball|lacrosse|golf|tennis|swimming|diving|track and field|cross country|gymnastics|rowing|field hockey|water polo|esports)\b/i;
  const mentions = (n) => { const h = String(n.headline || "").toLowerCase(); return !OTHER_SPORT.test(h) && names.some((x) => h.includes(x)); };
  const others = [...(siteFeed?.news || []), ...wider, ...gdelt].filter(mentions).sort((a, b) => String(b.published || "").localeCompare(String(a.published || ""))).map((n) => ({ ...n, team: aboutLabel(n.about) }));
  const espn = [
    ...(direct?.related || []).map((n) => ({ ...n, team: "This game" })),
    ...(news?.away || []).map((n) => ({ ...n, team: game.awayShort })),
    ...(news?.home || []).map((n) => ({ ...n, team: game.homeShort })),
  ].filter(mentions);
  const mixed = [];
  const gameFirst = [...others.filter((n) => n.about === "game"), ...espn.filter((n) => n.team === "This game")];
  const restO = others.filter((n) => n.about !== "game"), restE = espn.filter((n) => n.team !== "This game");
  mixed.push(...gameFirst);
  for (let i = 0; i < Math.max(restO.length, restE.length); i++) { if (restO[i]) mixed.push(restO[i]); if (i % 2 === 1 && restE[(i - 1) / 2]) mixed.push(restE[(i - 1) / 2]); }
  // Rank: stories about this game first, then by outlet quality, then by
  // recency. Beat outlets and wire services outrank aggregators.
  const TIER1 = /espn|associated press|\bap\b|yahoo sports|athletic|cbs ?sports|si\.com|sports illustrated|on3|247|rivals|post-gazette|roanoke|tribune|times|gazette|herald|journal|dispatch|courier|news-|dot ?com$|\.com$/i;
  const TIER0 = /espn|associated press|\bap\b|athletic|post-gazette|roanoke|on3|247sports|rivals|cbs ?sports|yahoo sports/i;
  const tier = (n) => { const s = `${n.source || ""}`; return TIER0.test(s) ? 0 : TIER1.test(s) ? 1 : 2; };
  const injuryish = (n) => /injur|questionable|doubtful|ruled out|availability|probable|suspend|depth chart|starting|lineup/i.test(n.headline) ? 0 : 1;
  const rank = (n) => (n.team === "This game" || n.about === "game" ? 0 : 1) * 100 + injuryish(n) * 30 + tier(n) * 10 + (n.published ? Math.min(9, Math.floor((Date.now() - new Date(n.published).getTime()) / 86400000)) : 9);
  const newsRows = mixed.filter((n) => { const k = norm(n.headline); if (!k || seen.has(k)) return false; seen.add(k); return true; }).sort((x, y) => rank(x) - rank(y));
  // Expert picks: a tile per outlet, four across, the picked team's logo
  // and the line as written. Tap a tile for the piece.
  {
    // One tile per outlet. A staff page with four writers is one outlet
    // with a count, not four look-alike tiles. The tile shows the side the
    // outlet leans (and the split when writers disagree), one logo big
    // enough to read, and the line as written. Rows always fill: four
    // across, or fewer columns when there are fewer outlets, with any
    // remainder beyond a full row folded under MORE.
    const all = xpicks?.picks || [];
    const outlets = [];
    for (const p of all) { let o = outlets.find((x) => x.key === p.outlet.toLowerCase()); if (!o) { o = { key: p.outlet.toLowerCase(), outlet: p.outlet, picks: [] }; outlets.push(o); } o.picks.push(p); }
    // Each tile reads the article the way a person would: who wins, by how
    // much, and whether that margin covers our sealed line or is only a
    // straight-up win. The predicted final score sits at the bottom.
    const favSide = game.favorite === game.home ? "home" : "away", dogSide = favSide === "home" ? "away" : "home";
    const sealed = Number(game.spread) || 0;
    const lineOf = (side) => sealed === 0 ? "PK" : side === favSide ? `-${sealed}` : `+${sealed}`;
    // Scores are away-home. A pick to win outright must have its own side
    // winning: an older cached answer could be the wrong way round, and the
    // number order alone is never trusted over the team the expert named.
    const scoreOf = (p) => { const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(p.score || "")); if (!m) return null; let a = Number(m[1]), h = Number(m[2]); if ((p.type === "SU" || p.type === "BOTH") && a !== h && (a > h ? "away" : "home") !== p.side) [a, h] = [h, a]; return { away: a, home: h }; };
    // { win: side, by: margin or null, tag, tone }
    const callOf = (p) => {
      const sc = scoreOf(p);
      const win = sc ? (sc.away > sc.home ? "away" : sc.home > sc.away ? "home" : null) : p.side;
      if (!win) return null;
      const by = sc ? Math.abs(sc.away - sc.home) : null;
      let tag, tone;
      if (win === dogSide) { tag = "UPSET"; tone = "up"; }
      else if (by === null) { tag = p.type === "SU" ? "STRAIGHT UP" : `COVERS ${lineOf(favSide)}`; tone = p.type === "SU" ? "su" : "cov"; }
      else if (by > sealed) { tag = `COVERS ${lineOf(favSide)}`; tone = "cov"; }
      else if (by === sealed) { tag = "PUSH"; tone = "su"; }
      else { tag = "STRAIGHT UP"; tone = "su"; }
      // A dog picked against the spread with no score is a cover, not a win.
      if (!sc && p.side === dogSide && p.type === "ATS") return { win, by, tag: `COVERS ${lineOf(dogSide)}`, tone: "cov", sc, dogCover: true };
      return { win, by, tag, tone, sc };
    };
    const tileOf = (o) => {
      const calls = o.picks.map(callOf);
      // A staff of several writers shows the winner most of them pick.
      const nA = calls.filter((c) => c?.win === "away").length, nH = calls.filter((c) => c?.win === "home").length;
      const win = nA > nH ? "away" : nH > nA ? "home" : (calls.find(Boolean)?.win || o.picks[0].side);
      const lead = win === "away" ? nA : nH;
      const i0 = Math.max(0, calls.findIndex((c) => c?.win === win));
      const call = calls[i0] || { win, by: null, tag: "", tone: "su", sc: null };
      const first = o.picks[i0];
      const id = win === "away" ? game.awayId : game.homeId;
      const names = o.picks.map((p) => p.picker && p.picker === p.picker.toUpperCase() ? p.picker.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : p.picker).filter(Boolean);
      const big = call.by !== null ? `BY ${call.by}` : call.tone === "cov" ? lineOf(win === dogSide && call.tag.includes(lineOf(dogSide)) ? dogSide : win) : "WIN";
      const sc = call.sc;
      const scoreLab = sc ? `${abbrOf(win)} ${Math.max(sc.away, sc.home)}-${Math.min(sc.away, sc.home)}` : "";
      // One short word for the call, on the same line as the score.
      // With a score shown, a cover is just a check mark so four tiles fit.
      const short = call.tone === "cov" ? (scoreLab ? "✓" : "COVERS") : call.tone === "up" ? (scoreLab ? "" : "UPSET") : call.tag === "PUSH" ? "PUSH" : "SU";
      const who = o.picks.length > 1 ? (lead === o.picks.length ? `ALL ${o.picks.length}` : `${lead} OF ${o.picks.length}`) : (outlets.length <= 3 ? names[0] || "" : "");
      const split = o.picks.length > 1 && lead < o.picks.length ? `<span class="xp-bar"><i style="width:${Math.round(100 * lead / o.picks.length)}%"></i></span>` : "";
      const title = [names.length ? names.join(", ") : "", first.reason || ""].filter(Boolean).join(" — ");
      const meta = [short === "✓" ? `${scoreLab} ✓` : [scoreLab, short].filter(Boolean).join(" · "), who].filter(Boolean).join(" · ") || " ";
      const inner = `<span class="xp-out">${esc(o.outlet.replace(/\s+on MSN$/i, ""))}</span><span class="xp-main">${lg(id, "xp-logo")}<b>${esc(big)}</b></span><span class="xp-meta">${esc(meta)}</span>${split}`;
      const href = first.link || o.picks.find((p) => p.link)?.link;
      return href ? `<a class="xp-tile ${win}" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(title)}">${inner}</a>` : `<span class="xp-tile ${win}" title="${esc(title)}">${inner}</span>`;
    };
    const n = outlets.length;
    const cols = n <= 1 ? 1 : n <= 4 ? n : 4;
    const shown = n <= 4 ? n : 4 * Math.floor(n / 4);
    const list = outlets.slice(0, shown), rest = outlets.slice(shown, shown + 16);
    if (all.length) {
      // The headline: which team the experts back (to win, or to cover as
      // the dog), then how: outright wins for a dog, covers for a favourite.
      const every = all.map(callOf).filter(Boolean);
      const T = (sd) => esc(String(abbrOf(sd)).toUpperCase());
      const backs = (sd) => every.filter((c) => c.win === sd).length;
      const bA = backs("away"), bH = backs("home"), tot = every.length;
      const lw = bA >= bH ? "away" : "home", ln = Math.max(bA, bH);
      const wins = every.filter((c) => c.win === lw && !c.dogCover).length;
      const cov = every.filter((c) => c.win === lw && c.tone === "cov" && !c.dogCover).length;
      const how = lw === dogSide ? (wins ? ` · ${wins === ln ? (ln === 1 ? "OUTRIGHT WIN" : "ALL SAY OUTRIGHT WIN") : `${wins} SAY OUTRIGHT WIN`}` : ` · COVER ${lineOf(dogSide)}`)
        : cov === ln ? ` · ${ln === 1 ? "COVERS" : "ALL COVER"} ${lineOf(favSide)}` : cov ? ` · ${cov} COVER ${lineOf(favSide)}` : ` · NONE COVER ${lineOf(favSide)}`;
      const sum = !tot ? "NO CALL" : bA === bH ? `SPLIT: ${bA} ${T("away")}, ${bH} ${T("home")}`
        : `${ln === tot ? (tot === 1 ? "1 PICK:" : `ALL ${tot} BACK`) : `${ln} OF ${tot} BACK`} ${T(lw)}${how}`;
      html += `<div class="ins-h">EXPERT PICKS</div><div class="xp-sum">${sum}</div><div class="xp-grid" style="grid-template-columns:repeat(${cols},minmax(0,${cols >= 4 ? "1fr" : "112px"}))">${list.map(tileOf).join("")}</div>`;
      if (rest.length) html += `<details class="ins-more-news xp-more"><summary><span>▶</span> MORE OUTLETS (${rest.length})</summary><div class="xp-grid" style="grid-template-columns:repeat(${Math.min(rest.length, 4)},minmax(0,${rest.length >= 4 ? "1fr" : "112px"}))">${rest.map(tileOf).join("")}</div></details>`;
    } else if (pend.picks) html += `<div class="ins-h">EXPERT PICKS</div><div class="ins-loading">Checking the pickers…</div>`;
    else html += `<div class="ins-h">EXPERT PICKS</div><div class="ins-empty small">No published picks yet. The outlets usually call games Thursday and Friday.</div>`;
  }
  if (!newsRows.length && (pend.news || pend.wider || pend.gdelt || pend.site)) html += `<div class="ins-h">NEWS</div><div class="ins-loading">Loading news…</div>`;
  const newsErr = !pend.wider && !pend.gdelt && !pend.site && !wider.length && !gdelt.length && !(siteFeed?.news || []).length && (wider.errors || []).length ? `<div class="ins-empty small"><i class="ins-err">More sources unavailable: ${esc(wider.errors.slice(0, 2).join(" · "))}</i></div>` : "";
  const newsLi = (n) => `<li><b class="ins-nh">${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.headline)}</a>` : esc(n.headline)}</b>${n.blurb ? `<span class="ins-blurb">${esc(n.blurb)}</span>` : ""}<span class="ins-det"><em class="ins-src">${esc(n.source || "")}</em>${n.team && n.team !== "This game" ? esc(n.team) : ""}${n.published ? `${n.team && n.team !== "This game" ? " · " : ""}${esc(fmtWhen(n.published))}` : ""}</span></li>`;
  // Three at the top; the rest fold under MORE NEWS.
  if (newsRows.length) html += `<div class="ins-h">NEWS</div><ul class="ins-news">${newsRows.slice(0, 3).map(newsLi).join("")}</ul>${newsRows.length > 3 ? `<details class="ins-more-news"><summary><span>▶</span> MORE NEWS (${Math.min(newsRows.length - 3, 12)})</summary><ul class="ins-news">${newsRows.slice(3, 15).map(newsLi).join("")}</ul></details>` : ""}`;
  if (newsErr) html += newsRows.length ? newsErr : `<div class="ins-h">NEWS</div>${newsErr}`;

  // 1. Injuries, one column per team.
  const statusCls = (st) => `st-${String(st || "").toLowerCase().replace(/[^a-z]/g, "")}`;
  const col = (label, list, ok, teamId, err) => `<div class="ins-col"><div class="ins-team">${lg(teamId)}${esc(label)}</div>` + (list?.length
    ? `<ul class="ins-inj">${list.slice(0, 7).map((i) => {
        // The grey line earns its place only with a fact: "injury" alone or
        // the status in other words ("still uncertain to play") is noise.
        const weak = /^(injur(y|ed|ies)|unspecified|undisclosed( injury)?|not specified)\.?$|^(still |remains )?(uncertain|unsure|unlikely|likely|listed|questionable|doubtful|probable|out)( to (play|suit up))?\.?$|injury from (last|previous) (game|week)|not (yet )?specified|^injury status( for (this|the) week'?s game)?\.?$|^status for (this|the) week'?s game\.?$/i;
        const det = i.detail && !weak.test(i.detail.replace(/\s*·\s*via .*$/i, "").trim()) ? i.detail : i.detail && /via /i.test(i.detail) ? i.detail.replace(/^.*?·\s*(via .*)$/i, "$1") : "";
        const row = `<b class="${statusCls(i.status)}">${esc(i.status)}</b><span class="ins-who">${esc(i.name)}${i.pos ? ` <i>${esc(i.pos)}</i>` : ""}</span>${det ? `<span class="ins-det">${esc(det)}</span>` : ""}`;
        // A beat-writer row with a verified sentence unfolds on tap to show it.
        if (!i.quote && !i.note) return `<li>${row}</li>`;
        // The article's date sits beside the outlet, so a report from an
        // earlier week reads as what it is.
        const when = i.published && !isNaN(Date.parse(i.published)) ? ` · ${new Date(i.published).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}` : "";
        const src = i.link ? `<a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.source || "Read more")} ↗</a>${esc(when)}` : i.source ? `<span>${esc(i.source)}${esc(when)}</span>` : "";
        // The note is what the report says in plain words; the verbatim
        // sentence sits under it as the evidence, with the article link.
        const body = (i.note ? `<div class="ins-note">${esc(i.note)}</div>` : "") + (i.quote ? `<div class="ins-quote-txt">“${esc(i.quote)}”</div>` : "");
        return `<li class="ins-q"><details><summary>${row}</summary><div class="ins-quote">${body}${src ? `<div class="ins-q-src">${src}</div>` : ""}</div></details></li>`;
      }).join("")}</ul>`
    : `<div class="ins-empty small">${ok === false ? `Feed unavailable.${err ? ` <i class="ins-err">${esc(err)}</i>` : ""}` : "Nothing reported. Most schools don't file injury reports."}</div>`) + `</div>`;
  let injHtml = `<div class="ins-h">INJURIES</div>`;
  injHtml += injuries ? `<div class="ins-cols">${col(game.awayShort, injuries.away, direct ? true : snap?.feeds?.awayInjuries, game.awayId, feedErr("awayInjuriesError"))}${col(game.homeShort, injuries.home, direct ? true : snap?.feeds?.homeInjuries, game.homeId, feedErr("homeInjuriesError"))}</div>` : `<div class="ins-empty">Could not reach the injury feeds${eventId ? "" : " (game not on ESPN's scoreboard yet)"}. Team reports are in the links below.</div>`;

  // Nobody listed on either side: leave the section out entirely, unless
  // the news read is still on its way.
  const anyInj = injuries && ((injuries.away || []).length || (injuries.home || []).length);
  if (anyInj) {
    const srcs = [...(newsInj?.sources?.away || []), ...(newsInj?.sources?.home || [])].slice(0, 3);
    if (newsInj?.at) injHtml += `<div class="ins-det ins-injsrc">From the beat: ${srcs.map((n) => n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.source || "report")}</a>` : esc(n.source || "")).join(" · ")}${srcs.length ? " · " : ""}read ${esc(fmtWhen(new Date(newsInj.at).toISOString()))}</div>`;
    html += injHtml;
  } else if (pend.inj) html += `<div class="ins-h">INJURIES</div><div class="ins-loading">Reading the injury reports…</div>`;

  // 4. Links out.
  html += links();
  html += `<div class="ins-foot">Information only. Scoring uses the sealed line on your card.</div>`;
  body.innerHTML = html;
  // The room, then simulate, then the line. After that, what
  // changes a pick: line and experts, then the background, with injuries
  // after last five and just before news. Each section is its heading plus
  // everything up to the next heading.
  (() => {
    const ORDER = ["LINE", "EXPERT PICKS", "PREVIEW", "LAST FIVE", "INSIGHTS", "INJURIES", "NEWS", "MORE"];
    const head = [], secs = {}, tail = [];
    let cur = null;
    for (const el of [...body.children]) {
      if (el.classList.contains("ins-h")) { cur = el.textContent.trim(); (secs[cur] ||= []).push(el); continue; }
      if (el.classList.contains("ins-foot")) { tail.push(el); continue; }
      if (cur === null) head.push(el); else secs[cur].push(el);
    }
    const sim = head.find((el) => el.id === "ins-sim");
    // Simulate rides in the header, opposite the close button.
    if (sim) modal.querySelector(".h2h-top")?.prepend(sim);
    const out = head.filter((el) => el !== sim);
    for (const k of [...ORDER.filter((k) => secs[k]), ...Object.keys(secs).filter((k) => !ORDER.includes(k))]) out.push(...secs[k]);
    body.replaceChildren(...out, ...tail);
  })();
  // Simulation context: names, logos, and the line it draws the score around.
  const comps = summaryRaw?.header?.competitions?.[0]?.competitors || [];
  const teamInfo = (id, shortName, side) => {
    const c = comps.find((x) => Number(x.team?.id) === Number(id));
    return { id, short: shortName, abbr: c?.team?.abbreviation || shortName.slice(0, 4).toUpperCase(), color: c?.team?.color ? `#${c.team.color}` : null, logo: logoUrl(id), leaders: glance?.leaders?.[side] || [] };
  };
  const favNowShort = mv ? mv.nowFavorite : favShort;
  const simCtx = {
    away: teamInfo(game.awayId, game.awayShort, "away"),
    home: teamInfo(game.homeId, game.homeShort, "home"),
    favSide: favNowShort === game.homeShort ? "home" : "away",
    spread: mv ? mv.now : Number(game.spread) || 3,
    total: mv?.overUnder ?? direct?.odds?.overUnder ?? 52,
  };
  modal.querySelector("#ins-sim")?.addEventListener("click", () => window.openSim?.(simCtx));
  // No pick yet: one tap closes the sheet and goes to the picks screen.
  body.querySelector("#ins-mypick-go")?.addEventListener("click", () => { modal.querySelector("#insights-close")?.click(); navPicksBtn?.click(); });
  };
  // While the game is on, pull the scoreboard and the game page again
  // every thirty seconds and repaint, so the sheet keeps up with the
  // scorebug behind it. Stops the moment the sheet closes or the game ends.
  const liveTick = async () => {
    if (!alive()) { clearInterval(liveTimer); return; }
    const l = insLive(gameId);
    if (!(l && l.found && l.state === "in" && !l.completed)) return;
    try { await (sideGuestGame(gameId) ? fetchSideLive(true) : fetchLiveScores()); } catch {}
    const id = insLive(gameId)?.eventId || null;
    if (id) { try { const raw = await fetchEspnSummary(id, true); if (raw) summaryRaw = raw; } catch {} }
    if (alive()) paint();
  };
  // Every 8 seconds while the sheet is on screen; nothing while the phone
  // is locked or the app is in the background, and an immediate catch-up
  // the moment it comes back.
  const liveTimer = setInterval(() => { if (!document.hidden) liveTick(); }, 8000);
  const onVis = () => { if (!alive()) { document.removeEventListener("visibilitychange", onVis); return; } if (!document.hidden) liveTick(); };
  document.addEventListener("visibilitychange", onVis);
  fetchAllPicks().then((p) => { if (p) { lastGoodCloudPicks = p; if (alive()) paint(); } }).catch(() => {});
  // Cached summary paints at once; otherwise the first paint waits for it.
  land(withTimeout(fetchInsights(), 3500, null), (v) => { data = v; });
  land(withTimeout(fetchGameSnapshot(gameId), 3500, null), (v) => { snap = v; });
  land(withTimeout(fetchWiderNews(gameId), 6000, []), (v) => { wider = v || []; }, "wider");
  // No short cap here: the first read of a game runs two searches and two
  // model calls, and a late answer still paints into the open sheet.
  const gdeltP = withTimeout(fetchGdeltNews(game), 6000, []);
  land(gdeltP, (v) => { gdelt = v || []; }, "gdelt");
  const siteP = withTimeout(fetchSiteFeeds(), 6000, null).then((f) => f?.games?.[gameId] || null);
  land(siteP, (v) => { siteFeed = v; }, "site");
  // Injuries wait for everything the phone can reach, so the Worker has
  // articles to read: ESPN team news, GDELT, and the site's pulled feeds.
  const injItems = Promise.all([withTimeout(Promise.all([fetchTeamNews(game.awayId), fetchTeamNews(game.homeId)]), 6000, [[], []]), gdeltP, siteP]).then(([[a, h], g, sf]) => ({
    away: [...(sf?.injuries?.away || []), ...a, ...g.filter((n) => n.about === "away" || n.about === "game")],
    home: [...(sf?.injuries?.home || []), ...h, ...g.filter((n) => n.about === "home" || n.about === "game")],
  }));
  // Ask for the Worker's cached read first: a warm cache answers in a
  // few hundred milliseconds and paints at once. Only when that comes
  // back empty does the slow path run, with the articles the phone found.
  land(withTimeout(fetchExpertPicks(gameId), 30000, null), (v) => { xpicks = v; }, "picks");
  const quickInj = withTimeout(fetchNewsInjuries(gameId, null), 4000, null);
  land(quickInj, (v) => { if (v && (v.away?.length || v.home?.length)) newsInj = v; });
  land(withTimeout(quickInj.then((q) => (q && (q.away?.length || q.home?.length) && !q.stale) ? q : injItems.then((items) => fetchNewsInjuries(gameId, items))), 40000, null), (v) => { if (v && (v.away?.length || v.home?.length || !newsInj)) newsInj = v; }, "inj");
  land(Promise.all([fetchTeamNews(game.awayId), fetchTeamNews(game.homeId)]), ([a, h]) => { awayNews = a; homeNews = h; }, "news");
  const eventIdNow = insLive(gameId)?.eventId || insightsCache.eventIds?.[gameId] || sideGuestGame(gameId)?.eventId || null;
  const summaryP = (eventIdNow ? Promise.resolve(eventIdNow) : fetchLiveScores().catch(() => {}).then(() => insLive(gameId)?.eventId || null))
    .then((id) => fetchEspnSummary(id, !!(insLive(gameId)?.found && (insLive(gameId).completed || insLive(gameId).state === "in"))));
  land(summaryP, (v) => { summaryRaw = v; }, "summary");
  land(withTimeout(summaryP.then((raw) => fetchAiPreview(game, parseSummaryClient(raw, game))), 15000, null), (v) => { aiPv = v; }, "ai");
}
// Swipe down to close a sheet: only from the top of the sheet, so
// scrolling the content still works; the card follows the finger and
// snaps back if the pull is short.
function swipeToClose(modal, card, close) {
  let y0 = null, dy = 0, t0 = 0;
  modal.dataset.swipe = "own";
  modal.addEventListener("touchstart", (e) => {
    if (modal.scrollTop > 2 || e.touches.length !== 1 || e.target.closest("select")) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
    if (card) card.style.transition = "none";
  }, { passive: true });
  modal.addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { if (card) card.style.transform = ""; return; }
    if (card) { card.style.transform = `translateY(${dy * 0.85}px)`; card.style.opacity = String(Math.max(0.4, 1 - dy / 500)); }
  }, { passive: true });
  modal.addEventListener("touchend", () => {
    if (y0 === null) return;
    if (card) card.style.transition = "transform .2s ease, opacity .2s ease";
    if (dy > 110 || (dy > 50 && Date.now() - t0 < 250)) close();
    if (card) { card.style.transform = ""; card.style.opacity = ""; }
    y0 = null; dy = 0;
  });
}
// Every other window that has a way out swipes down to close too: the
// arcade popups, the grid check, the rules and the Game Box. A swipe does
// exactly what that window's own close does (its ✕, or a tap outside), so
// any cleanup still runs. Windows that must be answered (sign in, the
// question of the week, admin keys) have no way out and are left alone.
// Only from the top: if anything under the finger is scrolled down, the
// pull scrolls it back up instead; a sideways drag never closes.
(() => {
  const SEL = ".wpx-overlay:not(#qotw-modal), #grid-modal, #rules-modal, #sim-modal, #gridcard-modal, #player-modal, #sh2h-modal";
  const CLOSE = '.wpx-x, [data-act="close"], #rules-close-btn, [aria-label="Close"]';
  let st = null;
  const reset = (card) => { if (card) { card.style.transform = ""; card.style.opacity = ""; } };
  document.addEventListener("touchstart", (e) => {
    st = null;
    if (e.touches.length !== 1) return;
    const ov = e.target.closest?.(SEL);
    if (!ov || ov.dataset.swipe === "own" || ov.classList.contains("hidden")) return;
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    for (let el = e.target; el && el !== document.body; el = el.parentElement) { if (el.scrollTop > 2) return; if (el === ov) break; }
    const card = [...ov.children].find((c) => !c.matches(CLOSE)) || null;
    st = { ov, card, x0: e.touches[0].clientX, y0: e.touches[0].clientY, t0: Date.now(), dy: 0, dir: null };
    if (card) card.style.transition = "none";
  }, { passive: true, capture: true });
  document.addEventListener("touchmove", (e) => {
    if (!st) return;
    const dx = e.touches[0].clientX - st.x0, dy = e.touches[0].clientY - st.y0;
    if (!st.dir && Math.hypot(dx, dy) > 8) st.dir = Math.abs(dy) > Math.abs(dx) && dy > 0 ? "down" : "other";
    if (st.dir !== "down") { reset(st.card); if (st.dir === "other") st = null; return; }
    st.dy = Math.max(0, dy);
    if (st.card) { st.card.style.transform = `translateY(${st.dy * 0.85}px)`; st.card.style.opacity = String(Math.max(0.4, 1 - st.dy / 500)); }
  }, { passive: true, capture: true });
  const end = () => {
    if (!st) return;
    const { ov, card, dy, t0 } = st; st = null;
    if (card) card.style.transition = "transform .2s ease, opacity .2s ease";
    if (dy > 110 || (dy > 50 && Date.now() - t0 < 250)) {
      const btn = ov.querySelector(CLOSE);
      if (btn) btn.click(); else ov.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    reset(card);
  };
  document.addEventListener("touchend", end, { capture: true });
  document.addEventListener("touchcancel", end, { capture: true });
})();
(() => {
  const m = document.getElementById("h2h-modal");
  if (m) swipeToClose(m, m.querySelector(".h2h-card"), () => m.classList.add("hidden"));
})();
(() => {
  const modal = document.getElementById("insights-modal");
  if (!modal) return;
  const close = () => modal.classList.add("hidden");
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  modal.querySelector("#insights-close")?.addEventListener("click", close);
  swipeToClose(modal, modal.querySelector(".insights-card"), close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.classList.contains("hidden")) close(); });
})();

// --- Head to head -------------------------------------------------------
// Two cards side by side for the week: where each stands, then every
// game with both picks, settled ones graded, live ones as they stand,
// and the ones still to come with what is riding on them. Games where
// both took the same side are a wash and are shown dimmed.
let h2h = { a: null, b: null };
function openH2H() {
  const rows = liveWeekRows || [];
  if (!h2h.a) h2h.a = currentManager && rows.some((r) => r.name === currentManager) ? currentManager : rows[0]?.name || MANAGERS[0];
  if (!h2h.b || h2h.b === h2h.a) h2h.b = rows.find((r) => r.name !== h2h.a)?.name || MANAGERS.find((n) => n !== h2h.a);
  noteUse("h2h", `${h2h.a} vs ${h2h.b}`);
  renderH2H();
  // Lifted out of the app's scroll layer so it sits above the tab bar.
  const m = document.getElementById("h2h-modal");
  if (m && m.parentElement !== document.body) document.body.appendChild(m);
  m?.classList.remove("hidden");
}
function renderH2H() {
  const modal = document.getElementById("h2h-modal");
  if (!modal) return;
  const picks = lastGoodCloudPicks || {};
  const live = latestLive || {};
  const results = computeLiveResults(live);
  const rows = liveWeekRows || rankManagers(picks, results);
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // Name pickers: native selects, ranked order, with each side's score.
  modal.querySelectorAll(".h2h-select").forEach((el) => {
    const side = el.dataset.side;
    el.innerHTML = rows.map((r) => `<option value="${esc(r.name)}"${h2h[side] === r.name ? " selected" : ""}>${esc(shown(r.name).toUpperCase())}</option>`).join("");
  });
  const A = rows.find((r) => r.name === h2h.a), B = rows.find((r) => r.name === h2h.b);
  const body = document.getElementById("h2h-body");
  if (!A || !B) { body.innerHTML = ""; return; }
  // Nobody sees another manager's pick before that game locks. The mask
  // runs before any math so max, swing and the verdict cannot leak either.
  const hiddenFor = (name, g) => !isGameLocked(g) && name !== currentManager;
  const maskState = (name, st) => ({ ...st, picks: Object.fromEntries(Object.entries(st.picks || {}).filter(([gid]) => { const g = GAMES.find((x) => String(x.id) === String(gid)); return g && !hiddenFor(name, g); })) });
  const sideOf = (row) => {
    const st = maskState(row.name, row.state || picks[row.name] || { picks: {} });
    let w = 0, l = 0, max = row.score, left = 0;
    for (const g of GAMES) {
      const pick = st.picks[g.id];
      if (results[g.id]) { if (pick) { const o = resultOutcome(g, results[g.id]); if (!(pick.mode === "ATS" && o?.push)) { if (scorePick(g, pick, results[g.id]) > 0) w += 1; else l += 1; } } }
      else if (pick) { max += pointValue(g, pick.team, pick.mode); left += 1; }
    }
    return { st, w, l, max, left, fly: inFlightPoints(st.picks, live) };
  };
  const a = sideOf(A), b = sideOf(B);
  const short = (g, team) => team === g.home ? g.homeShort : team === g.away ? g.awayShort : team;
  const abbr = (g, side) => live[g.id]?.[`${side}Abbr`] || (side === "home" ? g.homeShort : g.awayShort);
  // What each pick is doing right now: points banked, in flight, or at stake.
  const stateOf = (g, pick) => {
    if (!pick) return { cls: "none", txt: "–" };
    const res = results[g.id];
    const lv = live[g.id];
    if (res) { const p = scorePick(g, pick, res); return p > 0 ? { cls: "hit", txt: `+${p}` } : { cls: "miss", txt: "0" }; }
    if (lv && lv.found && lv.state === "in" && Number.isFinite(lv.awayScore) && Number.isFinite(lv.homeScore)) {
      const p = scorePick(g, pick, { awayScore: lv.awayScore, homeScore: lv.homeScore });
      return p > 0 ? { cls: "live-hit", txt: `+${p}` } : { cls: "live-miss", txt: "0" };
    }
    return { cls: "open", txt: `${pointValue(g, pick.team, pick.mode)}` };
  };
  // Status comes from the feed's own state, never from a score: a game is
  // live only while ESPN says "in", final only once it is in the results.
  const statusOf = (g) => {
    if (results[g.id]) return "final";
    const lv = live[g.id];
    if (lv?.state === "in") return "live";
    if (lv?.state === "post") return "void"; // over without a final: postponed, canceled or suspended
    return "upcoming";
  };
  // Every way a game can still end that changes any pick: the league's own
  // outcome classes (gameCats), a tie, and no result at all (both score 0).
  // Each is scored with scorePick, so SU, ATS, pushes and point values are
  // exactly the app's.
  const swingRange = (g) => {
    const pa = a.st.picks[g.id], pb = b.st.picks[g.id];
    const ends = [...gameCats(g).map((c) => c.res), { awayScore: 30, homeScore: 30 }];
    const d = ends.map((r) => (pa ? scorePick(g, pa, r) : 0) - (pb ? scorePick(g, pb, r) : 0));
    d.push(0);
    return { gainA: Math.max(...d), gainB: Math.max(...d.map((x) => -x)), none: d.every((x) => x === 0) };
  };
  const hidden = (g) => hiddenFor(A.name, g) || hiddenFor(B.name, g);
  const rowsOf = gamesByKickoff().filter((g) => a.st.picks[g.id] || b.st.picks[g.id] || hidden(g));
  // No swing: settled with the identical pick, or still open and proven to
  // pay both the same however it ends. Anything else stays in the list.
  const noSwing = (g) => {
    if (hidden(g)) return false;
    const pa = a.st.picks[g.id], pb = b.st.picks[g.id];
    if (results[g.id]) return !!pa && !!pb && pa.team === pb.team && pa.mode === pb.mode;
    return swingRange(g).none;
  };
  const sameGames = rowsOf.filter(noSwing);
  const splitGames = rowsOf.filter((g) => !noSwing(g));
  // Path to victory, from locked points only: live points are provisional
  // and the live game is counted once, as a game that can still end any way.
  let gainA = 0, gainB = 0, unknown = 0;
  for (const g of splitGames) {
    if (results[g.id]) continue;
    if (hidden(g)) { unknown++; continue; }
    const r = swingRange(g); gainA += r.gainA; gainB += r.gainB;
  }
  const openLeft = rowsOf.filter((g) => !results[g.id]).length;
  const allDone = a.left + b.left === 0 && GAMES.every((g) => results[g.id]);
  const gap = A.score - B.score;
  const leader = gap > 0 ? A : gap < 0 ? B : null, trailer = gap > 0 ? B : gap < 0 ? A : null;
  const N = (r) => esc(shown(r.name).toUpperCase());
  const anyLive = rowsOf.some((g) => statusOf(g) === "live");
  const kicker = allDone ? "FINAL" : anyLive ? "LIVE" : "THIS WEEK";
  const headline = allDone ? (leader ? `${N(leader)} WINS BY ${Math.abs(gap)}` : "LEVEL ON POINTS") : leader ? `${N(leader)} LEADS BY ${Math.abs(gap)}` : "ALL SQUARE";
  const facts = [];
  let path = "";
  if (allDone) {
    if (!leader) path = "Level on points: the week's tiebreaker decides it.";
  } else {
    facts.push(`<span><small>LEAD</small><b>${Math.abs(gap)}</b></span>`);
    facts.push(`<span><small>${N(A)} GAIN</small><b>${unknown ? "≥" : ""}${gainA}</b></span>`);
    facts.push(`<span><small>${N(B)} GAIN</small><b>${unknown ? "≥" : ""}${gainB}</b></span>`);
    if (unknown) path = `${leader ? `${N(leader)} +${Math.abs(gap)} · ` : ""}${unknown} PICK${unknown === 1 ? "" : "S"} HIDDEN TILL KICKOFF`;
    else if (!openLeft || (gainA === 0 && gainB === 0)) path = leader ? `${N(leader)} CLINCHED` : "LOCKED LEVEL · TIEBREAKER";
    else if (!leader) path = `LEVEL · ${N(A)} UP TO +${gainA}, ${N(B)} UP TO +${gainB}`;
    else {
      const need = Math.abs(gap), best = trailer === A ? gainA : gainB;
      path = best < need ? `${N(leader)} CLINCHED · ${N(trailer)} CAN GAIN ${best}, NEEDS ${need}`
        : best === need ? `${N(trailer)} CAN ONLY TIE (+${need}) · TIEBREAKER`
        : `${N(trailer)} NEEDS +${need + 1} (+${need} TIES) · UP TO +${best} LEFT`;
    }
  }
  const provA = A.score + (a.fly || 0), provB = B.score + (b.fly || 0);
  const nowLine = anyLive && !allDone && (a.fly || b.fly) ? `<div class="h2x-now">If it ended now: ${provA === provB ? "level" : `${N(provA > provB ? A : B)} by ${Math.abs(provA - provB)}`} <small>(${provA}–${provB} with live points)</small></div>` : "";
  // A row: left pick, the game in the middle, right pick. The points badge
  // says what it is in words as well as colour: earned, none, live, at stake.
  const BADGE = { hit: "EARNED", miss: "NO PTS", "live-hit": "LIVE", "live-miss": "LIVE", open: "AT STAKE", none: "" };
  const centre = (g) => {
    const st = statusOf(g), r = results[g.id], lv = live[g.id];
    const sc = r ? `${r.awayScore}–${r.homeScore}` : st === "live" ? `${lv.awayScore ?? 0}–${lv.homeScore ?? 0}` : "@";
    const k = new Date(g.kickoff);
    const when = st === "final" ? (/OT/i.test(String(lv?.detail || "")) ? "FINAL/OT" : "FINAL") : st === "live" ? esc(String(lv.detail || "LIVE").replace(/\s*-\s*/, " ").toUpperCase()) : st === "void" ? "NO RESULT" : `${k.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" }).toUpperCase()} ${k.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).replace(":00", "")}`;
    return `<div class="h2x-mid"><span class="h2x-teams">${esc(abbr(g, "away"))} <b>${sc}</b> ${esc(abbr(g, "home"))}</span><small class="h2x-when ${st}">${st === "live" ? "<u></u>" : ""}${when}</small></div>`;
  };
  const pickCell = (g, name, pick, side) => {
    if (hiddenFor(name, g)) return `<div class="h2x-pick ${side} locked"><span class="h2x-tm">🔒 Hidden</span><small>until kickoff</small></div>`;
    if (!pick) return `<div class="h2x-pick ${side} none"><span class="h2x-tm">No pick</span><small><b class="h2x-pts none">0</b></small></div>`;
    const st = stateOf(g, pick);
    const id = pick.team === g.home ? g.homeId : g.awayId;
    const line = pick.mode === "SU" ? "SU · WIN" : `ATS ${pick.team === g.favorite ? "−" : "+"}${g.spread}`;
    return `<div class="h2x-pick ${side} ${st.cls}"><span class="h2x-tm">${id ? `<img class="h2h-logo" src="${logoUrl(id)}" alt="" loading="lazy">` : ""}${(() => { const nm = short(g, pick.team), ab = abbr(g, pick.team === g.home ? "home" : "away"); return ab && ab !== nm && nm.length > 9 ? `<span class="nm-full">${esc(nm)}</span><span class="nm-ab">${esc(ab)}</span>` : `<span>${esc(nm)}</span>`; })()}</span><small>${line}<b class="h2x-pts ${st.cls}" title="${BADGE[st.cls]}">${st.txt}</b></small></div>`;
  };
  const row = (g) => `<div class="h2x-row ${statusOf(g)}${noSwing(g) ? "" : " swing"}">${pickCell(g, A.name, a.st.picks[g.id], "l")}${centre(g)}${pickCell(g, B.name, b.st.picks[g.id], "r")}</div>`;
  const GROUPS = [["live", "LIVE"], ["upcoming", "UPCOMING"], ["void", "NO RESULT"], ["final", "FINAL"]];
  const groupsHtml = GROUPS.map(([k, label]) => {
    const list = splitGames.filter((g) => statusOf(g) === k);
    return list.length ? `<section class="h2x-grp ${k}"><div class="h2x-gh"><span>${label}</span><b>${list.length}</b></div>${list.map(row).join("")}</section>` : "";
  }).join("");
  const legend = `<div class="h2x-legend"><span><b class="h2x-pts hit">+2</b>earned</span><span><b class="h2x-pts miss">0</b>no points</span><span><b class="h2x-pts live-hit">+2</b>live</span><span><b class="h2x-pts open">2</b>at stake</span></div>`;
  // Same picks move nothing, so they are only a footnote.
  const shared = sameGames.length ? `<p class="h2x-foot">Same pick, no swing: ${sameGames.map((g) => { const pk = a.st.picks[g.id]; return esc(abbr(g, pk.team === g.home ? "home" : "away")); }).join(", ")}</p>` : "";
  // Fighter cards up top: name, score, record, and a crown on the winner.
  // The native select sits invisibly over each card, so a tap still
  // changes the player.
  const fill = (side, row, x) => {
    const card = modal.querySelector(`.h2h-fighter.${side}`);
    if (!card) return;
    const av = card.querySelector(".h2h-f-av");
    av.textContent = avatarOverrides[row.name] || shown(row.name)[0];
    av.style.setProperty("--accent", accentFor(row.name));
    card.querySelector(".h2h-f-name").textContent = shown(row.name).toUpperCase();
    const top = leader && leader.name === row.name;
    card.querySelector(".h2h-f-meta").innerHTML = x.fly ? `<em title="Provisional, from games in progress">+${x.fly} LIVE</em>` : "";
    card.querySelector(".h2h-f-score").title = "Points locked in";
    card.querySelector(".h2h-f-score").textContent = String(row.score);
    card.classList.toggle("ahead", !!top);
    card.classList.toggle("crowned", !!top && allDone);
  };
  fill("a", A, a); fill("b", B, b);
  // One line under the cards: the scores are already up there, so this
  // only says where the matchup stands.
  const verdict = allDone ? (leader ? `${N(leader)} WINS` : "LEVEL · TIEBREAKER") : !leader ? "ALL SQUARE" : path;
  body.innerHTML = `${splitGames.length ? groupsHtml : `<div class="h2c-none">Same picks on every game so far.</div>`}
    ${shared}`;
}
// Split games past the first three, and the shared picks, open on a tap
// and stay that way while the sheet is up.
let h2hShowAll = false, h2hSharedOpen = false;
document.getElementById("h2h-body")?.addEventListener("click", (e) => {
  if (e.target.closest("[data-h2h-all]")) { h2hShowAll = !h2hShowAll; renderH2H(); }
});
document.getElementById("h2h-body")?.addEventListener("toggle", (e) => { if (e.target.matches?.(".h2c-shared, .h2x-same")) h2hSharedOpen = e.target.open; }, true);
document.getElementById("h2h-open")?.addEventListener("click", openH2H);
document.getElementById("h2h-close")?.addEventListener("click", () => document.getElementById("h2h-modal").classList.add("hidden"));
document.getElementById("h2h-modal")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});
document.querySelectorAll(".h2h-select").forEach((el) => el.addEventListener("change", () => {
  const side = el.dataset.side, other = side === "a" ? "b" : "a";
  if (h2h[other] === el.value) h2h[other] = h2h[side]; // picking the other card swaps them
  h2h[side] = el.value;
  noteUse("h2h", `${h2h.a} vs ${h2h.b}`);
  renderH2H();
}));

// Graphics published from the Creative Studio (brochiefs.com/live): which
// image to show where, by placement and subject. Kept on the phone so the
// replay opens with it, refreshed on load, and redrawn when it changes.
const CREATIVE_KEY = "brochiefs_creative_v1";
var creativeArt = { at: 0, art: {} }; // var: the board can draw before this line runs
try { creativeArt = JSON.parse(localStorage.getItem(CREATIVE_KEY) || "null") || creativeArt; } catch { /* private mode */ }
async function loadCreativeArt(force) {
  if (!WORKER_URL || window.LEAGUE?.sport === "nfl") return;
  try {
    const res = await fetch(`${WORKER_URL}/art/manifest?t=${force ? Date.now() : Math.floor(Date.now() / 60000)}`);
    if (!res.ok) return;
    const m = await res.json();
    if (!m || typeof m.art !== "object" || m.at === creativeArt.at) return;
    creativeArt = m;
    try { localStorage.setItem(CREATIVE_KEY, JSON.stringify(m)); } catch {}
    renderRecap();
    applySlots(document.body);
  } catch { /* the usual logos stay */ }
}
setTimeout(loadCreativeArt, 1500);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadCreativeArt(); });

// An award's picture. The Studio's art for it is swapped in by applySlots,
// the same way as any other graphic on the page.
function awardArt(path) {
  return `assets/images/${path}.webp`;
}

// The Studio Canvas. Any graphic or line of copy can be replaced from the
// Studio: a published one is swapped in here as the page draws, so no
// screen needs to know about it. Graphics are known by their own path (or
// team:id for a team logo) and copy by its original words; scores, records
// and names are never copy (they have digits or are an owner's name), so
// they always come from the app.
const STUDIO = new URLSearchParams(location.search).has("studio") && window.parent !== window;
const slotPreview = {}; // the Studio's drafts, shown only inside the Canvas
function slotOfImg(img) {
  if (img.dataset.slot) return img.dataset.slot;
  const src = img.getAttribute("src") || "";
  const a = src.match(/(assets\/images\/[\w\/.-]+?\.(?:webp|png|gif|jpe?g|svg))/);
  if (a) return a[1];
  const t = src.match(/teamlogos\/ncaa\/500(?:-dark)?\/(\d+)\.png/);
  return t ? `team:${t[1]}` : null;
}
function slotImgUrl(slot) {
  if (slotPreview[`img:${slot}`]) return slotPreview[`img:${slot}`];
  const art = creativeArt?.art || {};
  const award = slot.match(/^assets\/images\/(recap|hs)\/([\w-]+)\.webp$/);
  const v = art[`slot:img:${slot}`]?.v || (award && art[`award-icon:award:${award[1]}-${award[2]}`]?.v);
  return v ? `${WORKER_URL}/art/img/${encodeURIComponent(v)}` : null;
}
const copyOk = (t) => t.length >= 2 && t.length <= 80 && !/\d/.test(t) && !MANAGERS.some((m) => t.toUpperCase() === m.toUpperCase());
function slotCopy(orig) {
  const p = slotPreview[`t:${orig}`];
  return p != null ? p : creativeArt?.art?.[`slot:t:${orig}`]?.text?.body ?? null;
}
const hasCopy = () => STUDIO || Object.keys(creativeArt?.art || {}).some((k) => k.startsWith("slot:t:"));
function applySlots(root) {
  if (!root || window.LEAGUE?.sport === "nfl") return;
  const imgs = root.tagName === "IMG" ? [root] : root.querySelectorAll ? root.querySelectorAll("img") : [];
  for (const img of imgs) {
    const slot = img.dataset.slotOf || slotOfImg(img);
    if (!slot || img.dataset.slotOff) continue;
    const url = slotImgUrl(slot);
    if (!img.dataset.slotOf) { img.dataset.slotOf = slot; img.dataset.slotSrc = img.getAttribute("src") || ""; }
    const want = url || img.dataset.slotSrc;
    if (want && img.getAttribute("src") !== want) img.setAttribute("src", want);
  }
  if (!hasCopy()) return;
  if (root.nodeType === 3) return slotText(root);
  if (root.nodeType !== 1) return;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) slotText(n);
}
function slotText(n) {
  const host = n.parentNode;
  if (!host || /^(SCRIPT|STYLE|TEXTAREA|OPTION|TITLE)$/.test(host.tagName)) return;
  const orig = n.__slotOrig || n.nodeValue.trim();
  if (!copyOk(orig)) return;
  const next = slotCopy(orig);
  if (next == null && !n.__slotOrig) return;
  n.__slotOrig = orig;
  const want = n.nodeValue.replace(n.nodeValue.trim(), next ?? orig);
  if (n.nodeValue !== want) n.nodeValue = want;
}
const ourSrc = (v) => /\/art\/img\/|\/creative\/image\//.test(String(v || ""));
new MutationObserver((recs) => {
  for (const r of recs) {
    if (r.type === "attributes") {
      // The page changed a picture's source itself: a new picture to look
      // up, unless it was falling back from Studio art that failed to load.
      const img = r.target, src = img.getAttribute("src");
      if (!img.dataset.slotOf || img.dataset.slotOff || src === img.dataset.slotSrc || ourSrc(src)) continue;
      if (ourSrc(r.oldValue)) { img.dataset.slotOff = "1"; continue; }
      delete img.dataset.slotOf;
      applySlots(img);
      continue;
    }
    for (const n of r.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) applySlots(n);
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"], attributeOldValue: true });
document.addEventListener("DOMContentLoaded", () => applySlots(document.body));

// Inside the Studio's Canvas: every graphic and line of copy is tappable,
// and a tap tells the Studio what was picked instead of using the app.
if (STUDIO) {
  const pickCopy = (e) => {
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    let n = r?.startContainer;
    if (n?.nodeType !== 3) n = [...(e.target.childNodes || [])].find((c) => c.nodeType === 3 && c.nodeValue.trim());
    if (!n || n.nodeType !== 3) return null;
    const orig = n.__slotOrig || n.nodeValue.trim();
    return copyOk(orig) ? { n, orig } : { bad: orig };
  };
  // Browse mode uses the app as normal (past the splash, between tabs);
  // Edit mode turns taps into picks. The Studio flips it.
  let editing = false;
  const setEditing = (on) => { editing = !!on; document.documentElement.classList.toggle("studio-canvas", editing); };
  setEditing(false);
  document.addEventListener("click", (e) => {
    if (!editing) return;
    const img = e.target.closest?.("img");
    e.preventDefault(); e.stopPropagation();
    if (img && (img.dataset.slotOf || slotOfImg(img))) {
      const slot = img.dataset.slotOf || slotOfImg(img);
      const label = img.alt || img.closest("[class]")?.innerText?.trim().split("\n")[0].slice(0, 60) || "";
      const rc = img.getBoundingClientRect();
      parent.postMessage({ type: "studio-pick", kind: "img", slot, label, src: img.currentSrc || img.src, original: new URL(img.dataset.slotSrc || img.src, location.href).href, w: Math.round(rc.width), h: Math.round(rc.height) }, location.origin);
      return;
    }
    const c = pickCopy(e);
    if (c?.orig) parent.postMessage({ type: "studio-pick", kind: "text", slot: `t:${c.orig}`, text: c.n.nodeValue.trim(), original: c.orig }, location.origin);
    else parent.postMessage({ type: "studio-pick", kind: "none", why: c?.bad ? "Scores, records and owner names always come from the app, so they can't be rewritten." : "Nothing editable there. Tap a graphic or a heading." }, location.origin);
  }, true);
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === "studio-mode") { setEditing(e.data.edit); return; }
    if (e.data.type === "studio-preview") {
      if (e.data.value == null) delete slotPreview[e.data.key]; else slotPreview[e.data.key] = e.data.value;
      applySlots(document.body);
    } else if (e.data.type === "studio-reload") {
      for (const k of Object.keys(slotPreview)) delete slotPreview[k];
      creativeArt = { at: 0, art: creativeArt.art };
      loadCreativeArt(true).then(() => applySlots(document.body));
    }
  });
}

// Last sealed week in five lines, computed by the Worker at seal time.
// Leads the board, open, until Thursday morning, then it is gone.
let renderRecap = function () {
  const toggle = document.getElementById("recap-toggle");
  const panel = document.getElementById("recap-panel");
  if (!toggle || !panel) return;
  const last = Object.values(weekSummaries).filter((s) => s?.complete && s.recap).sort((a, b) => b.week - a.week)[0];
  // Gone once the next slate is up, or Thursday morning, whichever first.
  if (!last || currentWeek > last.week || Date.now() >= recapExpiry(last)) { toggle.classList.add("hidden"); panel.classList.add("hidden"); return; }
  const r = last.recap;
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const names = (w) => w.length <= 2 ? w.join(" & ") : `${w.slice(0, -1).join(", ")} & ${w.at(-1)}`;
  const cards = [];
  const chips = (w) => nameChips(Array.isArray(w) ? w : [w]);
  // Pixel art for each card's header, cut from the league's template;
  // it hangs a little past the colour bar, the way the template draws it.
  const art = (f) => `<img class="recap-ico" src="${awardArt(`recap/${f}`)}" alt="" aria-hidden="true" decoding="async">`;
  const ICON = { target: art("crown"), skull: art("bomb"), up: art("chart"), coin: art("coin"), hash: art("flag") };
  // Team art in the template's pixel style: hand-drawn for the teams the
  // template has, and for everyone else ESPN's logo fetched tiny and blown
  // up with hard pixel edges, so every card reads the same.
  const TEAM_ART = new Set([99, 344, 2390, 194, 84]);
  // Art published from the Creative Studio comes first; then the template's
  // hand-drawn five; then ESPN's logo in pixels.
  const studio = (id) => creativeArt.art?.[`replay-logo:team:${Number(id)}`]?.v;
  const logo = (id, alt = "") => !id ? `<span class="recap-logo blank"></span>`
    : studio(id) ? `<img class="recap-logo px-art" data-slot="team:${Number(id)}" src="${WORKER_URL}/art/img/${encodeURIComponent(studio(id))}" alt="${esc(alt)}" loading="lazy" onerror="this.onerror=null;this.src='https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500-dark/${Number(id)}.png&w=26&h=26';this.className='recap-logo px'">`
    : TEAM_ART.has(Number(id)) ? `<img class="recap-logo px-art" src="assets/images/teams/${Number(id)}.webp" alt="${esc(alt)}" loading="lazy">`
    : `<img class="recap-logo px" src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500-dark/${Number(id)}.png&w=26&h=26" alt="${esc(alt)}" loading="lazy">`;
  const mine = (w) => (Array.isArray(w) ? w : [w]).includes(currentManager);
  // [label, class, art, headline, sub, stat, statLabel, isMe]
  if (r.best) {
    const b = r.best;
    cards.push([ICON.target + "PICK OF THE WEEK", "hit", logo(b.teamId, b.team), `${chips(b.who)}<span class="recap-pick">${esc(b.pick)}</span>`,
      `Only ${b.takers} of ${b.of} ${b.takers === 1 ? "took it" : `were on ${esc(b.team || b.pick)}`}${Array.isArray(b.who) && b.who.length < b.takers ? ` · ${b.who.length} cashed` : ""} · ${esc(b.final || b.score)}`, `+${b.pts}`, Array.isArray(b.who) && b.who.length > 1 ? "PTS TOP" : "PTS", mine(b.who)]);
  }
  if (r.worst) {
    const w = r.worst;
    cards.push([ICON.skull + "WORST PICK", "miss", logo(w.teamId, w.team), `<span class="recap-pick">${esc(w.pick)}</span>`,
      `${w.takers} of ${w.of} got zero · ${esc(w.final || w.score)}`, `${w.takers}/${w.of}`, "PICKED", mine(w.who)]);
  }
  if (r.movement?.up) {
    const u = r.movement.up, d = r.movement.down;
    cards.push([ICON.up + "MOVEMENT", "move", `<img class="recap-logo chart" src="assets/images/recap/chart.webp" alt="" decoding="async">`, `${chips([u.name])}<span class="recap-pick">to #${u.to} on the season</span>`,
      d ? `${esc(shown(d.name))} fell ${d.to - d.from} to #${d.to}` : "Nobody fell", `▲${u.from - u.to}`, "SPOTS", mine([u.name, d?.name].filter(Boolean))]);
  }
  if (r.consensus?.sides?.length > 1) {
    const c = r.consensus;
    const [a, b] = c.sides;
    cards.push([ICON.coin + "COIN FLIP", "split", `<span class="recap-vs">${logo(a.id, a.team)}${logo(b.id, b.team)}</span>`, `<span class="recap-pick">${esc(c.matchup)}</span>`,
      `${esc(a.team)} ${a.n} · ${esc(b.team)} ${b.n} · ${esc(c.final || c.score)}`, `${a.n}-${b.n}`, "SPLIT", false]);
  }
  if (r.tb) {
    const t = r.tb;
    const guess = [...new Set(t.guesses || [t.guess])].join(" & ");
    cards.push([ICON.hash + "TIEBREAKER", "tb", `<span class="recap-vs">${logo(t.awayId)}${logo(t.homeId)}</span>`, `${chips(t.who)}<span class="recap-pick">said ${esc(guess)}</span>`,
      `${esc(t.matchup)} came in at ${t.actual}`, t.off === 0 ? "🎯" : `${t.off}`, t.off === 0 ? "EXACT" : "OFF", mine(t.who)]);
  }
  const key = `${last.week}|${cards.length}|${currentManager}|${creativeArt.at || 0}|${[...recapOpen].join(",")}`;
  toggle.classList.remove("hidden");
  toggle.firstChild.textContent = `📰 ${String(last.label || `WEEK ${last.week}`).toUpperCase()} RECAP `;
  if (panel.dataset.drawn === key) return;
  panel.dataset.drawn = key;
  panel.innerHTML = `<div class="recap-marquee" role="button" tabindex="0" aria-expanded="true" title="Tap to fold"><span>★ ${esc(String(last.label || `WEEK ${last.week}`).toUpperCase())} REPLAY ★</span><small>GAME OVER · FINAL STATS <i class="recap-caret">▾</i></small></div>` + cards.map(([h, cls, art, main, sub, stat, statLabel, me], i) =>
    `<div class="recap-card arc ${cls}${me ? " me" : ""}${recapOpen.has(cls) ? " open" : ""}" style="--i:${i}" data-rc="${cls}" role="button" tabindex="0" aria-expanded="${recapOpen.has(cls)}">
      <div class="recap-head">${h}${me ? `<span class="recap-you">YOU</span>` : ""}</div>
      <div class="recap-art">${art}</div>
      <div class="recap-body">
        <div class="recap-main">${main}</div>
        <div class="recap-sub">${sub}</div>
      </div>
      <div class="recap-stat"><b>${stat}</b><span>${statLabel}</span></div>
      ${recapOpen.has(cls) ? `<div class="recap-more">${recapDetail(last, cls)}</div>` : ""}
    </div>`).join("");
};

// Tap a replay card for the whole story behind it: who took which side on
// that game, everyone's week score, or every tiebreaker guess. Read from
// the sealed week, so it is exactly what was graded.
var recapOpen = new Set(); // var: the board can draw the replay before this line runs
function recapDetail(sum, kind) {
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // Picks come with the detailed weeks; until they land, ask for them and say so.
  const full = (seasonLedger || []).find((w) => w.week === sum.week);
  if (full) sum = { ...sum, rows: full.rows, slate: full.slate || sum.slate };
  else if (kind !== "move" && !(sum.rows || []).some((r) => r.ledger)) { fetchSeasonLedger().then(() => { if ((seasonLedger || []).some((w) => w.week === sum.week)) { document.getElementById("recap-panel").dataset.drawn = ""; renderRecap(); } }); return `<div class="rm-none">Loading the picks…</div>`; }
  const rows = (sum.rows || []).filter((r) => r && r.name);
  if (!rows.length) return `<div class="rm-none">Details aren't saved for this week.</div>`;
  const nm = (n) => `<b class="${n === currentManager ? "me" : ""}">${esc(shown(n))}</b>`;
  if (kind === "move") {
    // Season standings after this week, with how far each player moved
    // from the week before. Ties share a place.
    const weeks = Object.values(weekSummaries).filter((w) => w?.complete && w.week <= sum.week);
    const total = (upto) => { const t = new Map(); for (const w of weeks) if (w.week <= upto) for (const r of w.rows || []) t.set(r.name, (t.get(r.name) || 0) + (r.score || 0)); return t; };
    const place = (t) => { const list = [...t.entries()].sort((a, b) => b[1] - a[1]); const m = new Map(); list.forEach(([n, p]) => m.set(n, 1 + list.filter(([, q]) => q > p).length)); return m; };
    const now = total(sum.week), was = total(sum.week - 1), pNow = place(now), pWas = place(was);
    const list = [...now.entries()].sort((a, b) => b[1] - a[1]);
    return `<div class="rm-h">SEASON STANDINGS AFTER WEEK ${sum.week}</div><ol class="rm-rank">${list.map(([n, pts]) => {
      const d = was.size ? (pWas.get(n) ?? pNow.get(n)) - pNow.get(n) : 0;
      const wk = (rows.find((r) => r.name === n) || {}).score;
      return `<li><em>${pNow.get(n)}</em>${nm(n)}<i class="${d > 0 ? "up" : d < 0 ? "down" : "same"}">${d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : "–"}</i><span>${pts} pts${wk != null ? ` <small>+${wk} this week</small>` : ""}</span></li>`;
    }).join("")}</ol>`;
  }
  if (kind === "tb") {
    const g = rows.filter((r) => r.tbGuess != null).sort((a, b) => (a.tbDiff ?? 999) - (b.tbDiff ?? 999));
    return `<div class="rm-h">EVERY GUESS · ACTUAL ${esc(sum.recap?.tb?.actual ?? sum.tiebreaker?.actual ?? "?")}</div><ol class="rm-list">${g.map((r) => `<li>${nm(r.name)}<span>${r.tbGuess}${r.tbDiff != null ? ` · ${r.tbDiff === 0 ? "exact" : `off ${r.tbDiff}`}` : ""}</span></li>`).join("")}</ol>`;
  }
  const r = sum.recap || {};
  const team = kind === "hit" ? r.best?.team : kind === "miss" ? r.worst?.team : r.consensus?.sides?.[0]?.team;
  const g = (sum.slate || []).find((x) => [x.awayShort, x.homeShort].includes(team));
  if (!g) return `<div class="rm-none">Couldn't find that game.</div>`;
  const sides = new Map();
  for (const row of rows) {
    const l = (row.ledger || []).find((x) => Number(x.g) === Number(g.id));
    const side = l ? `${l.team === g.home ? g.homeShort : l.team === g.away ? g.awayShort : l.team} ${l.line || l.mode || ""}`.trim() : "No pick";
    const x = sides.get(side) || { side, team: l?.team, teamId: l ? (l.team === g.home ? g.homeId : l.team === g.away ? g.awayId : null) : null, hit: l?.result === "hit", pts: l?.result === "hit" ? l.pts : 0, who: [] };
    x.who.push(row.name); sides.set(side, x);
  }
  return `<div class="rm-h">${esc(g.awayShort)} AT ${esc(g.homeShort)} · WHO TOOK WHAT</div>${[...sides.values()].sort((a, b) => b.who.length - a.who.length).map((x) => { const id = x.teamId || (x.team ? teamIdOf(x.team) : null); return `<div class="rm-side ${x.hit ? "hit" : "miss"}"><span>${id ? `<img src="${logoUrl(id)}" alt="" loading="lazy">` : ""}${esc(x.side)}</span><i>${x.hit ? `+${x.pts} each` : "0"}</i><div class="pick-chips">${nameChips(x.who)}</div></div>`; }).join("")}`;
}
document.getElementById("recap-panel")?.addEventListener("click", (e) => {
  const c = e.target.closest(".recap-card[data-rc]");
  if (!c || e.target.closest(".pick-chip, a, button")) return;
  const k = c.dataset.rc;
  if (recapOpen.has(k)) recapOpen.delete(k); else { recapOpen.add(k); noteUse("recap-card", k); }
  e.currentTarget.classList.add("dealt"); // already dealt in: redraw without replaying the deal
  renderRecap();
});

// The REPLAY marquee is the fold: tap it to tuck the cards away.
document.getElementById("recap-panel")?.addEventListener("click", (e) => {
  const mq = e.target.closest(".recap-marquee");
  if (!mq) return;
  const panel = e.currentTarget;
  const folded = !panel.classList.contains("folded");
  panel.classList.toggle("folded", folded);
  mq.setAttribute("aria-expanded", String(!folded));
  try { localStorage.setItem("brochiefs_recap_folded_v1", folded ? "1" : "0"); } catch {}
});
try { if (localStorage.getItem("brochiefs_recap_folded_v1") === "1") document.getElementById("recap-panel")?.classList.add("folded"); } catch {}

// Folds like the sections under it. Starts open; the choice is remembered.
(() => {
  const toggle = document.getElementById("recap-toggle");
  const panel = document.getElementById("recap-panel");
  if (!toggle || !panel) return;
  const KEY = "brochiefs_recap_open_v1";
  let open = null;
  try { open = localStorage.getItem(KEY); } catch { /* private mode */ }
  const paint = () => {
    // Before the first kickoff the board is empty and last week is the
    // story, so the recap leads. Once games start it steps below them.
    // The REPLAY marquee is the title now, so the fold heading is gone and
    // the recap always shows while it is current.
    const isOpen = true;
    panel.classList.toggle("hidden", !isOpen || toggle.classList.contains("hidden"));
    toggle.classList.toggle("open", isOpen); toggle.setAttribute("aria-expanded", String(isOpen));
  };
  toggle.addEventListener("click", () => {
    open = toggle.classList.contains("open") ? "0" : "1";
    paint();
    try { localStorage.setItem(KEY, open); } catch { /* private mode */ }
  });
  paint();
  const orig = renderRecap;
  renderRecap = (...a) => { orig(...a); paint(); };
})();

// The leaderboard folds like the sections under it. It starts open, and
// the choice is remembered on the device.
(() => {
  const toggle = document.getElementById("leaderboard-toggle");
  const list = document.getElementById("rankings-list");
  if (!toggle || !list) return;
  const KEY = "brochiefs_leaderboard_open_v2";
  let open = true;
  try { open = localStorage.getItem(KEY) !== "0"; } catch { /* private mode */ }
  const h2hBtn = document.getElementById("h2h-open");
  const paint = () => {
    list.classList.toggle("hidden", !open);
    toggle.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    // The compare button belongs to the list, so it folds with it.
    h2hBtn?.classList.toggle("hidden", !open);
  };
  toggle.addEventListener("click", () => {
    open = !open;
    paint();
    try { localStorage.setItem(KEY, open ? "1" : "0"); } catch { /* private mode */ }
  });
  paint();
})();

// All Picks starts collapsed: the scorebugs and the leaderboard are the
// point of the board, the full grid is there when someone wants it.
(() => {
  const toggle = document.getElementById("all-picks-toggle");
  const wrap = document.querySelector(".scoreboard-table-wrap");
  if (!toggle || !wrap) return;
  let open = false;
  const paint = () => { wrap.classList.toggle("hidden", !open); toggle.classList.toggle("open", open); toggle.setAttribute("aria-expanded", String(open)); };
  toggle.addEventListener("click", () => { open = !open; paint(); if (open) track("all-picks-open", { event: true }); });
  paint();
})();

(() => {
  const toggle = document.getElementById("payouts-toggle");
  const panel = document.getElementById("payouts-panel");
  if (!toggle || !panel) return;
  let open = false;
  const paint = () => {
    panel.classList.toggle("hidden", !open);
    toggle.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) renderPayouts();
  };
  // Only a real tap counts: the week-over overview opens it by itself.
  toggle.addEventListener("click", (e) => { open = !open; paint(); if (open && e.isTrusted) track("pot-open", { event: true }); });
  paint();
})();

// --- Player card ----------------------------------------------------------
// Tap a pot row, or a name on the replay: that player's season on one
// card. Everything comes from the sealed weeks, so it is what was graded.
function playerSeason(name) {
  // The detailed weeks (with every pick) when they are loaded, else the plain ones.
  const weeks = (seasonLedger && seasonLedger.length ? seasonLedger : Object.values(weekSummaries).filter((w) => w?.complete)).slice().sort((a, b) => a.week - b.week);
  const scores = [], picks = [];
  let w = 0, l = 0, atsW = 0, atsN = 0, suW = 0, suN = 0;
  for (const wk of weeks) {
    const me = (wk.rows || []).find((r) => r.name === name);
    if (!me) continue;
    scores.push({ week: wk.week, score: me.score, won: (wk.winners || []).includes(name), high: wk.highScore });
    for (const lg of me.ledger || []) {
      if (lg.result !== "hit" && lg.result !== "miss") continue;
      const hit = lg.result === "hit";
      hit ? w++ : l++;
      if (lg.mode === "ATS") { atsN++; if (hit) atsW++; } else { suN++; if (hit) suW++; }
      // How many others were on the same team that week.
      const with_ = (wk.rows || []).filter((r) => (r.ledger || []).some((x) => x.g === lg.g && x.team === lg.team)).length;
      const others = (wk.rows || []).filter((r) => (r.ledger || []).some((x) => x.g === lg.g && x.team !== lg.team && x.result === "hit")).length;
      const sameNames = (wk.rows || []).filter((r) => r.name !== name && (r.ledger || []).some((x) => x.g === lg.g && x.team === lg.team)).map((r) => r.name);
      const oppNames = (wk.rows || []).filter((r) => (r.ledger || []).some((x) => x.g === lg.g && x.team !== lg.team)).map((r) => r.name);
      const g = (wk.slate || []).find((x) => Number(x.id) === Number(lg.g));
      const team = g ? (lg.team === g.home ? g.homeShort : lg.team === g.away ? g.awayShort : lg.team) : lg.team;
      // The game itself: matchup and final, from the sealed score ("away-home").
      const [as, hs] = String(lg.score || "").split("-").map(Number);
      const game = g ? `${g.awayShort} ${Number.isFinite(as) ? as : ""} at ${g.homeShort} ${Number.isFinite(hs) ? hs : ""}`.replace(/\s+/g, " ").trim() : "";
      const margin = Number.isFinite(as) && Number.isFinite(hs) && g ? (as === hs ? "tied" : `${as > hs ? g.awayShort : g.homeShort} by ${Math.abs(as - hs)}`) : "";
      const line = g && g.spread != null ? `${g.favorite === g.home ? g.homeShort : g.awayShort} −${g.spread}` : "";
      picks.push({ teamFull: lg.team, teamId: g ? (lg.team === g.home ? g.homeId : lg.team === g.away ? g.awayId : null) : null, awayId: g?.awayId, homeId: g?.homeId, away: g?.away, home: g?.home, awayShort: g?.awayShort, homeShort: g?.homeShort, as, hs, week: wk.week, hit, pts: hit ? lg.pts || 0 : 0, worth: lg.worth || lg.pts || 0, text: lg.mode === "SU" ? `${team} to win` : `${team} ${lg.line || ""} on the spread`.replace(/\s+/g, " ").trim(), mode: lg.mode, sameNames, oppNames, with_, of: (wk.rows || []).length, others, game, margin, line });
    }
  }
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const best = picks.filter((p) => p.hit).sort((a, b) => b.pts - a.pts || a.with_ - b.with_)[0];
  const worst = picks.filter((p) => !p.hit).sort((a, b) => b.others - a.others || b.worth - a.worth)[0];
  return {
    scores, w, l, best, worst,
    top: sorted[0], low: sorted[sorted.length - 1],
    avg: scores.length ? scores.reduce((s, x) => s + x.score, 0) / scores.length : null,
    wins: scores.filter((x) => x.won),
    ats: atsN ? Math.round((atsW / atsN) * 100) : null, atsN, atsW, su: suN ? Math.round((suW / suN) * 100) : null, suN, suW,
  };
}
// Team logos for past weeks: the sealed weeks keep names, not ESPN ids, so
// the ids come from ESPN's public team list once and stay on the phone.
var teamIdMap = null;
// Names differ between feeds ("Georgia St" / "Georgia State Panthers"), so
// both sides are folded the same way before matching.
const teamKey = (n) => String(n || "").toLowerCase().replace(/&/g, "and").replace(/\bst\.?\b/g, "state").replace(/[^a-z0-9]+/g, " ").trim();
function teamIdOf(name) {
  if (!name) return null;
  const g = GAMES.find((x) => x.away === name || x.home === name);
  if (g) return g.away === name ? g.awayId : g.homeId;
  if (!teamIdMap) { try { teamIdMap = JSON.parse(localStorage.getItem("brochiefs_team_ids_v2") || "null"); } catch {} }
  if (!teamIdMap && !teamIdOf.loading) {
    teamIdOf.loading = fetch(`${window.ESPN_API || "https://site.api.espn.com/apis/site/v2/sports/football/college-football"}/teams?limit=1000`).then((r) => r.json()).then((d) => {
      const m = {};
      for (const { team: t } of d?.sports?.[0]?.leagues?.[0]?.teams || []) for (const k of [t.displayName, t.shortDisplayName, t.location, `${t.location} ${t.name}`, t.abbreviation]) { const key = teamKey(k); if (key && !m[key]) m[key] = Number(t.id); }
      teamIdMap = m;
      try { localStorage.setItem("brochiefs_team_ids_v2", JSON.stringify(m)); } catch {}
      if (!document.getElementById("player-modal")?.classList.contains("hidden")) openPlayerCard(document.getElementById("player-modal").dataset.name, true);
    }).catch(() => {});
  }
  if (!teamIdMap) return null;
  // Full name, then the name without its last word (the mascot), and so on.
  const words = teamKey(name).split(" ");
  for (let n = words.length; n > 0; n--) { const id = teamIdMap[words.slice(0, n).join(" ")]; if (id) return id; }
  return null;
}
function openPlayerCard(name, again) {
  if (!name) return;
  if (!again) noteUse("player-card", name);
  // Every pick lives in the detailed weeks; fetch them once, then redraw.
  if (!again && !(seasonLedger && Date.now() - seasonLedgerAt < 5 * 60 * 1000)) fetchSeasonLedger().then(() => { if (!document.getElementById("player-modal")?.classList.contains("hidden")) openPlayerCard(name, true); });
  const esc = escapeCd, d = playerSeason(name);
  const pot = typeof payoutLedger === "function" ? payoutLedger() : null;
  const pr = pot?.list?.find((r) => r.name === name) || {};
  let m = document.getElementById("player-modal");
  if (!m) {
    m = document.createElement("div");
    m.id = "player-modal";
    m.className = "modal-overlay plc-modal hidden";
    m.setAttribute("role", "dialog");
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".plc-x")) m.classList.add("hidden"); });
  }
  m.dataset.name = name;
  const pts = pr.points ?? d.scores.reduce((t, x) => t + x.score, 0);
  const max = Math.max(1, ...d.scores.map((x) => x.score));
  const pct = d.w + d.l ? Math.round((d.w / (d.w + d.l)) * 100) : null;
  // A fighting game stat bar: label, value, ten segments filled to the share.
  const bar = (label, val, share, note = "") => `<div class="plc-sb"><span>${label}</span><i>${Array.from({ length: 10 }, (_, k) => `<u class="${k < Math.round(share * 10) ? "on" : ""}"></u>`).join("")}</i><b>${val}</b><em>${note}</em></div>`;
  const logo = (full, known) => { const id = known || teamIdOf(full); return id ? `<img src="${logoUrl(id)}" alt="" loading="lazy">` : `<span class="plc-nologo"></span>`; };
  const pick = (p, hit) => !p ? "" : `<div class="plc-pick ${hit ? "hit" : "miss"}">
      <div class="plc-pt"><small>${hit ? "BEST PICK" : "WORST PICK"} · WEEK ${p.week}</small><b>${hit ? `+${p.pts}` : "0"} PTS</b></div>
      <div class="plc-call">${logo(p.teamFull, p.teamId)}<span><b>${esc(p.text)}</b><small>${hit ? `${p.with_} of ${p.of} made this pick${p.with_ <= 2 ? " · almost nobody else" : ""}` : p.others ? `${p.others} of ${p.of} took the other side and got it right` : `${p.with_} of ${p.of} made this pick`}</small></span></div>
      ${p.away ? `<div class="plc-score"><span class="${p.as > p.hs ? "w" : ""}">${logo(p.away, p.awayId)}<i>${esc(p.awayShort)}</i><b>${Number.isFinite(p.as) ? p.as : ""}</b></span><em>FINAL</em><span class="${p.hs > p.as ? "w" : ""}"><b>${Number.isFinite(p.hs) ? p.hs : ""}</b><i>${esc(p.homeShort)}</i>${logo(p.home, p.homeId)}</span></div>` : ""}
      <div class="plc-more">${p.sameNames?.length ? `<div class="plc-wh"><small>ALSO ON IT</small><div class="pick-chips">${nameChips(p.sameNames)}</div></div>` : `<div class="plc-wh"><small>ALSO ON IT</small><em>Nobody else</em></div>`}${p.oppNames?.length ? `<div class="plc-wh"><small>OTHER SIDE</small><div class="pick-chips">${nameChips(p.oppNames)}</div></div>` : ""}</div>
      <i class="plc-caret">▾</i>
    </div>`;
  if (!m.dataset.pickTap) {
    m.dataset.pickTap = "1";
    m.addEventListener("click", (e) => {
      const pk = e.target.closest(".plc-pick");
      if (!pk || e.target.closest(".pick-chip")) return;
      pk.classList.toggle("open");
    });
  }
  m.innerHTML = `<div class="modal-card plc-card">
    <button type="button" class="plc-x" aria-label="Close">✕</button>
    <div class="plc-top">
      <div class="plc-av"><span>${avatarOverrides[name] || shown(name)[0]}</span></div>
      <div class="plc-id"><small>PLAYER ${String(MANAGERS.indexOf(name) + 1).padStart(2, "0")}</small><b>${esc(shown(name).toUpperCase())}</b>
        <div class="plc-badges">${pr.seasonPlace ? `<span class="rank">${pr.tied ? "T" : "#"}${pr.seasonPlace}</span>` : ""}<span>${pts} PTS</span>${pr.earned ? `<span class="cash">${money(pr.earned)}</span>` : ""}${d.wins.length ? `<span class="gold"><i class="plc-tro">🏆</i>×${d.wins.length}</span>` : ""}</div></div>
    </div>
    ${d.scores.length ? `
    <div class="plc-sec">POINTS EACH WEEK <span>gold = won the week</span></div>
    <div class="plc-bars">${d.scores.map((x) => `<i class="${x.won ? "won" : ""}${x === d.top ? " top" : ""}"><b>${x.score}</b><s style="height:${Math.max(8, (x.score / max) * 100)}%"></s><em>W${x.week}</em></i>`).join("")}</div>
    <div class="plc-sec">STATS</div>
    <div class="plc-stats">
      ${bar("AVG WEEK", `${d.avg.toFixed(1)}`, d.avg / 20, "pts")}
      ${bar("BEST WEEK", d.top.score, d.top.score / 20, `W${d.top.week}`)}
      ${bar("WORST WEEK", d.low.score, d.low.score / 20, `W${d.low.week}`)}
      ${pct != null ? bar("PICKS RIGHT", `${pct}%`, pct / 100, `${d.w}-${d.l}`) : `<div class="plc-sb"><span>PICKS</span><small>Loading every pick…</small></div>`}
      ${d.atsN ? bar("ON SPREAD", `${d.ats}%`, d.ats / 100, `${d.atsN} picks`) : ""}
      ${d.suN ? bar("TO WIN", `${d.su}%`, d.su / 100, `${d.suN} picks`) : ""}
    </div>
    ${pick(d.best, true)}${pick(d.worst, false)}` : `<div class="plc-none">No finished weeks yet.</div>`}
  </div>`;
  m.classList.remove("hidden");
}
document.addEventListener("click", (e) => {
  const row = e.target.closest?.("[data-pot-row]");
  if (row) return openPlayerCard(row.dataset.potRow);
  const chip = e.target.closest?.("#recap-panel .pick-chip");
  if (chip?.dataset.name) { e.stopPropagation(); return openPlayerCard(chip.dataset.name); }
}, true);

// --- Week win card --------------------------------------------------------
// Tap a trophy in The Pot (or a gold week on the season bar): how that
// week was won, from the frozen record.
let weekDetailAll = null;
async function fetchWeekDetail() {
  if (weekDetailAll) return weekDetailAll;
  try {
    const res = await fetch(`${WORKER_URL}/weeks?detail=1&t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) weekDetailAll = (await res.json()).summaries || {};
  } catch {}
  return weekDetailAll || {};
}
async function openWeekWin(week, name) {
  const all = await fetchWeekDetail();
  const w = all[week] || weekSummaries[week];
  if (!w) return;
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rows = [...(w.rows || [])].sort((a, b) => b.score - a.score);
  const me = rows.find((r) => r.name === name) || rows[0];
  const winners = w.winners || [];
  const next = rows.find((r) => !winners.includes(r.name));
  const slate = new Map((w.slate || []).map((g) => [Number(g.id), g]));
  const shortOf = (gid, t) => { const g = slate.get(Number(gid)); return !g ? t : t === g.home ? g.homeShort : t === g.away ? g.awayShort : t; };
  const hits = (me.ledger || []).filter((l) => l.result === "hit");
  const lg = (gid, t) => { const g = slate.get(Number(gid)); const id = g ? (t === g.home ? g.homeId : t === g.away ? g.awayId : null) : null; const k = id || (t ? teamIdOf(t) : null); return k ? `<img src="${logoUrl(k)}" alt="" loading="lazy">` : `<span class="ww-nologo"></span>`; };
  // Where the win was made: the game where this card out-earned the runner-up most.
  let deciding = null;
  if (next) for (const l of me.ledger || []) {
    const o = (next.ledger || []).find((x) => x.g === l.g);
    const gap = (l.pts || 0) - (o?.pts || 0);
    if (gap > 0 && (!deciding || gap > deciding.gap)) deciding = { gap, l, o };
  }
  const margin = next ? me.score - next.score : null;
  const tb = w.tiebreaker;
  const howWon = !next ? "Everyone tied for the week." :
    margin > 0 ? `Won by <b>${margin}</b> over ${esc(shown(next.name))} (${next.score}).` :
    `Tied ${esc(shown(next.name))} on ${me.score} and took it on the tiebreaker${tb && me.tbGuess != null ? `: guessed <b>${me.tbGuess}</b>, ${esc(tb.matchup)} came in at <b>${tb.actual}</b>` : ""}.`;
  const shared = winners.length > 1 ? ` Shared with ${winners.filter((n) => n !== me.name).map((n) => esc(shown(n))).join(", ")}.` : "";
  const prize = w.exhibition ? `<span class="ww-prize exh">TROPHY ONLY</span>` : `<span class="ww-prize">${money(Math.round(POT.weekly / Math.max(1, winners.length)))}</span>`;
  let m = document.getElementById("week-win");
  if (!m) {
    m = document.createElement("div");
    m.id = "week-win"; m.className = "wpx-overlay hidden"; m.setAttribute("role", "dialog");
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".wpx-x")) m.classList.add("hidden"); });
  }
  m.innerHTML = `<div class="wpx-card ww">
    <button type="button" class="wpx-x" aria-label="Close">✕</button>
    <div class="ww-kicker">🏆 ${esc(String(w.label || `Week ${w.week}`).toUpperCase())} CHAMPION${w.exhibition ? " · EXHIBITION" : ""}</div>
    <div class="ww-head"><span class="wpp-av" style="--accent:${accentFor(me.name)}">${esc(avatarOverrides[me.name] || shown(me.name)[0])}</span><div><b>${esc(shown(me.name).toUpperCase())}</b><small>${me.score} PTS · ${me.hits ?? hits.length}-${me.misses ?? (me.ledger || []).filter((l) => l.result === "miss").length}</small></div>${prize}</div>
    <div class="ww-how">${howWon}${shared}</div>
    ${deciding ? (() => {
      const g = slate.get(Number(deciding.l.g)) || {};
      const [as, hs] = String(deciding.l.score || "").split("-").map((x) => Number(x));
      const side = (who, pk, pts, mine) => `<div class="ww-side${mine ? " me" : ""}"><small>${esc(shown(who).toUpperCase())}</small><span>${pk?.team ? `${lg(deciding.l.g, pk.team)}<b>${esc(shortOf(deciding.l.g, pk.team))}</b><i>${esc(pk.line || "")}</i>` : `<b class="dim">No pick</b>`}</span><em class="${pts ? "up" : "dn"}">+${pts || 0}</em></div>`;
      return `<div class="wpx-h">WHERE IT WAS WON</div>
      <div class="ww-dec2">
        <div class="ww-sb"><span class="${as > hs ? "w" : ""}">${lg(deciding.l.g, g.away)}<i>${esc(g.awayShort || "")}</i><b>${Number.isFinite(as) ? as : ""}</b></span><em>FINAL</em><span class="${hs > as ? "w" : ""}"><b>${Number.isFinite(hs) ? hs : ""}</b><i>${esc(g.homeShort || "")}</i>${lg(deciding.l.g, g.home)}</span></div>
        <div class="ww-sides">${side(me.name, deciding.l, deciding.l.pts, true)}${side(next.name, deciding.o, deciding.o?.pts, false)}</div>
      </div>`;
    })() : ""}
    ${hits.length ? `<div class="wpx-h">CORRECT PICKS <span>${hits.length} of ${(me.ledger || []).length}</span></div><div class="ww-hits2">${hits.map((l) => `<span>${lg(l.g, l.team)}<b>${esc(shortOf(l.g, l.team))}</b><i>${esc(l.mode === "SU" ? "to win" : l.line)}</i><em>+${l.pts}</em></span>`).join("")}</div>` : ""}
    <div class="wpx-h">TOP OF THE BOARD</div>
    <ol class="ww-top2">${rows.slice(0, 4).map((r, i) => `<li class="${r.name === me.name ? "me" : ""}"><u>${i + 1}</u><span class="ww-av" style="--accent:${accentFor(r.name)}">${esc(avatarOverrides[r.name] || shown(r.name)[0])}</span><span>${esc(shown(r.name))}</span><b>${r.score}</b></li>`).join("")}</ol>
  </div>`;
  m.classList.remove("hidden");
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".pot-tro, .ps-seg.won");
  if (!b) return;
  e.stopPropagation();
  openWeekWin(Number(b.dataset.week), b.dataset.name);
});

// --- Season stats ------------------------------------------------------
// Five leaderboards from the ledger of every counting week. The ledger
// comes down only when the panel is opened, and is kept for five minutes.
var seasonLedgerAt = 0;
var seasonLedger = null; // var: the replay and player card can read it before this line runs
async function fetchSeasonLedger() {
  if (!WORKER_URL) return null;
  if (seasonLedger && Date.now() - seasonLedgerAt < 5 * 60 * 1000) return seasonLedger;
  try {
    const res = await fetch(`${WORKER_URL}/weeks?detail=1&t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return seasonLedger;
    const data = await res.json();
    seasonLedger = Object.values(data.summaries || {}).filter((w) => w?.complete && Array.isArray(w.rows)).sort((a, b) => a.week - b.week);
    seasonLedgerAt = Date.now();
  } catch { /* keep what we had */ }
  return seasonLedger;
}

// Pure: the boards from a list of counting weeks. Every board carries
// everyone, ranked, so the panel can show the top three and the viewer.
function seasonStats(weeks, liveBlanks = {}) {
  const by = new Map(MANAGERS.map((n) => [n, { name: n, atsW: 0, atsL: 0, dogHits: 0, fades: 0, picks: 0, blanks: 0, lone: 0, tbSum: 0, tbN: 0, bestWeek: null, streak: 0, pts: 0 }]));
  // How many were on each team in each game, for the lone-wolf board.
  const onTeam = new Map();
  for (const w of weeks) for (const r of w.rows) for (const l of r.ledger || []) if (l.team) { const k = `${w.week}|${l.g}|${l.team}`; onTeam.set(k, (onTeam.get(k) || 0) + 1); }
  for (const w of weeks) for (const r of w.rows) {
    const m = by.get(r.name); if (!m) continue;
    m.pts += r.score || 0;
    if (r.tbDiff !== null && r.tbDiff !== undefined) { m.tbSum += r.tbDiff; m.tbN += 1; }
    if (!m.bestWeek || r.score > m.bestWeek.score) m.bestWeek = { week: w.week, score: r.score };
    for (const l of r.ledger || []) {
      if (l.result === "pending") continue;
      if (!l.team) { m.blanks += 1; m.streak = 0; continue; }
      m.picks += 1;
      const dog = l.team !== l.favorite;
      if (dog) m.fades += 1;
      if (l.mode === "ATS") { if (l.result === "hit") m.atsW += 1; else if (l.result === "miss") m.atsL += 1; }
      if (l.mode === "SU" && dog && l.result === "hit") m.dogHits += 1;
      if (l.result === "hit" && (onTeam.get(`${w.week}|${l.g}|${l.team}`) || 0) <= 3) m.lone += 1;
      // Correct-pick streak, in ledger order, carried across weeks.
      if (l.result === "hit") m.streak += 1; else if (l.result === "miss") m.streak = 0;
    }
  }
  // This week's blanks count the moment the card locks, so a no-show is
  // on the board on Saturday rather than after the Monday seal.
  for (const [name, n] of Object.entries(liveBlanks)) { const m = by.get(name); if (m) m.blanks += n; }
  const all = [...by.values()];
  const pct = (w, l) => (w + l ? w / (w + l) : 0);
  const sameTbN = new Set(all.filter((m) => m.tbN).map((m) => m.tbN)).size === 1;
  return {
    ats: all.filter((m) => m.atsW + m.atsL >= 3).sort((a, b) => pct(b.atsW, b.atsL) - pct(a.atsW, a.atsL) || b.atsW - a.atsW).map((m) => ({ name: m.name, n: pct(m.atsW, m.atsL), value: `${m.atsW}-${m.atsL}`, sub: `${Math.round(pct(m.atsW, m.atsL) * 100)}%` })),
    dogs: all.filter((m) => m.dogHits).sort((a, b) => b.dogHits - a.dogHits).map((m) => ({ name: m.name, n: m.dogHits, value: String(m.dogHits), sub: m.dogHits === 1 ? "hit" : "hits" })),
    lone: all.filter((m) => m.lone).sort((a, b) => b.lone - a.lone).map((m) => ({ name: m.name, n: m.lone, value: String(m.lone), sub: m.lone === 1 ? "hit" : "hits" })),
    streak: all.filter((m) => m.streak >= 2).sort((a, b) => b.streak - a.streak).map((m) => ({ name: m.name, n: m.streak, value: String(m.streak), sub: "in a row" })),
    fader: all.filter((m) => m.picks >= 5).sort((a, b) => b.fades / b.picks - a.fades / a.picks).map((m) => ({ name: m.name, n: m.fades / m.picks, value: `${Math.round((m.fades / m.picks) * 100)}%`, sub: `${m.fades} of ${m.picks}` })),
    tb: all.filter((m) => m.tbN).sort((a, b) => a.tbSum / a.tbN - b.tbSum / b.tbN).map((m) => ({ name: m.name, n: m.tbSum / m.tbN, low: true, value: (m.tbSum / m.tbN).toFixed(1), sub: "avg miss", more: `avg miss${sameTbN ? "" : ` · ${m.tbN} wk${m.tbN === 1 ? "" : "s"}`}` })),
    best: all.filter((m) => m.bestWeek).sort((a, b) => b.bestWeek.score - a.bestWeek.score).map((m) => ({ name: m.name, n: m.bestWeek.score, value: String(m.bestWeek.score), sub: `Week ${m.bestWeek.week}` })),
    blanks: all.filter((m) => m.blanks).sort((a, b) => b.blanks - a.blanks).map((m) => ({ name: m.name, n: m.blanks, value: String(m.blanks), sub: "blank", more: "left blank" })),
  };
}

// The season's finished side bets, from the Worker's own side record.
// Read only for this board; nothing here feeds the pool's numbers.
async function fetchSideHistory() {
  if (!WORKER_URL || window.LEAGUE?.sport === "nfl") return [];
  if (sideHistory && Date.now() - sideHistoryAt < 5 * 60 * 1000) return sideHistory;
  try {
    const res = await fetchCapped(`${WORKER_URL}/side?history=1&t=${Date.now()}`, { cache: "no-store" }, 8000);
    if (res.ok) { sideHistory = (await res.json()).history || []; sideHistoryAt = Date.now(); }
  } catch { /* keep what we had */ }
  return sideHistory || [];
}

// Pure: side bet boards from finished bets, scored by the side bet's own
// rules on the finals the Worker kept. Apart from seasonStats on purpose:
// a side bet never moves a pool record.
function sideSeasonStats(history) {
  const by = new Map();
  const get = (n) => by.get(n) || by.set(n, { name: n, played: 0, won: 0, net: 0, pW: 0, pL: 0, oW: 0, oL: 0, pts: 0 }).get(n);
  for (const rec of history || []) {
    const pot = { ...rec, own: true };
    const st = sideStandings(pot, (g) => rec.finals?.[g.id] || null);
    if (!st.final) continue;
    const out = sideOutcome(pot, st);
    for (const r of st.rows) {
      const m = get(r.name);
      m.played += 1; m.pts += r.pts;
      if (out.n >= 2 && !out.push) {
        if (out.winners.includes(r.name)) { m.won += 1; m.net += out.net; } else m.net -= rec.buyIn;
      }
      for (const c of r.cells) {
        if (c.cls !== "hit" && c.cls !== "miss") continue;
        if (!c.pick) continue;
        if (c.ou) { if (c.cls === "hit") m.oW += 1; else m.oL += 1; } else if (c.cls === "hit") m.pW += 1; else m.pL += 1;
      }
    }
  }
  const all = [...by.values()];
  const money = (x) => `${x > 0 ? "+" : x < 0 ? "-" : ""}${sideMoney(Math.abs(x))}`;
  const rate = (m) => { const w = m.pW + m.oW, l = m.pL + m.oL; return w + l ? w / (w + l) : 0; };
  return {
    bets: (history || []).length,
    bank: all.sort((a, b) => b.net - a.net || b.won - a.won || a.name.localeCompare(b.name)).map((m) => ({ name: m.name, n: m.net, signed: true, value: money(m.net), sub: `${m.won} of ${m.played}`, more: `won ${m.won} of ${m.played}` })),
    picks: [...all].filter((m) => m.pW + m.pL + m.oW + m.oL).sort((a, b) => rate(b) - rate(a) || b.pW + b.oW - (a.pW + a.oW)).map((m) => ({ name: m.name, n: rate(m), value: `${m.pW + m.oW}-${m.pL + m.oL}`, sub: `${Math.round(rate(m) * 100)}%`, more: `${Math.round(rate(m) * 100)}% · O/U ${m.oW}-${m.oL}` })),
  };
}

// Season stats: a case of trophy tiles, two across. Each tile shows the
// leader and where the viewer stands; a tap opens the full ranking, with
// a bar for each player. Side bets sit underneath, off the books.
const seasonOpenTiles = new Set();
async function renderSeasonStats() {
  const panel = document.getElementById("season-panel");
  if (!panel || panel.classList.contains("hidden")) return;
  const [weeks, sideHist] = await Promise.all([fetchSeasonLedger(), fetchSideHistory()]);
  if (!weeks) { panel.innerHTML = `<div class="pot-empty">Could not reach the record. Try again in a moment.</div>`; return; }
  if (!weeks.length && !GAMES.some(isGameLocked) && !sideHist.length) { panel.innerHTML = `<div class="pot-empty">Nothing on the record yet. Stats appear once a week seals.</div>`; return; }
  // Locked games with no pick in the week in progress, unless that week
  // is already sealed and counted above.
  const liveBlanks = {};
  const sealedNow = weeks.some((w) => w.week === currentWeek);
  if (!sealedNow) {
    const picks = lastGoodCloudPicks || {};
    for (const name of MANAGERS) {
      const st = picks[name] || { picks: {} };
      const n = GAMES.filter((g) => isGameLocked(g) && !st.picks?.[g.id]).length;
      if (n) liveBlanks[name] = n;
    }
  }
  const s = seasonStats(weeks, liveBlanks);
  const side = sideSeasonStats(sideHist);
  const esc = escapeCd;
  const me = currentManager;
  const av = (n, cls = "") => `<span class="hs-av ${cls}" style="--accent:${accentFor(n)}">${esc(avatarOverrides[n] || shown(n)[0])}</span>`;
  // Competition rank on the shown value, so a tie reads as a tie.
  const ranked = (rows) => rows.map((r) => ({ ...r, rank: 1 + rows.filter((x) => (r.low ? x.n < r.n : x.n > r.n)).length }));
  const ORD = (k) => `${k}${k % 100 >= 11 && k % 100 <= 13 ? "TH" : ["TH", "ST", "ND", "RD"][k % 10] || "TH"}`;
  const tile = (key, icon, label, note, rows, color, art = key) => {
    const list = ranked(rows);
    const open = seasonOpenTiles.has(key);
    const lead = list[0];
    const tied = lead ? list.filter((r) => r.rank === 1).length - 1 : 0;
    const mine = list.find((r) => r.name === me);
    const top = Math.max(...list.map((r) => Math.abs(r.n)), 0) || 1;
    const lo = Math.min(...list.map((r) => r.n));
    const width = (r) => Math.max(6, Math.round(100 * (r.low ? (lo || 0.1) / (r.n || 0.1) : Math.abs(r.n) / top)));
    const full = !open ? "" : `<div class="hs-full"><div class="hs-note">${note}</div>${list.map((r) => `<div class="hs-r${r.name === me ? " me" : ""}${r.rank === 1 ? " first" : ""}"><i class="hs-rk">${r.rank}</i>${av(r.name)}<span class="hs-nm">${esc(shown(r.name))}</span><span class="hs-bar"><u class="${r.signed && r.n < 0 ? "neg" : ""}" style="width:${width(r)}%"></u></span><b class="hs-v${r.signed ? (r.n > 0 ? " up" : r.n < 0 ? " down" : "") : ""}">${esc(r.value)}<small>${esc(r.more || r.sub || "")}</small></b></div>`).join("")}</div>`;
    // The tile art is pixel art cut from the league's own template, one
    // per board; the emoji stands in if it fails to load.
    return `<div class="hs-tile${open ? " open" : ""}${!lead ? " empty" : ""}" style="--c:${color}">
      <button type="button" class="hs-tap" data-hs="${key}" aria-expanded="${open}">
        <span class="hs-art"><img src="${awardArt(`hs/${art}`)}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('i'),{textContent:'${icon}'}))"></span>
        <span class="hs-body">
          <span class="hs-t-head"><span>${label}</span><em>${lead ? (open ? "▴" : "▾") : ""}</em></span>
          ${lead ? `<span class="hs-name"><b>${esc(shown(lead.name))}</b>${tied ? `<i title="tied with ${tied} more">+${tied}</i>` : ""}</span>
          <span class="hs-line"><small>${esc(lead.sub || "")}</small><strong class="${lead.signed && lead.n < 0 ? "down" : ""}">${esc(lead.value)}</strong></span>
          <span class="hs-you">${mine && mine.rank > 1 ? `YOU · ${ORD(mine.rank)} · ${esc(mine.value)}` : mine ? "YOU LEAD" : `${list.length} RANKED`}</span>` : `<span class="hs-none">NOBODY YET</span>`}
        </span>
      </button>${full}</div>`;
  };
  panel.innerHTML = `<div class="hs-marquee"><span>★ HIGH SCORES ★</span><small>${weeks.length} WEEK${weeks.length === 1 ? "" : "S"} ON THE RECORD · TAP A BOARD FOR EVERYONE</small></div>
    <div class="hs-grid">
      ${tile("ats", "🎯", "BEST ATS", "Spread picks, at least 3", s.ats, "var(--neon-green)")}
      ${tile("streak", "🔥", "HOT HAND", "Correct picks in a row, right now", s.streak, "#ff9f1c")}
      ${tile("dogs", "🐶", "DOG HITS", "Underdogs straight up, 3 pts each", s.dogs, "var(--neon-pink)")}
      ${tile("lone", "🐺", "LONE WOLF", "Correct with 3 or fewer on the team", s.lone, "var(--neon-purple)")}
      ${tile("fader", "🙃", "FADER", "Share of picks against the favorite", s.fader, "var(--neon-cyan)")}
      ${tile("tb", "📏", "TB SNIPER", "Average tiebreaker miss, lower is better", s.tb, "var(--neon-yellow)")}
      ${tile("best", "🏆", "BEST WEEK", "Highest single week score", s.best, "#3fd0ff")}
      ${s.blanks.length ? tile("blanks", "💤", "NO SHOWS", "Games left unpicked", s.blanks, "#a77bff") : ""}
    </div>
    <div class="hs-side">
      <div class="hs-side-h"><img src="${awardArt("hs/coins")}" alt="" loading="lazy" decoding="async"><span>SIDE BETS</span><small>OFF THE BOOKS · ${side.bets} BET${side.bets === 1 ? "" : "S"}</small></div>
      <div class="hs-side-note">Their own record. Side bets never count toward pool standings, payouts or the boards above.</div>
      <div class="hs-grid">
        ${tile("side-bank", "💵", "BANKROLL", "Money won or lost across side bets", side.bank, "var(--neon-green)", "bank")}
        ${tile("side-picks", "🎲", "SIDE PICKS", "Side bet picks right, over/unders included", side.picks, "var(--neon-yellow)", "dice")}
      </div>
    </div>`;
}
document.getElementById("season-panel")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-hs]");
  if (!b) return;
  const k = b.dataset.hs;
  if (seasonOpenTiles.has(k)) seasonOpenTiles.delete(k); else { seasonOpenTiles.add(k); track("hs-board", { event: true, d: k }); }
  renderSeasonStats();
});
(() => {
  const toggle = document.getElementById("season-toggle");
  const panel = document.getElementById("season-panel");
  if (!toggle || !panel) return;
  let open = false;
  const paint = () => {
    panel.classList.toggle("hidden", !open);
    toggle.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) { panel.innerHTML = `<div class="pot-empty">Reading the record…</div>`; renderSeasonStats(); }
  };
  toggle.addEventListener("click", (e) => { open = !open; paint(); if (open && e.isTrusted) track("season-open", { event: true }); });
  paint();
})();

// --- Update check -----------------------------------------------------
// Added to the Home Screen the app runs standalone: no Safari chrome, so
// no reload button, so no way to pick up a new build short of force
// quitting. The app knows its own version from the stamp on its script
// tag, and version.json carries whatever is deployed; when they differ
// there is something to reload and the bar says so.
const APP_VERSION = (() => {
  try { return new URL(document.currentScript.src).searchParams.get("v") || ""; }
  catch { return ""; }
})();

function showUpdateBar() {
  document.getElementById("update-bar")?.classList.remove("hidden");
}

// A plain reload can be served the same cached index.html, which would
// leave the bar showing and nothing changed. A fresh query cannot.
function reloadFresh() {
  // A live page preview keeps what it was showing.
  if (window.__liveView) { const u = new URL(location.href); u.searchParams.set("r", String(Date.now())); location.replace(u.href); return; }
  location.replace(location.pathname + `?r=${Date.now()}` + location.hash);
}

// `quiet` is true at the two moments nobody is mid-tap: first paint, and
// the app coming back to the foreground. A stale build then reloads
// itself. Found mid-session, it shows the bar and waits for the tap.
const RELOADED_KEY = "brochiefs_reloaded_for";
async function checkForUpdate(quiet = false) {
  if (!APP_VERSION) return; // no stamp to compare against, so nothing to say
  try {
    // Cache-busted, or the check itself is the stale thing.
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (!(data && typeof data.v === "string" && data.v && data.v !== APP_VERSION)) return;
    let already = "";
    try { already = sessionStorage.getItem(RELOADED_KEY) || ""; } catch { /* private mode */ }
    // One automatic reload per build. If the cache still hands back the
    // old index.html after that, the bar takes over rather than a loop.
    // Found mid-session: reload too, but only once the person is idle, so
    // nobody is yanked out of a pick or a sheet. Until then the bar shows.
    if (already !== data.v && (quiet || !userBusy())) {
      try { sessionStorage.setItem(RELOADED_KEY, data.v); } catch { /* private mode */ }
      reloadFresh();
      return;
    }
    showUpdateBar();
    if (already !== data.v) updateWaiting = true;
  } catch { /* offline, or the file is not there yet: say nothing */ }
}

document.getElementById("update-bar")?.addEventListener("click", reloadFresh);

// Offline shell (sw.js). It serves the page network first and stamped
// files by stamp, so the update check above keeps working unchanged.
// updateViaCache "none" means a fix to sw.js reaches phones on the next
// visit rather than after the HTTP cache expires.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  const registerSw = () => navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  if (document.readyState === "complete") registerSw(); else addEventListener("load", registerSw);
}

// Force refresh, from the admin console. The Worker holds a flush time;
// a newer one than this phone last acted on makes it drop its offline copy
// (service worker and caches) and reload fresh. Only at the quiet moments
// below, never mid-pick. A phone that sees the switch for the first time
// just remembers it, so shipping this reloads nobody.
const FLUSH_KEY = "brochiefs_flush_applied";
async function checkForFlush() {
  if (!WORKER_URL) return;
  try {
    const res = await fetch(`${WORKER_URL}/app-control?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const flush = Number((await res.json())?.flush) || 0;
    if (!flush) return;
    let applied = null;
    try { applied = localStorage.getItem(FLUSH_KEY); localStorage.setItem(FLUSH_KEY, String(flush)); } catch { return; } // can't remember it: never risk a loop
    if (applied === null || Number(applied) >= flush) return;
    try { for (const r of (await navigator.serviceWorker?.getRegistrations()) || []) await r.unregister(); } catch {}
    try { if (window.caches) for (const k of await caches.keys()) if (/^brochiefs-/.test(k)) await caches.delete(k); } catch {}
    reloadFresh();
  } catch { /* offline: next time */ }
}

checkForUpdate(true);
checkForFlush();
// Standalone apps are suspended rather than closed, so coming back to one
// is the moment a new build is most likely to be waiting, and the moment
// a reload costs nothing.
document.addEventListener("visibilitychange", () => { if (!document.hidden) { checkForUpdate(true); checkForFlush(); } });
// Idle means: no sheet or popup open, not typing, no touch or scroll in
// the last 20 seconds. A waiting build reloads at the first idle moment.
let lastInteract = Date.now(), updateWaiting = false;
["pointerdown", "keydown", "scroll", "touchmove"].forEach((ev) => addEventListener(ev, () => { lastInteract = Date.now(); }, { passive: true, capture: true }));
function userBusy() {
  if (Date.now() - lastInteract < 20000) return true;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
  return !![...document.querySelectorAll(".modal-overlay, .wpx-overlay, .np-screen, #sim-modal")].find((el) => !el.classList.contains("hidden") && getComputedStyle(el).display !== "none");
}
// Once a minute: cheap (a tiny static file), and a deploy reaches an open
// screen within a minute or two of going live.
setInterval(() => { if (!document.hidden) checkForUpdate(false); }, 60 * 1000);
setInterval(() => { if (updateWaiting && !userBusy()) checkForUpdate(false); }, 10 * 1000);

// The splash shows once per 12 hours per device. Inside that window the
// app opens straight to where the tap would have landed, and from the
// week's first kickoff on it never shows to a known player.
const SPLASH_KEY = "brochiefs_splash_seen_v1";
const SPLASH_TTL = 12 * 60 * 60 * 1000;
// A signed-in player goes straight to the scoreboard: this week's games
// and the last board from this phone draw at once, and fresh ones replace
// them as they land. No splash, at any point in the week.
function goToScoresNow() {
  logoScreen.classList.add("hidden");
  loginScreen.classList.add("hidden");
  homeHeader.classList.remove("hidden");
  bottomNav.classList.remove("hidden");
  currentManager = loadMe();
  updateMePill();
  // A new slate with nothing kicked off yet: picks first. Once the week is
  // under way, the scoreboard.
  if (GAMES.length && !firstKickoffPassed()) showPicksScreen(); else showScoreboard();
  document.documentElement.classList.remove("known");
}
(async () => {
  const fast = !!loadMe() && !window.__adminEntry && !window.__liveView;
  if (fast) {
    restoreCachedSlate();
    lastSlateSignature = slateSignature();
    if (GAMES.length) { loadBootBoard(); goToScoresNow(); }
  }
  const routed = fast && GAMES.length > 0;
  // Fetch this week's slate before anything renders, so nobody sees last
  // week's games flash past. The splash covers the wait. Whether login is
  // live, and who has claimed a name, comes down in the same breath.
  // The week's trophies are decoration and draw themselves when they land,
  // so nothing waits on them. Once the slate is in, the board's picks and
  // scores start loading at once, so a game day open finds them ready.
  loadWeekSummaries();
  await Promise.all([
    loadSlate().then(() => { if (firstKickoffPassed()) { fetchLiveScores().catch(() => {}); fetchBoardPicks().catch(() => {}); } }),
    refreshAuthState(),
  ]);
  const slateChanged = routed && slateSignature() !== lastSlateSignature;
  lastSlateSignature = slateSignature();
  lastLockSignature = lockSignature();
  renderManagerPicker();
  if (routed) {
    // Already on the board: redraw only if the network's slate differs
    // from the one this phone had (a new week, a changed game).
    // The saved slate was last week's: the new one is open for picks, so
    // go there instead of the old board.
    if (slateChanged && !firstKickoffPassed() && !scoreboardScreen.classList.contains("hidden")) { showPicksScreen(); return; }
    if (slateChanged && !scoreboardScreen.classList.contains("hidden")) withScrollPreserved(renderScoreboard);
    return;
  }
  if (fast) { goToScoresNow(); return; }

  let last = 0;
  try { last = Number(localStorage.getItem(SPLASH_KEY)) || 0; } catch {}
  const fresh = Date.now() - last < SPLASH_TTL;
  const mark = () => { try { localStorage.setItem(SPLASH_KEY, String(Date.now())); } catch {} };
  // Skip the splash only when nothing else is due. The day's poster
  // follows the splash tap; it never jumps in over an untapped splash.
  // Once the week's first game has kicked off, a known player skips the
  // splash entirely and lands on the scoreboard.
  if (window.__liveView) {
    startLiveView();
  } else if (loadMe() && (firstKickoffPassed() || (fresh && !nowPlayingDue()))) {
    goToPlayerSelect();
  } else {
    track("/splash");
    logoScreen.addEventListener("click", mark, { once: true });
  }
})();

// The live page's preview: straight to the screen or sheet it names, as
// someone just looking would see it now. view: scoreboard, history,
// trivia, game (x = game id), card or path (x = a manager), h2h.
async function startLiveView() {
  const view = window.__liveView, x = new URLSearchParams(location.search).get("x") || "";
  document.body.classList.add("live-view");
  logoScreen.classList.add("hidden");
  homeHeader.classList.remove("hidden");
  bottomNav.classList.remove("hidden");
  currentManager = null;
  if (view === "history") return showHistory();
  if (view === "trivia") return showTrivia();
  showScoreboard();
  const until = async (ok, ms = 10000) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 100)); return ok(); };
  if (!(await until(() => liveWeekRows.length))) return;
  const who = MANAGERS.find((n) => n === x);
  if (view === "game" && GAMES.some((g) => String(g.id) === x)) openInsights(Number(x));
  else if (view === "card" && who) {
    expandedRankings.add(who);
    await renderScoreboard();
    document.querySelector(`.rd-path-btn[data-path="${CSS.escape(who)}"]`)?.closest(".ranking-row")?.scrollIntoView({ block: "start" });
  } else if (view === "path" && who && (await until(() => winChanceMemo.ctx))) openPathCard(who);
  else if (view === "h2h") openH2H();
}

// The bottom nav always wins: tapping a tab closes any sheet or popup that
// is up (game info, head to head, grid check, the Game Box sim) and then
// goes where the tab says. Sign-in and admin prompts are left alone.
(() => {
  const nav = document.getElementById("bottom-nav");
  if (!nav) return;
  const SHEETS = ["insights-modal", "h2h-modal", "grid-modal", "sim-modal", "rules-modal", "avatar-modal", "boner-modal"];
  nav.addEventListener("click", (e) => {
    if (!e.target.closest(".nav-btn")) return;
    for (const id of SHEETS) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains("hidden")) el.classList.add("hidden");
    }
    window.closeSim?.();
  }, true);
})();

// Avatars live on the Worker; pull them on open and whenever the app comes
// back to the front, so a change on one phone shows on every other.
syncAvatars();
document.addEventListener("visibilitychange", () => { if (!document.hidden) syncAvatars(); });

// What people read without tapping: the replay, the pot and the season
// stats each count once a visit when most of it has been on screen.
(() => {
  if (!("IntersectionObserver" in window)) return;
  const SEEN = { "recap-panel": "recap-seen", "payouts-panel": "pot-seen", "season-panel": "season-seen", "rankings-list": "board-seen", "live-scores-list": "scores-seen" };
  const done = new Set();
  const io = new IntersectionObserver((list) => {
    for (const en of list) {
      const k = SEEN[en.target.id];
      if (!k || done.has(k) || !en.isIntersecting || en.target.classList.contains("hidden")) continue;
      clearTimeout(en.target.__seenT);
      en.target.__seenT = setTimeout(() => { if (!done.has(k) && !en.target.classList.contains("hidden")) { done.add(k); track(k, { event: true }); } }, 1500);
    }
    for (const en of list) if (!en.isIntersecting) clearTimeout(en.target.__seenT);
  }, { threshold: 0.35 });
  for (const id of Object.keys(SEEN)) { const el = document.getElementById(id); if (el) io.observe(el); }
})();

// --- Insight: where people get stuck ----------------------------------------
// Named events only, never positions or screen recordings. Each lands in the
// admin visit log (brochiefs.com/live) like any other use.
//   rage        three or more fast taps on the same thing
//   dead-tap    a tap on something that looks like it does something but does nothing
//   quick-exit  a sheet closed within 2 seconds of opening
//   sheet-time  how long a sheet stayed open (3 seconds or more)
//   depth       how far down a screen they scrolled, on leaving it
//   js-error    a script error they ran into
(() => {
  if (window.__liveView || /[?&]studio\b/.test(location.search)) return;
  const label = (el) => {
    let host = el.closest?.("button, a, [role=button], [data-sec], [id], [class]") || el;
    if (!host || host === document.documentElement || host === document.body) host = el;
    if (host === document.documentElement || host === document.body) return "the background";
    const txt = String(host.getAttribute?.("aria-label") || host.innerText || host.alt || "").split("\n")[0].replace(/\s+/g, " ").trim().slice(0, 22);
    const tag = host.id ? `#${host.id}` : `.${String(host.className || host.tagName).split(" ")[0]}`;
    return `${tag}${txt ? ` “${txt}”` : ""}`.slice(0, 40);
  };
  const interactive = (el) => !!el.closest?.("button, a, input, select, textarea, label, summary, [role=button], [onclick], [data-sec], [tabindex]") || getComputedStyle(el).cursor === "pointer";
  // Rage: 3 taps inside 1 second within 30px.
  let taps = [], rageAt = 0;
  // Dead: a tap on a non interactive element that changes nothing on screen.
  let mutated = false;
  new MutationObserver(() => { mutated = true; }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  let deadAt = 0;
  document.addEventListener("pointerdown", (e) => {
    const now = Date.now();
    taps = taps.filter((t) => now - t.t < 1000 && Math.hypot(t.x - e.clientX, t.y - e.clientY) < 30);
    taps.push({ t: now, x: e.clientX, y: e.clientY });
    if (taps.length >= 3 && now - rageAt > 3000) { rageAt = now; taps = []; track("rage", { event: true, d: label(e.target) }); }
    const el = e.target;
    if (!(el instanceof Element) || interactive(el) || !(el.textContent || "").trim() && el.tagName !== "IMG") return;
    // Looks tappable: an image, a logo, a badge, a name, a number.
    if (!el.closest("img, [class*=logo], [class*=badge], [class*=chip], [class*=score], [class*=name], [class*=card], [class*=row]")) return;
    // A tap in the gap of a container that holds buttons (a card's row, the
    // space between bets) is a near miss, not a dead control.
    if (el.querySelector?.("button, a, [role=button]")) return;
    mutated = false;
    setTimeout(() => { if (!mutated && Date.now() - deadAt > 5000) { deadAt = Date.now(); track("dead-tap", { event: true, d: label(el) }); } }, 700);
  }, { capture: true, passive: true });
  // Sheets: time open, and closed almost at once.
  const opened = new Map();
  const watch = (m) => new MutationObserver(() => {
    const open = !m.classList.contains("hidden");
    if (open && !opened.has(m)) opened.set(m, Date.now());
    else if (!open && opened.has(m)) {
      const ms = Date.now() - opened.get(m); opened.delete(m);
      if (ms < 2000) track("quick-exit", { event: true, d: m.id });
      else if (ms >= 3000) track("sheet-time", { event: true, d: `${m.id}:${Math.round(ms / 1000)}` });
    }
  }).observe(m, { attributes: true, attributeFilter: ["class"] });
  document.querySelectorAll(".modal-overlay[id], .wpx-overlay[id]").forEach(watch);
  // Depth: deepest point reached on each screen, in quarters, sent on leaving it.
  const scroller = () => document.getElementById("app-scroll") || document.scrollingElement;
  let screen = null, deepest = 0;
  const flush = () => {
    if (screen && deepest > 0) track("depth", { event: true, d: `${screen}:${deepest}` });
    deepest = 0;
  };
  const measure = () => {
    const sc = scroller(); if (!sc) return;
    const max = sc.scrollHeight - sc.clientHeight;
    const pct = max <= 40 ? 100 : Math.min(100, Math.ceil(((sc.scrollTop + 1) / max) * 4) * 25);
    if (pct > deepest) deepest = pct;
  };
  (scroller() === document.scrollingElement ? window : scroller())?.addEventListener("scroll", () => { cancelAnimationFrame(measure.r); measure.r = requestAnimationFrame(measure); }, { passive: true });
  const onScreen = (t) => { if (t === screen) return; flush(); screen = t; setTimeout(measure, 400); };
  const setNav = window.setActiveNav;
  if (typeof setNav === "function") window.setActiveNav = function (t) { onScreen(t); return setNav.apply(this, arguments); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) { measure(); flush(); } else if (screen) setTimeout(measure, 400); });
  // Errors they actually hit, once each per visit.
  const seenErr = new Set();
  const err = (m) => { const k = String(m || "error").slice(0, 40); if (seenErr.has(k) || seenErr.size > 5) return; seenErr.add(k); track("js-error", { event: true, d: k }); };
  addEventListener("error", (e) => { if (e.message) err(e.message); });
  addEventListener("unhandledrejection", (e) => err(e.reason?.message || e.reason));
})();

// --- Logos that stay put ---------------------------------------------
// The board, the picks list and the all picks table are redrawn from their
// HTML on every refresh, and a freshly made <img> is blank until it loads
// and decodes, so logos blinked out and back every few seconds. A redraw
// now moves each logo already on screen into the new layout in place of
// its fresh copy (same address, taking the fresh copy's attributes), so a
// logo on screen, painted or still loading, is never replaced.
function keepLogos(el, draw) {
  if (!el) return draw();
  const have = new Map();
  for (const img of el.querySelectorAll("img")) {
    // A logo still loading is kept too: moving it keeps its download, where
    // a fresh copy would start over (a saved board followed a second later
    // by the fresh one would otherwise blink every logo on open).
    if (img.complete && !img.naturalWidth) continue; // a broken one gets a fresh try
    const list = have.get(img.src) || [];
    list.push(img); have.set(img.src, list);
  }
  const out = draw();
  if (!have.size) return out;
  for (const fresh of el.querySelectorAll("img")) {
    const old = have.get(fresh.src)?.shift();
    if (!old || old === fresh) continue;
    for (const a of [...old.attributes]) if (a.name !== "src") old.removeAttribute(a.name);
    for (const a of fresh.attributes) if (a.name !== "src") old.setAttribute(a.name, a.value);
    fresh.replaceWith(old);
  }
  return out;
}
// Every redraw anywhere keeps the logos already on screen. Live
// screens repaint every few seconds, and a fresh <img> blanks until it
// loads, which shifts everything under it.
{
  const d = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  let inside = false;
  Object.defineProperty(Element.prototype, "innerHTML", {
    configurable: true, get: d.get,
    set(v) {
      if (inside || !this.isConnected || !this.getElementsByTagName("img").length) return d.set.call(this, v);
      inside = true;
      try { keepLogos(this, () => d.set.call(this, v)); } finally { inside = false; }
    },
  });
}
const withLogosKept = (fn, el) => function (...args) { return keepLogos(el(), () => fn.apply(this, args)); };
renderLiveScores = withLogosKept(renderLiveScores, () => liveScoresList);
renderScoreboardTable = withLogosKept(renderScoreboardTable, () => scoreboardTable);
renderRankings = withLogosKept(renderRankings, () => rankingsList);
renderPicksScreen = withLogosKept(renderPicksScreen, () => gamesList);
