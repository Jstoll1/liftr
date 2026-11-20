// Fantasy: the top of the History tab. The BroChiefs fantasy league (NFL,
// ESPN, public) live from the Worker's /fantasy: this week's matchups with
// live team totals (tap one for both lineups, every starter's points),
// then the season standings. The league archive folds away underneath.
(() => {
  if (typeof WORKER_URL === "undefined" || !WORKER_URL) return;
  const root = document.getElementById("fx");
  if (!root) return;
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pts = (n) => (Math.round((Number(n) || 0) * 10) / 10).toFixed(1);
  const colour = (o) => (typeof A !== "undefined" && A.colors?.[o]) || "#8b8498";
  const nflLogo = (ab) => (ab ? `<img class="fx-nfl" src="https://a.espncdn.com/i/teamlogos/nfl/500/${esc(ab.toLowerCase())}.png" alt="" loading="lazy" onerror="this.style.display='none'">` : "");
  // A team's badge: its ESPN logo, or the owner's initial in their colour.
  const badge = (t) => t?.logo
    ? `<img class="fx-badge" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;fx-badge ini&quot; style=&quot;--oc:${esc(colour(t.owner))}&quot;>${esc(String(t.owner || "?")[0])}</span>'">`
    : `<span class="fx-badge ini" style="--oc:${esc(colour(t?.owner))}">${esc(String(t?.owner || "?")[0])}</span>`;
  let data = null, at = 0, open = new Set(), busy = false;

  async function load(force) {
    if (busy || (!force && data && Date.now() - at < 55000)) return data;
    busy = true;
    try { const r = await fetch(`${WORKER_URL}/fantasy?t=${Math.floor(Date.now() / 60000)}`); if (r.ok) { data = await r.json(); at = Date.now(); } } catch {}
    busy = false;
    return data;
  }

  const sideHtml = (t, other, k) => {
    const lead = (t?.points || 0) > (other?.points || 0);
    return `<span class="fx-side ${k}${lead ? " lead" : ""}${typeof currentManager !== "undefined" && t?.owner === currentManager ? " me" : ""}">${badge(t)}<span class="fx-nm"><b>${esc(t?.owner || t?.name || "")}</b><small>${t?.record ? `${esc(t.record)} · ` : ""}${esc(t?.name || "")}</small></span><em>${pts(t?.points)}</em></span>`;
  };
  const lineup = (t) => `<ol class="fx-lu">${(t?.starters || []).map((p) => `<li><i>${esc(p.slot)}</i><span>${esc(p.name)}${p.injury ? `<u>${esc(p.injury === "QUESTIONABLE" ? "Q" : p.injury === "OUT" ? "O" : p.injury[0])}</u>` : ""}</span>${nflLogo(p.nfl)}<b class="${p.pts > 0 ? "on" : ""}">${pts(p.pts)}</b></li>`).join("")}</ol>`;

  function paint() {
    if (!data) { root.innerHTML = `<div class="fx-head"><span class="fx-k">FANTASY</span></div><p class="fx-note">Loading the league…</p>`; return; }
    const lw = data.live, week = lw?.week || data.weeksPlayed + 1;
    const anyLive = (lw?.matchups || []).some((m) => !m.final && ((m.home?.points || 0) + (m.away?.points || 0)) > 0);
    const games = (lw?.matchups || []).map((m) => {
      const isOpen = open.has(m.id);
      return `<div class="fx-mu${isOpen ? " open" : ""}${m.final ? " final" : ""}" data-fxmu="${m.id}" role="button" tabindex="0" aria-expanded="${isOpen}">
        <div class="fx-row">${sideHtml(m.away, m.home, "a")}<span class="fx-vs">${m.final ? "FINAL" : "VS"}</span>${sideHtml(m.home, m.away, "h")}</div>
        ${isOpen ? `<div class="fx-lus">${lineup(m.away)}${lineup(m.home)}</div>` : ""}
      </div>`;
    }).join("");
    const rows = (data.standings || []).map((r) => { const t = data.teams?.[r.owner]; return `<div class="fx-st${typeof currentManager !== "undefined" && r.owner === currentManager ? " me" : ""}"><span class="fx-rk">${r.rank}</span>${badge({ ...t, owner: r.owner })}<span class="fx-nm"><b>${esc(t?.name || r.owner)}</b><small>${esc(r.owner)}</small></span><span class="fx-rec">${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}</span><span class="fx-pf">${pts(r.pointsFor)}</span></div>`; }).join("");
    root.innerHTML = `
      <div class="fx-head"><span class="fx-k">FANTASY · ${esc(data.year)}</span><span class="fx-wk">${anyLive ? `<i class="fx-dot"></i>LIVE · ` : ""}WEEK ${esc(week)}</span></div>
      ${games ? `<div class="fx-mus">${games}</div>` : `<p class="fx-note">This week's matchups show once ESPN posts them.</p>`}
      <div class="fx-sth"><span>STANDINGS</span><span>W-L</span><span>PF</span></div>
      <div class="fx-sts">${rows}</div>
      <p class="fx-note">From ESPN · updated ${esc(new Date(data.exportedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}</p>`;
  }

  root.addEventListener("click", (e) => {
    const mu = e.target.closest("[data-fxmu]");
    if (!mu) return;
    const id = Number(mu.dataset.fxmu);
    open.has(id) ? open.delete(id) : open.add(id);
    try { window.noteUse?.("fantasy-matchup"); } catch {}
    paint();
  });
  root.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-fxmu]")) { e.preventDefault(); e.target.click(); } });

  const visible = () => !document.getElementById("history-screen")?.classList.contains("hidden") && !document.hidden;
  window.paintFantasy = async (force) => { paint(); await load(force); paint(); };
  if (visible()) window.paintFantasy();
  setInterval(() => { if (visible()) load().then(paint); }, 60000);
  document.addEventListener("visibilitychange", () => { if (visible()) load().then(paint); });
})();
