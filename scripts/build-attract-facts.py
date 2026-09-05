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
open('attract-facts.js', 'w').write("// Real facts from the archive tables, cycled in the Ask the Archive box\n// while idle. Built by scripts/build-attract-facts.py.\nconst ATTRACT_FACTS = " + json.dumps(out, ensure_ascii=False) + ";\n")
print(f"wrote attract-facts.js with {len(out)} facts")
