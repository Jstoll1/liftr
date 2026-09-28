// Tecmo-style game simulation for the insights sheet. For fun only: the
// final score is drawn around the current spread and total, then a game
// is built backwards to reach it, drive by drive, using real names from
// ESPN's stat leaders and the team roster where the phone can reach them.
(() => {
  const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
  const rosterCache = {};
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rand = (a, b) => a + Math.random() * (b - a);
  const irand = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr, weights) => {
    if (!weights) return arr[Math.floor(Math.random() * arr.length)];
    const sum = weights.reduce((x, y) => x + y, 0);
    let r = Math.random() * sum;
    for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  };
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const yd = (n) => `${n} YD${Math.abs(n) === 1 ? "" : "S"}`;
  const short = (n) => {
    const parts = String(n || "").trim().split(/\s+/);
    if (parts.length < 2) return String(n || "").toUpperCase();
    return `${parts[0][0]}. ${parts.slice(1).join(" ")}`.toUpperCase();
  };

  // --- Players ------------------------------------------------------------
  async function roster(teamId) {
    if (rosterCache[teamId]) return rosterCache[teamId];
    const out = { QB: [], RB: [], WR: [], TE: [], K: [] };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch(`${ESPN}/teams/${teamId}/roster`, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        const groups = Array.isArray(data.athletes) ? data.athletes : [];
        const items = groups.flatMap((g) => Array.isArray(g.items) ? g.items : [g]);
        for (const a of items) {
          const pos = a?.position?.abbreviation;
          if (out[pos] && a.displayName) out[pos].push(a.displayName);
        }
      }
    } catch {}
    rosterCache[teamId] = out;
    return out;
  }
  async function lineup(team) {
    const r = await roster(team.id);
    const lead = (re) => (team.leaders || []).find((l) => re.test(l.cat || ""))?.name || null;
    const qb = lead(/pass/i) || r.QB[0] || null;
    const rb = lead(/rush/i) || r.RB[0] || null;
    const wr1 = lead(/receiv/i) || r.WR[0] || null;
    const wrs = [wr1, ...r.WR.filter((n) => n !== wr1).slice(0, 2)].filter(Boolean);
    const tes = r.TE.slice(0, 1);
    const rbs = [rb, ...r.RB.filter((n) => n !== rb).slice(0, 1)].filter(Boolean);
    const num = () => `#${irand(1, 89)}`;
    return {
      qb: short(qb) || `QB ${num()}`,
      rbs: rbs.length ? rbs.map(short) : [`RB ${num()}`],
      targets: [...wrs.map((n) => ({ pos: "WR", name: short(n) })), ...tes.map((n) => ({ pos: "TE", name: short(n) }))].concat(wrs.length ? [] : [{ pos: "WR", name: `#${irand(1, 19)}` }, { pos: "WR", name: `#${irand(80, 89)}` }]),
      k: r.K[0] ? short(r.K[0]) : null,
    };
  }

  // --- Score --------------------------------------------------------------
  // Scores a team can reach with touchdowns (7) and field goals (3).
  const reachable = (n) => { for (let a = 0; a * 7 <= n; a++) if ((n - a * 7) % 3 === 0) return true; return false; };
  const nearestScore = (x) => { const n = Math.max(0, Math.round(x)); for (let d = 0; d < 6; d++) { if (reachable(n + d)) return n + d; if (n - d >= 0 && reachable(n - d)) return n - d; } return n; };
  const split = (n) => { for (let a = Math.floor(n / 7); a >= 0; a--) if ((n - a * 7) % 3 === 0) return { td: a, fg: (n - a * 7) / 3 }; return { td: 0, fg: 0 }; };
  function drawScore(ctx) {
    const margin = ctx.spread + gauss() * 11;
    const total = Math.max(13, ctx.total + gauss() * 10);
    let fav = nearestScore((total + margin) / 2), dog = nearestScore((total - margin) / 2);
    return ctx.favSide === "home" ? { home: fav, away: dog } : { home: dog, away: fav };
  }

  // --- Game script --------------------------------------------------------
  // Each team gets eleven possessions; scoring ones are sprinkled among
  // them, the rest end in punts, picks, fumbles or a missed kick.
  function buildGame(ctx, target, lu) {
    const POSS = 11;
    const plan = (side) => {
      const { td, fg } = split(target[side]);
      const drives = Array(POSS).fill("empty");
      const slots = [...Array(POSS).keys()].sort(() => Math.random() - 0.5);
      let i = 0;
      for (let k = 0; k < td; k++) drives[slots[i++ % POSS]] = "td";
      for (let k = 0; k < fg && i < POSS; k++) drives[slots[i++]] = "fg";
      return drives;
    };
    const plans = { away: plan("away"), home: plan("home") };
    const first = Math.random() < 0.5 ? "away" : "home";
    const order = [];
    for (let i = 0; i < POSS; i++) { order.push(first); order.push(first === "away" ? "home" : "away"); }
    const idx = { away: 0, home: 0 };
    const events = [];
    const score = { away: 0, home: 0 };
    order.forEach((side, n) => {
      const kind = plans[side][idx[side]++];
      const qtr = Math.min(4, Math.floor((n / order.length) * 4) + 1);
      const clockStart = 900 - Math.floor(((n / order.length) * 4 % 1) * 900);
      events.push(...drive(side, kind, lu[side], score, qtr, clockStart));
    });
    if (score.away === score.home) {
      // Overtime: one field goal decides it, favourite a little likelier.
      const side = Math.random() < (ctx.favSide === "home" ? 0.58 : 0.42) ? "home" : "away";
      events.push({ type: "banner", text: "OVERTIME" });
      events.push(...drive(side, "fg", lu[side], score, 5, 0, 75));
    }
    return { events, score };
  }
  function drive(side, kind, p, score, qtr, clock, startAt = null) {
    const out = [];
    let pos = startAt ?? pick([20, 25, 25, 25, 30, 35, 40]);
    const goal = kind === "td" ? 100 : kind === "fg" ? irand(62, 80) : irand(35, 62);
    let plays = 0;
    let t = clock;
    const tick = () => { t = Math.max(0, t - irand(22, 44)); return t; };
    out.push({ type: "drive", side, pos, qtr, clock: t });
    while (pos < goal && plays < 9) {
      plays += 1;
      const left = goal - pos;
      const isLast = kind !== "empty" && (plays >= 7 || left <= 14);
      let yds;
      const pass = Math.random() < 0.55;
      if (isLast) yds = left;
      else if (pass) yds = Math.random() < 0.28 ? 0 : Math.random() < 0.12 ? irand(30, 48) : irand(5, 22);
      else yds = Math.random() < 0.08 ? irand(18, 38) : irand(-2, 9);
      if (!isLast) yds = Math.min(yds, left - 1 > 0 ? left - 1 : yds);
      if (!isLast && Math.random() < 0.05) {
        const loss = irand(4, 9);
        pos = Math.max(1, pos - loss);
        out.push({ type: "play", side, pos, qtr, clock: tick(), text: `${p.qb} SACKED · -${loss}` });
        continue;
      }
      pos = Math.min(100, pos + yds);
      const tdNow = kind === "td" && pos >= 100;
      if (pass) {
        const tgt = pick(p.targets, p.targets.map((_, i) => i === 0 ? 5 : i === 1 ? 3 : 2));
        const text = yds === 0 && !isLast ? `${p.qb} PASS INCOMPLETE` : `${p.qb} PASS TO ${tgt.pos} ${tgt.name} · ${yd(yds)}`;
        out.push({ type: "play", side, pos, qtr, clock: tick(), text: tdNow ? `${text} · TOUCHDOWN!` : text, td: tdNow });
      } else {
        const rb = pick(p.rbs, p.rbs.map((_, i) => i === 0 ? 4 : 1));
        const text = yds < 0 ? `${rb} RUN · LOSS OF ${-yds}` : yds === 0 ? `${rb} RUN · NO GAIN` : `${rb} RUN · ${yd(yds)}`;
        out.push({ type: "play", side, pos, qtr, clock: tick(), text: tdNow ? `${text} · TOUCHDOWN!` : text, td: tdNow });
      }
      if (tdNow) break;
    }
    if (kind === "td") {
      score[side] += 7;
      out.push({ type: "score", side, pos: 100, qtr, clock: t, text: "EXTRA POINT GOOD", big: "TOUCHDOWN!", score: { ...score } });
    } else if (kind === "fg") {
      const dist = 100 - pos + 17;
      score[side] += 3;
      out.push({ type: "score", side, pos, qtr, clock: tick(), text: `${p.k ? `${p.k} ` : ""}${dist} YD FIELD GOAL · GOOD`, big: "FIELD GOAL", score: { ...score } });
    } else {
      const end = pick(["PUNT", "PUNT", "PUNT", "INTERCEPTED", "FUMBLE LOST", "MISSED FG", "DOWNS"], null);
      const text = end === "PUNT" ? `PUNT · ${irand(36, 52)} YDS`
        : end === "INTERCEPTED" ? `${p.qb} PASS INTERCEPTED!`
        : end === "FUMBLE LOST" ? `${pick(p.rbs)} FUMBLES · RECOVERED BY DEFENSE`
        : end === "MISSED FG" ? `${100 - pos + 17} YD FIELD GOAL · NO GOOD`
        : "TURNOVER ON DOWNS";
      out.push({ type: "end", side, pos, qtr, clock: tick(), text, turnover: end !== "PUNT" });
    }
    return out;
  }

  // --- Screen -------------------------------------------------------------
  let timer = null;
  function ensureModal() {
    let el = document.getElementById("sim-modal");
    if (el) return el;
    el = document.createElement("div");
    el.id = "sim-modal";
    el.className = "sim-modal hidden";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Game simulation");
    el.innerHTML = `<div class="gb">
      <div class="gb-bezel">
        <div class="gb-bezel-top"><span><i></i><i></i></span><em>DOT MATRIX WITH STEREO SOUND</em><span><i></i><i></i></span></div>
        <div class="gb-led"><i></i>BATTERY</div>
        <div class="gb-screen">
          <div class="sim-board"></div>
          <div class="sim-field"><div class="sim-ez l"></div><div class="sim-lines"></div><div class="sim-ez r"></div><div class="sim-ball"></div><div class="sim-flash"></div></div>
          <div class="sim-log"></div>
        </div>
      </div>
      <div class="gb-brand"><b>BROCHIEFS</b> <i>GAME BOX</i><sup>™</sup></div>
      <div class="gb-controls sim-actions">
        <div class="gb-dpad" aria-hidden="true"><i class="h"></i><i class="v"></i><b></b></div>
        <div class="gb-ab">
          <div class="gb-btn-wrap b"><button type="button" class="sim-btn ghost gb-round" data-act="close" aria-label="Close"></button><span>B · EXIT</span></div>
          <div class="gb-btn-wrap a"><button type="button" class="sim-btn gb-round" data-act="skip" aria-label="Skip to final"></button><span class="gb-alabel">A · SKIP</span></div>
        </div>
      </div>
      <div class="gb-pills" aria-hidden="true"><div><i></i><span>SELECT</span></div><div><i></i><span>START</span></div></div>
      <div class="gb-grille" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    </div>
    <div class="sim-note">SIMULATED FOR FUN · NOT A PREDICTION</div>`;
    document.body.appendChild(el);
    el.querySelector(".sim-lines").innerHTML = Array.from({ length: 9 }, (_, i) => `<i style="left:${(i + 1) * 10}%"><b>${[10, 20, 30, 40, 50, 40, 30, 20, 10][i]}</b></i>`).join("");
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    return el;
  }
  function close() {
    clearTimeout(timer);
    document.getElementById("sim-modal")?.classList.add("hidden");
  }
  const fmtClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  window.openSim = async function openSim(ctx) {
    const el = ensureModal();
    clearTimeout(timer);
    el.classList.remove("hidden");
    const board = el.querySelector(".sim-board");
    const log = el.querySelector(".sim-log");
    const ball = el.querySelector(".sim-ball");
    const flash = el.querySelector(".sim-flash");
    const setColors = () => {
      el.querySelector(".sim-ez.l").innerHTML = `<img src="${ctx.away.logo}" alt="">`;
      el.querySelector(".sim-ez.r").innerHTML = `<img src="${ctx.home.logo}" alt="">`;
    };
    setColors();
    log.innerHTML = `<div class="sim-line dim">LOADING ROSTERS…</div>`;
    board.innerHTML = "";
    const [away, home] = await Promise.all([lineup(ctx.away), lineup(ctx.home)]);
    const target = drawScore(ctx);
    const game = buildGame(ctx, target, { away, home });
    const cur = { away: 0, home: 0, qtr: 1, clock: 900, side: null };
    const drawBoard = () => {
      board.innerHTML = `<div class="sim-tm${cur.side === "away" ? " poss" : ""}" ><img src="${ctx.away.logo}" alt=""><span>${esc(ctx.away.abbr)}</span><b>${cur.away}</b></div>
        <div class="sim-mid"><span>${cur.final ? "FINAL" : cur.qtr > 4 ? "OT" : `${cur.qtr}${["", "ST", "ND", "RD", "TH"][cur.qtr]} QTR`}</span><b>${cur.final ? (game.events.some((e) => e.qtr === 5) ? "OT" : "0:00") : fmtClock(cur.clock)}</b></div>
        <div class="sim-tm r${cur.side === "home" ? " poss" : ""}" ><b>${cur.home}</b><span>${esc(ctx.home.abbr)}</span><img src="${ctx.home.logo}" alt=""></div>`;
    };
    // Away drives left to right, home right to left.
    const place = (side, pos) => { ball.style.left = `${side === "away" ? pos : 100 - pos}%`; };
    const pushLine = (text, cls = "") => {
      const d = document.createElement("div");
      d.className = `sim-line ${cls}`;
      d.textContent = text;
      log.appendChild(d);
      while (log.children.length > 8) log.firstChild.remove();
    };
    const showBig = (text) => { flash.textContent = text; flash.classList.remove("on"); void flash.offsetWidth; flash.classList.add("on"); };
    log.innerHTML = "";
    drawBoard();
    let i = 0;
    const finish = () => {
      clearTimeout(timer);
      cur.away = game.score.away; cur.home = game.score.home; cur.clock = 0; cur.side = null; cur.final = true;
      drawBoard();
      const winner = cur.home > cur.away ? ctx.home : ctx.away;
      const w = Math.max(cur.home, cur.away), l = Math.min(cur.home, cur.away);
      pushLine(`FINAL · ${winner.short.toUpperCase()} WINS ${w}-${l}`, "final");
      showBig(`FINAL ${w}-${l}`);
      const a = el.querySelector('[data-act="skip"]');
      if (a) { a.dataset.act = "again"; a.setAttribute("aria-label", "Sim again"); }
      el.querySelector(".gb-alabel").textContent = "A · AGAIN";
    };
    const step = () => {
      if (i >= game.events.length) { finish(); return; }
      const ev = game.events[i++];
      let wait = 380;
      if (ev.qtr) cur.qtr = ev.qtr;
      if (ev.clock != null) cur.clock = ev.clock;
      if (ev.type === "banner") { showBig(ev.text); pushLine(ev.text, "banner"); wait = 1100; }
      else if (ev.type === "drive") {
        cur.side = ev.side;
        place(ev.side, ev.pos);
        pushLine(`${(ev.side === "away" ? ctx.away : ctx.home).abbr} BALL · OWN ${ev.pos}`, "dim");
        wait = 260;
      } else if (ev.type === "play") {
        place(ev.side, Math.min(ev.pos, 100));
        pushLine(ev.text, ev.td ? "td" : "");
        if (ev.td) wait = 700;
      } else if (ev.type === "score") {
        cur.away = ev.score.away; cur.home = ev.score.home;
        showBig(ev.big);
        pushLine(ev.text, "td");
        wait = 1000;
      } else if (ev.type === "end") {
        pushLine(ev.text, ev.turnover ? "to" : "dim");
        wait = ev.turnover ? 700 : 320;
      }
      drawBoard();
      timer = setTimeout(step, wait);
    };
    const actions = el.querySelector(".sim-actions");
    const btn = actions.querySelector(".sim-btn:not(.ghost)");
    btn.dataset.act = "skip";
    btn.setAttribute("aria-label", "Skip to final");
    el.querySelector(".gb-alabel").textContent = "A · SKIP";
    actions.onclick = (e) => {
      const act = e.target.closest(".sim-btn")?.dataset.act;
      if (act === "close") close();
      else if (act === "skip") finish();
      else if (act === "again") openSim(ctx);
    };
    pushLine(`KICKOFF · ${ctx.away.abbr} AT ${ctx.home.abbr}`, "banner");
    timer = setTimeout(step, 600);
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.getElementById("sim-modal")?.classList.contains("hidden")) close(); });
})();
