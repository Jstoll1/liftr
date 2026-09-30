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
  const px = (ctx, map, x, y, s, colours) => {
    map.forEach((row, j) => [...row].forEach((ch, i) => { const c = colours[ch]; if (c) { ctx.fillStyle = c; ctx.fillRect(x + i * s, y + j * s, s, s); } }));
  };
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };

  async function openGridCard() {
    const picks = (typeof fetchAllPicks === "function" ? await fetchAllPicks() : null) || lastGoodCloudPicks || {};
    const total = GAMES.length;
    const lockAt = weekLockTime() ?? Math.min(...GAMES.map((g) => new Date(g.kickoff).getTime()));
    const ms = Math.max(0, lockAt - Date.now());
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    const left = ms <= 0 ? "LIGHTS OUT" : `LIGHTS OUT IN ${d ? `${d}D ${h}H` : h ? `${h}H ${m}M` : `${m}M`}`;
    const rows = MANAGERS.map((name, i) => {
      const st = picks[name] || { picks: {} };
      const n = GAMES.filter((g) => st.picks?.[g.id]).length;
      const tb = String(st.tiebreaker ?? "").trim() !== "";
      return { name, n, tb, colour: AVATAR_COLORS[i % AVATAR_COLORS.length], state: n === total && tb ? "go" : n === 0 && !tb ? "none" : "warn" };
    }).sort((a, b) => (b.n + (b.tb ? 1 : 0)) - (a.n + (a.tb ? 1 : 0)) || a.name.localeCompare(b.name));

    // Canvas: 2x for a crisp share. A staggered two-column grid, pole on top left.
    const W = 720, slotH = 150, top = 200, H = top + Math.ceil(rows.length / 2) * slotH + 90;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0a0014"; ctx.fillRect(0, 0, W, H);
    // Track: two dark lanes with a dashed centre line and grid boxes.
    ctx.fillStyle = "#14101f"; ctx.fillRect(40, top - 20, W - 80, H - top - 50);
    ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.setLineDash([14, 14]); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W / 2, top - 20); ctx.lineTo(W / 2, H - 70); ctx.stroke(); ctx.setLineDash([]);
    // Checkered header strip.
    for (let x = 0; x < W; x += 20) for (let y = 0; y < 40; y += 20) { ctx.fillStyle = ((x + y) / 20) % 2 ? "#fff" : "#111"; ctx.fillRect(x, y, 20, 20); }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "italic 900 44px Orbitron, system-ui, sans-serif"; ctx.fillStyle = "#fff";
    ctx.shadowColor = "#ff2a3a"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 0;
    ctx.fillText("GRID CHECK", W / 2, 84);
    ctx.shadowColor = "transparent"; ctx.shadowOffsetX = 0;
    ctx.font = "700 18px 'Press Start 2P', monospace"; ctx.fillStyle = "#ffe45e";
    ctx.fillText(`${WEEK_LABEL.toUpperCase()} · ${left}`, W / 2, 132);
    const ready = rows.filter((r) => r.state === "go").length;
    ctx.font = "14px 'Press Start 2P', monospace"; ctx.fillStyle = "#9a8bb8";
    ctx.fillText(`${ready}/${rows.length} ON THE GRID`, W / 2, 164);

    rows.forEach((r, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x0 = 40 + col * (W - 80) / 2, y0 = top + row * slotH + (col ? 30 : 0);
      const cx = x0 + (W - 80) / 4;
      // Grid box.
      ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 3;
      ctx.strokeRect(cx - 120, y0 + 30, 240, 78);
      ctx.fillStyle = "#0a0014"; ctx.fillRect(cx - 124, y0 + 30, 8, 78); ctx.fillRect(cx + 116, y0 + 30, 8, 78);
      // Name.
      ctx.font = "700 15px 'Press Start 2P', monospace"; ctx.fillStyle = r.colour; ctx.textAlign = "center";
      ctx.fillText(`P${i + 1} ${shown(r.name).toUpperCase()}`, cx, y0 + 14);
      // Car.
      px(ctx, CAR, cx - 96, y0 + 34, 6, { B: r.colour, D: shade(r.colour, .55), W: "#111", H: "#fff" });
      ctx.fillStyle = "#333"; [cx - 96 + 12, cx - 96 + 96].forEach((wx) => { ctx.fillRect(wx + 6, y0 + 34 + 42, 12, 6); });
      // Flag.
      const fc = r.state === "go" ? "#39ff88" : r.state === "warn" ? "#ffe45e" : "#e0102a";
      px(ctx, FLAG, cx + 62, y0 + 36, 5, { P: "#ddd", F: fc, C: r.state === "go" ? "#052010" : fc });
      // Line under the car.
      ctx.font = "700 13px 'Press Start 2P', monospace"; ctx.fillStyle = fc;
      ctx.fillText(`${r.n}/${total} · TB ${r.tb ? "✓" : "✗"}`, cx, y0 + 126);
    });
    ctx.font = "12px 'Press Start 2P', monospace"; ctx.fillStyle = "#9a8bb8"; ctx.fillText("BROCHIEFS.COM", W / 2, H - 28);

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
