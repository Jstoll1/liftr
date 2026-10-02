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

// ESPN ships a second cut of every logo drawn for dark backgrounds
// (navy and black marks such as Penn State get a light outline or a
// white fill). The app is dark everywhere, so that cut is the default;
// an <img> that fails to load it falls back to the standard file below.
function logoUrl(espnId) {
  return `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${espnId}.png`;
}
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.src.includes("/500-dark/")) return;
  img.src = img.src.replace("/500-dark/", "/500/");
}, true);

const MANAGERS = [
  "Robert", "Logan", "Jordan", "Conlan", "Dewitt",
  "Nissan", "Skills", "Jake", "Curt", "Andrew",
];

const AVATAR_COLORS = ["#ff2079", "#05d9e8", "#c13cff", "#ffe45e", "#39ff88"];

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
        try { lastPushEcho = (await res.json())?.state || null; } catch { lastPushEcho = null; }
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
      winProb,
      // Where the ball is, for the live view on the sheet.
      awayColor: away?.team?.color ? `#${away.team.color}` : null,
      homeColor: home?.team?.color ? `#${home.team.color}` : null,
      situation: comp.situation ? {
        down: Number.isFinite(Number(comp.situation.down)) ? Number(comp.situation.down) : null,
        distance: Number.isFinite(Number(comp.situation.distance)) ? Number(comp.situation.distance) : null,
        yardLine: Number.isFinite(Number(comp.situation.yardLine)) ? Number(comp.situation.yardLine) : null,
        possessionId: comp.situation.possession != null ? Number(comp.situation.possession) : null,
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
  const accent = AVATAR_COLORS[(idx >= 0 ? idx : 0) % AVATAR_COLORS.length];
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
  const show = headerCompact && activeScreenName === "scoreboard" && !!headScoreHtml;
  el.innerHTML = show ? headScoreHtml : "";
  el.classList.toggle("hidden", !show);
  // The wordmark gives up a few pixels while the score is beside it.
  homeHeader.classList.toggle("has-score", show);
  if (show) renderHeaderCountdown();
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
  tag.src = "admin.js?v=202610022319";
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
  tag.src = "console.js?v=202610022319";
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
  maybeShowGridCheck();
  return syncManagerFromCloud(currentManager).then((cloud) => {
    if (!picksScreen.classList.contains("hidden")) withScrollPreserved(renderPicksScreen);
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
  // Fetched whether or not anything has kicked off: the feed carries each
  // team's poll rank, which the board and the picks cards show all week.
  if (!Object.keys(latestLive).length) { try { await fetchLiveScores(); } catch {} }
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
    const av = avatarOverrides[name] || shown(name)[0];
    return `<button type="button" class="claim-btn" data-name="${name}"><span class="claim-avatar" style="--accent:${accent}">${av}</span>${shown(name)}</button>`;
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
    const av = avatarOverrides[name] || shown(name)[0];
    return `<button type="button" class="claim-btn${name === me ? " current" : ""}" data-name="${name}"><span class="claim-avatar" style="--accent:${accent}">${av}</span>${shown(name)}${name === me ? '<span class="claim-you">YOU</span>' : ""}</button>`;
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
      <div class="tm-id">
        <span class="tm-logo-wrap"><img class="tm-logo" src="${logoUrl(teamId)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />${rankBadge(teamId === game.awayId ? latestLive[game.id]?.awayRank : latestLive[game.id]?.homeRank)}</span>
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
  const live = latestLive[game.id] || {};
  const side = (team, teamId, isFavorite, short, rank, record) => {
    const sign = isFavorite ? "-" : "+";
    const line = `${sign}${game.spread}`;
    const lineHtml = `<span class="pk-line"><i class="pk-sign">${sign}</i>${game.spread}</span>`;
    const suPts = pointValue(game, team, "SU");
    const atsSelected = pickEqual(draft, { team, mode: "ATS" });
    const suSelected = pickEqual(draft, { team, mode: "SU" });
    const pts = (n) => `<span class="pk-pts">${n}<i>PT</i></span>`;
    const id = `<div class="hz-tm${atsSelected || suSelected ? " picked" : ""}">
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
      pill = `<span class="rd-pts lean ${hit ? ptsValueTier(worth) : "miss"}">${hit ? "+" + worth : "0"}?</span>`;
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
    if (state) cloudPicks[name] = { ...state, picks: sanitizePicks(state.picks) };
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
  const state = getManagerState(currentManager);
  lastLockSignature = lockSignature();
  renderPicksCountdown();
  renderSyncBanner();
  renderPicksStanding();

  gamesList.innerHTML = "";
  // Kickoff order, not the order the commissioner happened to tap them
  // in: the card at the top is always the next one to lock, which is what
  // the countdown above is counting down to.
  gamesByKickoff().forEach((game) => {
    const gameLocked = isGameLocked(game);
    const pick = state.picks[game.id];

    const card = document.createElement("div");
    card.dataset.gameId = game.id;
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
  if (!tiebreakerLocked) tbText = !guess ? "Required — ties go to whoever is closest, and no guess loses every tie."
    : state.tiebreakerSavedToCloud === guess ? `✓ Saved to cloud: ${guess}`
    : `${guess} on this phone — tap SAVE to confirm it reached the cloud`;
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

async function renderScoreboard() {
  renderRecap(); // memoised on week and viewer, so this is cheap when nothing changed
  maybeShowBoner();
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
  // Ranked once and handed to both, so the table and the leaderboard
  // cannot end up in different orders.
  const ranked = rankManagers(cloudPicks, results);
  renderScoreboardTable(cloudPicks, results, live, ranked);
  renderRankings(cloudPicks, results, live, ranked);
  liveWeekRows = ranked;
  // The picks screen shows a one-line version of exactly these standings,
  // so it takes the board's copy rather than fetching its own again.
  picksStandingRows = ranked;
  picksStandingFinals = Object.keys(results).length > 0;
  liveWeekFinal = GAMES.length > 0 && GAMES.every((g) => results[g.id]);
  renderMyScore(ranked, cloudPicks, live);
  renderWeekChamp(ranked, results);
  renderInsertCoin(cloudPicks);
  // The clock lives inside the strip when there is one, so the board does
  // not spend a whole line on it. Seconds are gone: the poll is every 30,
  // so second-level precision was never true.
  const stamp = document.getElementById("scoreboard-updated");
  if (stamp) {
    const noData = !Object.keys(live).length;
    stamp.textContent = `${clockLabel()}${noData ? " · no live data" : ""}${cloudPicksStale ? " · ⚠ picks not reloaded" : ""} · tap to refresh`;
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
const expandedGames = new Set();
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
    const accent = AVATAR_COLORS[(idx >= 0 ? idx : 0) % AVATAR_COLORS.length];
    const av = avatarOverrides[n] || shown(n)[0];
    return `<span class="pick-chip${n === currentManager ? " me" : ""}"><span class="pick-chip-av" style="--accent:${accent}">${av}</span>${shown(n)}</span>`;
  }).join("");
}

// The expanded scorebug, read top to bottom: who the room is on, then one
// row per bet (team, terms, what it is worth, who holds it), each with a
// light that says whether it is cashing on the current score. Before the
// final the light is live (green cashing, pink not); after it the row
// says what it paid. Win probability sits last as context.
function bugPicksDetail(cloudPicks, game, res, isLive, isFinal, abbr) {
  const A = abbr("away"), H = abbr("home");
  const bets = [
    { team: game.away, side: "away", mode: "SU" },
    { team: game.away, side: "away", mode: "ATS" },
    { team: game.home, side: "home", mode: "ATS" },
    { team: game.home, side: "home", mode: "SU" },
  ].map((b) => ({ ...b, names: pickersFor(cloudPicks, game.id, b.team, b.mode) })).filter((b) => b.names.length);
  const nA = bets.filter((b) => b.side === "away").reduce((n, b) => n + b.names.length, 0);
  const nH = bets.filter((b) => b.side === "home").reduce((n, b) => n + b.names.length, 0);
  const tot = nA + nH;
  const outcome = res ? resultOutcome(game, res) : null;
  const row = (b) => {
    const fav = b.team === game.favorite;
    const terms = b.mode === "SU" ? "WIN" : `${fav ? "-" : "+"}${game.spread}`;
    const worth = pointValue(game, b.team, b.mode);
    let state = "", badge = `<span class="bp-pts">${worth} PT</span>`;
    if (res && (isLive || isFinal)) {
      const pushed = b.mode === "ATS" && outcome?.push;
      const pts = scorePick(game, { team: b.team, mode: b.mode }, res);
      state = pushed ? "push" : pts > 0 ? "up" : "down";
      if (isFinal) badge = pushed ? `<span class="pick-pill push">PUSH</span>` : pts > 0 ? `<span class="pick-pill ${ptsTier(pts)}">+${pts}</span>` : `<span class="pick-pill miss">✗</span>`;
    }
    return `<div class="bp-row ${b.side} ${state}${isLive ? " live" : ""}">
      <div class="bp-bet"><i class="bp-light"></i><b>${b.side === "away" ? A : H}</b><span class="bp-terms">${terms}</span>${badge}</div>
      <div class="pick-chips bp-chips">${nameChips(b.names)}</div>
    </div>`;
  };
  const head = tot ? `<div class="bp-head"><span class="bp-count away">${nA} ${A}</span><span class="bp-split"><i class="away" style="width:${tot ? (100 * nA / tot).toFixed(0) : 50}%"></i><i class="home"></i></span><span class="bp-count home">${nH} ${H}</span></div>` : "";
  return `<div class="bp">${head}${bets.length ? bets.map(row).join("") : `<div class="bp-none">No picks on this game</div>`}</div>`;
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

      const row = (team, short, id, score, lead, fav, pop, rank) => `
        <div class="bug-row ${lead ? "leading" : ""} ${myPick && myPick.team === team ? "mine" : ""}">
          <span class="bug-mark">
            <img class="bug-logo" src="${logoUrl(id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
            ${rankBadge(rank)}
          </span>
          <span class="bug-team"><span class="tm-nm">${short}</span></span>
          ${fav ? `<span class="bug-fav">-${game.spread}</span>` : `<span class="bug-fav dog"></span>`}
          <span class="bug-score ${pop ? "pop" : ""}">${score}</span>
        </div>`;

      const winProbHtml = isLive && g.winProb
        ? `<div class="win-prob-bar"><div class="win-prob-fill away" style="width:${g.winProb.away}%"></div><div class="win-prob-fill home" style="width:${g.winProb.home}%"></div></div>
           <div class="win-prob-labels"><span>${Math.round(g.winProb.away)}% ${game.awayShort}</span><span class="wp-cap">WIN PROB</span><span>${Math.round(g.winProb.home)}% ${game.homeShort}</span></div>`
        : "";

      const detail = !expanded ? "" : locked
        ? `<div class="bug-detail">
             ${bugPicksDetail(cloudPicks, game, hasScores ? { awayScore: g.awayScore, homeScore: g.homeScore } : null, isLive, isFinal, (side) => { const t = side === "away" ? (feed?.awayAbbr || game.awayShort) : (feed?.homeAbbr || game.homeShort); return (t.length > 6 && /\s/.test(t) ? t.split(/\s+/).map((w) => w[0]).join("") : t).toUpperCase(); })}
             ${winProbHtml}
             <div class="bug-foot"><span class="bug-foot-txt">${game.kickoffLabel} · ${game.tv || ""}</span><button type="button" class="insights-btn" data-insights="${game.id}" aria-label="Insights for ${game.awayShort} at ${game.homeShort}">INFO</button></div>
           </div>`
        // Before kickoff the detail is the lock note, with the same INFO
        // pill beside it that the picks card carries.
        : `<div class="bug-detail"><div class="bug-foot"><span class="bug-hidden-note">🔒 Picks reveal at kickoff (${game.kickoffLabel})</span><button type="button" class="insights-btn" data-insights="${game.id}" aria-label="Insights for ${game.awayShort} at ${game.homeShort}">INFO</button></div></div>`;

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
          face = lean > 0 ? `+${worth}?` : "0?";
        }
        myPill = `<span class="stake ${tone}" title="You took ${mine} ${terms} for ${worth} pt">${face}</span>`;
      }
      return `
        <div class="${cls}" data-game="${game.id}" role="button" tabindex="0" aria-expanded="${expanded}">
          <div class="bug-head">
            <span class="bug-gnum">G${game.id}</span>
            <span class="bug-status">${statusText}</span>${tvTag}
            ${myPill}
          </div>
          ${row(game.away, game.awayShort, game.awayId, awayScore, awayLead, awayFav, awayPop, feed?.awayRank ?? null)}
          ${row(game.home, game.homeShort, game.homeId, homeScore, homeLead, !awayFav, homePop, feed?.homeRank ?? null)}

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
    el.addEventListener("click", (e) => { if (e.target.closest(".insights-btn")) return; toggle(); });
    el.addEventListener("keydown", (e) => { if (e.target.closest(".insights-btn")) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    el.querySelectorAll(".insights-btn").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openInsights(id); }));
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

function playerBreakdownHtml(name, state, results, live) {
  const ordered = gamesByKickoff();
  let banked = 0, liveCovering = 0, liveOpen = 0, wins = 0, losses = 0, liveFly = 0;
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
        if (prov > 0) { liveCovering += 1; liveFly += worth; ptsHtml = `<span class="rd-pts lean ${ptsValueTier(worth)}">+${worth}?</span>`; }
        else ptsHtml = `<span class="rd-pts lean miss">0?</span>`;
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
  return `<div class="rank-detail"><div class="rd-head"><span>GAME</span><span>PICK</span><span>PTS</span></div>${rows}${tbRow}${summary}</div>`;
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
  if (!isGameLocked(tbGame)) return picked;
  const guess = row.tbGuess === null ? "TB –" : `TB ${row.tbGuess}`;
  // Once the tiebreaker is final: record, guess and miss on one short
  // line. Picked count only matters when someone left picks blank.
  if (actualTotal !== null && results) {
    let w = 0, l = 0;
    for (const g of GAMES) {
      const pick = row.state.picks[g.id];
      if (!results[g.id] || !pick) continue;
      const o = resultOutcome(g, results[g.id]);
      if (pick.mode === "ATS" && o?.push) continue;
      if (scorePick(g, pick, results[g.id]) > 0) w += 1; else l += 1;
    }
    const lead = row.submittedCount < GAMES.length ? `${picked} · ` : "";
    const tb = row.tbGuess === null
      ? `<span class="sub-tb none">NO TB</span>`
      : `TB ${row.tbGuess} · <span class="sub-tb${row.tbDiff === 0 ? " exact" : ""}">OFF ${row.tbDiff}</span>`;
    return `${lead}${w}-${l} · ${tb}`;
  }
  if (inFlight !== null && results) {
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
    return `${w}-${l} · <span class="rank-max">MAX <b>${max}</b></span> · <span class="rank-inflight">+${inFlight} LIVE</span>`;
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
  // An exhibition week keeps its picks, points and trophy, but pays
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
    <div class="pot-note">${sealed} of ${POT.weeks} weeks settled · ${money(paid)} paid out · ${money(Math.max(0, left))} in play${POT.season.length && !done ? " weekly · season money is a projection" : ""}</div>
    ${liveWeek ? `<div class="pot-live">${liveWeekFinal ? `WEEK ${liveWeek} UNSEALED` : `WEEK ${liveWeek} ACTIVE`}</div>` : ""}
    ${contested ? `<div class="pot-warn">⚠ Season places are tied on points where the money sits. The weekly tiebreaker does not settle the season, so the league needs a rule for this before the last week.</div>` : ""}
    <div class="pot-table">
      <div class="pot-row head"><span>#</span><span>MANAGER</span><span>PTS</span><span>WON</span><span>EARNED</span></div>
      ${list.map((r) => `<div class="pot-row${r.name === currentManager ? " me" : ""}${r.seasonPrize ? " inmoney" : ""}">
        <span class="pot-place">${r.tied ? "T" : ""}${r.seasonPlace}</span>
        <span class="pot-name">${shown(r.name).toUpperCase()}${r.seasonPrize ? `<span class="pot-proj">+${money(r.seasonPrize)} ${done ? "" : "proj"}</span>` : ""}</span>
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
    renderRecap();
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
function gaussRand() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function timeLeftFrac(l) {
  if (!l || l.state !== "in") return 1;
  const p = Number(l.period) || 1;
  if (p > 4) return 0.03;
  const [m, sec] = String(l.clock || "15:00").split(":").map(Number);
  const clk = (Number.isFinite(m) ? m : 15) * 60 + (Number.isFinite(sec) ? sec : 0);
  return Math.min(1, Math.max(0.01, ((4 - p) * 900 + clk) / 3600));
}
let winChanceMemo = { key: "", out: null };
function weekWinChances(cloudPicks, results, live) {
  const key = JSON.stringify([GAMES.map((g) => { const l = live[g.id]; return [g.id, results[g.id] ? `${results[g.id].awayScore}-${results[g.id].homeScore}` : l ? `${l.state}${l.awayScore}-${l.homeScore}@${l.period}${l.clock}` : ""]; }), MANAGERS.map((n) => JSON.stringify(cloudPicks[n]?.picks || {}) + (cloudPicks[n]?.tiebreaker ?? ""))]);
  if (winChanceMemo.key === key) return winChanceMemo.out;
  const N = 2000;
  const tbGame = tiebreakerGameOf();
  const guesses = MANAGERS.map((n) => { const raw = String(cloudPicks[n]?.tiebreaker ?? "").trim(); const v = Number(raw); return raw !== "" && Number.isFinite(v) ? v : null; });
  const models = GAMES.map((g) => {
    if (results[g.id]) return { g, fixed: results[g.id] };
    const l = live[g.id];
    const odds = l?.odds && l.odds.spread != null ? l.odds : null;
    const homeEdge = odds ? (odds.favoriteSide === "home" ? odds.spread : -odds.spread) : (g.favorite === g.home ? Number(g.spread) : -Number(g.spread));
    const rem = timeLeftFrac(l);
    const inGame = l && l.state === "in";
    return { g, rem, homeEdge, ou: odds?.overUnder ?? 52, curM: inGame ? (l.homeScore || 0) - (l.awayScore || 0) : 0, curT: inGame ? (l.homeScore || 0) + (l.awayScore || 0) : 0 };
  });
  // Each manager's pick on each game, with what it pays.
  const picks = MANAGERS.map((n) => GAMES.map((g) => { const p = cloudPicks[n]?.picks?.[g.id]; return p ? { team: p.team, mode: p.mode, pts: pointValue(g, p.team, p.mode) } : null; }));
  const wins = new Array(MANAGERS.length).fill(0);
  const score = new Array(MANAGERS.length);
  for (let s = 0; s < N; s++) {
    score.fill(0);
    let tbTotal = null;
    for (let k = 0; k < models.length; k++) {
      const m = models[k];
      let res = m.fixed;
      if (!res) {
        const margin = m.curM + m.homeEdge * m.rem + gaussRand() * 13.5 * Math.sqrt(m.rem);
        const total = Math.max(3, m.curT + (m.ou - 0) * m.rem + gaussRand() * 10 * Math.sqrt(m.rem));
        let h = Math.max(0, Math.round((total + margin) / 2)), a = Math.max(0, Math.round((total - margin) / 2));
        if (h === a) { if (Math.random() < 0.5) h += 3; else a += 3; }
        res = { awayScore: a, homeScore: h };
      }
      if (m.g === tbGame) tbTotal = res.awayScore + res.homeScore;
      const o = resultOutcome(m.g, res);
      for (let i = 0; i < MANAGERS.length; i++) {
        const p = picks[i][k];
        if (!p) continue;
        const winner = p.mode === "SU" ? o.suWinner : o.atsWinner;
        if (winner && winner === p.team) score[i] += p.pts;
      }
    }
    let best = -1, bestDiff = Infinity, lead = [];
    for (let i = 0; i < MANAGERS.length; i++) {
      const diff = guesses[i] === null || tbTotal === null ? Infinity : Math.abs(guesses[i] - tbTotal);
      if (score[i] > best || (score[i] === best && diff < bestDiff)) { best = score[i]; bestDiff = diff; lead = [i]; }
      else if (score[i] === best && diff === bestDiff) lead.push(i);
    }
    for (const i of lead) wins[i] += 1 / lead.length;
  }
  const out = Object.fromEntries(MANAGERS.map((n, i) => [n, wins[i] / N]));
  winChanceMemo = { key, out };
  return out;
}

function renderRankings(cloudPicks, results, live = {}, precomputed = null) {
  const rows = precomputed || rankManagers(cloudPicks, results);
  if (anyGameLive(live)) {
    const tbGame = tiebreakerGameOf() || GAMES[0];
    const tbRes = tbGame && results[tbGame.id];
    const actualTotal = tbRes ? tbRes.awayScore + tbRes.homeScore : null;
    for (const row of rows) row.subline = rankingSubline(row, actualTotal, tbGame, inFlightPoints(cloudPicks[row.name]?.picks || {}, live), results);
  }
  rankingsList.innerHTML = "";
  rankingsList.classList.toggle("wp-live", weekIsLive(results));
  if (weekIsLive(results)) {
    const ch = weekWinChances(cloudPicks, results, live);
    for (const row of rows) row.winPct = ch[row.name] ?? 0;
    const note = document.createElement("div");
    note.className = "wp-note";
    note.innerHTML = `<i></i>LIVE · CHANCE TO WIN THE WEEK`;
    rankingsList.appendChild(note);
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
  const trophy = `<svg class="wc-trophy" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${["########", "#.####.#", "#.####.#", ".######.", "..####..", "...##...", "..####..", ".######."].flatMap((row, y) => [...row].map((c, x) => c === "#" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : "")).join("")}</svg>`;
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
    : pre ? `<span class="ms-state kick" title="${next.awayShort} at ${next.homeShort}">KICK <b class="ms-kick">${kickoffCountdown(next.kickoff)?.brief || ""}</b></span>` : "";
  const clock = `<button class="ms-refresh${cloudPicksStale ? " stale" : ""}" type="button" title="${cloudPicksStale ? "Picks did not reload. Tap to try again" : "Tap to refresh"}">${cloudPicksStale ? "⚠ " : ""}${pre ? "" : clockLabel()}<span class="ms-cyc">⟳</span></button>`;
  // No name here. The header's own pill says who you are eight pixels
  // above, and the room it gives back pays for LIVE on the pill, which
  // reads better than a bare +6.
  const banked = `<span class="ms-score">${String(me.score).padStart(2, "0")} PTS</span>`;
  const livePill = inFlight ? `<span class="ms-live"><span class="stake-dot"></span>+${inFlight} LIVE</span>` : "";
  el.innerHTML = `<span class="ms-rank">${me.tied ? "T-" : ""}${ordinal(me.place)}</span>${banked}${livePill}${state}${clock}`;
  el.classList.remove("hidden");
  // Same numbers, ready for the header to pick up on scroll. The word
  // LIVE stays behind: the strip has room for it, the header's left slot
  // does not, and 30 PTS +30 LIVE ran under the wordmark at 320px.
  headScoreHtml = `${banked}${inFlight ? `<span class="ms-live"><span class="stake-dot"></span>+${inFlight}</span>` : ""}`;
  renderHeadScore();
}
// Ticks the strip's countdown without redrawing the strip.
function renderBoardCountdown() {
  const el = document.querySelector("#my-score .ms-kick");
  if (!el) return;
  const next = gamesByKickoff().find((g) => !isGameLocked(g));
  const cd = next && kickoffCountdown(next.kickoff);
  const text = cd && !cd.past ? cd.brief : "";
  if (el.textContent !== text) el.textContent = text;
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
  const els = [...rankingsList.querySelectorAll(".ranking-row")];
  const i = rows.findIndex((r) => r.score < chalk);
  const beat = i === -1 ? rows.length : i;
  const line = document.createElement("div");
  line.className = "chalk-line";
  line.title = "Score of a card with every favorite against the spread";
  line.innerHTML = `<span>CHALK LINE <b>${String(chalk).padStart(2, "0")}</b></span><em>${beat} of ${rows.length} above</em>`;
  if (i === -1 || !els[i]) rankingsList.appendChild(line);
  else rankingsList.insertBefore(line, els[i]);
}

function renderRankingRows(rows, cloudPicks, results, live) {
  rows.forEach((row, i) => {
    const open = expandedRankings.has(row.name);
    const div = document.createElement("div");
    div.className = "ranking-row" + (i === 0 && row.score > 0 ? " rank-1" : "") + (row.name === currentManager ? " is-me" : "") + (open ? " open" : "");
    div.innerHTML = `
      <div class="ranking-main" role="button" tabindex="0" aria-expanded="${open}">
        <span class="ranking-place">${row.tied ? "T-" : ""}${ordinal(row.place)}</span>
        <span class="ranking-name"><span class="rank-nameline"><span class="rank-who">${shown(row.name).toUpperCase()}</span></span><span class="ranking-lock">${row.subline}</span></span>
        ${row.winPct != null ? (() => { const pct = row.winPct * 100; const txt = pct >= 99.5 ? "99%+" : pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`; return `<span class="rank-wp${pct >= 50 ? " hot" : ""}" title="Chance to win the week"><span class="rank-wp-bar"><i style="width:${Math.max(pct, pct > 0 ? 2 : 0).toFixed(1)}%"></i></span><b>${txt}</b></span>`; })() : `<span class="ranking-dots" aria-hidden="true"></span>`}
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
  } else {
    el.innerHTML = `<span class="cd-top"><span class="cd-left"><span class="cd-label"><u></u>${label}</span><span class="cd-cells">${cells}</span></span>${status}</span><span class="cd-game">${match}</span>${fuse}`;
    el.dataset.frame = frameKey;
  }
  // The clock carries the card status, so the separate line hides.
  document.getElementById("picks-progress")?.classList.toggle("hidden", !!st);
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
// the score strip, so it stays out of the way once the week is underway.
function renderHeaderCountdown() {
  const el = document.getElementById("header-countdown");
  if (!el) return;
  const hide = () => { el.classList.add("hidden"); el.innerHTML = ""; delete el.dataset.drawn; };
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
  if (!currentManager) return;
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
setInterval(refreshSlateIfChanged, 60 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshSlateIfChanged(); });

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
    // Only while someone is looking at it. It is collapsed by default, and
    // rendering into a hidden panel every twenty seconds bought nothing.
    if (!document.getElementById("payouts-panel")?.classList.contains("hidden")) renderPayouts();
  renderRecap(); // memoised: only the Thursday cutoff can change anything here
  }
  // The off-board branch that fetched live scores here every tick is gone.
  // It fed the header chip back when the chip reported live games; the
  // chip is a to-do reminder now and reads nothing from the feed.
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
// or not in at all, plus a clock to the lock. Once per twelve hours per
// week, and always if something is still blank inside the last day.
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
  if (!el || bonerShownThisLoad || !currentManager) return;
  if (currentWeek !== 4 || Date.now() >= BONER_UNTIL || !GAMES.length || !GAMES.every(isGameLocked)) return;
  bonerShownThisLoad = true;
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
  const live = latestLive[game.id];
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
async function fetchEspnSummary(eventId) {
  if (!eventId) return null;
  const hit = summaryCache[eventId];
  if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.promise;
  // Share one request between the touch prefetch and the tap.
  const promise = fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${eventId}&t=${Math.floor(Date.now() / 900000)}`)
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
  const live = latestLive[game.id]?.odds?.spread != null ? latestLive[game.id].odds : d.odds;
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
  const rk = (side) => latestLive[game.id]?.[side === "away" ? "awayRank" : "homeRank"];
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
async function openInsights(gameId) {
  const modal = document.getElementById("insights-modal");
  const game = GAMES.find((g) => g.id === gameId);
  if (!modal || !game) return;
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const body = modal.querySelector("#insights-body");
  const favShort = game.favorite === game.home ? game.homeShort : game.awayShort;
  const lg = (id, cls = "") => `<img class="ins-logo ${cls}" src="${logoUrl(id)}" alt="" loading="lazy">`;
  modal.querySelector("#insights-title").innerHTML = `${lg(game.awayId, "hd")}<span>${esc(game.awayShort)}<i>at</i>${esc(game.homeShort)}</span>${lg(game.homeId, "hd")}`;
  modal.querySelector("#insights-sub").textContent = `${game.kickoffLabel} · ${game.tv}`;
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
  const eventId = latestLive[gameId]?.eventId || insightsCache.eventIds?.[gameId] || snap?.eventId || null;
  // Line: the Worker's logged samples plus whatever the browser sees now.
  const samples = (snap?.samples || []).filter((x) => !x.live).slice();
  const nowOdds = latestLive[gameId]?.odds && latestLive[gameId].odds.spread !== null ? latestLive[gameId].odds : direct?.odds && direct.odds.spread !== null ? direct.odds : null;
  if (nowOdds) { samples.push({ ...nowOdds, at: Date.now(), live: true }); reportLine(gameId, nowOdds); }
  const mv = movementFrom(game, samples) || snap?.movement || brief?.movement || null;
  const feedErr = (side) => direct ? null : snap?.feeds?.[side];
  // Live or final: a gamecast in our theme at the top. Score and clock
  // from the scoreboard, where the ball is and the last play from its
  // situation, the current drive and scoring plays from ESPN's game page.
  const liveGame = () => { const l = latestLive[gameId]; return !!(l && l.found && l.state === "in" && !l.completed); };
  // The live gamecast: scoreboard strip, a field with both end zones, the
  // ball at the spot with the offence's logo over it and the line to
  // gain, down and distance, then the last three plays and the scoring.
  // Away defends the left goal, home the right, as on the scorebug.
  const gamecastHtml = () => {
    const lv = latestLive[gameId], sit = lv.situation || {};
    const A = abbrOf("away"), H = abbrOf("home");
    const sc = summaryRaw?.header?.competitions?.[0]?.competitors || [];
    const colorOf = (id, fb) => { const c = sc.find((x) => Number(x.team?.id) === Number(id))?.team?.color; return c ? `#${c}` : fb || null; };
    const aCol = colorOf(game.awayId, lv.awayColor) || "#05d9e8", hCol = colorOf(game.homeId, lv.homeColor) || "#ff2079";
    const possA = sit.possessionId != null && Number(sit.possessionId) === Number(game.awayId);
    const possH = sit.possessionId != null && Number(sit.possessionId) === Number(game.homeId);
    // Where the ball is, 0 at the away goal to 100 at the home goal. ESPN's
    // text says "at VT 34" (34 yards from VT's goal); its yardLine number
    // is the same spot counted from the home goal on most feeds, so the
    // text wins when both are present.
    const dd = String(sit.downDistance || "");
    let x = null;
    const m = dd.match(/\bat\s+([A-Za-z&.' -]+?)\s+(\d{1,2})\s*$/);
    if (m) { const who = m[1].trim().toUpperCase(), yd = Number(m[2]); x = who === String(H).toUpperCase() ? 100 - yd : who === String(A).toUpperCase() ? yd : null; }
    else if (/\bat\s+50\b/.test(dd)) x = 50;
    if (x === null && sit.yardLine != null) x = 100 - sit.yardLine;
    const dir = possA ? 1 : possH ? -1 : 0;
    const goalToGo = /goal/i.test(dd);
    const dist = sit.distance != null ? sit.distance : (dd.match(/&\s*(\d+)/) ? Number(dd.match(/&\s*(\d+)/)[1]) : null);
    const toGo = x !== null && dir && (dist != null || goalToGo) ? Math.max(0, Math.min(100, goalToGo ? (dir > 0 ? 100 : 0) : x + dir * dist)) : null;
    const pct = (v) => (8 + v * 0.84).toFixed(2);
    const ticks = Array.from({ length: 9 }, (_, i) => (i + 1) * 10).map((v) => `<i class="gc-yl${v === 50 ? " mid" : ""}" style="left:${pct(v)}%"></i><span class="gc-num" style="left:${pct(v)}%">${v <= 50 ? v : 100 - v}</span>`).join("");
    const ball = x === null ? "" : `<div class="gc-spot" style="left:${pct(x)}%">${possA || possH ? `<img class="gc-off" src="${logoUrl(possA ? game.awayId : game.homeId)}" alt="">` : ""}<i class="gc-ball ${dir > 0 ? "r" : dir < 0 ? "l" : ""}"></i></div><i class="gc-los" style="left:${pct(x)}%"></i>`;
    const gain = toGo === null ? "" : `<i class="gc-first" style="left:${pct(toGo)}%"></i>`;
    const drive = x !== null && toGo !== null ? `<i class="gc-drive" style="left:${pct(Math.min(x, toGo))}%;width:${(Math.abs(toGo - x) * 0.84).toFixed(2)}%"></i>` : "";
    const field = `<div class="gc-field">
      <div class="gc-ez l" style="--tc:${aCol}"><span>${esc(A)}</span></div>
      <div class="gc-ez r" style="--tc:${hCol}"><span>${esc(H)}</span></div>
      ${ticks}${drive}${gain}${ball}
    </div>`;
    const status = shortStatus(lv.detail || `Q${lv.period ?? "?"} ${lv.clock ?? ""}`);
    const aS = lv.awayScore ?? 0, hS = lv.homeScore ?? 0;
    const team = (id, ab, s, poss, side) => `<div class="gc-tm ${side}${poss ? " poss" : ""}">${lg(id, "gc-logo")}<b>${esc(ab)}</b><span class="gc-sc">${s}</span>${poss ? `<i class="gc-pdot"></i>` : ""}</div>`;
    const strip = `<div class="gc-strip">${team(game.awayId, A, aS, possA, "a")}<div class="gc-clock"><span class="gc-live"><i class="lv-dot"></i>LIVE</span><b>${esc(status)}</b></div>${team(game.homeId, H, hS, possH, "h")}</div>`;
    const ddLine = dd ? `<div class="gc-dd${sit.isRedZone ? " rz" : ""}"><b>${esc(dd.replace(/\s+at\s+.*$/i, ""))}</b>${/\bat\s+/.test(dd) ? `<span>${esc(dd.replace(/^.*?\bat\s+/i, "at "))}</span>` : ""}${sit.isRedZone ? `<em>RED ZONE</em>` : ""}</div>` : `<div class="gc-dd"><b>${esc(sit.possessionText || "Between plays")}</b></div>`;
    // Last three plays: the current drive first, the previous drive if the
    // current one is too short, else the scoreboard's last play.
    const drives = summaryRaw?.drives || {};
    const pool = [...(drives.current?.plays || []), ...(drives.previous?.length ? drives.previous[drives.previous.length - 1].plays || [] : [])];
    const ordered = [...(drives.current?.plays || [])].reverse().concat([...(drives.previous?.length ? drives.previous[drives.previous.length - 1].plays || [] : [])].reverse());
    let plays = ordered.filter((p) => p && p.text).slice(0, 3).map((p) => ({ text: p.text, when: `Q${p.period?.number ?? "?"} ${p.clock?.displayValue || ""}`.trim(), dd: p.start?.shortDownDistanceText || p.start?.downDistanceText || "", tid: p.start?.team?.id ?? null }));
    if (!plays.length && sit.lastPlay) plays = [{ text: sit.lastPlay, when: "", dd: "", tid: sit.lastPlayTeamId }];
    const playsHtml = plays.length ? `<div class="gc-h">LAST PLAYS</div><ol class="gc-plays">${plays.map((p, i) => `<li class="${i === 0 ? "new" : ""}">${p.tid ? lg(p.tid, "gc-plogo") : ""}<div><span class="gc-pmeta">${esc([p.dd, p.when].filter(Boolean).join(" · "))}</span><span class="gc-ptxt">${esc(p.text)}</span></div></li>`).join("")}</ol>` : "";
    void pool;
    const wp = lv.winProb;
    const wpHtml = wp ? `<div class="gc-h">WIN PROBABILITY</div><div class="win-prob-bar"><div class="win-prob-fill away" style="width:${wp.away}%;background:${aCol}"></div><div class="win-prob-fill home" style="width:${wp.home}%;background:${hCol}"></div></div><div class="win-prob-labels"><span>${Math.round(wp.away)}% ${esc(A)}</span><span>${Math.round(wp.home)}% ${esc(H)}</span></div>` : "";
    const sp = Array.isArray(summaryRaw?.scoringPlays) ? summaryRaw.scoringPlays : [];
    const spHtml = sp.length ? `<div class="gc-h">SCORING</div><ul class="lv-sp">${sp.slice().reverse().map((q) => { const tid = q.team?.id != null ? Number(q.team.id) : null; return `<li>${tid ? lg(tid, "lv-splogo") : ""}<span class="lv-spq">Q${q.period?.number ?? "?"} ${esc(q.clock?.displayValue || "")}</span><span class="lv-sptxt">${esc(q.text || q.type?.text || "")}</span><b class="lv-spsc">${q.awayScore ?? ""}-${q.homeScore ?? ""}</b></li>`; }).join("")}</ul>` : "";
    return `<div class="gc">${strip}${field}${ddLine}${playsHtml}${wpHtml}${spHtml}</div>`;
  };
  // Built as a function and prepended once abbrOf exists below.
  const liveBlock = () => {
  const lv = latestLive[gameId];
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
  let html = `<button type="button" class="ins-sim" id="ins-sim" aria-label="Simulate game"><span class="ins-sim-gb" aria-hidden="true"><i></i></span><span class="ins-sim-txt"><b>SIMULATE GAME</b><em>▶ PRESS START</em></span><span class="ins-sim-vs" aria-hidden="true">${lg(game.awayId, "sm").replace("/500-dark/", "/500/")}<i>VS</i>${lg(game.homeId, "sm").replace("/500-dark/", "/500/")}</span></button>`;
  const hdrComps = summaryRaw?.header?.competitions?.[0]?.competitors || [];
  const abbrOf = (side) => {
    const id = side === "away" ? game.awayId : game.homeId;
    const c = hdrComps.find((x) => Number(x.team?.id) === Number(id));
    return c?.team?.abbreviation || (side === "away" ? game.awayShort : game.homeShort);
  };

  // 2. Line: OPENED -> SEALED -> NOW, each step saying how far and toward
  // whom, then one plain sentence. Values are signed from the sealed
  // favourite: positive means they are favoured by that much.
  if (liveGame()) {
    body.innerHTML = gamecastHtml() + links() + `<div class="ins-foot">Live from ESPN. Refreshes every 15 seconds.</div>`;
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
    const vals = [sealedV, openV, nowV].filter((v) => v !== null);
    let lo = Math.min(...vals) - 0.5, hi = Math.max(...vals) + 0.5;
    if (hi - lo < 3) { const mid = (hi + lo) / 2; lo = mid - 1.5; hi = mid + 1.5; }
    lo = Math.floor(lo * 2) / 2; hi = Math.ceil(hi * 2) / 2;
    const pos = (v) => (((v - lo) / (hi - lo)) * 100).toFixed(1);
    const lab = (v) => v === 0 ? "PK" : `${v > 0 ? favAb : dogAb} -${Math.abs(v)}`;
    const half = (v) => `${Math.abs(v)}`;
    const ticks = Math.round((hi - lo) * 2);
    const seal = `<i class="lm-pt seal" style="left:${pos(sealedV)}%"></i><span class="lm-lab seal up" style="left:${pos(sealedV)}%"><b>${esc(lab(sealedV))}</b>SEALED</span>`;
    const openCrowded = openV !== null && nowV !== null && Math.abs(nowV - openV) < 1;
    const open = openV !== null ? `<i class="lm-pt open" style="left:${pos(openV)}%"></i>${openCrowded ? "" : `<span class="lm-lab open dn" style="left:${pos(openV)}%">OPEN<b>${esc(lab(openV))}</b></span>`}` : "";
    const nowMoved = nowV !== null && nowV !== sealedV;
    // NOW is always labelled; OPEN yields its label when the two collide.
    const now = nowV === null ? "" : `<i class="lm-pt now" style="left:${pos(nowV)}%"></i><span class="lm-lab now dn" style="left:${pos(nowV)}%">NOW<b>${esc(lab(nowV))}</b></span>`;
    const bandL = nowMoved ? pos(Math.min(sealedV, nowV)) : 0, bandW = nowMoved ? (Math.abs(nowV - sealedV) / (hi - lo) * 100).toFixed(1) : 0;
    // Your pick decides the colour: green when the market moved your way
    // (your sealed number is now the better one), pink when it moved
    // against you, cyan when you have no pick on this game.
    const myPick = currentManager ? getManagerState(currentManager).picks?.[game.id] : null;
    const myFav = myPick ? myPick.team === game.favorite : null;
    // A bigger favourite number helps whoever holds the favourite at the
    // smaller sealed number, and hurts the dog holder, and vice versa.
    const forMe = !myPick || !nowMoved ? null : (nowV > sealedV) === myFav;
    // A straight-up pick never touches the spread, so for it the move is
    // a signal, not points: the market agreeing with the side or cooling.
    const mySU = !!myPick && myPick.mode === "SU";
    const tone = forMe === null ? "" : forMe ? " good" : " bad";
    const band = nowMoved ? `<i class="lm-band ${nowV > sealedV ? "r" : "l"}${tone}" style="left:${bandL}%;width:${bandW}%"></i>` : "";
    // Small indicator under the axis: an arrow spanning seal to now with the size of the move.
    const move = "";
    const zero = lo < 0 && hi > 0 ? `<i class="lm-zero" style="left:${pos(0)}%"></i>` : "";
    // Two plain lines: since open, and what the move since seal means.
    const dS = nowV === null ? null : Math.round((nowV - sealedV) * 2) / 2;
    const dO = nowV === null || openV === null ? null : Math.round((nowV - openV) * 2) / 2;
    // Two short lines. First: where it was and where it is. Second: what
    // that means for you, or for whoever holds the sealed number.
    const l1 = nowV === null ? `NO LIVE LINE · SEALED <em>${esc(lab(sealedV))}</em>`
      : openV === null ? `SEALED <em>${esc(lab(sealedV))}</em> · NOW <em>${esc(lab(nowV))}</em>`
      : dO === 0 ? `OPEN ${esc(lab(openV))} · NOW <em>${esc(lab(nowV))}</em> · NO MOVE`
      : `OPEN ${esc(lab(openV))} ▸ NOW <em>${esc(lab(nowV))}</em>`;
    const myLab = myPick ? `${esc(myPick.team === game.away ? abbrOf("away") : abbrOf("home"))} ${myPick.mode === "SU" ? "SU" : (myFav ? "-" : "+") + game.spread}` : "";
    const l2 = nowV === null ? "" : dS === 0 ? (myPick ? `YOUR ${myLab} · AT MARKET` : `SEAL AT MARKET · NO EDGE`)
      : myPick && mySU ? (forMe ? `<em class="good">✓ MARKET AGREES · ${myLab}</em> · NOW ${esc(lab(nowV))}` : `<em class="bad">MARKET COOLING ON ${myLab}</em> · NOW ${esc(lab(nowV))}`)
      : myPick ? (forMe ? `<em class="good">✓ GOOD FOR YOUR ${myLab}</em> · +${half(dS)}` : `<em class="bad">✗ BAD FOR YOUR ${myLab}</em> · -${half(dS)}`)
      : `EDGE <em>+${half(dS)}</em> TO ${esc(dS > 0 ? favAb : dogAb)} BACKERS`;
    const ou = mv?.overUnder ?? direct?.odds?.overUnder ?? null;
    html += `<div class="lm"><div class="lm-axis" style="--ticks:${ticks}">
      <span class="lm-end l">${lg(dogId, "sm")}<em>${esc(dogAb)}</em></span><span class="lm-end r">${lg(favId, "sm")}<em>${esc(favAb)}</em></span>
      ${zero}${band}${open}${seal}${now}${move}</div>
      <div class="lm-read"><span>${l1}${l2 ? `<br>${l2}` : ""}</span>${ou !== null ? `<span class="lm-ou"><em>O/U</em>${ou}</span>` : ""}</div></div>`;
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
    const statRows = (direct?.teamStats || []).map((r) => { const [ab, hb] = better(r.label, r.away, r.home); return cell(r.label, r.away, r.home, ab ? "lead" : "", hb ? "lead" : "", true); }).join("");
    html += `<div class="ins-glance ins-stats"><div class="ins-g head"><span></span><span>${lg(game.awayId)}${esc(abbrOf("away"))}</span><span>${lg(game.homeId)}${esc(abbrOf("home"))}</span></div>`
      + cell("RECORD", glance.records?.away?.overall, glance.records?.home?.overall)
      + cell("ATS", glance.ats?.away || previewAts?.away, glance.ats?.home || previewAts?.home)
      + cell("ESPN FPI", glance.fpi ? `${glance.fpi.away}%` : null, glance.fpi ? `${glance.fpi.home}%` : null, glance.fpi && glance.fpi.away > glance.fpi.home ? "lead" : "", glance.fpi && glance.fpi.home > glance.fpi.away ? "lead" : "")
      + (statRows ? `<div class="ins-g divider"><span>SEASON</span></div>${statRows}` : "")
      + `</div>`
      + (w ? `<div class="ins-wx"><span>${esc(w)}</span></div>` : "");
    if (glance.venue?.name) modal.querySelector("#insights-sub").textContent = `${game.kickoffLabel} · ${game.tv} · ${glance.venue.name}${glance.venue.indoor ? " (indoors)" : ""}`;
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
    html += `<div class="ins-sub-h">LAST FIVE</div>${row(game.awayId, form.away)}${row(game.homeId, form.home)}`;
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
    const tileOf = (o) => {
      const nA = o.picks.filter((p) => p.side === "away").length, nH = o.picks.length - nA;
      const side = nA > nH ? "away" : nH > nA ? "home" : o.picks[0].side;
      const lead = side === "away" ? nA : nH;
      const first = o.picks.find((p) => p.side === side) || o.picks[0];
      const id = side === "away" ? game.awayId : game.homeId;
      const raw = abbrOf(side) || "";
      const short = raw.length <= 6 ? raw : raw.split(/[\s-]+/).length > 1 ? raw.split(/[\s-]+/).map((w) => w[0]).join("") : raw.slice(0, 5);
      // The logo says the team; beside it goes the number that matters
      // (the line, else the predicted score, else WIN). The second line is
      // who and how: the writer count or the writer, and ATS/SU. A staff
      // that splits gets a bar showing the lean.
      const names = o.picks.map((p) => p.picker && p.picker === p.picker.toUpperCase() ? p.picker.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : p.picker).filter(Boolean);
      // The big number is a spread or a predicted score, never a
      // moneyline: -172 beside another tile's -3.5 reads as a spread.
      const spread = first.line && Math.abs(Number(first.line)) < 30 ? first.line : "";
      const ml = first.ml || (first.line && !spread ? first.line : "");
      const big = spread || first.score || (first.type === "SU" ? "WIN" : "COVER");
      const how = first.type === "SU" ? (ml && outlets.length <= 3 ? `ML ${ml}` : "SU") : "ATS";
      const who = o.picks.length > 1 ? (lead === o.picks.length ? `ALL ${o.picks.length}` : `${lead} OF ${o.picks.length}`) : (outlets.length <= 3 ? names[0] || "" : "");
      const extra = spread && first.score && o.picks.length === 1 ? first.score : "";
      const meta = [who, extra, how].filter(Boolean).join(" · ");
      const split = o.picks.length > 1 && lead < o.picks.length ? `<span class="xp-bar"><i style="width:${Math.round(100 * lead / o.picks.length)}%"></i></span>` : "";
      const title = [names.length ? names.join(", ") : "", first.reason || ""].filter(Boolean).join(" — ");
      const inner = `<span class="xp-out">${esc(o.outlet.replace(/\s+on MSN$/i, ""))}</span><span class="xp-main">${lg(id, "xp-logo")}<b>${esc(big)}</b></span><span class="xp-meta">${esc(meta)}</span>${split}`;
      const href = first.link || o.picks.find((p) => p.link)?.link;
      return href ? `<a class="xp-tile ${side}" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(title)}">${inner}</a>` : `<span class="xp-tile ${side}" title="${esc(title)}">${inner}</span>`;
    };
    const n = outlets.length;
    const cols = n <= 1 ? 1 : n <= 4 ? n : 4;
    const shown = n <= 4 ? n : 4 * Math.floor(n / 4);
    const list = outlets.slice(0, shown), rest = outlets.slice(shown, shown + 16);
    if (all.length) {
      const nA = all.filter((p) => p.side === "away").length, nH = all.length - nA;
      const lead = nA >= nH ? { n: nA, short: game.awayShort } : { n: nH, short: game.homeShort };
      const who = all.length === 1 ? "1 PICK" : `${all.length} PICKS`;
      const sum = nA && nH ? `${lead.n} OF ${who} ON ${esc(lead.short.toUpperCase())}` : `ALL ${who} ON ${esc(lead.short.toUpperCase())}`;
      html += `<div class="ins-h">EXPERT PICKS</div><div class="xp-sum">${sum}</div><div class="xp-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${list.map(tileOf).join("")}</div>`;
      if (rest.length) html += `<details class="ins-more-news xp-more"><summary><span>▶</span> MORE OUTLETS (${rest.length})</summary><div class="xp-grid" style="grid-template-columns:repeat(${Math.min(rest.length, 4)},minmax(0,1fr))">${rest.map(tileOf).join("")}</div></details>`;
    } else if (pend.picks) html += `<div class="ins-h">EXPERT PICKS</div><div class="ins-loading">Checking the pickers…</div>`;
    else html += `<div class="ins-h">EXPERT PICKS</div><div class="ins-empty small">No published picks yet. The outlets usually call games Thursday and Friday.</div>`;
  }
  if (!newsRows.length && (pend.news || pend.wider || pend.gdelt || pend.site)) html += `<div class="ins-h">NEWS</div><div class="ins-loading">Loading news…</div>`;
  const newsErr = !pend.wider && !pend.gdelt && !pend.site && !wider.length && !gdelt.length && !(siteFeed?.news || []).length && (wider.errors || []).length ? `<div class="ins-empty small"><i class="ins-err">More sources unavailable: ${esc(wider.errors.slice(0, 2).join(" · "))}</i></div>` : "";
  const newsLi = (n) => `<li><b class="ins-nh">${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.headline)}</a>` : esc(n.headline)}</b>${n.blurb ? `<span class="ins-blurb">${esc(n.blurb)}</span>` : ""}<span class="ins-det"><em class="ins-src">${esc(n.source || "")}</em>${esc(n.team)}${n.published ? ` · ${esc(fmtWhen(n.published))}` : ""}</span></li>`;
  // Three at the top; the rest fold under MORE NEWS.
  if (newsRows.length) html += `<div class="ins-h">NEWS</div><ul class="ins-news">${newsRows.slice(0, 3).map(newsLi).join("")}</ul>${newsRows.length > 3 ? `<details class="ins-more-news"><summary><span>▶</span> MORE NEWS (${Math.min(newsRows.length - 3, 12)})</summary><ul class="ins-news">${newsRows.slice(3, 15).map(newsLi).join("")}</ul></details>` : ""}`;
  if (newsErr) html += newsRows.length ? newsErr : `<div class="ins-h">NEWS</div>${newsErr}`;

  // 1. Injuries, one column per team.
  const statusCls = (st) => `st-${String(st || "").toLowerCase().replace(/[^a-z]/g, "")}`;
  const col = (label, list, ok, teamId, err) => `<div class="ins-col"><div class="ins-team">${lg(teamId)}${esc(label)}</div>` + (list?.length
    ? `<ul class="ins-inj">${list.slice(0, 7).map((i) => {
        // The grey line earns its place only with a fact: "injury" alone or
        // the status in other words ("still uncertain to play") is noise.
        const weak = /^(injur(y|ed|ies)|unspecified|undisclosed( injury)?|not specified)\.?$|^(still |remains )?(uncertain|unsure|unlikely|likely|listed|questionable|doubtful|probable|out)( to (play|suit up))?\.?$|injury from (last|previous) (game|week)|not (yet )?specified/i;
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
        return `<li class="ins-q"><details><summary>${row}<span class="ins-q-tap">▾</span></summary><div class="ins-quote">${body}${src ? `<div class="ins-q-src">${src}</div>` : ""}</div></details></li>`;
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
  body.querySelector("#ins-sim")?.addEventListener("click", () => window.openSim?.(simCtx));
  };
  // While the game is on, pull the scoreboard and the game page again
  // every thirty seconds and repaint, so the sheet keeps up with the
  // scorebug behind it. Stops the moment the sheet closes or the game ends.
  const liveTick = async () => {
    if (!alive()) { clearInterval(liveTimer); return; }
    const l = latestLive[gameId];
    if (!(l && l.found && l.state === "in" && !l.completed)) return;
    try { await fetchLiveScores(); } catch {}
    const id = latestLive[gameId]?.eventId || null;
    if (id) { delete summaryCache[id]; try { const raw = await fetchEspnSummary(id); if (raw) summaryRaw = raw; } catch {} }
    if (alive()) paint();
  };
  const liveTimer = setInterval(liveTick, 15000);
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
  const eventIdNow = latestLive[gameId]?.eventId || insightsCache.eventIds?.[gameId] || null;
  const summaryP = (eventIdNow ? Promise.resolve(eventIdNow) : fetchLiveScores().catch(() => {}).then(() => latestLive[gameId]?.eventId || null))
    .then((id) => fetchEspnSummary(id));
  land(summaryP, (v) => { summaryRaw = v; }, "summary");
  land(withTimeout(summaryP.then((raw) => fetchAiPreview(game, parseSummaryClient(raw, game))), 15000, null), (v) => { aiPv = v; }, "ai");
}
(() => {
  const modal = document.getElementById("insights-modal");
  if (!modal) return;
  const close = () => modal.classList.add("hidden");
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  modal.querySelector("#insights-close")?.addEventListener("click", close);
  // Swipe down to close: only from the top of the sheet, so scrolling the
  // content still works; the card follows the finger and snaps back if the
  // pull is short.
  const card = modal.querySelector(".insights-card");
  let y0 = null, dy = 0;
  modal.addEventListener("touchstart", (e) => {
    if (modal.scrollTop > 2 || e.touches.length !== 1) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
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
    if (card) { card.style.transition = "transform .2s ease, opacity .2s ease"; }
    if (dy > 110) { close(); }
    if (card) { card.style.transform = ""; card.style.opacity = ""; }
    y0 = null; dy = 0;
  });
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
  renderH2H();
  document.getElementById("h2h-modal")?.classList.remove("hidden");
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
  const lineOf = (g, pick) => !pick ? `<i class="h2h-none">no pick</i>` : `${esc(short(g, pick.team))} <small>${pick.mode === "SU" ? "SU" : (pick.team === g.favorite ? "-" : "+") + g.spread}</small>`;
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
  // One line per game. Left card, centre column with the game number and
  // where it stands, right card. Same pick on both sides is dimmed.
  const order = (g) => results[g.id] ? 0 : (live[g.id]?.state === "in" ? 1 : 2);
  const games = gamesByKickoff().slice().sort((x, y) => order(x) - order(y));
  const mid = (g) => {
    if (results[g.id]) return `<i>${results[g.id].awayScore}-${results[g.id].homeScore}</i>`;
    const lv = live[g.id];
    if (lv?.state === "in") return `<i class="live"><u></u>${lv.awayScore ?? 0}-${lv.homeScore ?? 0}</i>`;
    const k = new Date(g.kickoff);
    return `<i class="soon">${k.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" }).toUpperCase()} ${k.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric" }).replace(" ", "")}</i>`;
  };
  const cell = (g, pick, st, side) => {
    if (hiddenFor(side === "a" ? A.name : B.name, g)) return `<div class="h2h-td ${side} hidden-pick"><span class="h2h-team"><span class="h2h-nm"><em>🔒 locked at kick</em></span></span></div>`;
    const id = pick ? (pick.team === g.home ? g.homeId : pick.team === g.away ? g.awayId : null) : null;
    const team = `<span class="h2h-team">${id ? `<img class="h2h-logo" src="${logoUrl(id)}" alt="" loading="lazy">` : ""}<span class="h2h-nm">${pick ? esc(short(g, pick.team)) : "<em>none</em>"}</span></span>`;
    const line = `<span class="h2h-line">${pick ? (pick.mode === "SU" ? "SU" : (pick.team === g.favorite ? "-" : "+") + g.spread) : ""}</span>`;
    const pts = `<b>${st.txt}</b>`;
    // The right card mirrors the left: points nearest the middle, team at the edge.
    return `<div class="h2h-td ${side} ${st.cls}">${side === "a" ? team + line + pts : pts + line + team}</div>`;
  };
  const trs = games.map((g) => {
    const pa = a.st.picks[g.id], pb = b.st.picks[g.id];
    const same = pa && pb && pa.team === pb.team && pa.mode === pb.mode;
    const sa = stateOf(g, pa), sb = stateOf(g, pb);
    // Marked only where it matters: a settled game where the points came
    // out different, or an unsettled one where the picks could.
    const diff = hiddenFor(A.name, g) || hiddenFor(B.name, g) ? false : order(g) === 2 ? !same : sa.txt !== sb.txt;
    // Where the points split, an arrow from the centre points at the card
    // that has the edge on this game.
    const na = Number(sa.txt) || 0, nb = Number(sb.txt) || 0;
    const arrow = diff && order(g) !== 2 && na !== nb ? (na > nb ? `<em class="h2h-arr l">◀</em>` : `<em class="h2h-arr r">▶</em>`) : "";
    return `<div class="h2h-tr${diff ? " diff" : ""}${order(g) === 1 ? " is-live" : ""}">${cell(g, pa, sa, "a")}<div class="h2h-mid">${arrow}<span>G${g.id}</span>${mid(g)}</div>${cell(g, pb, sb, "b")}</div>`;
  }).join("");
  // The swing: on games still to play where they differ, the most either can gain on the other.
  let swingA = 0, swingB = 0;
  for (const g of GAMES) {
    if (results[g.id]) continue;
    const pa = a.st.picks[g.id], pb = b.st.picks[g.id];
    if (pa && pb && pa.team === pb.team && pa.mode === pb.mode) continue;
    if (pa) swingA += pointValue(g, pa.team, pa.mode);
    if (pb) swingB += pointValue(g, pb.team, pb.mode);
  }
  const gap = A.score - B.score;
  const leader = gap > 0 ? A : gap < 0 ? B : null, trailer = gap > 0 ? B : A;
  const trailSwing = gap > 0 ? swingB : swingA;
  let verdict;
  if (a.left + b.left === 0) verdict = leader ? `Final. ${esc(shown(leader.name))} by ${Math.abs(gap)}.` : "Final. Dead level.";
  else if (!leader) verdict = `Level. Where they split, ${esc(shown(A.name))} has ${swingA} in play and ${esc(shown(B.name))} has ${swingB}.`;
  else if (trailSwing === 0) verdict = `${esc(shown(leader.name))} by ${Math.abs(gap)}. Nothing left where they split, so that holds.`;
  else verdict = `${esc(shown(leader.name))} by ${Math.abs(gap)}. ${esc(shown(trailer.name))} has ${trailSwing} in play where they split${trailSwing < Math.abs(gap) ? ", not enough alone" : ""}.`;
  const sideHead = (row, x, cls) => `<div class="h2h-th ${cls}"><span class="h2h-name">${esc(shown(row.name).toUpperCase())}</span><span class="h2h-score">${String(row.score).padStart(2, "0")}</span><span class="h2h-meta">${x.w}-${x.l} · MAX ${x.max}${x.fly ? ` · <em>+${x.fly}</em>` : ""}</span></div>`;
  body.innerHTML = `<div class="h2h-grid">
    <div class="h2h-tr h2h-head">${sideHead(A, a, "a")}<div class="h2h-mid h2h-th-mid">VS</div>${sideHead(B, b, "b")}</div>
    ${trs}
  </div>
  <div class="h2h-verdict">${verdict}</div>`;
}
document.getElementById("h2h-open")?.addEventListener("click", openH2H);
document.getElementById("h2h-close")?.addEventListener("click", () => document.getElementById("h2h-modal").classList.add("hidden"));
document.getElementById("h2h-modal")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});
document.querySelectorAll(".h2h-select").forEach((el) => el.addEventListener("change", () => {
  const side = el.dataset.side, other = side === "a" ? "b" : "a";
  if (h2h[other] === el.value) h2h[other] = h2h[side]; // picking the other card swaps them
  h2h[side] = el.value;
  renderH2H();
}));

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
  // 8x8 pixel icons in the card's colour, so they sit with the pixel type
  // instead of fighting the logos the way native emoji did.
  const px = (rows) => `<svg class="recap-icon" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${rows.flatMap((row, y) => [...row].map((c, x) => c === "#" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : "")).join("")}</svg>`;
  const ICON = {
    target: px(["..####..", ".#....#.", "#..##..#", "#.####.#", "#.####.#", "#..##..#", ".#....#.", "..####.."]),
    skull: px([".######.", "########", "##.##.##", "##.##.##", "########", ".##..##.", "..####..", "..#..#.."]),
    up: px(["...##...", "..####..", ".######.", "###..###", "#..##..#", "...##...", "...##...", "...##..."]),
    coin: px(["..####..", ".#....#.", "#..##..#", "#.#..#.#", "#.#..#.#", "#..##..#", ".#....#.", "..####.."]),
    hash: px(["..#..#..", "..#..#..", "########", "..#..#..", "..#..#..", "########", "..#..#..", "..#..#.."]),
  };
  const logo = (id, alt = "") => id ? `<img class="recap-logo" src="${logoUrl(id)}" alt="${esc(alt)}" loading="lazy">` : `<span class="recap-logo blank"></span>`;
  const mine = (w) => (Array.isArray(w) ? w : [w]).includes(currentManager);
  // [label, class, art, headline, sub, stat, statLabel, isMe]
  if (r.best) {
    const b = r.best;
    cards.push([ICON.target + "PICK OF THE WEEK", "hit", logo(b.teamId, b.team), `${chips(b.who)}<span class="recap-pick">${esc(b.pick)}</span>`,
      `Only ${b.takers} of ${b.of} ${b.takers === 1 ? "took it" : `were on ${esc(b.team || b.pick)}`} · ${esc(b.final || b.score)}`, `+${b.pts}`, "PTS", mine(b.who)]);
  }
  if (r.worst) {
    const w = r.worst;
    cards.push([ICON.skull + "WORST PICK", "miss", logo(w.teamId, w.team), `<span class="recap-pick">${esc(w.pick)}</span>`,
      `All ${w.takers} got zero · ${esc(w.final || w.score)}`, `${w.takers}/${w.of}`, "PICKED", mine(w.who)]);
  }
  if (r.movement?.up) {
    const u = r.movement.up, d = r.movement.down;
    cards.push([ICON.up + "MOVEMENT", "move", `<span class="recap-logo arrow">▲</span>`, `${chips([u.name])}<span class="recap-pick">to #${u.to} on the season</span>`,
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
  const key = `${last.week}|${cards.length}|${currentManager}`;
  toggle.classList.remove("hidden");
  toggle.firstChild.textContent = `📰 ${String(last.label || `WEEK ${last.week}`).toUpperCase()} RECAP `;
  if (panel.dataset.drawn === key) return;
  panel.dataset.drawn = key;
  panel.innerHTML = cards.map(([h, cls, art, main, sub, stat, statLabel, me], i) =>
    `<div class="recap-card ${cls}${me ? " me" : ""}" style="--i:${i}">
      <div class="recap-art">${art}</div>
      <div class="recap-body">
        <div class="recap-head">${h}${me ? `<span class="recap-you">YOU</span>` : ""}</div>
        <div class="recap-main">${main}</div>
        <div class="recap-sub">${sub}</div>
      </div>
      <div class="recap-stat"><b>${stat}</b><span>${statLabel}</span></div>
      <div class="recap-react" data-card="${cls}"></div>
    </div>`).join("");
  paintReactions(last.week);
};

// --- Recap reactions --------------------------------------------------------
const REACTION_SET = ["🔥", "💀", "🤡", "😂", "👏"];
let reactionState = { week: null, cards: {} };
async function paintReactions(week, fresh = true) {
  const panel = document.getElementById("recap-panel");
  if (!panel) return;
  if (fresh && WORKER_URL) {
    try {
      const r = await fetch(`${WORKER_URL}/reactions?week=${week}&t=${Date.now()}`, { cache: "no-store" });
      if (r.ok) reactionState = { week, cards: (await r.json()).cards || {} };
    } catch {}
  }
  panel.querySelectorAll(".recap-react").forEach((el) => {
    const c = reactionState.week === week ? reactionState.cards[el.dataset.card] || {} : {};
    el.innerHTML = REACTION_SET.map((e) => {
      const who = c[e] || [];
      const mine = currentManager && who.includes(currentManager);
      return `<button type="button" class="rx${mine ? " mine" : ""}${who.length ? " on" : ""}" data-emoji="${e}" title="${who.map((n) => shown(n)).join(", ")}">${e}${who.length ? `<b>${who.length}</b>` : ""}</button>`;
    }).join("");
  });
}
document.getElementById("recap-panel")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".rx");
  if (!btn) return;
  e.stopPropagation();
  const card = btn.closest(".recap-react")?.dataset.card;
  const week = reactionState.week;
  if (!card || !week || !currentManager || !WORKER_URL) return;
  // Optimistic toggle, then the Worker's copy wins.
  const c = reactionState.cards[card] = reactionState.cards[card] || {};
  const list = new Set(c[btn.dataset.emoji] || []);
  if (list.has(currentManager)) list.delete(currentManager); else list.add(currentManager);
  c[btn.dataset.emoji] = [...list];
  paintReactions(week, false);
  try {
    const r = await fetch(`${WORKER_URL}/reactions?week=${week}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manager: currentManager, card, emoji: btn.dataset.emoji, token: tokenFor(currentManager) || undefined }) });
    if (r.ok) { reactionState = { week, cards: (await r.json()).cards || {} }; paintReactions(week, false); }
    else if (r.status === 401) handleAuthFailure(currentManager);
  } catch {}
});

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
    const isOpen = open === null ? true : open === "1";
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
  toggle.addEventListener("click", () => { open = !open; paint(); if (open) track("pot-open", { event: true }); });
  paint();
})();

// --- Season stats ------------------------------------------------------
// Five leaderboards from the ledger of every counting week. The ledger
// comes down only when the panel is opened, and is kept for five minutes.
let seasonLedgerAt = 0;
let seasonLedger = null;
async function fetchSeasonLedger() {
  if (!WORKER_URL) return null;
  if (seasonLedger && Date.now() - seasonLedgerAt < 5 * 60 * 1000) return seasonLedger;
  try {
    const res = await fetch(`${WORKER_URL}/weeks?detail=1&t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return seasonLedger;
    const data = await res.json();
    seasonLedger = Object.values(data.summaries || {}).filter((w) => w?.complete && !w.exhibition && Array.isArray(w.rows)).sort((a, b) => a.week - b.week);
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
    ats: all.filter((m) => m.atsW + m.atsL >= 3).sort((a, b) => pct(b.atsW, b.atsL) - pct(a.atsW, a.atsL) || b.atsW - a.atsW).map((m) => ({ name: m.name, value: `${m.atsW}-${m.atsL}`, sub: `${Math.round(pct(m.atsW, m.atsL) * 100)}%` })),
    dogs: all.filter((m) => m.dogHits).sort((a, b) => b.dogHits - a.dogHits).map((m) => ({ name: m.name, value: String(m.dogHits), sub: "" })),
    lone: all.filter((m) => m.lone).sort((a, b) => b.lone - a.lone).map((m) => ({ name: m.name, value: String(m.lone), sub: "" })),
    streak: all.filter((m) => m.streak >= 2).sort((a, b) => b.streak - a.streak).map((m) => ({ name: m.name, value: String(m.streak), sub: "" })),
    fader: all.filter((m) => m.picks >= 5).sort((a, b) => b.fades / b.picks - a.fades / a.picks).map((m) => ({ name: m.name, value: `${Math.round((m.fades / m.picks) * 100)}%`, sub: `${m.fades} of ${m.picks}` })),
    tb: all.filter((m) => m.tbN).sort((a, b) => a.tbSum / a.tbN - b.tbSum / b.tbN).map((m) => ({ name: m.name, value: (m.tbSum / m.tbN).toFixed(1), sub: sameTbN ? "" : `${m.tbN} wk${m.tbN === 1 ? "" : "s"}` })),
    best: all.filter((m) => m.bestWeek).sort((a, b) => b.bestWeek.score - a.bestWeek.score).map((m) => ({ name: m.name, value: String(m.bestWeek.score), sub: `Week ${m.bestWeek.week}` })),
    blanks: all.filter((m) => m.blanks).sort((a, b) => b.blanks - a.blanks).map((m) => ({ name: m.name, value: String(m.blanks), sub: "left blank" })),
  };
}

async function renderSeasonStats() {
  const panel = document.getElementById("season-panel");
  if (!panel || panel.classList.contains("hidden")) return;
  const weeks = await fetchSeasonLedger();
  if (!weeks) { panel.innerHTML = `<div class="pot-empty">Could not reach the record. Try again in a moment.</div>`; return; }
  if (!weeks.length && !GAMES.some(isGameLocked)) { panel.innerHTML = `<div class="pot-empty">Nothing on the record yet. Stats appear once a week seals.</div>`; return; }
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
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const row = (r, i, cls) => `<div class="ss-row${r.name === currentManager ? " me" : ""}${i === 0 ? " lead" : ""}"><span class="ss-rank">${i + 1}</span><span class="ss-name">${esc(shown(r.name).toUpperCase())}</span><span class="ss-sub">${esc(r.sub)}</span><b class="ss-val">${esc(r.value)}</b></div>`;
  const board = (label, note, rows, cls) => {
    const top = rows.slice(0, 3).map((r, i) => row(r, i, cls)).join("");
    return `<div class="ss-card ${cls}"><div class="ss-head"><span>${label}</span><small>${note}</small></div>${rows.length ? top : `<div class="ss-row none">Nobody qualifies yet</div>`}</div>`;
  };
  panel.innerHTML = `<div class="ss-note">${weeks.length} counting week${weeks.length === 1 ? "" : "s"} · top three on each</div>
    ${board("BEST ATS RECORD", "spread picks, min 3", s.ats, "hit")}
    ${board("HOT HAND", "correct picks in a row, right now", s.streak, "hit")}
    ${board("MOST DOG HITS", "underdogs straight up, 3 pts each", s.dogs, "upset")}
    ${board("LONE WOLF", "correct with 3 or fewer on the team", s.lone, "upset")}
    ${board("FAVOURITE FADER", "share of picks against the favourite", s.fader, "split")}
    ${board("TIEBREAKER SNIPER", "average miss, lower is better", s.tb, "tb")}
    ${board("BEST WEEK", "highest single-week score", s.best, "move")}
    ${s.blanks.length ? board("NO-SHOWS", "games left unpicked", s.blanks, "miss") : ""}`;
}
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
  toggle.addEventListener("click", () => { open = !open; paint(); });
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
    if (quiet && already !== data.v) {
      try { sessionStorage.setItem(RELOADED_KEY, data.v); } catch { /* private mode */ }
      reloadFresh();
      return;
    }
    showUpdateBar();
  } catch { /* offline, or the file is not there yet: say nothing */ }
}

document.getElementById("update-bar")?.addEventListener("click", reloadFresh);

checkForUpdate(true);
// Standalone apps are suspended rather than closed, so coming back to one
// is the moment a new build is most likely to be waiting, and the moment
// a reload costs nothing.
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForUpdate(true); });
setInterval(() => checkForUpdate(false), 15 * 60 * 1000);

// The splash shows once per 12 hours per device. Inside that window the
// app opens straight to where the tap would have landed.
const SPLASH_KEY = "brochiefs_splash_seen_v1";
const SPLASH_TTL = 12 * 60 * 60 * 1000;
(async () => {
  // Fetch this week's slate before anything renders, so nobody sees last
  // week's games flash past. The splash covers the wait. Whether login is
  // live, and who has claimed a name, comes down in the same breath.
  await Promise.all([loadSlate(), refreshAuthState(), loadWeekSummaries()]);
  lastSlateSignature = slateSignature();
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
