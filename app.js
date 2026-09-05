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
  const favoriteCovered = favMargin > game.spread;
  const underdog = game.favorite === game.away ? game.home : game.away;
  const atsWinner = favoriteCovered ? game.favorite : underdog;
  return { suWinner, atsWinner };
}

// Points earned for one pick given a final score, or null if the game
// hasn't been scored yet.
function scorePick(game, pick, result) {
  const outcome = resultOutcome(game, result);
  if (!outcome) return null;
  if (!pick || !pick.team || !pick.mode) return 0;
  const winner = pick.mode === "SU" ? outcome.suWinner : outcome.atsWinner;
  return pick.team === winner ? pointValue(game, pick.team, pick.mode) : 0;
}

// Fill this in after deploying the Worker (see worker/README.md), e.g.
// "https://liftr-ai.<your-subdomain>.workers.dev". Left blank, the app
// works fine on a single device/browser but the scoreboard can only ever
// show picks made on that same device.
const WORKER_URL = "https://liftr-ai.jhs797.workers.dev";

const STORAGE_KEY = "brochiefs_picks_v1";

// Kickoff dates confirmed against each team's published 2026 schedule:
// Week 1 Saturday slate is Sept 5, 2026; the Louisville/Ole Miss "Music
// City Kickoff" is Sunday, Sept 6, 2026.
// ESPN team IDs, used to hotlink official logos from ESPN's CDN
// (a.espncdn.com/i/teamlogos/ncaa/500/<id>.png) — nothing downloaded or
// stored in this repo, just referenced by URL like any other <img src>.
const GAMES = [
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
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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

async function pushManagerState(manager, state) {
  if (!WORKER_URL) return;
  try {
    await fetch(`${WORKER_URL}/picks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manager, state }),
    });
  } catch {
    // Offline or worker unreachable — local copy still saved, fine.
  }
}

async function fetchAllPicks() {
  if (!WORKER_URL) return null;
  try {
    const res = await fetch(`${WORKER_URL}/picks?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.picks || {};
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
const ESPN_SCOREBOARD_DATES = ["20260905", "20260906"];
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
    const isFinal = (t) => !!t.completed || t.state === "post" || /^STATUS_FINAL/.test(t.name || "") || /^final/i.test(t.shortDetail || t.detail || t.description || "");
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
  for (const date of ESPN_SCOREBOARD_DATES) {
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

async function fetchLiveScores() {
  try {
    const direct = await fetchLiveFromEspn();
    if (Object.keys(direct).length) return direct;
  } catch (err) {
    console.warn("ESPN direct fetch failed, falling back to Worker", err);
  }
  try {
    return await fetchLiveFromWorker();
  } catch {
    return {};
  }
}

// Cloud is the source of truth across devices — pull once per manager
// select and merge into local storage before rendering, so a manager who
// submitted a pick on their phone sees it submitted on their laptop too.
async function syncManagerFromCloud(name) {
  const cloud = await fetchAllPicks();
  if (!cloud || !cloud[name]) return;
  const all = loadAll();
  all[name] = { ...cloud[name], picks: sanitizePicks(cloud[name].picks) };
  saveAll(all);
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

function firstKickoffPassed() {
  return GAMES.some((g) => isGameLocked(g));
}

const logoScreen = document.getElementById("logo-screen");
const loginScreen = document.getElementById("login-screen");
const picksScreen = document.getElementById("picks-screen");
const scoreboardScreen = document.getElementById("scoreboard-screen");
const managerPicker = document.getElementById("manager-picker");
const managerBadge = document.getElementById("manager-badge");
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
const navHomeBtn = document.getElementById("nav-home-btn");
const navPicksBtn = document.getElementById("nav-picks-btn");
const navScoreboardBtn = document.getElementById("nav-scoreboard-btn");
const navHistoryBtn = document.getElementById("nav-history-btn");
const historyScreen = document.getElementById("history-screen");
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
  requestAnimationFrame(() => { appScroll.scrollTop = savedScroll[name] ?? 0; });
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
    managerBadge.textContent = me.toUpperCase();
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
  [navHomeBtn, navPicksBtn, navScoreboardBtn, navHistoryBtn].forEach((btn) => btn.classList.remove("active"));
  if (target === "history") navHistoryBtn.classList.add("active");
  if (target === "home") navHomeBtn.classList.add("active");
  if (target === "picks") navPicksBtn.classList.add("active");
  if (target === "scoreboard") navScoreboardBtn.classList.add("active");
}

// Roster view from anywhere — the wordmark header is visible on every
// screen except the splash, so this is always reachable. Deliberately
// does NOT forget who you are: your card is marked YOU, and picking a
// different card asks for confirmation before switching.
function goHome() {
  rememberScroll();
  historyScreen.classList.add("hidden");
  picksScreen.classList.add("hidden");
  scoreboardScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  renderManagerPicker();
  setActiveNav("home");
  enterScreen("home");
}

logoScreen.addEventListener("click", goToPlayerSelect);
track("/splash");
rulesOpenBtn.addEventListener("click", openRules);
rulesCloseBtn.addEventListener("click", closeRules);
homeLogoBtn.addEventListener("click", goHome);
document.getElementById("me-pill")?.addEventListener("click", openOwnerPicker);

navHomeBtn.addEventListener("click", goHome);
navPicksBtn.addEventListener("click", () => {
  if (!currentManager) {
    goHome();
    return;
  }
  rememberScroll();
  historyScreen.classList.add("hidden");
  scoreboardScreen.classList.add("hidden");
  loginScreen.classList.add("hidden");
  picksScreen.classList.remove("hidden");
  renderPicksScreen();
  setActiveNav("picks");
  enterScreen("picks");
});

function showHistory() {
  if (!currentManager) openClaimPrompt();
  rememberScroll();
  loginScreen.classList.add("hidden");
  picksScreen.classList.add("hidden");
  scoreboardScreen.classList.add("hidden");
  historyScreen.classList.remove("hidden");
  setActiveNav("history");
  enterScreen("history");
}
navHistoryBtn.addEventListener("click", showHistory);

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
        <span class="manager-pick-status">${complete ? "✓ All in" : partial ? `${submittedCount}/${GAMES.length} in` : ""}</span>
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
  claimGrid.querySelectorAll(".claim-btn").forEach((btn) => btn.addEventListener("click", () => {
    const name = btn.dataset.name;
    claimModal.classList.add("hidden");
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
    saveMe(name);
    currentManager = name;
    managerBadge.textContent = name.toUpperCase();
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
identityConfirmBtn.addEventListener("click", () => {
  const name = pendingIdentity;
  closeIdentityConfirm();
  if (name) {
    saveMe(name);
    selectManager(name);
  }
});

async function selectManager(name) {
  rememberScroll();
  historyScreen.classList.add("hidden");
  currentManager = name;
  saveMe(name);
  managerBadge.textContent = name.toUpperCase();
  loginScreen.classList.add("hidden");
  scoreboardScreen.classList.add("hidden");
  picksScreen.classList.remove("hidden");
  renderPicksScreen();
  setActiveNav("picks");
  enterScreen("picks");
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
      <img class="team-card-logo" src="${logoUrl(teamId)}" alt="" loading="lazy" onerror="this.style.display='none'" />
      <span class="team-card-spread">${spreadDisplay}</span>
      <span class="team-card-name">${team}</span>
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

function renderPicksScreen() {
  const state = getManagerState(currentManager);
  lastLockSignature = lockSignature();

  gamesList.innerHTML = "";
  GAMES.forEach((game) => {
    const gameLocked = isGameLocked(game);
    const pick = state.picks[game.id];

    const card = document.createElement("div");
    card.className =
      "game-card" +
      (gameLocked ? " game-locked" : "") +
      (pick ? " game-submitted" : "") +
      (justSavedGameId === game.id ? " just-saved" : "");

    let statusLabel = "OPEN";
    let statusClass = "open";
    if (gameLocked) {
      statusLabel = "LOCKED";
      statusClass = "locked";
    } else if (pick && justSavedGameId === game.id && justSavedKind === "updated") {
      statusLabel = "UPDATED ✓";
      statusClass = "submitted updated";
    } else if (pick) {
      statusLabel = "SAVED ✓";
      statusClass = "submitted";
    }

    const noteVerb = justSavedGameId === game.id && justSavedKind === "updated" ? "Updated" : "Saved";
    const note = gameLocked
      ? pick ? `Final pick: ${pickLabel(game, pick)}` : "No pick made — locked"
      : pick ? `✓ ${noteVerb}: ${pickLabel(game, pick)}` : "Tap a button to pick — it saves instantly";

    card.innerHTML = `
      <div class="game-meta">
        <span>G${game.id} &middot; ${game.kickoffLabel} &middot; ${game.tv}</span>
        <span class="game-status ${statusClass}">${statusLabel}</span>
      </div>
      ${matchupCardsHtml(game, pick)}
      <div class="game-submit-row">
        <span class="game-submit-note">${note}</span>
      </div>
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
        s.picks[game.id] = { team, mode };
        setManagerState(currentManager, s);
        pushManagerState(currentManager, s);
        justSavedGameId = game.id;
        justSavedKind = changed ? "updated" : "saved";
        track(changed ? "pick-updated" : "pick-saved", { event: true });
        withScrollPreserved(renderPicksScreen);
        setTimeout(() => {
          if (justSavedGameId !== game.id) return;
          justSavedGameId = null;
          withScrollPreserved(renderPicksScreen);
        }, 2500);
      });
    });

    gamesList.appendChild(card);
  });

  const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
  const tiebreakerLocked = isGameLocked(tiebreakerGame);
  // Don't clobber a number someone is mid-typing on a background redraw.
  if (document.activeElement !== tiebreakerInput) {
    tiebreakerInput.value = state.tiebreaker || "";
  }
  tiebreakerInput.disabled = tiebreakerLocked;
  tiebreakerStatus.textContent = tiebreakerLocked
    ? state.tiebreaker ? `Final: ${state.tiebreaker}` : "No tiebreaker entered — locked"
    : state.tiebreaker ? `✓ Saved: ${state.tiebreaker}` : "Saves as you type";

  updatePicksProgress(state);
}

function updatePicksProgress(state) {
  const totalPicked = Object.values(state.picks).filter(Boolean).length;
  picksProgress.textContent =
    `${totalPicked} of ${GAMES.length} games picked` + (state.tiebreaker ? " · tiebreaker set" : " · tiebreaker not set");
}

// Tiebreaker saves as you type (debounced), no button.
let tiebreakerSaveTimer = null;
tiebreakerInput.addEventListener("input", () => {
  clearTimeout(tiebreakerSaveTimer);
  tiebreakerSaveTimer = setTimeout(() => {
    if (!currentManager) return;
    const s = getManagerState(currentManager);
    s.tiebreaker = tiebreakerInput.value.trim();
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
  loginScreen.classList.add("hidden");
  picksScreen.classList.add("hidden");
  scoreboardScreen.classList.remove("hidden");
  setActiveNav("scoreboard");
  enterScreen("scoreboard");
  withScrollPreserved(renderScoreboard);
}


async function renderScoreboard() {
  const rawPicks = (await fetchAllPicks()) || loadAll();
  const cloudPicks = {};
  MANAGERS.forEach((name) => {
    const state = rawPicks[name];
    if (state) cloudPicks[name] = { ...state, picks: sanitizePicks(state.picks) };
  });
  const live = await fetchLiveScores();
  const results = computeLiveResults(live);

  renderLiveScores(live, cloudPicks);
  renderScoreboardTable(cloudPicks, results, live);
  renderRankings(cloudPicks, results);
  renderInsertCoin(cloudPicks);
  const stamp = document.getElementById("scoreboard-updated");
  if (stamp) {
    const src = Object.keys(live).length ? "ESPN" : "no live data";
    stamp.textContent = `updated ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })} · ${src} · tap to refresh`;
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
function bugSideDetail(cloudPicks, game, team, short) {
  const isFav = team === game.favorite;
  const spreadTxt = isFav ? `-${game.spread}` : `+${game.spread}`;
  const ats = pickersFor(cloudPicks, game.id, team, "ATS");
  const su = pickersFor(cloudPicks, game.id, team, "SU");
  const rows = [];
  if (ats.length) rows.push(`<div class="bug-pick-group"><span class="bug-pick-tag ats">SPREAD ${spreadTxt}</span><div class="pick-chips">${nameChips(ats)}</div></div>`);
  if (su.length) rows.push(`<div class="bug-pick-group"><span class="bug-pick-tag su">STRAIGHT UP</span><div class="pick-chips">${nameChips(su)}</div></div>`);
  return `
    <div class="bug-side">
      <div class="bug-side-head"><span>${short}</span><span class="bug-side-count">${ats.length + su.length}</span></div>
      ${rows.length ? rows.join("") : '<div class="bug-pick-group none">nobody</div>'}
    </div>
  `;
}

function renderLiveScores(live, cloudPicks) {
  // Compact scorebugs in a 2-up grid, every game from the start. Tap a
  // bug to expand the who-picked-what lists (only once that game has
  // kicked off). A red pulsing dot marks games that are live right now.
  // Open bugs float to the front so the grid never leaves a hole beside
  // a tall card; the rest keep kickoff order.
  const ordered = [...GAMES]
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff) || a.id - b.id)
    .sort((a, b) => (expandedGames.has(b.id) ? 1 : 0) - (expandedGames.has(a.id) ? 1 : 0));
  const liveCount = ordered.filter((g) => { const l = live[g.id]; return isGameLocked(g) && l && l.found && l.state === "in" && !l.completed; }).length;
  // Live count rides in the top bar title instead of a section heading.
  const title = document.getElementById("scoreboard-title");
  if (title) {
    title.innerHTML = liveCount > 0
      ? `📡 SCOREBOARD <span class="live-dot"></span> ${liveCount} LIVE`
      : "📡 LIVE SCOREBOARD";
  }

  liveScoresList.innerHTML = `<div class="bug-grid">` + ordered
    .map((game) => {
      const locked = isGameLocked(game);
      const g = live[game.id];
      const found = locked && g && g.found;
      const isLive = found && g.state === "in" && !g.completed;
      const isFinal = found && g.completed;
      const expanded = expandedGames.has(game.id);

      const statusText = !locked
        ? game.kickoffLabel.replace(/^(Sat|Sun) /, "")
        : isFinal
          ? "FINAL"
          : isLive
            ? (g.detail || `Q${g.period ?? "?"} ${g.clock ?? ""}`)
            : (found && g.state === "pre" ? game.kickoffLabel.replace(/^(Sat|Sun) /, "") : found ? (g.detail || "Scheduled") : "Waiting…");

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
        <div class="bug-row ${lead ? "leading" : ""}">
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
             ${bugSideDetail(cloudPicks, game, game.away, game.awayShort)}
             ${bugSideDetail(cloudPicks, game, game.home, game.homeShort)}
             ${winProbHtml}
           </div>`
        : `<div class="bug-detail"><span class="bug-hidden-note">🔒 Picks reveal at kickoff (${game.kickoffLabel})</span></div>`;

      const cls = ["scorebug", isLive ? "is-live" : "", isFinal ? "is-final" : "", !locked ? "upcoming" : "", expanded ? "expanded" : ""].join(" ");

      return `
        <div class="${cls}" data-game="${game.id}" role="button" tabindex="0" aria-expanded="${expanded}">
          <div class="bug-head">
            <span class="bug-gnum">G${game.id}</span>
            <span class="bug-status">${isLive ? '<span class="live-dot"></span>' : ""}${statusText}</span>
            ${locked && !expanded ? (() => {
              const ac = pickersFor(cloudPicks, game.id, game.away, "ATS").length + pickersFor(cloudPicks, game.id, game.away, "SU").length;
              const hc = pickersFor(cloudPicks, game.id, game.home, "ATS").length + pickersFor(cloudPicks, game.id, game.home, "SU").length;
              const tot = Math.max(1, ac + hc);
              return `<span class="bug-count-bars" title="${ac} on ${game.awayShort}, ${hc} on ${game.homeShort}"><span class="bug-count-bar away" style="width:${Math.round(ac / tot * 100)}%"></span><span class="bug-count-bar home" style="width:${Math.round(hc / tot * 100)}%"></span></span>`;
            })() : ""}
            <span class="bug-caret">${expanded ? "▴" : "▾"}</span>
          </div>
          ${row(game.away, game.awayShort, game.awayId, awayScore, awayLead, awayFav, awayPop)}
          ${row(game.home, game.homeShort, game.homeId, homeScore, homeLead, !awayFav, homePop)}
          ${!expanded ? (isLive && g.winProb
            ? `<div class="bug-prob-strip"><span class="away" style="width:${g.winProb.away}%"></span><span class="home" style="width:${g.winProb.home}%"></span></div>`
            : `<div class="bug-prob-strip empty"></div>`) : ""}
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
  const headCells = GAMES.map((g) => `<th class="${results[g.id] ? "final" : isGameLocked(g) ? "live" : ""}">G${g.id}</th>`).join("");
  let html = `<thead><tr><th class="manager-col">Team</th>${headCells}<th>TB</th><th>PTS</th></tr></thead><tbody>`;

  MANAGERS.forEach((name) => {
    const state = cloudPicks[name] || { picks: {}, tiebreaker: "" };
    let total = 0;
    const cells = GAMES.map((game) => {
      const gameStarted = isGameLocked(game);
      const pick = state.picks[game.id];

      if (!gameStarted) {
        return `<td class="pick-cell hidden-pick">🔒</td>`;
      }
      if (!pick) {
        return `<td class="pick-cell pending">—</td>`;
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
      const badge = pts === null ? "" : pts >= 3 ? `<span class="pick-badge upset">+3</span>` : pts === 2 ? `<span class="pick-badge hit2">+2</span>` : pts > 0 ? `<span class="pick-badge hit">+1</span>` : `<span class="pick-badge miss">✗</span>`;
      return `<td class="pick-cell ${cls}" title="${short} ${pick.mode}${pts !== null ? ` · ${pts} pt` : ""}"><span class="pick-mark">${badge}<img class="pick-cell-logo" src="${logoUrl(pickId)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pick-cell-short',textContent:'${short}'}))" /></span>${spreadTag}</td>`;
    }).join("");

    const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
    const tbVisible = isGameLocked(tiebreakerGame);
    const tbCell = tbVisible ? (state.tiebreaker || "—") : "🔒";
    const submittedCount = Object.values(state.picks).filter(Boolean).length;

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

function renderRankings(cloudPicks, results) {
  const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
  const tbResult = results[tiebreakerGame.id];
  const actualTotal = tbResult ? tbResult.awayScore + tbResult.homeScore : null;

  const rows = MANAGERS.map((name) => {
    const state = cloudPicks[name] || { picks: {} };
    const submittedCount = Object.values(state.picks).filter(Boolean).length;
    const tbGuess = Number(state.tiebreaker);
    const tbDiff = actualTotal !== null && Number.isFinite(tbGuess) ? Math.abs(tbGuess - actualTotal) : Infinity;
    return { name, score: computeScore(state, results), submittedCount, tbDiff };
  }).sort((a, b) => b.score - a.score || a.tbDiff - b.tbDiff);

  rankingsList.innerHTML = "";
  rows.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "ranking-row" + (i === 0 && row.score > 0 ? " rank-1" : "") + (row.name === currentManager ? " is-me" : "");
    div.innerHTML = `
      <span class="ranking-place">#${i + 1}</span>
      <span class="ranking-name">${row.name}</span>
      <span class="ranking-lock">${row.submittedCount}/${GAMES.length} submitted</span>
      <span class="ranking-score">${row.score} PTS</span>
    `;
    rankingsList.appendChild(div);
  });
}

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
    }
  }
  if (!scoreboardScreen.classList.contains("hidden")) {
    withScrollPreserved(renderScoreboard);
  }
}, 20000);

// Timers pause while the phone is locked or the app is in the background.
// Refresh the moment it comes back so the board never shows stale scores.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!scoreboardScreen.classList.contains("hidden")) withScrollPreserved(renderScoreboard);
  if (currentManager && !picksScreen.classList.contains("hidden")) withScrollPreserved(renderPicksScreen);
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted && !scoreboardScreen.classList.contains("hidden")) withScrollPreserved(renderScoreboard);
});

renderManagerPicker();
