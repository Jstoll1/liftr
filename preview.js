// Preview site only (brochiefs-preview.pages.dev): demo scenarios, so a
// change can be tried on a week of open picks or a live game day whatever
// the real calendar says. Loaded by the head script on the preview host
// and nowhere else. The app's own preview guard (app.js) still answers
// every write on the phone, so nothing here can reach the real data.
//
// Scenarios, picked from the PREVIEW flag and remembered on this phone:
//   real    the real slate, picks and scores (read only)
//   picks   ten games kicking off in two days: every pick open
//   gameday three final, three live, four still to kick off; live games
//           play out in real time, a whole game in about thirty minutes
// The slate, picks and live scores are answered here; everything else
// (history, trivia, insights, the archive) is the real data.
(function () {
  var WORKER = "https://liftr-ai.jhs797.workers.dev";
  var KEY = "brochiefs_demo_v1";
  var MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  var WEEK = 8, LABEL = "Demo Week";

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "null") || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  var state = load();
  if (!state.scenario) { state.scenario = "picks"; state.start = Date.now(); state.picks = {}; save(state); }

  // Real teams, so logos and colors are the real ones (ESPN team ids).
  var TEAMS = [
    ["Texas", 251, "Georgia", 61, "CBS"], ["LSU", 99, "Alabama", 333, "ABC"], ["Ohio State", 194, "Penn State", 213, "FOX"],
    ["USC", 30, "Oregon", 2483, "NBC"], ["Clemson", 228, "Miami", 2390, "ESPN"], ["Utah", 254, "BYU", 252, "FS1"],
    ["Ole Miss", 145, "Auburn", 2, "SEC"], ["Duke", 150, "UNC", 153, "ACCN"], ["Iowa", 2294, "Wisconsin", 275, "BTN"],
    ["Kansas St", 2306, "Baylor", 239, "ESPN2"],
  ];
  var SPREADS = [3.5, 7, 2.5, 10.5, 1.5, 6, 3, 13.5, 4, 2];
  // Minutes from the scenario's start. Game day: a game runs about thirty
  // real minutes, so -40 is final and -10 is in the second quarter.
  var KICK = {
    picks: [2880, 2880, 2910, 2970, 3000, 3060, 3090, 3150, 3210, 3270],
    gameday: [-75, -60, -45, -26, -17, -8, 20, 50, 95, 180],
  };
  var GAME_SPEED = 2; // game seconds per real second

  function seeded(n) { var x = Math.sin(n * 9301 + 49297) * 233280; return x - Math.floor(x); }
  function slate() {
    var ks = KICK[state.scenario] || KICK.picks;
    return TEAMS.map(function (t, i) {
      var k = new Date(state.start + ks[i] * MIN);
      return {
        id: i + 1, away: t[0], awayId: t[1], awayShort: t[0], home: t[2], homeId: t[3], homeShort: t[2],
        favorite: i % 3 ? t[2] : t[0], spread: SPREADS[i], kickoff: k.toISOString(),
        kickoffLabel: k.toLocaleDateString([], { weekday: "short" }) + " " + k.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        tv: t[4], tiebreakerGame: i === 9 || undefined,
      };
    });
  }

  // Scoring plays for one game, the same every time for the same game.
  function script(id) {
    var ev = [], n = 6 + Math.floor(seeded(id) * 5);
    for (var j = 0; j < n; j++) {
      ev.push({ s: Math.floor(seeded(id * 31 + j) * 3550) + 20, side: seeded(id * 57 + j) < (0.42 + (id % 3) * 0.08) ? "away" : "home", pts: seeded(id * 73 + j) < 0.7 ? 7 : 3 });
    }
    return ev.sort(function (a, b) { return a.s - b.s; });
  }
  var PLAYS = {
    7: ["{t} touchdown run, 4 yards", "{t} touchdown pass, 23 yards", "{t} touchdown pass, 41 yards"],
    3: ["{t} field goal good, 38 yards", "{t} field goal good, 44 yards"],
  };
  function liveOf(g) {
    var s = Math.floor((Date.now() - Date.parse(g.kickoff)) / 1000 * GAME_SPEED);
    if (s < 0) return { id: g.id, found: true, state: "pre", completed: false, detail: g.kickoffLabel, eventId: null };
    var done = s >= 3600, t = Math.min(s, 3600), a = 0, h = 0, last = null;
    script(g.id).forEach(function (e) { if (e.s <= t) { if (e.side === "away") a += e.pts; else h += e.pts; last = e; } });
    if (done && a === h) h += 3; // no ties: a walk-off field goal
    var period = Math.min(4, Math.floor(t / 900) + 1), left = done ? 0 : 900 - (t % 900);
    var clock = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    var ordinal = ["1st", "2nd", "3rd", "4th"][period - 1];
    // Win chance from the margin and the time left, home side.
    var frac = 1 - t / 3600, z = (h - a) / (3 + 11 * frac);
    var pHome = done ? (h > a ? 100 : 0) : Math.round(100 / (1 + Math.exp(-z * 1.6)));
    var team = function (side) { return side === "away" ? g.away : g.home; };
    var possSide = seeded(g.id * 13 + Math.floor(t / 150)) < 0.5 ? "away" : "home";
    var yard = 15 + Math.floor(seeded(g.id * 17 + Math.floor(t / 40)) * 70);
    var down = 1 + Math.floor(seeded(g.id * 19 + Math.floor(t / 40)) * 4), dist = 1 + Math.floor(seeded(g.id * 23 + Math.floor(t / 40)) * 12);
    return {
      id: g.id, found: true, eventId: null,
      state: done ? "post" : "in", completed: done,
      detail: done ? "Final" : ordinal + " " + clock, period: period, clock: done ? "0:00" : clock,
      awayScore: a, homeScore: h, awayAbbr: g.away.slice(0, 4).toUpperCase(), homeAbbr: g.home.slice(0, 4).toUpperCase(),
      winProb: done ? null : { home: pHome, away: 100 - pHome },
      situation: done ? null : {
        down: down, distance: dist, yardLine: yard,
        possessionId: possSide === "away" ? g.awayId : g.homeId,
        downDistance: ["1st", "2nd", "3rd", "4th"][down - 1] + " & " + dist + " at " + (yard > 50 ? (possSide === "away" ? g.home : g.away) : team(possSide)).slice(0, 4).toUpperCase() + " " + (yard > 50 ? 100 - yard : yard),
        isRedZone: yard >= 80,
        lastPlay: last ? PLAYS[last.pts][Math.floor(seeded(last.s) * PLAYS[last.pts].length)].replace("{t}", team(last.side)) : null,
      },
    };
  }

  // Everyone's picks. Game day: all in. Open week: the others have picked
  // some games, shown hidden the way the real board hides them before lock.
  function allPicks(me) {
    var games = slate(), out = {}, names = typeof MANAGERS !== "undefined" ? MANAGERS.slice() : [];
    names.forEach(function (n, k) {
      if (state.picks[n]) { out[n] = state.picks[n]; return; }
      var picks = {}, made = state.scenario === "gameday" ? games.length : Math.floor(seeded(k + 3) * 11);
      games.slice(0, made).forEach(function (g, i) {
        picks[g.id] = state.scenario === "gameday"
          ? { team: seeded(k * 11 + i) < 0.5 ? g.away : g.home, mode: ["SU", "ATS", "ATS"][Math.floor(seeded(k * 7 + i) * 3)], updatedAt: state.start - 20 * HOUR }
          : { hidden: true };
      });
      if (state.scenario === "picks" && n === me) picks = {};
      out[n] = { picks: picks, tiebreaker: state.scenario === "gameday" ? String(38 + k * 3) : (made ? "hidden" : ""), submittedAt: made ? state.start - 20 * HOUR : null };
    });
    return out;
  }

  function reply(body) { return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }); }

  // The app's fetch guard asks this first. A Response answers the request;
  // null lets the guard carry on (real reads, faked writes).
  window.__previewDemo = {
    scenario: function () { return state.scenario; },
    handle: function (url, method, body) {
      if (state.scenario === "real") return null;
      var u;
      try { u = new URL(url); } catch (e) { return null; }
      // ESPN's own scoreboard: nothing, so the app falls back to /live here.
      if (/site\.api\.espn\.com$/.test(u.hostname) && /scoreboard/.test(u.pathname)) return reply({ events: [] });
      if (url.indexOf(WORKER) !== 0) return null;
      var path = u.pathname;
      if (path === "/games" && method === "GET") return reply({ week: WEEK, label: LABEL, weeks: { list: [1, 2, 3, 4, 5, 6, 7, WEEK], current: WEEK }, games: slate() });
      if (path === "/live" && method === "GET") return reply({ games: slate().map(liveOf) });
      if (path === "/picks" && method === "GET") return reply({ picks: allPicks(u.searchParams.get("me")) });
      if (path === "/picks" && method === "POST") {
        try { var b = JSON.parse(body || "{}"); if (b.manager && b.state) { state.picks[b.manager] = b.state; save(state); } return reply({ ok: true, preview: true, state: b.state || null }); } catch (e) { return null; }
      }
      return null;
    },
  };

  // The PREVIEW flag doubles as the scenario switch.
  var NAMES = { real: "REAL DATA", picks: "MAKE PICKS", gameday: "GAME DAY" };
  function setScenario(s) {
    var keepMe = null;
    try { keepMe = localStorage.getItem("brochiefs_me_v1"); } catch (e) {}
    state = { scenario: s, start: Date.now(), picks: {} };
    save(state);
    // Each scenario starts clean: local picks for the demo week go too.
    try { Object.keys(localStorage).forEach(function (k) { if (/pick|pending/i.test(k) && k !== KEY && !/theme|me_v1|splash|rules/.test(k)) localStorage.removeItem(k); }); if (keepMe) localStorage.setItem("brochiefs_me_v1", keepMe); } catch (e) {}
    location.replace(location.pathname + "?r=" + Date.now());
  }
  document.addEventListener("DOMContentLoaded", function () {
    var flag = document.createElement("button");
    flag.type = "button";
    flag.className = "preview-flag demo";
    flag.textContent = "PREVIEW · " + NAMES[state.scenario] + " ▾";
    var menu = document.createElement("div");
    menu.className = "preview-menu hidden";
    menu.innerHTML = '<b>PREVIEW · NOTHING IS SAVED</b>' + ["picks", "gameday", "real"].map(function (s) {
      return '<button type="button" data-s="' + s + '"' + (s === state.scenario ? ' class="on"' : "") + ">" + NAMES[s] + "<small>" + ({ picks: "10 open games, lock in 2 days", gameday: "3 final, 3 live, 4 to come", real: "this week's real slate, read only" })[s] + "</small></button>";
    }).join("") + '<button type="button" data-s="restart">RESTART THIS SCENARIO<small>clears picks made here</small></button>';
    flag.addEventListener("click", function () { menu.classList.toggle("hidden"); });
    menu.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-s]");
      if (!b) return;
      setScenario(b.dataset.s === "restart" ? state.scenario : b.dataset.s);
    });
    document.body.appendChild(flag);
    document.body.appendChild(menu);
  });
})();
