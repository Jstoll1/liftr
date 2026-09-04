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
  { id: 1, away: "Liberty", awayId: 2335, home: "James Madison", homeId: 2349, favorite: "James Madison", spread: 6.5, kickoff: "2026-09-05T16:00:00Z", kickoffLabel: "Sat 12:00 PM ET", tv: "ESPNU" },
  { id: 2, away: "Miami (OH)", awayId: 193, home: "Pitt", homeId: 221, favorite: "Pitt", spread: 16.5, kickoff: "2026-09-05T16:30:00Z", kickoffLabel: "Sat 12:30 PM ET", tv: "The CW" },
  { id: 3, away: "Baylor", awayId: 239, home: "Auburn", homeId: 2, favorite: "Auburn", spread: 7.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "ABC" },
  { id: 4, away: "Boston College", awayId: 103, home: "Cincinnati", homeId: 2132, favorite: "Cincinnati", spread: 7.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "FOX" },
  { id: 5, away: "Tulane", awayId: 2655, home: "Duke", homeId: 150, favorite: "Duke", spread: 7.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "ACCN" },
  { id: 6, away: "Boise State", awayId: 68, home: "#2 Oregon", homeId: 2483, favorite: "#2 Oregon", spread: 24.5, kickoff: "2026-09-05T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "CBS" },
  { id: 7, away: "Wyoming", awayId: 2751, home: "Colorado State", homeId: 36, favorite: "Colorado State", spread: 3.5, kickoff: "2026-09-05T22:00:00Z", kickoffLabel: "Sat 6:00 PM ET", tv: "USA" },
  { id: 8, away: "Clemson", awayId: 228, home: "#11 LSU", homeId: 99, favorite: "#11 LSU", spread: 10, kickoff: "2026-09-05T23:30:00Z", kickoffLabel: "Sat 7:30 PM ET", tv: "ABC", tiebreakerGame: true },
  { id: 9, away: "East Carolina", awayId: 151, home: "#13 Alabama", homeId: 333, favorite: "#13 Alabama", spread: 27.5, kickoff: "2026-09-05T16:00:00Z", kickoffLabel: "Sat 12:00 PM ET", tv: "ABC" },
  { id: 10, away: "#24 Louisville", awayId: 97, home: "#9 Ole Miss", homeId: 145, favorite: "#9 Ole Miss", spread: 7, kickoffLabel: "Sun 7:30 PM ET", kickoff: "2026-09-06T23:30:00Z", tv: "ABC" },
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
    const res = await fetch(`${WORKER_URL}/picks`);
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
async function fetchLiveScores() {
  if (!WORKER_URL) return {};
  try {
    const res = await fetch(`${WORKER_URL}/live`);
    if (!res.ok) return {};
    const data = await res.json();
    const byId = {};
    (data.games || []).forEach((g) => {
      if (g && g.found) byId[g.id] = g;
    });
    return byId;
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

// Ephemeral, per-manager, not persisted: what's currently selected on
// screen but not yet submitted. Reset whenever a manager is (re)selected.
let draftPicks = {};
let draftTiebreaker = null;

const logoScreen = document.getElementById("logo-screen");
const loginScreen = document.getElementById("login-screen");
const picksScreen = document.getElementById("picks-screen");
const scoreboardScreen = document.getElementById("scoreboard-screen");
const managerPicker = document.getElementById("manager-picker");
const managerBadge = document.getElementById("manager-badge");
const gamesList = document.getElementById("games-list");
const tiebreakerInput = document.getElementById("tiebreaker-input");
const tiebreakerSubmitBtn = document.getElementById("tiebreaker-submit-btn");
const tiebreakerStatus = document.getElementById("tiebreaker-status");
const picksProgress = document.getElementById("picks-progress");
const switchBtn = document.getElementById("switch-btn");
const toScoreboardBtn = document.getElementById("to-scoreboard-btn");
const scoreboardBackBtn = document.getElementById("scoreboard-back-btn");
const scoreboardRefreshBtn = document.getElementById("scoreboard-refresh-btn");
const liveScoresList = document.getElementById("live-scores-list");
const rankingsList = document.getElementById("rankings-list");
const scoreboardTable = document.getElementById("scoreboard-table");
const rulesModal = document.getElementById("rules-modal");
const rulesOpenBtn = document.getElementById("rules-open-btn");
const rulesCloseBtn = document.getElementById("rules-close-btn");
const homeHeader = document.getElementById("home-header");
const homeLogoBtn = document.getElementById("home-logo-btn");

// --- Logo / splash screen ---------------------------------------------

const RULES_SEEN_KEY = "brochiefs_rules_seen_v1";

function openRules() {
  rulesModal.classList.remove("hidden");
}

function closeRules() {
  rulesModal.classList.add("hidden");
  localStorage.setItem(RULES_SEEN_KEY, "1");
}

function goToPlayerSelect() {
  logoScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  homeHeader.classList.remove("hidden");
  if (!localStorage.getItem(RULES_SEEN_KEY)) openRules();
}

// Jumps back to player select from anywhere — the wordmark header is
// visible on every screen except the splash, so this is always reachable.
function goHome() {
  currentManager = null;
  picksScreen.classList.add("hidden");
  scoreboardScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  renderManagerPicker();
}

logoScreen.addEventListener("click", goToPlayerSelect);
rulesOpenBtn.addEventListener("click", openRules);
rulesCloseBtn.addEventListener("click", closeRules);
homeLogoBtn.addEventListener("click", goHome);

// Deterministic per-name "identicon" — a small symmetric pixel-grid
// avatar, generated from the name itself so it's stable across every
// device/session with no image assets or network calls. Mirrored
// horizontally, classic identicon style, rendered as inline SVG.
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function avatarSvg(name, accent) {
  let seed = hashString(name) || 1;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return (seed >>> 16) / 65535;
  };
  const cols = 5;
  const rows = 5;
  const half = Math.ceil(cols / 2);
  const rects = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < half; x++) {
      if (rand() <= 0.55) continue;
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" />`);
      const mirrorX = cols - 1 - x;
      if (mirrorX !== x) rects.push(`<rect x="${mirrorX}" y="${y}" width="1" height="1" />`);
    }
  }
  return `<svg viewBox="0 0 ${cols} ${rows}" xmlns="http://www.w3.org/2000/svg" fill="${accent}" shape-rendering="crispEdges">${rects.join("")}</svg>`;
}

async function renderManagerPicker() {
  const local = loadAll();
  const cloud = await fetchAllPicks();
  const all = cloud ? { ...local, ...cloud } : local; // cloud wins where it has data

  managerPicker.innerHTML = "";
  MANAGERS.forEach((name, i) => {
    const state = all[name];
    const submittedCount = state ? Object.keys(sanitizePicks(state.picks)).length : 0;
    const tiebreakerDone = !!(state && String(state.tiebreaker || "").trim() !== "");
    const complete = submittedCount === GAMES.length && tiebreakerDone;
    const partial = !complete && (submittedCount > 0 || tiebreakerDone);

    const isChamp = name === "Jake";
    const accent = AVATAR_COLORS[i % AVATAR_COLORS.length];

    const btn = document.createElement("button");
    btn.className = "manager-card" + (complete ? " has-picks" : "") + (partial ? " partial-picks" : "") + (isChamp ? " defending-champ" : "");
    btn.style.setProperty("--accent", accent);
    btn.innerHTML = `
      <span class="player-tag">P${i + 1}</span>
      <span class="badge-slot">${isChamp ? `<span class="champ-badge">🏆 Defending Champ</span>` : ""}</span>
      <span class="manager-avatar-ring">
        <span class="manager-avatar">${avatarSvg(name, accent)}</span>
      </span>
      <span class="manager-name-plate">
        <span class="manager-name">${name}</span>
        <span class="manager-pick-status">${complete ? "✓ All in" : partial ? `${submittedCount}/${GAMES.length} in` : ""}</span>
      </span>
    `;
    btn.addEventListener("click", () => selectManager(name));
    managerPicker.appendChild(btn);
  });
}

async function selectManager(name) {
  currentManager = name;
  draftPicks = {};
  draftTiebreaker = null;
  managerBadge.textContent = name.toUpperCase();
  loginScreen.classList.add("hidden");
  picksScreen.classList.remove("hidden");
  renderPicksScreen();
  await syncManagerFromCloud(name);
  renderPicksScreen();
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

function renderPicksScreen() {
  const state = getManagerState(currentManager);

  gamesList.innerHTML = "";
  GAMES.forEach((game) => {
    const gameLocked = isGameLocked(game);
    const submittedPick = state.picks[game.id];

    if (draftPicks[game.id] === undefined) {
      draftPicks[game.id] = submittedPick;
    }
    const draft = draftPicks[game.id];
    const hasUnsavedChange = draft && !pickEqual(draft, submittedPick);

    const card = document.createElement("div");
    card.className = "game-card" + (gameLocked ? " game-locked" : "") + (submittedPick && !hasUnsavedChange ? " game-submitted" : "");

    let statusLabel = "OPEN";
    let statusClass = "open";
    if (gameLocked) {
      statusLabel = "LOCKED";
      statusClass = "locked";
    } else if (submittedPick && !hasUnsavedChange) {
      statusLabel = "SUBMITTED";
      statusClass = "submitted";
    }

    card.innerHTML = `
      <div class="game-meta">
        <span>G${game.id} &middot; ${game.kickoffLabel} &middot; ${game.tv}</span>
        <span class="game-status ${statusClass}">${statusLabel}</span>
      </div>
      ${matchupCardsHtml(game, draft)}
      <div class="game-submit-row">
        <span class="game-submit-note">${gameLocked ? (submittedPick ? `Final pick: ${pickLabel(game, submittedPick)}` : "No pick submitted — locked") : submittedPick && !hasUnsavedChange ? `✓ Submitted: ${pickLabel(game, submittedPick)}` : ""}</span>
        <button class="ghost-btn submit-pick-btn" type="button" ${gameLocked ? "disabled" : ""}>Submit</button>
      </div>
    `;

    const submitPickBtn = card.querySelector(".submit-pick-btn");

    card.querySelectorAll(".pick-mini-btn").forEach((btn) => {
      const team = btn.dataset.team;
      const mode = btn.dataset.mode;
      btn.disabled = gameLocked;
      btn.addEventListener("click", () => {
        draftPicks[game.id] = { team, mode };
        renderPicksScreen();
      });
    });

    submitPickBtn.disabled = gameLocked || !draft || pickEqual(draft, submittedPick);
    submitPickBtn.textContent = submittedPick && !hasUnsavedChange ? "Submitted" : "Submit";
    submitPickBtn.addEventListener("click", () => {
      const s = getManagerState(currentManager);
      s.picks[game.id] = draft;
      setManagerState(currentManager, s);
      pushManagerState(currentManager, s);
      renderPicksScreen();
    });

    gamesList.appendChild(card);
  });

  const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
  const tiebreakerLocked = isGameLocked(tiebreakerGame);
  if (draftTiebreaker === null) {
    draftTiebreaker = state.tiebreaker || "";
  }
  tiebreakerInput.value = draftTiebreaker;
  tiebreakerInput.disabled = tiebreakerLocked;
  tiebreakerInput.oninput = () => {
    draftTiebreaker = tiebreakerInput.value;
    const changed = draftTiebreaker !== "" && draftTiebreaker !== String(state.tiebreaker || "");
    tiebreakerSubmitBtn.disabled = tiebreakerLocked || !changed;
  };
  const tbChanged = draftTiebreaker !== "" && draftTiebreaker !== String(state.tiebreaker || "");
  tiebreakerSubmitBtn.disabled = tiebreakerLocked || !tbChanged;
  tiebreakerStatus.textContent = tiebreakerLocked
    ? (state.tiebreaker ? `Final: ${state.tiebreaker}` : "No tiebreaker submitted — locked")
    : state.tiebreaker ? `✓ Submitted: ${state.tiebreaker}` : "";

  const totalSubmitted = Object.values(state.picks).filter(Boolean).length;
  picksProgress.textContent = `${totalSubmitted} of ${GAMES.length} games submitted` + (state.tiebreaker ? " · tiebreaker submitted" : " · tiebreaker not submitted");
}

tiebreakerSubmitBtn.addEventListener("click", () => {
  const s = getManagerState(currentManager);
  s.tiebreaker = draftTiebreaker;
  setManagerState(currentManager, s);
  pushManagerState(currentManager, s);
  renderPicksScreen();
});

switchBtn.addEventListener("click", goHome);

// --- Scoreboard ------------------------------------------------------------

function showScoreboard() {
  picksScreen.classList.add("hidden");
  scoreboardScreen.classList.remove("hidden");
  renderScoreboard();
}

toScoreboardBtn.addEventListener("click", showScoreboard);
scoreboardBackBtn.addEventListener("click", () => {
  scoreboardScreen.classList.add("hidden");
  picksScreen.classList.remove("hidden");
  renderPicksScreen();
});
scoreboardRefreshBtn.addEventListener("click", renderScoreboard);

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
  renderScoreboardTable(cloudPicks, results);
  renderRankings(cloudPicks, results);
}

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

function renderLiveScores(live, cloudPicks) {
  const started = GAMES.filter((g) => isGameLocked(g));
  if (started.length === 0) {
    liveScoresList.innerHTML = `<p class="live-scores-empty">Live scores &amp; who-picked-who show up here once the first game kicks off.</p>`;
    return;
  }

  liveScoresList.innerHTML = `<span class="rules-heading live-scores-heading">📡 LIVE SCOREBOARD</span>` + started
    .map((game) => {
      const g = live[game.id];
      const found = g && g.found;

      const statusText = found
        ? g.completed
          ? "FINAL"
          : g.state === "in"
            ? g.detail || `Q${g.period ?? "?"} ${g.clock ?? ""}`
            : g.detail || "Scheduled"
        : "Waiting for score…";
      const awayScore = found ? g.awayScore ?? "—" : "—";
      const homeScore = found ? g.homeScore ?? "—" : "—";
      const awayLead = found && g.awayScore !== null && g.homeScore !== null && g.awayScore > g.homeScore;
      const homeLead = found && g.awayScore !== null && g.homeScore !== null && g.homeScore > g.awayScore;

      const winProbHtml = found && g.winProb
        ? `
          <div class="win-prob-bar">
            <div class="win-prob-fill away" style="width:${g.winProb.away}%"></div>
            <div class="win-prob-fill home" style="width:${g.winProb.home}%"></div>
          </div>
          <div class="win-prob-labels">
            <span>${Math.round(g.winProb.away)}% ${game.away}</span>
            <span>${Math.round(g.winProb.home)}% ${game.home}</span>
          </div>
        `
        : "";

      const awayPickers = teamPickersHtml(cloudPicks, game, game.away, "SU", "SU") + teamPickersHtml(cloudPicks, game, game.away, "ATS", "ATS");
      const homePickers = teamPickersHtml(cloudPicks, game, game.home, "SU", "SU") + teamPickersHtml(cloudPicks, game, game.home, "ATS", "ATS");

      return `
        <div class="live-score-card ${found && g.completed ? "final" : found && g.state === "in" ? "in-progress" : ""}">
          <div class="live-score-grid">
            <div class="live-score-col ${awayLead ? "leading" : ""}">
              <img class="live-score-logo" src="${logoUrl(game.awayId)}" alt="" loading="lazy" onerror="this.style.display='none'" />
              <span class="live-score-team-name">${game.away}</span>
              <span class="live-score-number">${awayScore}</span>
              <div class="live-score-pickers">${awayPickers || '<span class="picker-line none">&mdash;</span>'}</div>
            </div>
            <div class="live-score-mid">
              <span class="live-score-status">${statusText}</span>
              <span class="live-score-vs">@</span>
            </div>
            <div class="live-score-col ${homeLead ? "leading" : ""}">
              <img class="live-score-logo" src="${logoUrl(game.homeId)}" alt="" loading="lazy" onerror="this.style.display='none'" />
              <span class="live-score-team-name">${game.home}</span>
              <span class="live-score-number">${homeScore}</span>
              <div class="live-score-pickers">${homePickers || '<span class="picker-line none">&mdash;</span>'}</div>
            </div>
          </div>
          ${winProbHtml}
        </div>
      `;
    })
    .join("");
}

function renderScoreboardTable(cloudPicks, results) {
  const headCells = GAMES.map((g) => `<th>G${g.id}</th>`).join("");
  let html = `<thead><tr><th class="manager-col">Manager</th>${headCells}<th>Tiebreak</th><th>PTS</th></tr></thead><tbody>`;

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
      const cls = pts === null ? "pending" : pts > 0 ? "correct" : "incorrect";
      const pickId = pick.team === game.away ? game.awayId : game.homeId;
      const label = `${pick.team} ${pick.mode}`;
      const ptsLabel = pts !== null ? ` (${pts})` : "";
      return `<td class="pick-cell ${cls}"><img class="pick-cell-logo" src="${logoUrl(pickId)}" alt="" loading="lazy" onerror="this.style.display='none'" />${label}${ptsLabel}</td>`;
    }).join("");

    const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
    const tbVisible = isGameLocked(tiebreakerGame);
    const tbCell = tbVisible ? (state.tiebreaker || "—") : "🔒";
    const submittedCount = Object.values(state.picks).filter(Boolean).length;

    html += `<tr><td class="manager-col">${name} <span class="ranking-lock">(${submittedCount}/${GAMES.length})</span></td>${cells}<td>${tbCell}</td><td><strong>${total}</strong></td></tr>`;
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
    div.className = "ranking-row" + (i === 0 && row.score > 0 ? " rank-1" : "");
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
setInterval(() => {
  if (currentManager && !picksScreen.classList.contains("hidden")) {
    renderPicksScreen();
  }
  if (!scoreboardScreen.classList.contains("hidden")) {
    renderScoreboard();
  }
}, 30000);

renderManagerPicker();
