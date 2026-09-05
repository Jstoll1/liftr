#!/usr/bin/env python3
"""Rebuild worker/src/matchup-data.js from data/espn-history.json.

Owners are matched to archive names (history.js) by team name and record per
season. Run after re-exporting with scripts/export-espn-history.mjs:

    python3 scripts/build-matchup-data.py
"""
import json, re, collections, itertools

d = json.load(open('data/espn-history.json'))
A = json.loads(re.search(r'const A=(\{.*?\});\n', open('history.js').read(), re.S).group(1))
norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
R = lambda x: round(x, 2)

games, weekly, bench_rows = [], [], []
for y in sorted(d['seasons']):
    s = d['seasons'][y]; arch = A['seasons'][y][4]
    champ, ru, third = A['seasons'][y][0], A['seasons'][y][1], A['seasons'][y][2]
    owner_of = {}
    for t in s['teams']:
        m = [r for r in arch if norm(r[1]) == norm(t['name'])] or \
            [r for r in arch if r[2] == t['wins'] and r[3] == t['losses'] and abs(r[4] - (t['pointsFor'] or 0)) < 1]
        if len(m) != 1:
            raise SystemExit(f"{y}: could not match ESPN team {t['name']} to an archive owner")
        owner_of[t['id']] = m[0][0]
    reg = s['regularSeasonWeeks']; lastweek = max(m['week'] for m in s['matchups'])
    for m in s['matchups']:
        if not m['home'] or not m['away'] or m['winner'] == 'UNDECIDED':
            continue
        h, a = owner_of[m['home']['teamId']], owner_of[m['away']['teamId']]
        hp, ap = m['home']['points'], m['away']['points']
        label, note = 'regular season', None
        if m['week'] > reg:
            pair = {h, a}
            if m['week'] == lastweek and pair == {champ, ru}: label = 'championship game'
            elif m['week'] == lastweek and third in pair: label = 'third place game'
            else: label = 'playoff week game'
        # ESPN's winner field already applies the league tiebreaker for the
        # handful of tied games before 2021, so trust it over raw points.
        home_won = m['winner'] == 'HOME'
        w, l = (h, a) if home_won else (a, h); wp, lp = (hp, ap) if home_won else (ap, hp)
        if hp == ap: note = f"Tied {hp}-{ap} on points; {w} won on the league tiebreaker."
        if label == 'championship game' and w != champ:
            note = f"The final week score favored {w}, but the title was decided on a two-week total, which {champ} won."
            w, l = champ, ru; wp, lp = lp, wp
        g = {'year': int(y), 'week': m['week'], 'type': label, 'winner': w, 'loser': l,
             'winnerPoints': R(wp), 'loserPoints': R(lp), 'margin': R(wp - lp)}
        if note: g['note'] = note
        games.append(g)
        for o, p, opp, res in ((h, hp, a, 'W' if home_won else 'L'), (a, ap, h, 'L' if home_won else 'W')):
            weekly.append({'year': int(y), 'week': m['week'], 'owner': o, 'points': R(p), 'opponent': opp, 'result': res, 'type': label})
    for tid, wk in s['benchPointsByTeamWeek'].items():
        for w, pts in wk.items():
            if int(w) <= reg:
                bench_rows.append({'year': int(y), 'week': int(w), 'owner': owner_of[int(tid)], 'bench': pts})

owners = sorted({g['winner'] for g in games} | {g['loser'] for g in games}); active = A['owners']
regw = [w for w in weekly if w['type'] == 'regular season']; regg = [g for g in games if g['type'] == 'regular season']

h2h = {}
for a, b in itertools.combinations(owners, 2):
    rs = [g for g in games if {g['winner'], g['loser']} == {a, b} and g['type'] == 'regular season']
    po = [g for g in games if {g['winner'], g['loser']} == {a, b} and g['type'] != 'regular season']
    if not rs and not po: continue
    aw = sum(g['winner'] == a for g in rs); bw = len(rs) - aw
    apw = sum(g['winner'] == a for g in po); bpw = len(po) - apw
    finals = [{'year': g['year'], 'winner': g['winner']} for g in po if g['type'] == 'championship game']
    lm = max(rs + po, key=lambda g: (g['year'], g['week']))
    lms = f"{lm['year']} week {lm['week']}: {lm['winner']} {lm['winnerPoints']}-{lm['loserPoints']} ({lm['type']})"
    h2h.setdefault(a, {})[b] = {'regularSeason': f'{a} {aw}-{bw} {b}', 'playoffs': f'{a} {apw}-{bpw} {b}' if po else 'never met in playoffs', 'championshipGames': finals, 'lastMeeting': lms}
    h2h.setdefault(b, {})[a] = {'regularSeason': f'{b} {bw}-{aw} {a}', 'playoffs': f'{b} {bpw}-{apw} {a}' if po else 'never met in playoffs', 'championshipGames': finals, 'lastMeeting': lms}

wk_groups = collections.defaultdict(list)
for w in regw: wk_groups[(w['year'], w['week'])].append(w)
tops = collections.Counter(max(g, key=lambda w: w['points'])['owner'] for g in wk_groups.values())
bots = collections.Counter(min(g, key=lambda w: w['points'])['owner'] for g in wk_groups.values())

per = {}
for o in owners:
    rs = [w for w in regw if w['owner'] == o]; po = [w for w in weekly if w['owner'] == o and w['type'] != 'regular season']
    hi = max(rs, key=lambda w: w['points']); lo = min(rs, key=lambda w: w['points'])
    b = [r for r in bench_rows if r['owner'] == o]
    finals = [g for g in games if g['type'] == 'championship game' and o in (g['winner'], g['loser'])]
    streak = best = 0
    for w in sorted(rs, key=lambda w: (w['year'], w['week'])):
        streak = streak + 1 if w['result'] == 'W' else 0; best = max(best, streak)
    by_season = collections.defaultdict(float)
    for r in b: by_season[r['year']] += r['bench']
    bw_ = max([g for g in regg if g['winner'] == o], key=lambda g: g['margin'])
    wl_ = max([g for g in regg if g['loser'] == o], key=lambda g: g['margin'])
    close = [w for w in rs if abs(next(g['margin'] for g in regg if g['year']==w['year'] and g['week']==w['week'] and o in (g['winner'],g['loser']))) < 5]
    close10 = [w for w in rs if abs(next(g['margin'] for g in regg if g['year']==w['year'] and g['week']==w['week'] and o in (g['winner'],g['loser']))) < 10]
    # all-play: record if the owner had played every other team each week
    ap_w = ap_l = 0
    for w in rs:
        others = [x for x in wk_groups[(w['year'], w['week'])] if x['owner'] != o]
        ap_w += sum(w['points'] > x['points'] for x in others); ap_l += sum(w['points'] < x['points'] for x in others)
    ap_pct = ap_w / (ap_w + ap_l) if (ap_w + ap_l) else 0
    actual_w = sum(x['result'] == 'W' for x in rs); expected_w = ap_pct * len(rs)
    per[o] = {
        'active': o in active,
        'closeGameRecordUnder5': f"{sum(x['result']=='W' for x in close)}-{sum(x['result']=='L' for x in close)}",
        'closeGameRecordUnder10': f"{sum(x['result']=='W' for x in close10)}-{sum(x['result']=='L' for x in close10)}",
        'winsBy50Plus': sum(1 for g in regg if g['winner'] == o and g['margin'] >= 50),
        'lossesBy50Plus': sum(1 for g in regg if g['loser'] == o and g['margin'] >= 50),
        'allPlayRecord': f"{ap_w}-{ap_l}", 'allPlayWinPct': R(ap_pct),
        'luck': R(actual_w - expected_w),
        'luckNote': 'luck = actual wins minus the wins an all-play schedule would predict; positive means the schedule helped, negative means the owner was unlucky',
        'regularSeasonRecord': f"{sum(w['result']=='W' for w in rs)}-{sum(w['result']=='L' for w in rs)}",
        'playoffWeekRecord': f"{sum(w['result']=='W' for w in po)}-{sum(w['result']=='L' for w in po)}",
        'championshipGameRecord': f"{sum(g['winner']==o for g in finals)}-{sum(g['loser']==o for g in finals)}",
        'championshipGames': [{'year': g['year'], 'opponent': g['loser'] if g['winner'] == o else g['winner'], 'result': 'W' if g['winner'] == o else 'L', 'finalWeekScore': f"{g['winnerPoints']}-{g['loserPoints']}"} for g in finals],
        'avgWeeklyPoints': R(sum(w['points'] for w in rs) / len(rs)),
        'highestWeek': f"{hi['points']} in {hi['year']} week {hi['week']} vs {hi['opponent']} ({hi['result']})",
        'lowestWeek': f"{lo['points']} in {lo['year']} week {lo['week']} vs {lo['opponent']} ({lo['result']})",
        'weeksAsLeagueTopScorer': tops[o], 'weeksAsLeagueLowestScorer': bots[o], 'longestWinStreak': best,
        'weeks100Plus': sum(w['points'] >= 100 for w in rs), 'weeks150Plus': sum(w['points'] >= 150 for w in rs),
        'benchPointsTotal': R(sum(r['bench'] for r in b)), 'benchPointsPerWeek': R(sum(r['bench'] for r in b) / len(b)) if b else None,
        'mostBenchPointsSeason': ({'year': (yb := max(by_season, key=by_season.get)), 'bench': R(by_season[yb])} if by_season else None),
        'biggestWin': f"{bw_['margin']} over {bw_['loser']} in {bw_['year']} week {bw_['week']} ({bw_['winnerPoints']}-{bw_['loserPoints']})",
        'worstLoss': f"{wl_['margin']} to {wl_['winner']} in {wl_['year']} week {wl_['week']} ({wl_['winnerPoints']}-{wl_['loserPoints']})",
    }

pair_counts = collections.Counter(tuple(sorted((g['winner'], g['loser']))) for g in regg)
fmt_w = lambda w: f"{w['owner']} {w['points']} in {w['year']} week {w['week']} vs {w['opponent']} ({w['result']})"
fmt_g = lambda g: f"{g['year']} week {g['week']}: {g['winner']} {g['winnerPoints']} beat {g['loser']} {g['loserPoints']} (margin {g['margin']})"
bench_season = collections.defaultdict(float)
for r in bench_rows: bench_season[(r['year'], r['owner'])] += r['bench']
finals = [g for g in games if g['type'] == 'championship game']
league = {
    'highestWeeklyScores': [fmt_w(w) for w in sorted(regw, key=lambda w: -w['points'])[:10]],
    'lowestWeeklyScores': [fmt_w(w) for w in sorted(regw, key=lambda w: w['points'])[:10]],
    'biggestBlowouts': [fmt_g(g) for g in sorted(regg, key=lambda g: -g['margin'])[:10]],
    'closestGames': [fmt_g(g) for g in sorted(regg, key=lambda g: g['margin'])[:10]],
    'highestScoreInALoss': fmt_g(max(regg, key=lambda g: g['loserPoints'])),
    'lowestScoreInAWin': fmt_g(min(regg, key=lambda g: g['winnerPoints'])),
    'championshipGames': [{'year': g['year'], 'winner': g['winner'], 'loser': g['loser'], 'finalWeekScore': f"{g['winnerPoints']}-{g['loserPoints']}", **({'note': g['note']} if 'note' in g else {})} for g in sorted(finals, key=lambda g: g['year'])],
    'mostBenchPointsInASeason': [f"{o} {R(v)} in {y}" for (y, o), v in sorted(bench_season.items(), key=lambda kv: -kv[1])[:10]],
    'mostWeeksAsTopScorer': [f"{o} {n}" for o, n in tops.most_common(5)],
    'mostWeeksAsLowestScorer': [f"{o} {n}" for o, n in bots.most_common(5)],
    'longestWinStreaks': sorted([f"{o} {p['longestWinStreak']}" for o, p in per.items()], key=lambda s: -int(s.split()[-1]))[:5],
    'luckiestOwners': sorted([f"{o} {p['luck']:+} ({p['regularSeasonRecord']} actual, all-play {p['allPlayRecord']})" for o, p in per.items()], key=lambda s: -float(s.split()[1]))[:5],
    'unluckiestOwners': sorted([f"{o} {p['luck']:+} ({p['regularSeasonRecord']} actual, all-play {p['allPlayRecord']})" for o, p in per.items()], key=lambda s: float(s.split()[1]))[:5],
    'bestCloseGameRecords': sorted([f"{o} {p['closeGameRecordUnder5']} in games decided by under 5" for o, p in per.items()], key=lambda s: -int(s.split()[1].split('-')[0]))[:5],
    'mostPlayedPairs': [f"{a} vs {b}: {n} regular season games" for (a, b), n in sorted(pair_counts.items(), key=lambda kv: -kv[1])[:5]],
    'scope': 'Regular season only for weekly records, blowouts, closest games, close-game records, all-play and bench points. The league used divisional schedules, so some owner pairs met rarely. Playoff week scores before 2021 can be two-week totals.',
    'notAvailable': 'The archive has no playoff seeds or playoff appearance lists (only podium finishes), no in-game or comeback data (weekly totals only), no projections or favorite/underdog lines, and no player, draft, injury or transaction data.',
}
compact = {y: [f"W{g['week']} {g['winner']} {g['winnerPoints']} d. {g['loser']} {g['loserPoints']}" + ('' if g['type'] == 'regular season' else f" [{g['type']}]") for g in games if g['year'] == int(y)] for y in sorted({g['year'] for g in games})}
M = {'headToHead': h2h, 'ownerMatchupStats': per, 'leagueMatchupRecords': league, 'everyGameByYear': compact}
open('worker/src/matchup-data.js', 'w').write("// Derived from data/espn-history.json (ESPN league matchup export).\n// Regenerate with scripts/build-matchup-data.py when the export changes.\nexport const MATCHUPS = " + json.dumps(M, separators=(',', ':')) + ";\n")
print(f"wrote worker/src/matchup-data.js: {len(games)} games, {len(owners)} owners, {len(json.dumps(M))} bytes")
