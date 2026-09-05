#!/usr/bin/env python3
"""Build attract-facts.js: real facts from the precomputed archive tables that
the Ask the Archive box cycles through while idle. Each entry pairs a fact
line with the question that reproduces it.

    python3 scripts/build-attract-facts.py
"""
import json, re, subprocess
def load(path, name):
    src = open(path).read(); start = src.index("export const " + name + " = ") + len("export const " + name + " = ")
    return json.loads(src[start:src.rindex(";")])
H = load('worker/src/history-data.js', 'HISTORY'); M = load('worker/src/matchup-data.js', 'MATCHUPS')
C = H['careerTotals']; L = H['leagueRecords']; R = M['leagueMatchupRecords']; S = M['ownerMatchupStats']
facts = []
t = L['mostTitles'][0]; facts.append((f"{t['owner']} leads the league with {t['titles']} titles ({', '.join(map(str, t['years']))})", "who has the most titles"))
w = L['mostCareerWins'][0]; facts.append((f"{w['owner']} has the most career wins at {w['record']}", "who has the most career wins"))
b = L['bestSingleSeasonRecord'][0]; facts.append((f"Best regular season ever: {b['owner']} went {b['record']} in {b['year']}", "what is the best regular season record ever"))
wr = L['worstSingleSeasonRecord'][0]; facts.append((f"Worst regular season ever: {wr['owner']} went {wr['record']} in {wr['year']}", "what is the worst regular season record ever"))
lp = L['mostLastPlaceFinishes'][0]; facts.append((f"{lp['owner']} has finished last {lp['lastPlaceFinishes']} times ({', '.join(map(str, lp['years']))})", "who has the most last place finishes"))
bt = L['mostBottomThreeFinishes'][0]; facts.append((f"{bt['owner']} has {bt['bottomThree']} bottom-three finishes, the most in the league", "who has the most bottom three finishes"))
dr = L['longestActiveTitleDrought'][0]; facts.append((f"{dr['owner']} has gone {dr['seasonsWithoutTitle']} seasons without a title", "who has the longest title drought"))
hp = L['highestSingleSeasonPoints'][0]; facts.append((f"{hp['owner']} scored {hp['pointsFor']} points in {hp['year']}, the most in one season", "who scored the most points in a single season"))
bw = L['bestRecordWithoutTitle'][0]; facts.append((f"{bw['owner']} went {bw['record']} in {bw['year']} and did not win the title", "what is the best record that did not win a title"))
wt = L['worstRecordToWinTitle'][0]; facts.append((f"{wt['owner']} won the {wt['year']} title at {wt['record']}, the worst record for a champion", "what is the worst record to win a title"))
for line in R['highestWeeklyScores'][:1]: facts.append((f"Highest week ever: {line}", "what is the highest weekly score ever"))
for line in R['biggestBlowouts'][:1]: facts.append((f"Biggest blowout: {line}", "what is the biggest blowout in league history"))
for line in R['closestGames'][:1]: facts.append((f"Closest game: {line}", "what is the closest game in league history"))
facts.append((f"Unluckiest owner: {R['unluckiestOwners'][0]}", "who is the unluckiest owner"))
facts.append((f"Luckiest owner: {R['luckiestOwners'][0]}", "who is the luckiest owner"))
facts.append((f"{R['bestCloseGameRecords'][0]}", "who has the best record in close games"))
facts.append((f"Most played rivalry: {R['mostPlayedPairs'][0]}", "which two owners have played each other the most"))
facts.append((f"Most bench points in a season: {R['mostBenchPointsInASeason'][0]}", "who left the most points on the bench in a season"))
facts.append((f"Weeks as top scorer: {R['mostWeeksAsTopScorer'][0]} leads the league", "who has the most weeks as the top scorer"))
facts.append((f"Longest win streak: {R['longestWinStreaks'][0]} straight regular season wins", "who has the longest win streak"))
facts.append((f"Highest score in a loss: {R['highestScoreInALoss']}", "what is the highest score in a loss"))
cg = R['championshipGames'][0]; facts.append((f"The 2014 final ended {cg['finalWeekScore']} and {cg['winner']} won on the tiebreaker", "what happened in the 2014 championship"))
for o in H['owners']:
    c = C[o]
    if c['titles'] >= 2: facts.append((f"{o} has won {c['titles']} titles ({', '.join(map(str, c['titleYears']))})", f"how many titles does {o} have"))
    s = S[o]; facts.append((f"{o}'s best week: {s['highestWeek']}", f"what is {o}'s highest scoring week"))
fm = [m for m in H['formerMembers'] if m['name'].startswith('Marty')][0]; facts.append((f"Marty auto-drafted for four years, went {fm['record']} and won the 2022 title", "tell me about Marty"))
out = [{"fact": f.replace('–', '-'), "ask": q} for f, q in facts]

# Personal facts: shown to the signed-in owner in second person. "ask" is the
# question the archive answers; it uses the owner's name so it works for anyone.
h2h = M['headToHead']
for o in H['owners']:
    c = C[o]; s = S[o]; mine = []
    rec = f"{c['wins']}-{c['losses']}"
    if c['titles']: mine.append((f"You have {c['titles']} title{'s' if c['titles']>1 else ''} ({', '.join(map(str, c['titleYears']))}) and a {rec} career record", f"how many titles does {o} have"))
    else: mine.append((f"You are {rec} all time with no title yet, {c['podiums']} podium{'s' if c['podiums']!=1 else ''}", f"how close has {o} come to a title"))
    mine.append((f"Your best season: {c['bestSeason']['year']} at {c['bestSeason']['wins']}-{c['bestSeason']['losses']} ({c['bestSeason']['team']})", f"what was {o}'s best season"))
    mine.append((f"Your worst season: {c['worstSeason']['year']} at {c['worstSeason']['wins']}-{c['worstSeason']['losses']} ({c['worstSeason']['team']})", f"what was {o}'s worst season"))
    mine.append((f"Your best week: {s['highestWeek']}", f"what is {o}'s highest scoring week"))
    mine.append((f"You are {s['closeGameRecordUnder5']} in games decided by under 5", f"what is {o}'s record in close games"))
    luck = s['luck']; mine.append((f"Luck check: you are {luck:+} wins versus your all-play record ({s['allPlayRecord']})", f"is {o} lucky or unlucky"))
    mine.append((f"You have left {s['benchPointsTotal']} points on the bench, {s['benchPointsPerWeek']} a week", f"how many bench points has {o} left"))
    rivals = sorted(h2h.get(o, {}).items(), key=lambda kv: -int(kv[1]['regularSeason'].split()[1].split('-')[0]) - int(kv[1]['regularSeason'].split()[1].split('-')[1]))
    for other, e in rivals[:3]:
        if other not in H['owners']: continue
        mine.append((f"You are {e['regularSeason'].split()[1]} against {other} in the regular season", f"what is {o}'s record against {other}"))
    worst_h2h = None
    for other, e in h2h.get(o, {}).items():
        w_, l_ = map(int, e['regularSeason'].split()[1].split('-'))
        if other in H['owners'] and l_ - w_ >= 2 and (worst_h2h is None or l_ - w_ > worst_h2h[1]): worst_h2h = (other, l_ - w_, e['regularSeason'].split()[1])
    if worst_h2h: mine.append((f"{worst_h2h[0]} owns you: {worst_h2h[2]} in the regular season", f"who does {o} struggle against the most"))
    out += [{"fact": f.replace('–', '-'), "ask": q, "owner": o} for f, q in mine]
open('attract-facts.js', 'w').write("// Real facts from the archive tables, cycled in the Ask the Archive box\n// while idle. Built by scripts/build-attract-facts.py.\nconst ATTRACT_FACTS = " + json.dumps(out, ensure_ascii=False) + ";\n")
print(f"wrote attract-facts.js with {len(out)} facts")
