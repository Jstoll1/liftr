// Grades archived expert picks against the finals. A pick against the
// spread uses the line the outlet wrote when it gave one, else the
// sealed line. A straight-up pick is graded on the winner. BOTH counts
// once each way.

// The spread for one side of a game from the sealed line.
function sealedLine(game, side) {
  const favSide = game.favorite === game.home ? "home" : "away";
  const s = Number(game.spread) || 0;
  return side === favSide ? -s : s;
}

export function gradePick(game, pick, final) {
  if (!final) return [];
  const mine = pick.side === "away" ? final.awayScore : final.homeScore;
  const theirs = pick.side === "away" ? final.homeScore : final.awayScore;
  const out = [];
  if (pick.type === "ATS" || pick.type === "BOTH") {
    const written = pick.line !== "" && pick.line != null && Number.isFinite(Number(pick.line)) && Math.abs(Number(pick.line)) < 30;
    const line = written ? Number(pick.line) : sealedLine(game, pick.side);
    const m = mine - theirs + line;
    out.push({ kind: "ATS", line, lineFrom: written ? "outlet" : "sealed", result: m > 0 ? "W" : m < 0 ? "L" : "P" });
  }
  if (pick.type === "SU" || pick.type === "BOTH") {
    out.push({ kind: "SU", result: mine > theirs ? "W" : mine < theirs ? "L" : "P" });
  }
  // A straight-up pick with a predicted score still makes a spread call:
  // IU 27-24 with IU laying 7 is NEB covering. Grade that side on the
  // sealed line, the same call the expert tile shows.
  const sc = /^(\d{1,2})-(\d{1,2})$/.exec(String(pick.score || ""));
  if (pick.type === "SU" && sc) {
    const favSide = game.favorite === game.home ? "home" : "away";
    const pred = { away: Number(sc[1]), home: Number(sc[2]) };
    const favBy = pred[favSide] - pred[favSide === "home" ? "away" : "home"];
    const s = Number(game.spread) || 0;
    if (favBy !== s) {
      const side = favBy > s ? favSide : favSide === "home" ? "away" : "home";
      const m = (side === "away" ? final.awayScore - final.homeScore : final.homeScore - final.awayScore) + sealedLine(game, side);
      out.push({ kind: "ATS", line: sealedLine(game, side), lineFrom: "score", side, result: m > 0 ? "W" : m < 0 ? "L" : "P" });
    }
  }
  return out;
}

// rows: [{ week, game, picks, final }] -> per outlet tally plus every graded pick.
export function expertRecord(rows) {
  const outlets = {};
  const graded = [];
  const tally = (o, kind, r) => {
    const t = (o[kind] ||= { W: 0, L: 0, P: 0 });
    t[r] += 1;
  };
  for (const { week, game, picks, final } of rows) {
    for (const p of picks || []) {
      const grades = gradePick(game, p, final);
      const o = (outlets[p.outlet] ||= { outlet: p.outlet, picks: 0 });
      o.picks += 1;
      for (const g of grades) { tally(o, g.kind, g.result); tally(o, "ALL", g.result); }
      graded.push({ week, gameId: game.id, matchup: `${game.awayShort || game.away} @ ${game.homeShort || game.home}`, outlet: p.outlet, picker: p.picker || "", team: p.side === "away" ? (game.awayShort || game.away) : (game.homeShort || game.home), type: p.type, final: final ? `${final.awayScore}-${final.homeScore}` : null, grades: grades.map((g) => g.side ? { ...g, team: g.side === "away" ? (game.awayShort || game.away) : (game.homeShort || game.home) } : g) });
    }
  }
  const pct = (t) => (t && t.W + t.L ? t.W / (t.W + t.L) : null);
  const list = Object.values(outlets).map((o) => ({ ...o, pct: pct(o.ALL) })).sort((a, b) => ((b.ALL?.W || 0) + (b.ALL?.L || 0) ? 1 : 0) - ((a.ALL?.W || 0) + (a.ALL?.L || 0) ? 1 : 0) || (b.pct ?? -1) - (a.pct ?? -1) || b.picks - a.picks);
  const total = { W: 0, L: 0, P: 0 };
  for (const o of list) for (const k of ["W", "L", "P"]) total[k] += o.ALL?.[k] || 0;
  return { outlets: list, total: { ...total, pct: pct(total) }, graded };
}
