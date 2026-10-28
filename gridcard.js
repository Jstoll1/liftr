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
  const BG = "assets/grid-bg-100.webp";
  let bgImg = null;
  const loadBg = () => new Promise((res) => { if (bgImg) return res(bgImg); const im = new Image(); im.onload = () => { bgImg = im; res(im); }; im.onerror = () => res(null); im.src = BG; });
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

    const bg = await loadBg();
    const W = 1024, H = 1536;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = "#0a0014"; ctx.fillRect(0, 0, W, H); }
    // Name-bar top-left corners and widths on the $100 volleyball art
    // (1024x1536), left column then right, measured from the picture. Every
    // other part of a panel sits at a fixed offset from its name bar; the
    // flag box hangs off the bar's right end.
    const BARS = [[250, 427, 241], [243, 624, 243], [248, 821, 241], [246, 1022, 241], [247, 1241, 240], [751, 427, 245], [765, 624, 234], [765, 822, 236], [773, 1023, 235], [774, 1242, 231]];
    // The week and the ready count ride in one plate between the title and
    // the first row of panels.
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const sub = `${WEEK_LABEL.toUpperCase()} · ${left} · ${ready}/${rows.length} READY`;
    ctx.font = "700 17px 'Press Start 2P', monospace";
    const sw = ctx.measureText(sub).width + 36;
    ctx.fillStyle = "rgba(8,10,28,.88)"; ctx.fillRect(512 - sw / 2, 356, sw, 38);
    ctx.strokeStyle = "#ffd21f"; ctx.lineWidth = 3; ctx.strokeRect(512 - sw / 2, 356, sw, 38);
    ctx.fillStyle = "#ffe45e"; ctx.fillText(sub, 512, 376);

    rows.forEach((r, i) => {
      const [bx, by, bw] = BARS[i];
      const fx = bx + bw - 64; // flag box left edge
      const p = ctx.getImageData(bx + 6, by + 6, 1, 1).data;
      const colour = `rgb(${p[0]},${p[1]},${p[2]})`;
      const dark = (p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114) > 170;
      const q = ctx.getImageData(fx - 10, by + 128, 1, 1).data;
      const BODY = `rgb(${q[0]},${q[1]},${q[2]})`;
      const fc = r.state === "go" ? "#39ff88" : r.state === "warn" ? "#ffe45e" : "#e0102a";
      // Name over the "USER N" bar.
      ctx.fillStyle = colour; ctx.fillRect(bx + 6, by + 4, bw - 14, 27);
      ctx.font = "900 22px Orbitron, system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillStyle = dark ? "#111" : "#fff";
      ctx.fillText(shown(r.name).toUpperCase(), bx + 16, by + 18);
      // One trophy on the card: last week's winner only, not a season tally.
      if (r.last) { ctx.font = "18px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif"; ctx.textAlign = "right"; ctx.fillText("🏆", bx + bw - 12, by + 18); }
      if (r.last) {
        const tag = lastWeek ? `WEEK ${lastWeek.week} CHAMP` : "LAST WEEK'S CHAMP";
        ctx.font = "900 11px Orbitron, system-ui, sans-serif"; ctx.textAlign = "left";
        const tw = ctx.measureText(tag).width + 12;
        ctx.fillStyle = "#ffe45e"; ctx.fillRect(bx + 6, by - 14, tw, 16);
        ctx.fillStyle = "#2a1e00"; ctx.fillText(tag, bx + 12, by - 6);
      }
      // Selections count.
      ctx.fillStyle = BODY; ctx.fillRect(bx + bw - 96, by + 43, 82, 28);
      ctx.font = "700 20px Orbitron, system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillStyle = "#fff";
      ctx.fillText(`${r.n} / ${total}`, bx + bw - 18, by + 57);
      // Ten cells.
      ctx.fillStyle = BODY; ctx.fillRect(bx + 4, by + 72, fx - bx - 10, 34);
      const step = (fx - 12 - (bx + 7)) / total, cw = step - 2.4;
      for (let k = 0; k < total; k++) {
        const cx = bx + 7 + k * step;
        ctx.fillStyle = k < r.n ? fc : "#4a5468"; ctx.fillRect(cx, by + 75, cw, 28);
        ctx.fillStyle = k < r.n ? "rgba(255,255,255,.35)" : "rgba(255,255,255,.12)"; ctx.fillRect(cx, by + 75, cw, 5);
      }
      // Tiebreaker in or not; the number stays private until kickoff.
      ctx.fillStyle = BODY; ctx.fillRect(bx + 110, by + 114, fx - bx - 116, 28);
      ctx.font = "900 20px Orbitron, system-ui, sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = r.tb ? "#39ff88" : "#e0102a";
      ctx.fillText(r.tb ? "✓" : "✗", bx + 122, by + 128);
      // Flag box in the state colour.
      ctx.fillStyle = BODY; ctx.fillRect(fx - 4, by + 70, 72, 82);
      ctx.strokeStyle = fc; ctx.lineWidth = 5; ctx.strokeRect(fx + 2, by + 78, 56, 58);
      px_(ctx, SMALL_FLAG, fx + 10, by + 85, 5, { F: fc, P: "#ddd" });
      if (r.state === "go") for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 8; xx++) if ((xx + yy) % 2) { ctx.fillStyle = "#052010"; ctx.fillRect(fx + 10 + xx * 5, by + 85 + yy * 5, 5, 5); }
    });

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
