(() => {
  "use strict";

  const STORAGE_KEY = "liftr_history_v1";
  const CURRENT_USER_KEY = "liftr_current_user";

  // Rotation order for the training split. "Rest" is inferred separately
  // (same-day completion), it isn't a step in the rotation itself.
  const SPLIT_ORDER = ["chest-back", "legs", "cardio"];

  const PERSONAS = {
    jessica: {
      name: "Jessica",
      accent: "#ff5da2",
      goal: "Build lean endurance for her first half-marathon",
    },
    jake: {
      name: "Jake",
      accent: "#4fc3ff",
      goal: "Pack on strength for a 405lb deadlift",
    },
  };

  const SPLIT_LIBRARY = {
    "chest-back": {
      name: "Chest & Back",
      icon: "💪",
      tagline: "Push-pull strength builder",
      exercises: {
        jessica: [
          { name: "Push-Up Ladder", detail: "3 x 12" },
          { name: "Lat Pulldown", detail: "3 x 15" },
          { name: "Dumbbell Chest Press", detail: "3 x 12" },
          { name: "Seated Cable Row", detail: "3 x 15" },
          { name: "Plank to Row", detail: "3 x 10/side" },
        ],
        jake: [
          { name: "Barbell Bench Press", detail: "4 x 6" },
          { name: "Weighted Pull-Ups", detail: "4 x 6" },
          { name: "Incline Dumbbell Press", detail: "3 x 8" },
          { name: "Bent-Over Barbell Row", detail: "4 x 8" },
          { name: "Cable Fly", detail: "3 x 12" },
        ],
      },
    },
    legs: {
      name: "Leg Day",
      icon: "🦵",
      tagline: "Lower body power & stability",
      exercises: {
        jessica: [
          { name: "Goblet Squat", detail: "3 x 15" },
          { name: "Step-Ups", detail: "3 x 12/leg" },
          { name: "Glute Bridge", detail: "3 x 15" },
          { name: "Lateral Band Walk", detail: "3 x 20" },
          { name: "Bodyweight Lunge", detail: "3 x 12/leg" },
        ],
        jake: [
          { name: "Barbell Back Squat", detail: "5 x 5" },
          { name: "Romanian Deadlift", detail: "4 x 6" },
          { name: "Walking Lunges", detail: "3 x 10/leg" },
          { name: "Leg Press", detail: "3 x 10" },
          { name: "Standing Calf Raise", detail: "4 x 15" },
        ],
      },
    },
    cardio: {
      name: "Cardio",
      icon: "🔥",
      tagline: "Conditioning & active recovery",
      exercises: {
        jessica: [
          { name: "Tempo Run", detail: "25 min" },
          { name: "Stair Climber Intervals", detail: "15 min" },
          { name: "Cycling", detail: "20 min" },
          { name: "Mobility Flow", detail: "10 min" },
        ],
        jake: [
          { name: "Rowing Intervals", detail: "8 x 500m" },
          { name: "Sled Push", detail: "6 rounds" },
          { name: "Battle Ropes", detail: "5 x 30s" },
          { name: "Jump Rope Finisher", detail: "5 min" },
        ],
      },
    },
  };

  // ---------- storage helpers ----------

  function loadAllHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveAllHistory(all) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  function getHistory(user) {
    const all = loadAllHistory();
    return all[user] || [];
  }

  function logSession(user, splitKey) {
    const all = loadAllHistory();
    if (!all[user]) all[user] = [];
    all[user].push({ date: todayStr(), splitKey });
    saveAllHistory(all);
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  // ---------- split rotation logic ----------

  function nextSplitKey(history) {
    if (history.length === 0) return SPLIT_ORDER[0];
    const last = history[history.length - 1].splitKey;
    const idx = SPLIT_ORDER.indexOf(last);
    return SPLIT_ORDER[(idx + 1) % SPLIT_ORDER.length];
  }

  function splitAfter(splitKey) {
    const idx = SPLIT_ORDER.indexOf(splitKey);
    return SPLIT_ORDER[(idx + 1) % SPLIT_ORDER.length];
  }

  function loggedToday(history) {
    return history.length > 0 && history[history.length - 1].date === todayStr();
  }

  function currentStreak(history) {
    const days = new Set(history.map((h) => h.date));
    // if nothing logged today yet, start counting from yesterday so an
    // active streak isn't reset to 0 before today's session is done
    let offset = days.has(todayStr()) ? 0 : 1;
    let streak = 0;
    while (days.has(daysAgo(offset))) {
      streak++;
      offset++;
    }
    return streak;
  }

  // ---------- state ----------

  let currentUser = null;

  // ---------- rendering ----------

  function renderClock() {
    const now = new Date();
    const dateEl = document.getElementById("clock-date");
    const timeEl = document.getElementById("clock-time");

    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;

    timeEl.innerHTML = `${hours}<span class="colon">:</span>${minutes} <span style="font-size:14px;color:var(--text-dim)">${ampm}</span>`;
  }

  function renderGoal(persona) {
    document.documentElement.style.setProperty("--accent", persona.accent);
    document.getElementById("goal-avatar").textContent = persona.name[0];
    document.getElementById("goal-avatar").style.setProperty("--accent", persona.accent);
    document.getElementById("goal-username").textContent = persona.name;
    document.getElementById("goal-text").textContent = persona.goal;
  }

  function renderSession(user, history) {
    const done = loggedToday(history);
    const splitKey = done
      ? history[history.length - 1].splitKey
      : nextSplitKey(history);
    const split = SPLIT_LIBRARY[splitKey];
    const upcomingKey = splitAfter(splitKey);
    const upcoming = SPLIT_LIBRARY[upcomingKey];

    document.getElementById("session-icon").textContent = split.icon;
    document.getElementById("session-name").textContent = split.name;
    document.getElementById("session-tagline").textContent = split.tagline;

    const list = document.getElementById("session-exercises");
    list.innerHTML = "";
    split.exercises[user].forEach((ex) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${ex.name}</span><span class="ex-detail">${ex.detail}</span>`;
      list.appendChild(li);
    });

    const statusEl = document.getElementById("session-status");
    const btn = document.getElementById("log-session-btn");

    if (done) {
      statusEl.classList.remove("hidden");
      btn.textContent = "Session Logged ✓";
      btn.disabled = true;
    } else {
      statusEl.classList.add("hidden");
      btn.textContent = "Start Session";
      btn.disabled = false;
    }

    btn.onclick = () => {
      logSession(user, splitKey);
      renderDashboard(user);
    };

    document.getElementById("up-next-name").textContent = upcoming.name;
  }

  function renderHistory(history) {
    const list = document.getElementById("history-list");
    list.innerHTML = "";

    if (history.length === 0) {
      const note = document.createElement("li");
      note.className = "empty-note";
      note.textContent = "No sessions logged yet — start today's to kick things off.";
      list.appendChild(note);
      return;
    }

    const recent = history.slice(-5).reverse();
    recent.forEach((entry) => {
      const split = SPLIT_LIBRARY[entry.splitKey];
      const li = document.createElement("li");
      li.innerHTML = `<span class="hist-icon">${split.icon}</span><span class="hist-name">${split.name}</span><span class="hist-date">${formatShortDate(entry.date)}</span>`;
      list.appendChild(li);
    });
  }

  function formatShortDate(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function renderStreak(history) {
    const streak = currentStreak(history);
    const badge = document.getElementById("streak-badge");
    if (streak > 0) {
      badge.classList.remove("hidden");
      document.getElementById("streak-count").textContent = streak;
    } else {
      badge.classList.add("hidden");
    }
  }

  function renderDashboard(user) {
    const persona = PERSONAS[user];
    const history = getHistory(user);

    renderGoal(persona);
    renderSession(user, history);
    renderHistory(history);
    renderStreak(history);
  }

  // ---------- navigation ----------

  function showLogin() {
    currentUser = null;
    localStorage.removeItem(CURRENT_USER_KEY);
    document.getElementById("dashboard-screen").classList.add("hidden");
    document.getElementById("login-screen").classList.remove("hidden");
  }

  function showDashboard(user) {
    currentUser = user;
    localStorage.setItem(CURRENT_USER_KEY, user);
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("dashboard-screen").classList.remove("hidden");
    renderDashboard(user);
  }

  // ---------- init ----------

  document.querySelectorAll(".user-card").forEach((card) => {
    card.addEventListener("click", () => showDashboard(card.dataset.user));
  });

  document.getElementById("switch-user").addEventListener("click", showLogin);

  renderClock();
  setInterval(renderClock, 1000);

  showLogin();
})();
