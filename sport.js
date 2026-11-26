// Which league this copy of the app runs, read from the address before
// anything else loads. brochiefs.com is the college pick'em. The NFL
// pick'em is nfl.brochiefs.com (and its Cloudflare Pages address), with
// its own Worker, storage and members, so the two never share a pick, a
// login or a log. Everything sport specific the app, the slate editor and
// the console need reads from here.
//
// Testing anywhere else (a local copy): ?sport=nfl switches this device to
// the NFL build and remembers it; ?sport=cfb switches it back. The college
// site itself always runs college.
(function () {
  var host = location.hostname;
  var college = /^(www\.)?brochiefs\.com$/.test(host) || /(^|\.)brochiefs-preview\.pages\.dev$/.test(host) || /\.github\.io$/.test(host);
  var nflHost = /^nfl\.brochiefs\.com$/.test(host) || /(^|\.)liftr-1h0\.pages\.dev$/.test(host);
  var asked = null;
  if (!college && !nflHost) {
    try {
      var q = new URLSearchParams(location.search).get("sport");
      if (q === "nfl" || q === "cfb") localStorage.setItem("brochiefs_sport", q);
      asked = localStorage.getItem("brochiefs_sport");
    } catch (e) { /* private mode: college */ }
  }
  var nfl = nflHost || asked === "nfl";
  window.LEAGUE = nfl ? {
    sport: "nfl",
    name: "Brochiefs NFL",
    espn: "football/nfl",          // site.api.espn.com/apis/site/v2/sports/<espn>
    espnWeb: "nfl",                // www.espn.com/<espnWeb>/game/...
    groups: "",                    // the NFL scoreboard needs no division filter
    logos: "nfl",                  // a.espncdn.com/i/teamlogos/<logos>/<logoCut>/<team id>.png
    // ESPN's dark-background cut is filed by abbreviation only for the NFL;
    // by team id it is missing (404), so the NFL uses the standard cut.
    logoCut: "500",
    worker: "https://liftr-nfl.jhs797.workers.dev",
    // ESPN refuses this site's browser requests (no CORS header), so live
    // scores come straight from the Worker instead of failing first.
    liveViaWorker: true,
    // Members are added by the admin and stored on the Worker; the app
    // reads them on open (see loadRoster in app.js).
    roster: null,
    maxGames: 16,                  // every game of the week
    lockAllFromWeek: 1,            // every pick locks at the week's first kickoff (Jake, Nov 26)
    // Every game from Sunday's 1pm ET kickoff on locks at that kickoff; a
    // game before it (Thursday night, London) locks at its own.
    lockAtSunday1pm: false,
    seasonWeeks: 18,
    // NFL finals land about 14 points either side of the line (Stern,
    // "On the probability of winning a football game", The American
    // Statistician 45(3), 1991, measured 13.86); college about 15 to 16.
    // NFL totals run about 44 against college's 52.
    marginSd: 14,
    ouDefault: 44,
    features: { history: false, trivia: false, qotw: false, pot: false, boner: false, champ: false, analytics: false },
  } : {
    sport: "cfb",
    name: "Brochiefs Pick'em",
    espn: "football/college-football",
    espnWeb: "college-football",
    groups: "&groups=80",          // FBS only
    logos: "ncaa",
    worker: "https://liftr-ai.jhs797.workers.dev",
    roster: ["Robert", "Logan", "Jordan", "Conlan", "Dewitt", "Nissan", "Skills", "Jake", "Curt", "Andrew"],
    maxGames: 10,
    lockAllFromWeek: 4,            // the Sweatpants Amendment
    seasonWeeks: 16,
    marginSd: 15,
    ouDefault: 52,
    features: { history: true, trivia: true, qotw: true, pot: true, boner: true, champ: true, analytics: true },
  };
  window.ESPN_API = "https://site.api.espn.com/apis/site/v2/sports/" + window.LEAGUE.espn;
  // Open the connection to the Worker now, while the page and styles load,
  // so the first scores request skips DNS and TLS.
  try { var pc = document.createElement("link"); pc.rel = "preconnect"; pc.href = window.LEAGUE.worker; pc.crossOrigin = "anonymous"; document.head.appendChild(pc); } catch (e) { /* no head yet */ }
  if (nfl) {
    document.documentElement.setAttribute("data-sport", "nfl");
    document.title = window.LEAGUE.name;
    // The splash names the league.
    document.addEventListener("DOMContentLoaded", function () {
      var tag = document.querySelector("#logo-screen .arcade-tag");
      if (tag) tag.textContent = "2026 NFL PICK'EM";
      var copy = document.querySelector("#logo-screen .arcade-copyright");
      if (copy) copy.textContent = "\u00a9 2026 BROCHIEFS NFL";
      // NFL has no fantasy history or trivia: take their tabs and screens out.
      ["nav-history-btn", "nav-trivia-btn", "history-screen", "trivia-screen", "admin-qotw-btn", "admin-qotw", "week-champ", "recap-toggle", "recap-panel", "side-pot", "payouts-toggle", "sh2h-open", "payouts-panel", "season-toggle", "season-panel"].forEach(function (id) { var el = document.getElementById(id); if (el) { el.style.setProperty("display", "none", "important"); el.setAttribute("aria-hidden", "true"); } });
    });
  }
})();
