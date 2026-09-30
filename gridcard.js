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
  const ROWS = [376, 597, 822, 1051, 1281], COLS = [254, 694];
  const BG = "assets/grid-bg.png";
  let bgImg = null;
  const loadBg = () => new Promise((res) => { if (bgImg) return res(bgImg); const im = new Image(); im.onload = () => { bgImg = im; res(im); }; im.onerror = () => res(null); im.src = BG; });
  const SMALL_FLAG = ["FFFFFFFF", "FFFFFFFF", "FFFFFFFF", "FFFFFFFF", "FFFFFFFF", "FFFFFFFF", "P.......", "P.......", "P......."];

  // The art's panels drift a few pixels off a true grid, so each one's
  // name-bar corner is found from the pixels near where it should be: the
  // first strongly coloured pixel scanning in from the left, then up.
  const sat = (p) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  const bright = (p) => sat(p) > 100 && Math.max(p[0], p[1], p[2]) > 140;
  function findPanel(ctx, ex, ey) {
    const strip = ctx.getImageData(ex - 40, ey + 18, 90, 1).data;
    let x = ex;
    for (let k = 0; k < 90; k++) { const p = strip.slice(k * 4, k * 4 + 3); if (bright(p) && bright(strip.slice(k * 4 + 12, k * 4 + 15))) { x = ex - 40 + k; break; } }
    const col = ctx.getImageData(x + 10, ey - 30, 1, 70).data;
    let y = ey;
    for (let k = 0; k < 70; k++) { const p = col.slice(k * 4, k * 4 + 3); if (bright(p) && bright(col.slice(k * 4 + 12, k * 4 + 15))) { y = ey - 30 + k; break; } }
    const p = ctx.getImageData(x + 8, y + 18, 1, 1).data;
    return [x, y, `rgb(${p[0]},${p[1]},${p[2]})`];
  }

  async function openGridCard() {
    const picks = (typeof fetchAllPicks === "function" ? await fetchAllPicks() : null) || lastGoodCloudPicks || {};
    const total = GAMES.length;
    const lockAt = weekLockTime() ?? Math.min(...GAMES.map((g) => new Date(g.kickoff).getTime()));
    const ms = Math.max(0, lockAt - Date.now());
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    const left = ms <= 0 ? "LIGHTS OUT" : `LIGHTS OUT IN ${d ? `${d}D ${h}H` : h ? `${h}H ${m}M` : `${m}M`}`;
    const rows = MANAGERS.map((name) => {
      const st = picks[name] || { picks: {} };
      const n = GAMES.filter((g) => st.picks?.[g.id]).length;
      const tb = String(st.tiebreaker ?? "").trim();
      return { name, n, tb, state: n === total && tb ? "go" : n === 0 && !tb ? "none" : "warn" };
    }).sort((a, b) => (b.n + (b.tb ? 1 : 0)) - (a.n + (a.tb ? 1 : 0)) || a.name.localeCompare(b.name));
    const ready = rows.filter((r) => r.state === "go").length;

    const bg = await loadBg();
    const W = 1024, H = 1536;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = "#0a0014"; ctx.fillRect(0, 0, W, H); }
    const BGC = "#0d1220";
    // Week and clock on the track under the banner.
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "700 20px 'Press Start 2P', monospace"; ctx.fillStyle = "#000";
    const line = `${WEEK_LABEL.toUpperCase()} · ${left} · ${ready}/${rows.length} ON THE GRID`;
    ctx.fillRect(W / 2 - ctx.measureText(line).width / 2 - 16, 316, ctx.measureText(line).width + 32, 36);
    ctx.fillStyle = "#ffe45e"; ctx.fillText(line, W / 2, 334);

    rows.forEach((r, i) => {
      // P1..P5 down the left column, P6..P10 down the right, like the art.
      const [px, py, colour] = findPanel(ctx, COLS[Math.floor(i / 5)], ROWS[i % 5]);
      const fc = r.state === "go" ? "#39ff88" : r.state === "warn" ? "#ffe45e" : "#e0102a";
      // Name over the bar.
      ctx.fillStyle = colour; ctx.fillRect(px + 12, py + 6, 205, 26);
      ctx.font = "900 22px Orbitron, system-ui, sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = "#fff";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.lineJoin = "round";
      ctx.strokeText(shown(r.name).toUpperCase(), px + 22, py + 19); ctx.fillText(shown(r.name).toUpperCase(), px + 22, py + 19);
      // Selections count.
      ctx.fillStyle = BGC; ctx.fillRect(px + 140, py + 45, 76, 26);
      ctx.font = "700 20px Orbitron, system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillStyle = "#fff";
      ctx.fillText(`${r.n} / ${total}`, px + 212, py + 58);
      // Ten cells.
      ctx.fillStyle = BGC; ctx.fillRect(px + 6, py + 77, 164, 28);
      for (let k = 0; k < total; k++) {
        const cx = px + 8 + k * 15.8;
        ctx.fillStyle = k < r.n ? colour : "#4a5468"; ctx.fillRect(cx, py + 80, 13.5, 22);
        ctx.fillStyle = k < r.n ? "rgba(255,255,255,.35)" : "rgba(255,255,255,.12)"; ctx.fillRect(cx, py + 80, 13.5, 5);
      }
      // Tiebreaker value.
      ctx.fillStyle = BGC; ctx.fillRect(px + 112, py + 116, 62, 26);
      ctx.font = "700 18px Orbitron, system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillStyle = r.tb ? "#fff" : "#8a93a6";
      ctx.fillText(r.tb ? r.tb : "--", px + 170, py + 129);
      // Flag box: border and a pixel flag in the state colour.
      ctx.fillStyle = BGC; ctx.fillRect(px + 172, py + 75, 70, 70);
      ctx.strokeStyle = fc; ctx.lineWidth = 4; ctx.strokeRect(px + 178, py + 81, 52, 58);
      px_(ctx, SMALL_FLAG, px + 188, py + 88, 5, { F: fc, P: "#ddd" });
      if (r.state === "go") for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 8; xx++) if ((xx + yy) % 2) { ctx.fillStyle = "#052010"; ctx.fillRect(px + 188 + xx * 5, py + 88 + yy * 5, 5, 5); }
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
