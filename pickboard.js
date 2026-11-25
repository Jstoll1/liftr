// Pick board image (Jake only): the rodeo art with each member's name,
// picks made, tiebreaker set or not, and a flag (red none, yellow part,
// green all in). Picks themselves stay hidden: only counts are drawn.
// A nav shortcut makes it and hands it over to save or share.
(function () {
  const ME = "Jake", ART = "images/pickboard-rodeo.jpg";
  // Flag centre of each card on the 1024 x 1536 art (measured), left
  // column then right; every other spot is an offset from it.
  const ROWS = [382, 600, 824, 1048, 1301], COLS = [468, 978];
  const btn = document.createElement("button");
  btn.id = "nav-board-btn"; btn.className = "nav-btn hidden"; btn.type = "button";
  btn.innerHTML = `<svg class="nav-btn-icon" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M2 2h12v12H2zm1 1v10h10V3zm1 1h3v3H4zm5 0h3v3H9zM4 9h3v3H4zm5 0h3v3H9z"/></svg><span class="nav-btn-label">Board</span>`;
  const nav = document.getElementById("bottom-nav");
  if (nav) nav.appendChild(btn);
  const who = () => { try { return typeof currentManager !== "undefined" ? currentManager : null; } catch { return null; } };
  const sync = () => btn.classList.toggle("hidden", who() !== ME || !!window.LEAGUE && window.LEAGUE.sport === "nfl");
  sync(); setInterval(sync, 2000);

  const img = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  function rows(picks) {
    const total = GAMES.length;
    return MANAGERS.map((n) => {
      const st = picks?.[n] || {}, made = GAMES.filter((g) => { const p = st.picks?.[g.id]; return p && (p.hidden || p.team); }).length;
      const tb = String(st.tiebreaker ?? "").trim() !== "";
      return { n, made, total, tb, done: made >= total && tb };
    }).sort((a, b) => b.done - a.done || b.made - a.made || b.tb - a.tb || a.n.localeCompare(b.n)).slice(0, 10);
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function fit(c, text, max, size, weight, family) { let s = size; do { c.font = `${weight} ${s}px ${family}`; s--; } while (c.measureText(text).width > max && s > 10); }
  async function draw() {
    const picks = await fetchBoardPicks();
    const art = await img(ART);
    try { await document.fonts.load("italic 700 30px 'Chakra Petch'"); } catch {}
    const cv = document.createElement("canvas"); cv.width = art.width; cv.height = art.height;
    const c = cv.getContext("2d"); c.drawImage(art, 0, 0);
    const nm = (n) => (typeof shown === "function" ? shown(n) : n).toUpperCase();
    const list = rows(picks), sx = art.width / 1024, sy = art.height / 1536;
    c.scale(sx, sy);
    const DARK = "#17121c", F = "'Chakra Petch', 'Arial Narrow', sans-serif";
    list.forEach((r, i) => {
      const fx = COLS[i < 5 ? 0 : 1] + (i < 5 ? 0 : 2), fy = ROWS[i % 5], x0 = fx - 183;
      // Name banner: repaint the red plate, then the name.
      const g = c.createLinearGradient(0, fy - 112, 0, fy - 74); g.addColorStop(0, "#c0222a"); g.addColorStop(1, "#7d1015");
      c.fillStyle = g; rr(c, x0 + 1, fy - 110, 215, 34, 5); c.fill();
      c.fillStyle = "#fff7e8"; c.shadowColor = "rgba(0,0,0,.6)"; c.shadowBlur = 4; c.shadowOffsetY = 2;
      fit(c, nm(r.n), 196, 30, "italic 700", F); c.textBaseline = "middle"; c.fillText(nm(r.n), x0 + 18, fy - 92);
      c.shadowColor = "transparent";
      // Count.
      c.fillStyle = DARK; c.fillRect(fx - 44, fy - 62, 64, 26);
      c.fillStyle = "#fff7e8"; c.font = `700 21px ${F}`; c.textAlign = "right"; c.fillText(`${r.made} / ${r.total}`, fx + 17, fy - 48); c.textAlign = "left";
      // Pips, one per game.
      c.fillStyle = DARK; c.fillRect(x0 - 4, fy - 32, fx - 34 - (x0 - 4), 34);
      const n = Math.max(1, r.total), w = (130 - (n - 1) * 3) / n;
      for (let k = 0; k < n; k++) { c.fillStyle = k < r.made ? (r.done ? "#2bff7a" : "#e8e2ef") : "rgba(140,132,160,.35)"; rr(c, x0 + 13 + k * (w + 3), fy - 28, w, 25, 2); c.fill(); }
      // Tiebreaker.
      c.fillStyle = DARK; c.fillRect(fx - 80, fy + 12, 46, 26);
      c.fillStyle = r.tb ? "#2bff7a" : "#ff4f6e"; c.font = `700 15px ${F}`; c.fillText(r.tb ? "SET" : "NONE", fx - 72, fy + 25);
      // Flag.
      const col = r.done ? "#1fe36a" : r.made ? "#ffd400" : "#ff1f2e";
      c.fillStyle = DARK; rr(c, fx - 34, fy - 34, 78, 78, 8); c.fill();
      c.strokeStyle = col; c.lineWidth = 4; rr(c, fx - 22, fy - 22, 50, 52, 6); c.stroke();
      c.fillStyle = col; c.beginPath(); c.moveTo(fx - 10, fy + 20); c.lineTo(fx - 4, fy - 12); c.quadraticCurveTo(fx + 6, fy - 16, fx + 12, fy - 10); c.quadraticCurveTo(fx + 18, fy - 5, fx + 20, fy - 10); c.lineTo(fx + 15, fy + 10); c.quadraticCurveTo(fx + 8, fy + 14, fx + 2, fy + 8); c.quadraticCurveTo(fx - 3, fy + 5, fx - 6, fy + 9); c.lineTo(fx - 7, fy + 20); c.closePath(); c.fill();
    });
    return cv;
  }
  async function share() {
    btn.disabled = true;
    try {
      const cv = await draw();
      const blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.9));
      const file = new File([blob], `brochiefs-board-week-${typeof currentWeek !== "undefined" ? currentWeek : ""}.jpg`, { type: "image/jpeg" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }).catch(() => {}); }
      else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
    } catch (e) { alert("Couldn't make the board. Try again."); }
    btn.disabled = false;
  }
  btn.addEventListener("click", share);
  window.__pickBoardDraw = draw;
})();
