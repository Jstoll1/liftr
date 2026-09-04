// Brochiefs 2026 College Football Pick'em — retro arcade pick app.
// Picks are stored per-manager in localStorage. A game locks (no more
// changes, for anyone) once its kickoff time passes, independent of
// whether that manager has hit "Lock In". Hitting "Lock In" freezes ALL
// of that manager's picks immediately, even for games that haven't
// kicked off yet.

const STORAGE_KEY = "brochiefs_picks_v1";

// NOTE: the sheet only gives day-of-week + ET time, not a calendar date.
// These are set for the assumed Week 1 slate (Sat Aug 29 / Sun Aug 30,
// 2026) — double check against the real schedule and adjust the `date`
// fields below if the actual dates differ.
const GAMES = [
  { id: 1, away: "Liberty", home: "James Madison", favorite: "James Madison", spread: 6.5, kickoff: "2026-08-29T16:00:00Z", kickoffLabel: "Sat 12:00 PM ET", tv: "ESPNU" },
  { id: 2, away: "Miami (OH)", home: "Pitt", favorite: "Pitt", spread: 16.5, kickoff: "2026-08-29T16:30:00Z", kickoffLabel: "Sat 12:30 PM ET", tv: "The CW" },
  { id: 3, away: "Baylor", home: "Auburn", favorite: "Auburn", spread: 7.5, kickoff: "2026-08-29T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "ABC" },
  { id: 4, away: "Boston College", home: "Cincinnati", favorite: "Cincinnati", spread: 7.5, kickoff: "2026-08-29T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "FOX" },
  { id: 5, away: "Tulane", home: "Duke", favorite: "Duke", spread: 7.5, kickoff: "2026-08-29T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "ACCN" },
  { id: 6, away: "Boise State", home: "#2 Oregon", favorite: "#2 Oregon", spread: 24.5, kickoff: "2026-08-29T19:30:00Z", kickoffLabel: "Sat 3:30 PM ET", tv: "CBS" },
  { id: 7, away: "Wyoming", home: "Colorado State", favorite: "Colorado State", spread: 3.5, kickoff: "2026-08-29T22:00:00Z", kickoffLabel: "Sat 6:00 PM ET", tv: "USA" },
  { id: 8, away: "Clemson", home: "#11 LSU", favorite: "#11 LSU", spread: 10, kickoff: "2026-08-29T23:30:00Z", kickoffLabel: "Sat 7:30 PM ET", tv: "ABC", tiebreakerGame: true },
  { id: 9, away: "East Carolina", home: "#13 Alabama", favorite: "#13 Alabama", spread: 27.5, kickoff: "2026-08-29T16:00:00Z", kickoffLabel: "Sat 12:00 PM ET", tv: "ABC" },
  { id: 10, away: "#24 Louisville", home: "#9 Ole Miss", favorite: "#9 Ole Miss", spread: 7, kickoffLabel: "Sun 7:30 PM ET", kickoff: "2026-08-30T23:30:00Z", tv: "ABC" },
];

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

function getManagerState(name) {
  const all = loadAll();
  return all[name] || { picks: {}, tiebreaker: "", lockedIn: false, lockedAt: null };
}

function setManagerState(name, state) {
  const all = loadAll();
  all[name] = state;
  saveAll(all);
}

function isGameLocked(game) {
  return Date.now() >= new Date(game.kickoff).getTime();
}

let currentManager = null;

const loginScreen = document.getElementById("login-screen");
const picksScreen = document.getElementById("picks-screen");
const managerPicker = document.getElementById("manager-picker");
const managerBadge = document.getElementById("manager-badge");
const gamesList = document.getElementById("games-list");
const lockedBanner = document.getElementById("locked-banner");
const lockedBannerSub = document.getElementById("locked-banner-sub");
const tiebreakerInput = document.getElementById("tiebreaker-input");
const lockBtn = document.getElementById("lock-btn");
const picksProgress = document.getElementById("picks-progress");
const switchBtn = document.getElementById("switch-btn");

function renderManagerPicker() {
  const all = loadAll();
  managerPicker.innerHTML = "";
  MANAGERS.forEach((name, i) => {
    const state = all[name];
    const hasPicks = state && Object.keys(state.picks || {}).length > 0;
    const btn = document.createElement("button");
    btn.className = "manager-card" + (hasPicks ? " has-picks" : "");
    btn.innerHTML = `
      <span class="manager-avatar" style="--accent:${AVATAR_COLORS[i % AVATAR_COLORS.length]}">${name[0]}</span>
      <span class="manager-name">${name}</span>
    `;
    btn.addEventListener("click", () => selectManager(name));
    managerPicker.appendChild(btn);
  });
}

function selectManager(name) {
  currentManager = name;
  managerBadge.textContent = name.toUpperCase();
  loginScreen.classList.add("hidden");
  picksScreen.classList.remove("hidden");
  renderPicksScreen();
}

function renderPicksScreen() {
  const state = getManagerState(currentManager);
  const lockedIn = state.lockedIn;

  lockedBanner.classList.toggle("hidden", !lockedIn);
  if (lockedIn) {
    lockedBannerSub.textContent = `Locked at ${new Date(state.lockedAt).toLocaleString()} — picks are final.`;
  }

  gamesList.innerHTML = "";
  GAMES.forEach((game) => {
    const gameLocked = lockedIn || isGameLocked(game);
    const card = document.createElement("div");
    card.className = "game-card" + (gameLocked ? " game-locked" : "");

    const selected = state.picks[game.id];

    card.innerHTML = `
      <div class="game-meta">
        <span>G${game.id} &middot; ${game.kickoffLabel} &middot; ${game.tv}</span>
        <span class="game-status ${gameLocked ? "locked" : "open"}">${gameLocked ? "LOCKED" : "OPEN"}</span>
      </div>
      <div class="matchup-row">
        <button class="team-btn away-btn" type="button">${game.away}<span class="team-spread">${game.favorite === game.away ? "-" + game.spread : "+" + game.spread}</span></button>
        <span class="vs-divider">VS</span>
        <button class="team-btn home-btn" type="button">${game.home}<span class="team-spread">${game.favorite === game.home ? "-" + game.spread : "+" + game.spread}</span></button>
      </div>
    `;

    const awayBtn = card.querySelector(".away-btn");
    const homeBtn = card.querySelector(".home-btn");

    [
      [awayBtn, game.away],
      [homeBtn, game.home],
    ].forEach(([btn, team]) => {
      if (selected === team) btn.classList.add("selected");
      btn.disabled = gameLocked;
      btn.addEventListener("click", () => {
        const s = getManagerState(currentManager);
        s.picks[game.id] = team;
        setManagerState(currentManager, s);
        renderPicksScreen();
      });
    });

    gamesList.appendChild(card);
  });

  const tiebreakerGame = GAMES.find((g) => g.tiebreakerGame);
  const tiebreakerLocked = lockedIn || isGameLocked(tiebreakerGame);
  tiebreakerInput.value = state.tiebreaker || "";
  tiebreakerInput.disabled = tiebreakerLocked;
  tiebreakerInput.oninput = () => {
    const s = getManagerState(currentManager);
    s.tiebreaker = tiebreakerInput.value;
    setManagerState(currentManager, s);
  };

  const totalPicked = Object.keys(state.picks).length;
  picksProgress.textContent = `${totalPicked} of ${GAMES.length} games picked` + (state.tiebreaker ? " · tiebreaker set" : " · tiebreaker not set");

  const allPicked = totalPicked === GAMES.length && String(state.tiebreaker).trim() !== "";
  lockBtn.disabled = lockedIn || !allPicked;
  lockBtn.textContent = lockedIn ? "🔒 PICKS LOCKED IN" : "🔒 LOCK IN PICKS";
}

lockBtn.addEventListener("click", () => {
  const state = getManagerState(currentManager);
  if (state.lockedIn) return;
  state.lockedIn = true;
  state.lockedAt = new Date().toISOString();
  setManagerState(currentManager, state);
  renderPicksScreen();
});

switchBtn.addEventListener("click", () => {
  currentManager = null;
  picksScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  renderManagerPicker();
});

// Re-render periodically so games auto-lock the moment kickoff passes,
// even if the manager just leaves the tab open.
setInterval(() => {
  if (currentManager && !picksScreen.classList.contains("hidden")) {
    renderPicksScreen();
  }
}, 30000);

renderManagerPicker();
