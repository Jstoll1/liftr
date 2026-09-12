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
  const suWinner = awayScore > homeScore ? game.away : game.home;
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

const STORAGE_KEY_BASE = "brochiefs_picks_v1";
// Local picks are namespaced per week from week 2 on, so a device holding
// last week's card cannot leak it into the new one.
const storageKey = () => (currentWeek === 1 ? STORAGE_KEY_BASE : `${STORAGE_KEY_BASE}_w${currentWeek}`);

// Kickoff dates confirmed against each team's published 2026 schedule:
// Week 1 Saturday slate is Sept 5, 2026; the Louisville/Ole Miss "Music
// City Kickoff" is Sunday, Sept 6, 2026.
// ESPN team IDs, used to hotlink official logos from ESPN's CDN
// (a.espncdn.com/i/teamlogos/ncaa/500/<id>.png) — nothing downloaded or
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

// Pull the current slate from the Worker. Keeps the built-in week 1 if the
// Worker is unreachable or has nothing stored, so the app never shows an
// empty board.
async function loadSlate(week) {
  if (!WORKER_URL) return false;
  try {
    const q = week ? `?week=${week}&` : "?";
    const res = await fetch(`${WORKER_URL}/games${q}t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.weeks && Array.isArray(data.weeks.list)) weekList = data.weeks.list;
    if (!Array.isArray(data.games) || !data.games.length) return false;
    GAMES = data.games;
    currentWeek = data.week || currentWeek;
    WEEK_LABEL = data.label || `Week ${currentWeek}`;
    return true;
  } catch {
    return false;
  }
}
function weekIsFinal() {
  const results = computeLiveResults(latestLive);
  return GAMES.every((g) => results[g.id]);
}

function logoUrl(espnId) {
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnId}.png`;
}

const MANAGERS = [
  "Robert", "Logan", "Jordan", "Conlan", "Dewitt",
  "Nissan", "Skills", "Jake", "Curt", "Andrew",
];

const AVATAR_COLORS = ["#ff2079", "#05d9e8", "#c13cff", "#ffe45e", "#39ff88"];

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

function isGameLocked(game) {
  return Date.now() >= new Date(game.kickoff).getTime();
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

async function pushManagerState(manager, state, { attempts = 3 } = {}) {
  if (!WORKER_URL) return false;
  setSyncStatus("saving");
  // Read, merge, then write: only this device's newer picks go up, and a
  // stale copy of the other games never overwrites what the cloud holds.
  // Locked games are always taken from the cloud.
  let toSend = state;
  try {
    const cloud = await fetchAllPicks();
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
        try { localStorage.removeItem(PENDING_KEY); } catch {}
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

async function fetchAllPicks() {
  if (!WORKER_URL) return null;
  try {
    const res = await fetch(`${WORKER_URL}/picks?week=${currentWeek}&t=${Date.now()}`, { cache: "no-store" });
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
function parseEspnEvents(events) {
  const byId = {};
  GAMES.forEach((game) => {
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
    byId[game.id] = {
      id: game.id,
      found: true,
      state: statusType.state || "pre",
      completed: !!statusType.completed,
      rawStatus: { comp: { name: st1.name, state: st1.state, completed: st1.completed, detail: st1.shortDetail }, event: { name: st2.name, state: st2.state, completed: st2.completed, detail: st2.shortDetail } },
      detail: statusType.shortDetail || statusType.detail || "",
      period: comp.status?.period ?? null,
      clock: comp.status?.displayClock ?? null,
      awayScore: away?.score != null ? Number(away.score) : null,
      homeScore: home?.score != null ? Number(home.score) : null,
      winProb,
    };
  });
  return byId;
}

async function fetchLiveFromEspn() {
  const events = [];
  for (const date of espnScoreboardDates()) {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}&groups=80&limit=300&t=${Date.now()}`,
      { cache: "no-store" }
    );
    if (!res.ok) continue;
    const data = await res.json();
    if (Array.isArray(data?.events)) events.push(...data.events);
  }
  return parseEspnEvents(events);
}

async function fetchLiveFromWorker() {
  if (!WORKER_URL) return {};
  const res = await fetch(`${WORKER_URL}/live?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return {};
  const data = await res.json();
  const byId = {};
  (data.games || []).forEach((g) => {
    if (g && g.found) byId[g.id] = g;
  });
  return byId;
}

// Latest live map, shared with the picks screen so locked games there show
// the score without their own fetch.
let latestLive = {};
async function fetchLiveScores() {
  let live = {};
  try {
    live = await fetchLiveFromEspn();
  } catch (err) {
    console.warn("ESPN direct fetch failed, falling back to Worker", err);
  }
  if (!Object.keys(live).length) {
    try { live = await fetchLiveFromWorker(); } catch { live = {}; }
  }
  if (Object.keys(live).length) latestLive = live;
  return live;
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
  const cloud = await fetchAllPicks();
  if (!cloud) return;
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
  all[name] = merged;
  saveAll(all);
  // If local held an open-game pick the cloud did not, send it up.
  if (remote && JSON.stringify(merged.picks) !== JSON.stringify(remote.picks)) pushManagerState(name, merged);
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
  const accent = AVATAR_COLORS[(idx >= 0 ? idx : 0) % AVATAR_COLORS.length];
  const av = (typeof avatarOverrides !== "undefined" && avatarOverrides[me]) || me[0];
  pill.innerHTML = `<span class="me-pill-avatar" style="--accent:${accent}">${av}</span><span class="me-pill-name">${me.toUpperCase()}</span>`;
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
    ? `Enter the code you set for ${name}.`
    : `Nobody has claimed ${name} yet. Pick a code of six characters or more — you will need it on every device.`;
  document.getElementById("code-owner").textContent = name.toUpperCase();
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
}
appScroll.addEventListener("scroll", syncHeaderSize, { passive: true });
const savedScroll = {};
let activeScreenName = null;
function rememberScroll() {
  if (activeScreenName) savedScroll[activeScreenName] = appScroll.scrollTop;
}
// Call rememberScroll() BEFORE hiding the current screen: once it's
// hidden the page shrinks and the browser clamps scrollY to the top.
function enterScreen(name) {
  activeScreenName = name;
  const y = savedScroll[name] ?? 0;
  appScroll.scrollTop = y;
  // async renders can grow the page after this tick; pin again once painted
  requestAnimationFrame(() => { appScroll.scrollTop = savedScroll[name] ?? 0; syncHeaderSize(); });
  renderHeaderCountdown();
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
function track(path, extra) {
  try {
    if (!window.goatcounter || typeof window.goatcounter.count !== "function") return;
    window.goatcounter.count({ path, title: extra?.title || path, event: !!extra?.event });
  } catch {}
}

// Keeps the bottom tab bar's highlighted tab in sync, however the
// screen got navigated to (top links, bottom nav, or the wordmark).
let lastTrackedScreen = null;
function setActiveNav(target) {
  if (target !== lastTrackedScreen) { lastTrackedScreen = target; track(`/${target}`); }
  [navPicksBtn, navScoreboardBtn, navHistoryBtn, navTriviaBtn].forEach((btn) => btn.classList.remove("active"));
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

logoScreen.addEventListener("click", goToPlayerSelect);


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

// Already unlocked in this tab: straight back to that surface. Otherwise
// the key decides.
function requestAdmin() {
  if (adminRole) { openRole(adminRole); return; }
  if (!adminGate) return;
  const input = document.getElementById("admin-gate-key");
  if (input) input.value = "";
  setAdminGateStatus("");
  adminGate.classList.remove("hidden");
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
async function submitAdminKey() {
  const input = document.getElementById("admin-gate-key");
  const key = input?.value.trim();
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
  if (!role) { setAdminGateStatus(status === 403 ? "That key is not right." : err || "The Worker could not check that key.", "bad"); return; }
  adminRole = role;
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

document.getElementById("admin-gate-ok")?.addEventListener("click", submitAdminKey);
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
  tag.src = "admin.js?v=202609172200";
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

// --- The app console (the app owner's key only) -----------------------
function openAppConsole() {
  if (adminRole !== "app") return;
  if (consoleScriptLoaded) { window.showAppConsole?.(); return; }
  consoleScriptLoaded = true;
  const tag = document.createElement("script");
  tag.src = "console.js?v=202609172200";
  // console.js shows itself once it loads.
  tag.onerror = () => { consoleScriptLoaded = false; window.alert("Could not load the console."); };
  document.body.appendChild(tag);
}

// What the console needs from the running app: the verified key, a picture
// of this device, and the few actions that belong to the app rather than
// the Worker.
window.appConsoleKey = () => (adminRole === "app" ? adminKeyHeld : "");
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
    "Live feed": latestLiveAt ? `${Object.keys(latestLive).length} games · ${latestLiveSource} · ${new Date(latestLiveAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "not fetched yet",
    "Sync": syncStatus + (queued ? ` · queued for ${queued}` : ""),
    "Login token": loadAuth() ? `held for ${loadAuth().manager}` : "none",
    "Login mode": authState.mode,
    "Worker": WORKER_URL || "not configured",
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
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(PENDING_KEY); } catch {}
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
document.getElementById("me-pill")?.addEventListener("click", openOwnerPicker);

navPicksBtn.addEventListener("click", () => {
  if (!currentManager) {
    goHome();
    return;
  }
  rememberScroll();
  historyScreen.classList.add("hidden");
  triviaScreen.classList.add("hidden");
  scoreboardScreen.classList.add("hidden");
  loginScreen.classList.add("hidden");
  picksScreen.classList.remove("hidden");
  renderPicksScreen();
  setActiveNav("picks");
  enterScreen("picks");
  syncManagerFromCloud(currentManager).then(() => { if (!picksScreen.classList.contains("hidden")) withScrollPreserved(renderPicksScreen); });
});

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
let avatarOverrides = {};

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

async function pushAvatar(manager, emoji) {
  if (!WORKER_URL) return;
  try {
    await fetch(`${WORKER_URL}/avatars`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manager, emoji }),
    });
  } catch {
    // Offline or worker unreachable — local copy still saved, fine.
  }
}

async function resetAvatar(manager) {
  if (!WORKER_URL) return;
  try {
    await fetch(`${WORKER_URL}/avatars?manager=${encodeURIComponent(manager)}`, { method: "DELETE" });
  } catch {
    // Offline or worker unreachable.
  }
}

async function renderManagerPicker() {
  const local = loadAll();
  const cloud = await fetchAllPicks();
  const all = cloud ? { ...local, ...cloud } : local; // cloud wins where it has data
  // Once games have started the roster shows points instead of pick counts.
  if (firstKickoffPassed() && !Object.keys(latestLive).length) { try { await fetchLiveScores(); } catch {} }
  const pickerResults = firstKickoffPassed() ? computeLiveResults(latestLive) : {};
  const scored = Object.keys(pickerResults).length > 0;

  const localAvatars = loadAvatars();
  const cloudAvatars = await fetchAvatars();
  avatarOverrides = cloudAvatars ? { ...localAvatars, ...cloudAvatars } : localAvatars;
  saveAvatars(avatarOverrides);
  updateMePill();

  managerPicker.innerHTML = "";
  MANAGERS.forEach((name, i) => {
    const state = all[name];
    const submittedCount = state ? Object.keys(sanitizePicks(state.picks)).length : 0;
    const tiebreakerDone = !!(state && String(state.tiebreaker || "").trim() !== "");
    const complete = submittedCount === GAMES.length && tiebreakerDone;
    const partial = !complete && (submittedCount > 0 || tiebreakerDone);

    const isChamp = name === "Jake";
    const isMe = name === currentManager;
    const accent = AVATAR_COLORS[i % AVATAR_COLORS.length];
    const avatarContent = avatarOverrides[name] || name[0];

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
        <span class="manager-name">${name}</span>
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
  avatarEditPreview.textContent = current || name[0];
  avatarEditPreview.style.setProperty("--accent", accent);
  avatarEmojiInput.value = current;
  avatarModal.classList.remove("hidden");
  avatarEmojiInput.focus();
}

function closeAvatarEditor() {
  avatarModal.classList.add("hidden");
  editingAvatarManager = null;
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
  if (val) {
    avatarOverrides[editingAvatarManager] = val;
    saveAvatars(avatarOverrides);
    await pushAvatar(editingAvatarManager, val);
  }
  closeAvatarEditor();
  renderManagerPicker();
});

avatarResetBtn.addEventListener("click", async () => {
  if (!editingAvatarManager) return;
  delete avatarOverrides[editingAvatarManager];
  saveAvatars(avatarOverrides);
  await resetAvatar(editingAvatarManager);
  closeAvatarEditor();
  renderManagerPicker();
});

// --- "Who are you?" confirm --------------------------------------------
// The one deliberate step that locks a device to a name. Shown on first
// visit, and again any time someone taps a card that isn't theirs.

let pendingIdentity = null;

// Compact "Who are you?" for a device with no saved identity. Fires on
// entry from the splash and again if they head for Picks, Scores or
// History without choosing. "Just looking" hides it for this visit.
let openClaimPrompt = function () {
  if (loadMe() || claimSkippedThisVisit) return false;
  claimGrid.innerHTML = MANAGERS.map((name, idx) => {
    const accent = AVATAR_COLORS[idx % AVATAR_COLORS.length];
    const av = avatarOverrides[name] || name[0];
    return `<button type="button" class="claim-btn" data-name="${name}"><span class="claim-avatar" style="--accent:${accent}">${av}</span>${name}</button>`;
  }).join("");
  claimGrid.querySelectorAll(".claim-btn").forEach((btn) => btn.addEventListener("click", async () => {
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
  document.getElementById("claim-subtext").textContent = me ? `This phone is ${me}. Tap a name to switch.` : "Tap your name.";
  claimSkipBtn.textContent = "Cancel";
  claimGrid.innerHTML = MANAGERS.map((name, idx) => {
    const accent = AVATAR_COLORS[idx % AVATAR_COLORS.length];
    const av = avatarOverrides[name] || name[0];
    return `<button type="button" class="claim-btn${name === me ? " current" : ""}" data-name="${name}"><span class="claim-avatar" style="--accent:${accent}">${av}</span>${name}${name === me ? '<span class="claim-you">YOU</span>' : ""}</button>`;
  }).join("");
  claimGrid.querySelectorAll(".claim-btn").forEach((btn) => btn.addEventListener("click", async () => {
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
  document.getElementById("claim-title").textContent = "WHO ARE YOU?";
  document.getElementById("claim-subtext").textContent = "Pick your name once and this phone will remember you.";
  claimSkipBtn.textContent = "Just looking for now";
  return _openClaimPrompt();
};
claimModal.addEventListener("click", (e) => { if (e.target === claimModal) { claimSkippedThisVisit = true; claimModal.classList.add("hidden"); } });

function openIdentityConfirm(name, accent) {
  pendingIdentity = name;
  identityPreview.textContent = avatarOverrides[name] || name[0];
  identityPreview.style.setProperty("--accent", accent);
  identityText.textContent = currentManager
    ? `Switch from ${currentManager} to ${name}? This device will remember ${name} from now on.`
    : `Lock in as ${name}? This device will remember you — use SWITCH later if you need to change.`;
  identityConfirmBtn.textContent = currentManager ? `Switch to ${name}` : `That's me`;
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
  rememberScroll();
  historyScreen.classList.add("hidden");
  triviaScreen.classList.add("hidden");
  currentManager = name;
  saveMe(name);
  loginScreen.classList.add("hidden");
  scoreboardScreen.classList.add("hidden");
  picksScreen.classList.remove("hidden");
  renderPicksScreen();
  setActiveNav("picks");
  enterScreen("picks");
  syncManagerFromCloud(currentManager).then(() => { if (!picksScreen.classList.contains("hidden")) withScrollPreserved(renderPicksScreen); });
  await syncManagerFromCloud(name);
  withScrollPreserved(renderPicksScreen);
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
// Straight Up buttons sit together in the middle (inner side, next to
// each other across the center line) and the Spread buttons flank the
// outer edges — so the two "modes" each read as one visual row.
function teamCardHtml(game, team, teamId, isFavorite, side, draft) {
  const spreadDisplay = isFavorite ? `-${game.spread}` : `+${game.spread}`;
  const suPts = pointValue(game, team, "SU");
  const atsSelected = pickEqual(draft, { team, mode: "ATS" });
  const suSelected = pickEqual(draft, { team, mode: "SU" });

  const atsBtn = `
    <button class="pick-mini-btn ats ${atsSelected ? "selected" : ""}" type="button" data-team="${team}" data-mode="ATS">
      <span class="pick-mini-label">SPREAD</span>
      <span class="pick-mini-value">${spreadDisplay}</span>
      <span class="pick-mini-pts">2 PT</span>
    </button>
  `;
  const suBtn = `
    <button class="pick-mini-btn su ${isFavorite ? "risk-low" : "risk-high"} ${suSelected ? "selected" : ""}" type="button" data-team="${team}" data-mode="SU">
      <span class="pick-mini-label">STRAIGHT UP</span>
      <span class="pick-mini-value">${isFavorite ? "🟢 Chalk" : "🚨 Upset"}</span>
      <span class="pick-mini-pts">${suPts} PT</span>
    </button>
  `;
  // Away (left side): outer=ATS first, inner=SU second. Home (right
  // side): inner=SU first, outer=ATS second — puts both SU buttons
  // adjacent in the middle and both ATS buttons on the far edges.
  const buttons = side === "away" ? atsBtn + suBtn : suBtn + atsBtn;

  return `
    <div class="team-card">
      <div class="team-card-id">
        <img class="team-card-logo" src="${logoUrl(teamId)}" alt="" loading="lazy" onerror="this.style.display='none'" />
        <span class="team-card-name">${team}</span>
        <span class="team-card-spread">${spreadDisplay}</span>
      </div>
      <div class="team-card-buttons">${buttons}</div>
    </div>
  `;
}

function matchupCardsHtml(game, draft) {
  const awayIsFav = game.favorite === game.away;
  return `
    <div class="matchup-cards-row">
      ${teamCardHtml(game, game.away, game.awayId, awayIsFav, "away", draft)}
      ${teamCardHtml(game, game.home, game.homeId, !awayIsFav, "home", draft)}
    </div>
  `;
}

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
    return `<span class="lr-bet"><span class="lr-bet-check">✓</span>${terms}<span class="lr-bet-pts">${worth} PT</span></span>`;
  };
  const row = (side, name, id, score, other) => `<div class="lr-team ${pickedSide === side ? "picked" : ""}">
      <img class="lr-logo" src="${logoUrl(id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
      <span class="lr-name">${name}</span>
      ${pickedSide === side ? betBadge() : ""}
      <span class="lr-score ${finalRes && score !== null && score > other ? "win" : ""}">${score === null ? "–" : score}</span>
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
      pill = pushed ? `<span class="rd-pts push">PUSH</span>` : `<span class="rd-pts ${pts >= 3 ? "upset" : pts === 2 ? "hit2" : hit ? "hit" : "miss"}">${hit ? "+" + pts : "0"} PTS</span>`;
    } else if (prov !== null) {
      const hit = prov > 0;
      outcome = pick.mode === "ATS"
        ? `${short} ${liveByTxt} · ${resultOutcome(game, { awayScore: aS, homeScore: hS })?.push ? "on the number, a push right now" : hit ? "covering" : "not covering"} right now`
        : `${short} ${liveByTxt} · ${hit ? "winning" : "trailing"} right now`;
      pill = `<span class="rd-pts ${hit ? "lean-hit" : "lean-miss"}">${hit ? "+" + worth : "0"}?</span>`;
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
  return `<div class="locked-result ${finalRes ? "final" : liveG ? "live" : ""}">
    ${row("away", game.away, game.awayId, aS, hS)}
    ${row("home", game.home, game.homeId, hS, aS)}
    ${foot}
  </div>`;
}

function renderPicksScreen() {
  const state = getManagerState(currentManager);
  lastLockSignature = lockSignature();
  renderPicksCountdown();
  renderSyncBanner();

  gamesList.innerHTML = "";
  // Kickoff order, not the order the commissioner happened to tap them
  // in: the card at the top is always the next one to lock, which is what
  // the countdown above is counting down to.
  gamesByKickoff().forEach((game) => {
    const gameLocked = isGameLocked(game);
    const pick = state.picks[game.id];

    const card = document.createElement("div");
    card.className =
      "game-card" +
      (gameLocked ? " game-locked" : "") +
      (pick ? " game-submitted" : "") +
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
      statusLabel = "SAVED ✓";
      statusClass = "submitted";
    }

    const noteVerb = justSavedGameId === game.id && justSavedKind === "updated" ? "Updated" : "Saved";
    const note = pick && (pendingPushFor(currentManager) || (justSavedGameId === game.id && syncStatus === "failed"))
      ? `⚠ ${pickLabel(game, pick)} is on this phone but has not reached the league yet`
      : pick ? `✓ ${noteVerb}: ${pickLabel(game, pick)}${pickTimeLabel(pick) ? ` · ${pickTimeLabel(pick)}` : ""}` : "";

    card.innerHTML = `
      <div class="game-meta">
        <span>G${game.id} &middot; ${game.kickoffLabel} &middot; ${game.tv}</span>
        <span class="game-status ${statusClass}">${statusLabel}</span>
      </div>
      ${gameLocked ? lockedResultHtml(game, pick, finalRes, isLive ? g : null) : matchupCardsHtml(game, pick)}
      ${gameLocked || !note ? "" : `<div class="game-submit-row"><span class="game-submit-note">${note}</span></div>`}
    `;

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

  const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
  const tiebreakerLocked = isGameLocked(tiebreakerGame);
  // The label has to come from the slate: it named week 1's game while the
  // Worker was already serving a different week's tiebreaker.
  const tbLabel = document.querySelector("#picks-screen .tiebreaker-label");
  if (tbLabel) tbLabel.textContent = `TIEBREAKER — Total combined points, ${tiebreakerGame.awayShort} @ ${tiebreakerGame.homeShort} (G${tiebreakerGame.id})`;
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
  if (!tiebreakerLocked) tbText = guess ? `✓ Saved: ${guess}` : "Required — ties go to whoever is closest, and no guess loses every tie.";
  else if (!guess) tbText = `No tiebreaker entered — locked. Any tie this week is lost.${tbActual !== null ? ` · ${tbFinal ? "final" : "now"} ${tbActual}` : ""}`;
  else if (tbFinal) tbText = `Your guess: ${guess} · Final: ${tbActual} · off by ${Math.abs(Number(guess) - tbActual)}`;
  else if (tbLiveG && tbActual !== null) tbText = `Your guess: ${guess} · Now: ${tbActual} · off by ${Math.abs(Number(guess) - tbActual)}`;
  else tbText = `Your guess: ${guess} · waiting on kickoff`;
  tiebreakerStatus.textContent = tbText;

  updatePicksProgress(state);
}

function updatePicksProgress(state) {
  const totalPicked = Object.values(state.picks).filter(Boolean).length;
  const results = computeLiveResults(latestLive);
  const allFinal = GAMES.every((g) => results[g.id]);
  const allLocked = GAMES.every(isGameLocked);
  picksProgress.textContent = allFinal
    ? `${WEEK_LABEL} is final · you scored ${computeScore(state, results)} pts`
    : allLocked
      ? `${WEEK_LABEL} is locked · ${computeScore(state, results)} pts so far`
      : `${totalPicked} of ${GAMES.length} games picked` + (state.tiebreaker ? " · tiebreaker set" : " · tiebreaker MISSING");

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
  const needsTb = !allLocked && !String(state.tiebreaker ?? "").trim();
  tbWarn.classList.toggle("hidden", !needsTb);
  if (needsTb) {
    const done = totalPicked >= GAMES.length;
    tbWarn.innerHTML = `<b>⚠ No tiebreaker set.</b> ${done ? "Your card is otherwise complete." : ""} Ties are decided by the closest guess at the tiebreaker game's total, so leaving it blank forfeits every tie this week.
      <button class="tb-jump" type="button">SET IT NOW</button>`;
    tbWarn.querySelector(".tb-jump")?.addEventListener("click", () => {
      tiebreakerInput.scrollIntoView({ block: "center", behavior: "smooth" });
      tiebreakerInput.focus();
    });
  }
  const hint = document.querySelector("#picks-screen .picks-hint");
  if (hint) hint.textContent = allLocked
    ? `${WEEK_LABEL} has kicked off and your card is locked. Scores and results update below as games finish.`
    : "One pick per game: straight up (1 pt favorite, 3 pt underdog) or against the spread (2 pts). Tap to save — change it any time until that game kicks off.";
  let warn = document.getElementById("picks-mismatch");
  if (!warn) { warn = document.createElement("button"); warn.id = "picks-mismatch"; warn.type = "button"; warn.className = "picks-mismatch"; picksProgress.insertAdjacentElement("afterend", warn); warn.addEventListener("click", () => restorePhonePicks(currentManager)); }
  if (lockedMismatch.length && phoneSnapshot[currentManager]) {
    const lines = lockedMismatch.map((m) => `G${m.id}: phone ${m.phone ? pickLabel(GAMES.find((g) => g.id === m.id), m.phone) : "none"} · cloud ${m.cloud ? pickLabel(GAMES.find((g) => g.id === m.id), m.cloud) : "none"}`);
    warn.innerHTML = `<b>⚠ This phone and the scoreboard disagree on ${lockedMismatch.length} locked game${lockedMismatch.length === 1 ? "" : "s"}</b><span>${lines.join("<br>")}</span><span class="picks-mismatch-cta">Tap to make this phone's picks the record (needs the admin key)</span>`;
    warn.classList.remove("hidden");
  } else {
    warn.classList.add("hidden");
  }
}

// Tiebreaker saves as you type (debounced), no button.
let tiebreakerSaveTimer = null;
tiebreakerInput.addEventListener("input", () => {
  clearTimeout(tiebreakerSaveTimer);
  tiebreakerSaveTimer = setTimeout(() => {
    if (!currentManager) return;
    const s = getManagerState(currentManager);
    s.tiebreaker = tiebreakerInput.value.trim();
    s.tiebreakerUpdatedAt = Date.now();
    setManagerState(currentManager, s);
    pushManagerState(currentManager, s);
    tiebreakerStatus.textContent = s.tiebreaker ? `✓ Saved: ${s.tiebreaker}` : "Saves as you type";
    updatePicksProgress(s);
  }, 500);
});


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

async function renderScoreboard() {
  const fetched = await fetchAllPicks();
  cloudPicksStale = fetched === null;
  const rawPicks = fetched !== null ? fetched : (lastGoodCloudPicks || {});
  const cloudPicks = {};
  MANAGERS.forEach((name) => {
    const state = rawPicks[name];
    if (state) cloudPicks[name] = { ...state, picks: sanitizePicks(state.picks) };
  });
  if (fetched !== null) lastGoodCloudPicks = rawPicks;
  const live = await fetchLiveScores();
  const results = computeLiveResults(live);

  archiveWeekIfFinal(results);
  renderLiveScores(live, cloudPicks);
  renderScoreboardTable(cloudPicks, results, live);
  const ranked = renderRankings(cloudPicks, results, live);
  liveWeekRows = ranked;
  liveWeekFinal = GAMES.length > 0 && GAMES.every((g) => results[g.id]);
  renderMyScore(ranked, cloudPicks, live);
  renderWeekChamp(ranked, results);
  renderInsertCoin(cloudPicks);
  const stamp = document.getElementById("scoreboard-updated");
  if (stamp) {
    const src = Object.keys(live).length ? "ESPN" : "no live data";
    const stale = cloudPicksStale ? " · ⚠ picks not reloaded" : "";
    stamp.textContent = `updated ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })} · ${src}${stale} · tap to refresh`;
    stamp.classList.toggle("stale", cloudPicksStale);
    stamp.classList.remove("busy");
  }
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

// Which scorebugs the viewer has expanded to see the pick lists. Kept
// across the 30s refresh so the board doesn't snap shut mid-read.
const expandedGames = new Set();
// Last scores seen per game, so a changed number gets the arcade pop.
const lastScores = {};

function namesListHtml(names) {
  if (names.length === 0) return `<span class="bug-name-line none">&mdash;</span>`;
  return names.map((n) => `<span class="bug-name-line${n === currentManager ? " me" : ""}">${n}</span>`).join("");
}

// Name chips: avatar initial (or emoji) plus name, wrapping as a unit.
function nameChips(names) {
  return names.map((n) => {
    const idx = MANAGERS.indexOf(n);
    const accent = AVATAR_COLORS[(idx >= 0 ? idx : 0) % AVATAR_COLORS.length];
    const av = avatarOverrides[n] || n[0];
    return `<span class="pick-chip${n === currentManager ? " me" : ""}"><span class="pick-chip-av" style="--accent:${accent}">${av}</span>${n}</span>`;
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
    return pts > 0 ? `<span class="pick-pill ${pts >= 3 ? "upset" : pts === 2 ? "hit2" : "hit"}">+${pts}</span>` : `<span class="pick-pill miss">✗</span>`;
  };
  const rows = [];
  if (ats.length) rows.push(`<div class="bug-pick-group"><span class="bug-pick-tagline"><span class="bug-pick-tag ats">SPREAD ${spreadTxt}</span>${pill("ATS")}</span><div class="pick-chips">${nameChips(ats)}</div></div>`);
  if (su.length) rows.push(`<div class="bug-pick-group"><span class="bug-pick-tagline"><span class="bug-pick-tag su">STRAIGHT UP</span>${pill("SU")}</span><div class="pick-chips">${nameChips(su)}</div></div>`);
  return `
    <div class="bug-side">
      <div class="bug-side-head"><span>${short}</span><span class="bug-side-count">${ats.length + su.length}</span></div>
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
  return t;
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
  // Compact scorebugs in a 2-up grid, every game from the start. Tap a
  // bug to expand the who-picked-what lists (only once that game has
  // kicked off). A red pulsing dot marks games that are live right now.
  const ordered = gamesByKickoff();
  const liveCount = ordered.filter((g) => { const l = live[g.id]; return isGameLocked(g) && l && l.found && l.state === "in" && !l.completed; }).length;
  // Live count rides in the top bar title instead of a section heading.
  const title = document.getElementById("scoreboard-title");
  if (title) {
    const allFinal = ordered.every((g) => { const l = live[g.id]; return l && l.found && l.completed; });
    title.innerHTML = liveCount > 0
      ? `📡 SCOREBOARD <span class="live-dot"></span> ${liveCount} LIVE`
      : allFinal ? "🏁 FINAL SCOREBOARD" : "📡 LIVE SCOREBOARD";
  }

  liveScoresList.innerHTML = `<div class="bug-grid ${liveCount > 0 ? "has-live" : ""}">` + ordered
    .map((game) => {
      const locked = isGameLocked(game);
      const g = live[game.id];
      const found = locked && g && g.found;
      const isLive = found && g.state === "in" && !g.completed;
      const isFinal = found && g.completed;
      const expanded = expandedGames.has(game.id);

      // Every kickoff on the slate is Eastern and the label says so once
      // at the top, so the per-card time drops the suffix to make room
      // for the channel the game is on.
      const timeOnly = game.kickoffLabel.replace(/^(Sat|Sun|Mon|Tue|Wed|Thu|Fri) /, "").replace(/ ET$/, "");
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

      const row = (team, short, id, score, lead, fav, pop) => `
        <div class="bug-row ${lead ? "leading" : ""} ${myPick && myPick.team === team ? "mine" : ""}">
          <img class="bug-logo" src="${logoUrl(id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
          <span class="bug-team">${short}</span>
          ${fav ? `<span class="bug-fav">-${game.spread}</span>` : `<span class="bug-fav dog"></span>`}
          <span class="bug-score ${pop ? "pop" : ""}">${score}</span>
        </div>`;

      const winProbHtml = isLive && g.winProb
        ? `<div class="win-prob-bar"><div class="win-prob-fill away" style="width:${g.winProb.away}%"></div><div class="win-prob-fill home" style="width:${g.winProb.home}%"></div></div>
           <div class="win-prob-labels"><span>${Math.round(g.winProb.away)}% ${game.awayShort}</span><span>${Math.round(g.winProb.home)}% ${game.homeShort}</span></div>`
        : "";

      const detail = !expanded ? "" : locked
        ? `<div class="bug-detail">
             ${bugSideDetail(cloudPicks, game, game.away, game.awayShort, isFinal ? { awayScore: g.awayScore, homeScore: g.homeScore } : null)}
             ${bugSideDetail(cloudPicks, game, game.home, game.homeShort, isFinal ? { awayScore: g.awayScore, homeScore: g.homeScore } : null)}
             ${winProbHtml}
           </div>`
        : `<div class="bug-detail"><span class="bug-hidden-note">🔒 Picks reveal at kickoff (${game.kickoffLabel})</span></div>`;

      const cls = ["scorebug", isLive ? "is-live" : "", isFinal ? "is-final" : "", !locked ? "upcoming" : "", expanded ? "expanded" : ""].join(" ");
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
        let tone = "pending", dot = "", face = `${worth}<span class="stake-u">PT</span>`;
        if (pts !== null) {
          tone = pushed ? "push" : pts > 0 ? "hit" : "miss";
          face = pushed ? "P" : pts > 0 ? `+${pts}` : `${worth}<span class="stake-u">PT</span>`;
        } else if (lean !== null) {
          tone = lean > 0 ? "covering" : "slipping";
          dot = `<span class="stake-dot"></span>`;
        }
        myPill = `<span class="stake ${tone}" title="You took ${mine} ${terms} for ${worth} pt">${dot}${face}</span>`;
      }
      return `
        <div class="${cls}" data-game="${game.id}" role="button" tabindex="0" aria-expanded="${expanded}">
          <div class="bug-head">
            <span class="bug-gnum">G${game.id}</span>
            <span class="bug-status">${statusText}</span>${tvTag}
            ${myPill}
          </div>
          ${row(game.away, game.awayShort, game.awayId, awayScore, awayLead, awayFav, awayPop)}
          ${row(game.home, game.homeShort, game.homeId, homeScore, homeLead, !awayFav, homePop)}

          ${detail}
        </div>
      `;
    })
    .join("") + `</div>`;

  liveScoresList.querySelectorAll(".scorebug").forEach((el) => {
    const id = Number(el.dataset.game);
    const toggle = () => {
      if (expandedGames.has(id)) expandedGames.delete(id); else { expandedGames.add(id); track("scorebug-expand", { event: true }); }
      withScrollPreserved(() => renderLiveScores(live, cloudPicks));
    };
    el.addEventListener("click", toggle);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  });
}

function renderScoreboardTable(cloudPicks, results, live = {}) {
  // One ordered list for the header and every row, so the columns read
  // left to right in kickoff order and stay aligned with their labels.
  const ordered = gamesByKickoff();
  const headCells = ordered.map((g) => `<th class="${results[g.id] ? "final" : isGameLocked(g) ? "live" : ""}">G${g.id}</th>`).join("");
  let html = `<thead><tr><th class="manager-col">Team</th>${headCells}<th>TB</th><th>PTS</th></tr></thead><tbody>`;

  MANAGERS.forEach((name) => {
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
      const pill = pts === null ? "" : pushed ? `<span class="pick-pill push">P</span>` : pts >= 3 ? `<span class="pick-pill upset">+3</span>` : pts === 2 ? `<span class="pick-pill hit2">+2</span>` : pts > 0 ? `<span class="pick-pill hit">+1</span>` : `<span class="pick-pill miss">✗</span>`;
      const under = pts === null ? spreadTag : pill;
      return `<td class="pick-cell ${cls}" title="${short} ${pick.mode}${pick.mode === "ATS" ? ` ${pick.team === game.favorite ? "-" : "+"}${game.spread}` : ""}${pts !== null ? ` · ${pts} pt` : ""}"><span class="pick-mark"><img class="pick-cell-logo" src="${logoUrl(pickId)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pick-cell-short',textContent:'${short}'}))" /></span>${under}</td>`;
    }).join("");

    const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
    const tbVisible = isGameLocked(tiebreakerGame);
    const tbCell = tbVisible ? (state.tiebreaker || "—") : "🔒";
    // Count only games on this week's slate. Counting every key in the
    // picks object lets a leftover from another week inflate the number,
    // so the leaderboard and the All Picks grid could disagree.
    const submittedCount = GAMES.filter((g) => state.picks[g.id]).length;

    html += `<tr class="${name === currentManager ? "is-me" : ""}"><td class="manager-col">${name} <span class="ranking-lock">(${submittedCount}/${GAMES.length})</span></td>${cells}<td>${tbCell}</td><td><strong>${total}</strong></td></tr>`;
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

function playerBreakdownHtml(name, state, results, live) {
  const ordered = gamesByKickoff();
  let banked = 0, liveCovering = 0, liveOpen = 0;
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
      pickHtml = `<span class="rd-pickcard locked">🔒 LOCKED</span>`;
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
        ptsHtml = pushed ? `<span class="rd-pts push">PUSH</span>` : pts >= 3 ? `<span class="rd-pts upset">+3</span>` : pts === 2 ? `<span class="rd-pts hit2">+2</span>` : pts > 0 ? `<span class="rd-pts hit">+1</span>` : `<span class="rd-pts miss">0</span>`;
      } else if (isLive && Number.isFinite(g.awayScore) && Number.isFinite(g.homeScore) && (g.awayScore || g.homeScore)) {
        const prov = scorePick(game, pick, { awayScore: g.awayScore, homeScore: g.homeScore });
        liveOpen += 1;
        if (prov > 0) { liveCovering += 1; ptsHtml = `<span class="rd-pts lean-hit">+${worth}?</span>`; }
        else ptsHtml = `<span class="rd-pts lean-miss">0?</span>`;
      }
    }
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
  const tbGame = GAMES.find((g) => g.tiebreakerGame);
  const tbRaw = String(state.tiebreaker ?? "").trim();
  const tbGuess = tbRaw === "" ? null : Number(tbRaw);
  const tbRes = results[tbGame.id];
  const tbLive = !tbRes && live[tbGame.id] && live[tbGame.id].found && live[tbGame.id].state === "in" ? live[tbGame.id] : null;
  const actual = tbRes ? tbRes.awayScore + tbRes.homeScore : tbLive && Number.isFinite(tbLive.awayScore) && Number.isFinite(tbLive.homeScore) ? tbLive.awayScore + tbLive.homeScore : null;
  // Every guess stays sealed until the game kicks off, including your
  // own: a screen shared over someone's shoulder leaks it just the same.
  const tbSealed = !isGameLocked(tbGame);
  let tbStatus;
  if (tbSealed) tbStatus = `<span class="rd-tb-miss wait">SEALED UNTIL KICKOFF</span>`;
  else if (tbGuess === null) tbStatus = `<span class="rd-tb-miss none">NO GUESS</span>`;
  else if (tbRes) tbStatus = `<span class="rd-tb-miss">FINAL ${actual} · OFF BY <b>${Math.abs(tbGuess - actual)}</b></span>`;
  else if (tbLive) tbStatus = `<span class="rd-tb-miss live">NOW ${actual} · OFF BY ${Math.abs(tbGuess - actual)}</span>`;
  else tbStatus = `<span class="rd-tb-miss wait">WAITING ON KICKOFF</span>`;
  // Built on the same columns as the rows above it, so the label sits
  // under GAME and the guess under PICK rather than the two being flung
  // to opposite edges of a box.
  const tbRow = `<div class="rd-tb">
    <span class="rd-tb-label">TIEBREAKER<br /><b>G${tbGame.id} ${tbGame.awayShort} @ ${tbGame.homeShort}</b> TOTAL</span>
    <span class="rd-tb-right"><span class="rd-tb-guess">${tbSealed ? "🔒" : tbGuess === null ? "–" : tbGuess}</span>${tbStatus}</span>
  </div>`;
  const summary = `<div class="rd-summary"><span>BANKED <b>${banked}</b></span>${liveOpen ? `<span>LIVE <b>${liveCovering}/${liveOpen}</b> COVERING</span>` : ""}</div>`;
  return `<div class="rank-detail"><div class="rd-head"><span>GAME</span><span>PICK</span><span>PTS</span></div>${rows}${tbRow}${summary}</div>`;
}

// Second line under a leaderboard name. How many picks are in is fair
// game: it says who still has work to do, not what they chose. The
// tiebreaker guess is a number to bid against, so it stays sealed for
// everyone until that game kicks off.
function rankingSubline(row, actualTotal, tbGame) {
  const parts = [];
  if (row.submittedCount < GAMES.length) parts.push(`${row.submittedCount}/${GAMES.length} PICKED`);
  if (isGameLocked(tbGame)) {
    if (row.tbGuess === null) parts.push("NO TIEBREAKER");
    else if (actualTotal === null) parts.push(`TB ${row.tbGuess}`);
    else parts.push(`TB ${row.tbGuess} · OFF BY ${row.tbDiff}`);
  }
  return parts.join(" · ");
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
  const sealed = Object.values(weekSummaries).filter((s) => s && s.complete);
  const rows = new Map(MANAGERS.map((n) => [n, { name: n, weeksWon: 0, earned: 0, points: 0, played: 0 }]));
  for (const s of sealed) {
    const share = (s.winners || []).length ? POT.weekly / s.winners.length : 0;
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
  const { list, sealed, done, contested, liveWeek, liveWeekFinal } = payoutLedger();
  const paid = list.reduce((a, r) => a + r.earned, 0);
  const left = POT.total - paid - POT.seasonTotal;
  panel.innerHTML = `
    <div class="pot-head">
      <div class="pot-stat"><b>${money(POT.total)}</b><span>${POT.members} × ${money(POT.buyIn)}</span></div>
      <div class="pot-stat"><b>${money(POT.weekly)}</b><span>per week · ${POT.weeks} weeks</span></div>
      ${POT.season.length
        ? `<div class="pot-stat"><b>${POT.season.map(money).join(" / ")}</b><span>season ${POT.season.length > 1 ? "1st / 2nd" : "champion"}</span></div>`
        : `<div class="pot-stat"><b>1ST ONLY</b><span>${POT.total === POT.weeklyTotal ? "winner takes the week" : money(POT.total - POT.weeklyTotal) + " unallocated"}</span></div>`}
    </div>
    <div class="pot-note">${sealed} of ${POT.weeks} weeks settled · ${money(paid)} paid out · ${money(Math.max(0, left))} still to play for${POT.season.length && !done ? " weekly · season money is a projection" : ""}</div>
    ${liveWeek ? `<div class="pot-live">${liveWeekFinal ? `WEEK ${liveWeek} UNSEALED` : `WEEK ${liveWeek} ACTIVE`}</div>` : ""}
    ${contested ? `<div class="pot-warn">⚠ Season places are tied on points where the money sits. The weekly tiebreaker does not settle the season, so the league needs a rule for this before the last week.</div>` : ""}
    <div class="pot-table">
      <div class="pot-row head"><span>#</span><span>MANAGER</span><span>PTS</span><span>WON</span><span>EARNED</span></div>
      ${list.map((r) => `<div class="pot-row${r.name === currentManager ? " me" : ""}${r.seasonPrize ? " inmoney" : ""}">
        <span class="pot-place">${r.tied ? "T" : ""}${r.seasonPlace}</span>
        <span class="pot-name">${r.name.toUpperCase()}${r.seasonPrize ? `<span class="pot-proj">+${money(r.seasonPrize)} ${done ? "" : "proj"}</span>` : ""}</span>
        <span class="pot-pts"><b>${r.points}</b><i class="pot-livemark">${r.livePoints ? "•" : ""}</i></span>
        <span class="pot-won">${r.weeksWon ? "🏆".repeat(Math.min(r.weeksWon, 3)) + (r.weeksWon > 3 ? `×${r.weeksWon}` : "") : "–"}</span>
        <span class="pot-earned">${r.earned ? money(r.earned) : "–"}</span>
      </div>`).join("")}
    </div>
    ${sealed ? "" : `<div class="pot-empty">No weeks settled yet. Earnings appear once a week's last game is final.</div>`}`;
}

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

async function loadWeekSummaries() {
  if (!WORKER_URL) return;
  try {
    const res = await fetch(`${WORKER_URL}/weeks?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    weekTrophies = data.trophies || {};
    weekSummaries = data.summaries || {};
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

// One 🏆 per week won, and a count once there are too many to read at a
// glance.
function trophiesFor(name) {
  const n = weekTrophies[name] || 0;
  if (!n) return "";
  const label = `${n} week${n === 1 ? "" : "s"} won`;
  const face = n <= 4 ? "🏆".repeat(n) : `🏆<span class="rank-trophy-x">×${n}</span>`;
  return `<span class="rank-trophies" title="${label}" aria-label="${label}">${face}</span>`;
}

function renderRankings(cloudPicks, results, live = {}) {
  const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
  const tbResult = results[tiebreakerGame.id];
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
    row.subline = rankingSubline(row, actualTotal, tiebreakerGame);
  });

  rankingsList.innerHTML = "";
  renderRankingRows(rows, cloudPicks, results, live);
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
  const names = top.map((r) => r.name.toUpperCase()).join(" & ");
  el.innerHTML = `<span class="wc-label"><span class="wc-rule"></span>${WEEK_LABEL.toUpperCase()} HIGH SCORE<span class="wc-rule"></span></span><span class="wc-line"><span class="wc-name">${names}</span><span class="wc-pts">${String(rows[0].score).padStart(2, "0")}<small>PTS</small></span></span>`;
  el.classList.remove("hidden");
}

// "1UP" strip under the refresh line: the viewer's score and place, in
// arcade type. Tap jumps to their leaderboard row.
function renderMyScore(rows, cloudPicks = {}, live = {}) {
  const el = document.getElementById("my-score");
  if (!el) return;
  const me = currentManager && rows.find((r) => r.name === currentManager);
  if (!me) { el.classList.add("hidden"); return; }
  // Banked points sit at zero until games go final, which reads as a
  // contradiction next to a scorebug saying a pick is covering. Count what
  // is still in flight separately and show both.
  let inFlight = 0;
  const mine = cloudPicks[currentManager]?.picks || {};
  for (const game of GAMES) {
    const g = live[game.id];
    if (!g || !g.found || g.state !== "in" || g.completed) continue;
    if (!Number.isFinite(g.awayScore) || !Number.isFinite(g.homeScore)) continue;
    const pick = mine[game.id];
    if (!pick) continue;
    const pts = scorePick(game, pick, { awayScore: g.awayScore, homeScore: g.homeScore });
    if (pts > 0) inFlight += pts;
  }
  el.innerHTML = `<span class="ms-rank">${me.tied ? "T-" : ""}${ordinal(me.place)}</span><span class="ms-name">${me.name.toUpperCase()}</span><span class="ms-score">${String(me.score).padStart(2, "0")} PTS</span>${inFlight ? `<span class="ms-live"><span class="stake-dot"></span>+${inFlight} LIVE</span>` : ""}`;
  el.classList.remove("hidden");
}
document.getElementById("my-score")?.addEventListener("click", () => {
  const row = [...document.querySelectorAll(".ranking-row")].find((r) => r.querySelector(".ranking-name")?.textContent.startsWith((currentManager || "").toUpperCase()));
  row?.scrollIntoView({ block: "center", behavior: "smooth" });
});

function renderRankingRows(rows, cloudPicks, results, live) {
  rows.forEach((row, i) => {
    const open = expandedRankings.has(row.name);
    const div = document.createElement("div");
    div.className = "ranking-row" + (i === 0 && row.score > 0 ? " rank-1" : "") + (row.name === currentManager ? " is-me" : "") + (open ? " open" : "");
    div.innerHTML = `
      <div class="ranking-main" role="button" tabindex="0" aria-expanded="${open}">
        <span class="ranking-place">${row.tied ? "T-" : ""}${ordinal(row.place)}</span>
        <span class="ranking-name"><span class="rank-nameline"><span class="rank-who">${row.name.toUpperCase()}</span>${trophiesFor(row.name)}</span><span class="ranking-lock">${row.subline}</span></span>
        <span class="ranking-dots" aria-hidden="true"></span>
        <span class="ranking-score">${String(row.score).padStart(2, "0")}</span>
        <span class="ranking-caret">${open ? "▴" : "▾"}</span>
      </div>
      ${open ? playerBreakdownHtml(row.name, row.state, results, live) : ""}
    `;
    div.querySelector(".ranking-main").addEventListener("click", () => {
      if (expandedRankings.has(row.name)) expandedRankings.delete(row.name); else { expandedRankings.add(row.name); track("ranking-expand", { event: true }); }
      withScrollPreserved(() => renderRankings(cloudPicks, results, live));
    });
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
  const label = next.id === first.id ? "1ST KICKOFF" : "NEXT KICKOFF";
  const game = `${next.awayShort} at ${next.homeShort} · ${next.kickoffLabel}`;
  // Under an hour the whole slate is about to lock, so the strip goes hot.
  el.className = "picks-countdown" + (cd.ms < 3600000 ? " soon" : "");
  el.innerHTML = `<span class="cd-label">${label}</span><span class="cd-clock">${cd.text}</span><span class="cd-game">${escapeCd(game)}</span>`;
}

function escapeCd(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// The same clock, shrunk into the header for every page except Picks,
// which already carries the full strip above the slate. Tapping it goes
// to Picks, since that is what the deadline is for.
// The chip is a reminder, not a status display. It shows up only when the
// viewer has something left to do before the slate locks: a game
// unpicked or no tiebreaker. Games in progress are already reported by
// the scoreboard title and the score strip, so it stays out of the way
// once the week is underway.
function renderHeaderCountdown() {
  const el = document.getElementById("header-countdown");
  if (!el) return;
  const hide = () => { el.classList.add("hidden"); el.innerHTML = ""; };
  if (!picksScreen.classList.contains("hidden") || !currentManager) return hide();

  const next = gamesByKickoff().find((g) => !isGameLocked(g));
  if (!next) return hide();
  const cd = kickoffCountdown(next.kickoff);
  if (!cd || cd.past) return hide();

  const state = getManagerState(currentManager);
  const unpicked = GAMES.filter((g) => !isGameLocked(g) && !state.picks[g.id]).length;
  const noTb = !String(state.tiebreaker ?? "").trim();
  if (!unpicked && !noTb) return hide();

  const what = unpicked ? `${unpicked} TO PICK` : "NO TB";
  el.className = "head-cd" + (cd.ms < 3600000 ? " soon" : "");
  el.innerHTML = `<span class="hcd-dot"></span>${what}`;
  el.title = `${cd.text} to ${next.awayShort} at ${next.homeShort}`;
  el.dataset.go = "picks";
  el.classList.remove("hidden");
}

document.getElementById("header-countdown")?.addEventListener("click", (e) => {
  if (e.currentTarget.dataset.go === "scores") navScoreboardBtn?.click();
  else navPicksBtn?.click();
});

// Its own second-by-second timer, separate from the 20s refresh: the clock
// has to move, but nothing else on the page needs redrawing that often.
setInterval(() => {
  if (!currentManager) return;
  if (!picksScreen.classList.contains("hidden")) renderPicksCountdown();
  renderHeaderCountdown();
}, 1000);

// Re-render periodically so games auto-lock the moment kickoff passes,
// and the scoreboard/rankings stay live without a manual refresh.
// Background refresh. The picks list only redraws when a game's lock
// state actually flips (a kickoff), so it never yanks the page out from
// under someone mid-scroll for no reason. The board is meant to be live,
// so it refreshes every tick, but keeps the scroll position.
setInterval(() => {
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
    renderPayouts();
  } else if (picksScreen.classList.contains("hidden") && GAMES.some((g) => isGameLocked(g))) {
    // Nowhere near the board, but the header chip still reports live
    // games, so keep the numbers behind it honest.
    fetchLiveScores().then(renderHeaderCountdown);
  }
  flushPendingPush();
}, 20000);

// Timers pause while the phone is locked or the app is in the background.
// Refresh the moment it comes back so the board never shows stale scores.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  flushPendingPush();
  if (!scoreboardScreen.classList.contains("hidden")) withScrollPreserved(renderScoreboard);
  if (currentManager && !picksScreen.classList.contains("hidden")) fetchLiveScores().then(() => withScrollPreserved(renderPicksScreen));
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted && !scoreboardScreen.classList.contains("hidden")) withScrollPreserved(renderScoreboard);
});


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
  toggle.addEventListener("click", () => { open = !open; paint(); if (open) track("pot-open", { event: true }); });
  paint();
})();

// The splash shows once per 12 hours per device. Inside that window the
// app opens straight to where the tap would have landed.
const SPLASH_KEY = "brochiefs_splash_seen_v1";
const SPLASH_TTL = 12 * 60 * 60 * 1000;
(async () => {
  // Fetch this week's slate before anything renders, so nobody sees last
  // week's games flash past. The splash covers the wait. Whether login is
  // live, and who has claimed a name, comes down in the same breath.
  await Promise.all([loadSlate(), refreshAuthState(), loadWeekSummaries()]);
  lastLockSignature = lockSignature();
  renderManagerPicker();

  let last = 0;
  try { last = Number(localStorage.getItem(SPLASH_KEY)) || 0; } catch {}
  const fresh = Date.now() - last < SPLASH_TTL;
  const mark = () => { try { localStorage.setItem(SPLASH_KEY, String(Date.now())); } catch {} };
  if (fresh && loadMe()) {
    goToPlayerSelect();
  } else {
    track("/splash");
    logoScreen.addEventListener("click", mark, { once: true });
  }
})();
