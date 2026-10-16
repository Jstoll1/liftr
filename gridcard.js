// Grid card: the starting grid as a shareable picture. Ten pixel IndyCars
// in each manager's colour, name above, picks and tiebreaker below, and a
// green, yellow or red pixel flag for full, partial or nothing in.
// Opens by tapping the four nav buttons left to right within a few seconds.
// Exports a PNG through the share sheet, or shows it for a long press.
(() => {
  const NAV = ["nav-picks-btn", "nav-scoreboard-btn", "nav-history-btn", "nav-trivia-btn"];
  let taps = [];
  document.getElementById("bottom-nav")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-btn");
    if (!btn) return;
    const now = Date.now();
    taps = taps.filter((t) => now - t.at < 5000);
    taps.push({ id: btn.id, at: now });
    const ids = taps.slice(-4).map((t) => t.id);
    if (ids.length === 4 && ids.every((id, i) => id === NAV[i])) { taps = []; openGridCard(); }
  });

  // 24x10 car, side view, nose to the right. Letters map to colours:
  // B body (manager colour), D dark body, W wheel, H helmet, . empty.
  const CAR = [
    "........................",
    "..........DD............",
    "........BBHHBB..........",
    "....BBBBBBBBBBBBBBB.....",
    "DBBBBBBBBBBBBBBBBBBBBBD.",
    "DBBBBBBBBBBBBBBBBBBBBBBB",
    ".DDBBBBBBBBBBBBBBBBBBDDD",
    "..WWWW..........WWWW....",
    "..WWWW..........WWWW....",
    "...WW............WW.....",
  ];
  // 12x10 flag on a pole. P pole, F flag colour, C checker (green flag only).
  const FLAG = [
    "P...........",
    "PFFFFFFFFFF.",
    "PFCFCFCFCFF.",
    "PFFCFCFCFCF.",
    "PFCFCFCFCFF.",
    "PFFCFCFCFCF.",
    "PFFFFFFFFFF.",
    "P...........",
    "P...........",
    "P...........",
  ];
  const px_ = (ctx, map, x, y, s, colours) => {
    map.forEach((row, j) => [...row].forEach((ch, i) => { const c = colours[ch]; if (c) { ctx.fillStyle = c; ctx.fillRect(x + i * s, y + j * s, s, s); } }));
  };
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };

  // Panel geometry on the background picture (1024x1536): five rows in two
  // columns, measured from the art. Everything drawn is relative to a
  // panel's name-bar corner.
  const PANELS = [[265, 410], [263, 614], [259, 825], [256, 1047], [251, 1276], [697, 410], [705, 614], [715, 825], [724, 1047], [737, 1277]]; // measured from the art
  const BG = "assets/fight-bg.webp";
  const bgCache = {};
  const loadBg = (src = BG) => new Promise((res) => { if (bgCache[src]) return res(bgCache[src]); const im = new Image(); im.onload = () => { bgCache[src] = im; res(im); }; im.onerror = () => res(null); im.src = src; });

  // NFL league of up to three: the "$100 Triple Threat" art (1024x1536),
  // three panels, first place on the centre plinth. Rectangles measured
  // from the picture: the name bar, the "0 / 10" count, the row of cells,
  // the flag box and the tiebreaker value, each [x, y, w, h].
  const TRIPLE_BG = "assets/fight-bg-nfl.webp";
  const TRIPLE = [
    { bar: [405, 688, 283, 42], sel: [530, 748, 76, 30], cells: [350, 781, 254, 34], flag: [606, 772, 92, 92], tb: [503, 829, 100, 30], ink: "#ffd23f" },
    { bar: [107, 1191, 290, 42], sel: [232, 1252, 76, 30], cells: [52, 1285, 252, 39], flag: [312, 1278, 88, 94], tb: [206, 1332, 100, 28], ink: "#5cc2ff" },
    { bar: [705, 1192, 290, 42], sel: [828, 1252, 76, 30], cells: [648, 1285, 254, 39], flag: [906, 1278, 90, 94], tb: [802, 1332, 100, 28], ink: "#ff4a4a" },
  ];
  const triple = () => window.LEAGUE?.sport === "nfl" && MANAGERS.length >= 1 && MANAGERS.length <= 3;
  function drawTriple(ctx, rows, total, banner) {
    const at = (x, y) => { const p = ctx.getImageData(x, y, 1, 1).data; return `rgb(${p[0]},${p[1]},${p[2]})`; };
    rows.slice(0, 3).forEach((r, i) => {
      const P = TRIPLE[i];
      const fc = r.state === "go" ? "#39ff88" : r.state === "warn" ? "#ffe45e" : "#e0102a";
      const body = at(P.sel[0] - 26, P.sel[1] + 14);
      // Name over "USER N".
      const [bx, by, bw, bh] = P.bar;
      ctx.fillStyle = at(bx + 10, by + bh / 2); ctx.fillRect(bx, by, bw, bh);
      ctx.font = "900 26px Orbitron, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = P.ink; ctx.fillText(shown(r.name).toUpperCase(), bx + bw / 2, by + bh / 2 + 1, bw - 16);
      // Selections count.
      const [sx, sy, sw, sh] = P.sel;
      ctx.fillStyle = body; ctx.fillRect(sx, sy, sw, sh);
      ctx.font = "800 22px Orbitron, system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillStyle = "#fff";
      ctx.fillText(`${r.n} / ${total}`, sx + sw - 2, sy + sh / 2 + 1);
      // One cell per game.
      const [cx0, cy, cwAll, chh] = P.cells;
      ctx.fillStyle = body; ctx.fillRect(cx0, cy, cwAll, chh);
      const step = cwAll / Math.max(total, 1), cw = Math.max(3, step - 3);
      for (let k = 0; k < total; k++) {
        const cx = cx0 + 2 + k * step;
        ctx.fillStyle = k < r.n ? fc : "#5a6478"; ctx.fillRect(cx, cy + 3, cw, chh - 6);
        ctx.fillStyle = k < r.n ? "rgba(255,255,255,.35)" : "rgba(255,255,255,.14)"; ctx.fillRect(cx, cy + 3, cw, 5);
      }
      // Tiebreaker in or not; the number stays private until kickoff.
      const [tx, ty, tw, th] = P.tb;
      ctx.fillStyle = body; ctx.fillRect(tx, ty, tw, th);
      ctx.font = "900 19px Orbitron, system-ui, sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = r.tb ? "#39ff88" : "#ff4a4a";
      ctx.fillText(r.tb ? "✓ SET" : "✗ NONE", tx + 4, ty + th / 2 + 1);
      // Flag in the state colour.
      const [fx, fy, fw, fh] = P.flag;
      ctx.fillStyle = body; ctx.fillRect(fx, fy, fw, fh);
      ctx.strokeStyle = fc; ctx.lineWidth = 6; ctx.strokeRect(fx + 6, fy + 6, fw - 12, fh - 12);
      const s = Math.floor((fw - 28) / 9), ox = fx + Math.round((fw - 9 * s) / 2), oy = fy + Math.round((fh - 9 * s) / 2);
      px_(ctx, SMALL_FLAG, ox, oy, s, { F: fc, P: "#ddd" });
      if (r.state === "go") for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 8; xx++) if ((xx + yy) % 2) { ctx.fillStyle = "#052010"; ctx.fillRect(ox + xx * s, oy + yy * s, s, s); }
    });
    // Week, readiness and the next lock on a plate over the floor medallion.
    ctx.font = "700 17px 'Press Start 2P', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = Math.min(980, ctx.measureText(banner).width + 36);
    ctx.fillStyle = "rgba(0,0,0,.86)"; ctx.fillRect(512 - w / 2, 1470, w, 44);
    ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2; ctx.strokeRect(512 - w / 2, 1470, w, 44);
    ctx.fillStyle = "#ffe45e"; ctx.fillText(banner, 512, 1493, 960);
  }
  const SMALL_FLAG = ["FFFFFFFF", "FFFFFFFF", "FFFFFFFF", "FFFFFFFF", "FFFFFFFF", "FFFFFFFF", "P.......", "P.......", "P......."];

  // The art's panels drift a few pixels off a true grid, so each one's
  // name-bar corner is found from the pixels near where it should be: the
  // first strongly coloured pixel scanning in from the left, then up.
  const sat = (p) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  const bright = (p) => sat(p) > 100 && Math.max(p[0], p[1], p[2]) > 140;
  function findPanel(ctx, ex, ey) {
    // Top-left corner of the name bar: bright here, bright to the right and
    // below, dark to the left and above. Raster scan a window around the
    // expected spot, so a panel drawn a little off still lands.
    const x0 = ex - 20, y0 = ey - 34, w = 90, hgt = 70;
    const img = ctx.getImageData(x0, y0, w, hgt).data;
    const at = (x, y) => { const k = ((y - y0) * w + (x - x0)) * 4; return img.slice(k, k + 3); };
    const ok = (x, y) => x >= x0 + 4 && y >= y0 + 4 && x < x0 + w - 6 && y < y0 + hgt - 6 && bright(at(x, y)) && bright(at(x + 5, y)) && bright(at(x, y + 5)) && bright(at(x + 5, y + 5)) && !bright(at(x - 4, y)) && !bright(at(x, y - 4));
    let x = ex, y = ey, found = false;
    for (let yy = y0 + 4; yy < y0 + hgt - 6 && !found; yy++) for (let xx = x0 + 4; xx < x0 + w - 6; xx++) if (ok(xx, yy)) { x = xx; y = yy; found = true; break; }
    const p = ctx.getImageData(x + 8, y + 18, 1, 1).data;
    return [x, y, `rgb(${p[0]},${p[1]},${p[2]})`];
  }

  async function openGridCard() {
    try { window.noteUse?.("grid-card"); } catch {}
    const picks = (typeof fetchAllPicks === "function" ? await fetchAllPicks() : null) || lastGoodCloudPicks || {};
    // Trophies: one per sealed week won this season, and who took last week.
    if (typeof loadWeekSummaries === "function" && !Object.keys(weekSummaries || {}).length) { try { await loadWeekSummaries(); } catch {} }
    const sealedWeeks = Object.entries(weekSummaries || {}).filter(([, v]) => v && v.complete).map(([k, v]) => ({ week: Number(k), winners: v.winners || [] })).sort((a, b) => a.week - b.week);
    const wins = {};
    for (const w of sealedWeeks) for (const n of w.winners) wins[n] = (wins[n] || 0) + 1;
    const lastWeek = sealedWeeks.filter((w) => w.week < currentWeek).pop();
    const lastWinners = new Set(lastWeek ? lastWeek.winners : []);
    const total = GAMES.length;
    const lockAt = weekLockTime() ?? Math.min(...GAMES.map((g) => new Date(g.kickoff).getTime()));
    const ms = Math.max(0, lockAt - Date.now());
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    const left = ms <= 0 ? "FIGHT!" : `FIGHT IN ${d ? `${d}D ${h}H` : h ? `${h}H ${m}M` : `${m}M`}`;
    const rows = MANAGERS.map((name) => {
      const st = picks[name] || { picks: {} };
      const n = GAMES.filter((g) => st.picks?.[g.id]).length;
      const tb = String(st.tiebreaker ?? "").trim();
      return { name, n, tb, wins: wins[name] || 0, last: lastWinners.has(name), state: n === total && tb ? "go" : n === 0 && !tb ? "none" : "warn" };
    }).sort((a, b) => (b.n + (b.tb ? 1 : 0)) - (a.n + (a.tb ? 1 : 0)) || a.name.localeCompare(b.name));
    const ready = rows.filter((r) => r.state === "go").length;

    const isTriple = triple();
    const bg = await loadBg(isTriple ? TRIPLE_BG : BG);
    const W = 1024, H = 1536;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = "#0a0014"; ctx.fillRect(0, 0, W, H); }
    if (isTriple) {
      // NFL games lock one by one, so the clock is to the next lock.
      const next = GAMES.map((g) => new Date(g.kickoff).getTime()).filter((t) => t > Date.now()).sort((a, b) => a - b)[0];
      const nm = next ? next - Date.now() : 0;
      const nd = Math.floor(nm / 86400000), nh = Math.floor((nm % 86400000) / 3600000), nmin = Math.floor((nm % 3600000) / 60000);
      const clock = !next ? "ALL LOCKED" : `NEXT LOCK ${nd ? `${nd}D ${nh}H` : nh ? `${nh}H ${nmin}M` : `${nmin}M`}`;
      drawTriple(ctx, rows, total, `${WEEK_LABEL.toUpperCase()} · ${ready}/${rows.length} READY · ${clock}`);
    } else {
    // Name-bar top-left corners on the fighting-game art (1024x1536), left
    // column then right, measured from the picture.
    const BARS = [[244, 460, 241], [245, 664, 239], [247, 876, 237], [248, 1080, 238], [247, 1295, 238], [763, 459, 238], [765, 663, 236], [771, 877, 231], [769, 1080, 234], [773, 1295, 231]];
    const BODY = "rgb(17,21,38)";
    // "ROUND 1" plate becomes the week, the ready count rides under it.
    ctx.fillStyle = "rgb(2,22,60)"; ctx.fillRect(392, 302, 248, 36);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "900 28px Orbitron, system-ui, sans-serif"; ctx.fillStyle = "#e8eefc";
    ctx.fillText(WEEK_LABEL.toUpperCase(), 516, 321);
    const sub = `${left} · ${ready}/${rows.length} READY TO FIGHT`;
    ctx.font = "700 15px 'Press Start 2P', monospace";
    const sw = ctx.measureText(sub).width + 28;
    ctx.fillStyle = "rgba(0,0,0,.85)"; ctx.fillRect(512 - sw / 2, 418, sw, 30);
    ctx.fillStyle = "#ffe45e"; ctx.fillText(sub, 512, 434);

    rows.forEach((r, i) => {
      const [bx, by, bw] = BARS[i];
      const fx = bx + bw - 62; // flag box left edge, tucked inside this panel
      const p = ctx.getImageData(bx + 6, by + 6, 1, 1).data;
      const colour = `rgb(${p[0]},${p[1]},${p[2]})`;
      const dark = (p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114) > 170;
      const fc = r.state === "go" ? "#39ff88" : r.state === "warn" ? "#ffe45e" : "#e0102a";
      // Name over the "USER N" bar.
      ctx.fillStyle = colour; ctx.fillRect(bx + 6, by + 4, 226, 30);
      ctx.font = "900 22px Orbitron, system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillStyle = dark ? "#111" : "#fff";
      ctx.fillText(shown(r.name).toUpperCase(), bx + 16, by + 20);
      // One trophy on the card: last week's winner only, not a season tally.
      if (r.last) { ctx.font = "18px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif"; ctx.textAlign = "right"; ctx.fillText("🏆", bx + bw - 10, by + 20); }
      if (r.last) {
        const tag = lastWeek ? `WEEK ${lastWeek.week} CHAMP` : "LAST WEEK'S CHAMP";
        ctx.font = "900 11px Orbitron, system-ui, sans-serif"; ctx.textAlign = "left";
        const tw = ctx.measureText(tag).width + 12;
        ctx.fillStyle = "#ffe45e"; ctx.fillRect(bx + 6, by - 14, tw, 16);
        ctx.fillStyle = "#2a1e00"; ctx.fillText(tag, bx + 12, by - 6);
      }
      // Selections count.
      ctx.fillStyle = BODY; ctx.fillRect(bx + bw - 90, by + 46, 80, 26);
      ctx.font = "700 20px Orbitron, system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillStyle = "#fff";
      ctx.fillText(`${r.n} / ${total}`, bx + bw - 14, by + 59);
      // Ten cells.
      ctx.fillStyle = BODY; ctx.fillRect(bx + 10, by + 73, fx - bx - 16, 32);
      const step = (fx - 10 - (bx + 13)) / total, cw = step - 2.4;
      for (let k = 0; k < total; k++) {
        const cx = bx + 13 + k * step;
        ctx.fillStyle = k < r.n ? fc : "#4a5468"; ctx.fillRect(cx, by + 76, cw, 26);
        ctx.fillStyle = k < r.n ? "rgba(255,255,255,.35)" : "rgba(255,255,255,.12)"; ctx.fillRect(cx, by + 76, cw, 5);
      }
      // Tiebreaker in or not; the number stays private until kickoff.
      ctx.fillStyle = BODY; ctx.fillRect(bx + 112, by + 112, 60, 26);
      ctx.font = "900 20px Orbitron, system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillStyle = r.tb ? "#39ff88" : "#e0102a";
      ctx.fillText(r.tb ? "✓" : "✗", bx + 160, by + 125);
      // Flag box in the state colour.
      ctx.fillStyle = BODY; ctx.fillRect(fx - 6, by + 70, 72, 76);
      ctx.strokeStyle = fc; ctx.lineWidth = 5; ctx.strokeRect(fx, by + 77, 58, 62);
      px_(ctx, SMALL_FLAG, fx + 10, by + 86, 5, { F: fc, P: "#ddd" });
      if (r.state === "go") for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 8; xx++) if ((xx + yy) % 2) { ctx.fillStyle = "#052010"; ctx.fillRect(fx + 10 + xx * 5, by + 86 + yy * 5, 5, 5); }
    });

    }

    // Modal with the picture and share/save.
    let modal = document.getElementById("gridcard-modal");
    if (!modal) {
      modal = document.createElement("div"); modal.id = "gridcard-modal"; modal.className = "gridcard-modal";
      modal.innerHTML = `<div class="gridcard-box"><img alt="Grid check card"><div class="gridcard-row"><button type="button" class="admin-btn primary" data-act="share">Share</button><a class="admin-btn" data-act="save" download="grid-check.png">Save</a><button type="button" class="admin-btn" data-act="close">Close</button></div><p class="gridcard-hint">Long-press the picture to copy it.</p></div>`;
      document.body.appendChild(modal);
      modal.addEventListener("click", (e) => { if (e.target === modal || e.target.dataset.act === "close") modal.classList.add("hidden"); });
    }
    const url = c.toDataURL("image/png");
    modal.querySelector("img").src = url;
    modal.querySelector('[data-act="save"]').href = url;
    modal.classList.remove("hidden");
    modal.querySelector('[data-act="share"]').onclick = () => c.toBlob(async (blob) => {
      const file = new File([blob], "grid-check.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], text: `Grid check · ${WEEK_LABEL}` }); } catch {} }
      else modal.querySelector(".gridcard-hint").textContent = "Sharing is not available here. Save or long-press the picture.";
    });
    if (typeof track === "function") track("grid-card");
  }
  window.openGridCard = openGridCard;
})();
