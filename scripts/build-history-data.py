#!/usr/bin/env python3
"""Rebuild worker/src/history-data.js from the archive data in history.js:
season standings, precomputed career totals and league records.

    python3 scripts/build-history-data.py
"""
import json, re

A = json.loads(re.search(r'const A=(\{.*?\});\n', open('history.js').read(), re.S).group(1))
years = sorted(A["seasons"].keys())
R = lambda x: round(x, 2)

seasons = {}
for y, v in A["seasons"].items():
    st = [{"finish": i + 1, "owner": r[0], "team": r[1], "wins": r[2], "losses": r[3], "pointsFor": r[4], "pointsAgainst": r[5], "pfPerGame": r[6]} for i, r in enumerate(v[4])]
    for r in st:
        r["result"] = "champion" if r["owner"] == v[0] else "runner-up" if r["owner"] == v[1] else "third" if r["owner"] == v[2] else "no podium"
        r["winPct"] = round(r["wins"] / (r["wins"] + r["losses"]), 3)
    top = max(st, key=lambda r: r["pointsFor"]); low = min(st, key=lambda r: r["pointsFor"])
    bestrec = max(st, key=lambda r: (r["winPct"], r["wins"]))
    champ = [r for r in st if r["owner"] == v[0]][0]
    seasons[y] = {"champion": v[0], "runnerUp": v[1], "third": v[2], "recap": v[3], "teams": len(st),
        "championRecord": f'{champ["wins"]}-{champ["losses"]}',
        "bestRegularSeasonRecord": {"owner": bestrec["owner"], "wins": bestrec["wins"], "losses": bestrec["losses"], "wonTitle": bestrec["owner"] == v[0]},
        "topScorer": {"owner": top["owner"], "pointsFor": top["pointsFor"]}, "lowestScorer": {"owner": low["owner"], "pointsFor": low["pointsFor"]},
        "leagueTotalPoints": R(sum(r["pointsFor"] for r in st)), "leagueAvgPointsPerTeam": R(sum(r["pointsFor"] for r in st) / len(st)),
        "lastPlace": st[-1]["owner"], "standings": st}

careers = {}
for y in years:
    s = seasons[y]; n = len(s["standings"])
    for r in s["standings"]:
        c = careers.setdefault(r["owner"], {"owner": r["owner"], "active": r["owner"] in A["owners"], "seasonsPlayed": 0, "years": [], "wins": 0, "losses": 0, "pointsFor": 0.0, "pointsAgainst": 0.0,
            "titles": 0, "titleYears": [], "runnerUps": 0, "runnerUpYears": [], "thirds": 0, "thirdYears": [], "lastPlaceFinishes": 0, "lastPlaceYears": [],
            "topThreeFinishes": 0, "topThreeYears": [], "bottomThreeFinishes": 0, "bottomThreeYears": [], "finishesByYear": [],
            "winningSeasons": 0, "losingSeasons": 0, "topScorerSeasons": 0, "seasonLines": []})
        c["seasonsPlayed"] += 1; c["years"].append(int(y)); c["wins"] += r["wins"]; c["losses"] += r["losses"]
        c["pointsFor"] = R(c["pointsFor"] + r["pointsFor"]); c["pointsAgainst"] = R(c["pointsAgainst"] + r["pointsAgainst"])
        if r["result"] == "champion": c["titles"] += 1; c["titleYears"].append(int(y))
        if r["result"] == "runner-up": c["runnerUps"] += 1; c["runnerUpYears"].append(int(y))
        if r["result"] == "third": c["thirds"] += 1; c["thirdYears"].append(int(y))
        if r["finish"] == n: c["lastPlaceFinishes"] += 1; c["lastPlaceYears"].append(int(y))
        if r["finish"] <= 3: c["topThreeFinishes"] += 1; c["topThreeYears"].append(int(y))
        if r["finish"] >= n - 2: c["bottomThreeFinishes"] += 1; c["bottomThreeYears"].append(int(y))
        c["finishesByYear"].append(f'{y}:{r["finish"]}')
        if r["wins"] > r["losses"]: c["winningSeasons"] += 1
        if r["wins"] < r["losses"]: c["losingSeasons"] += 1
        if s["topScorer"]["owner"] == r["owner"]: c["topScorerSeasons"] += 1
        c["seasonLines"].append({"year": int(y), "team": r["team"], "wins": r["wins"], "losses": r["losses"], "finish": r["finish"], "result": r["result"], "pointsFor": r["pointsFor"], "pointsAgainst": r["pointsAgainst"], "pfPerGame": r["pfPerGame"]})

for o, c in careers.items():
    g = c["wins"] + c["losses"]; c["gamesPlayed"] = g; c["winPct"] = round(c["wins"] / g, 3)
    c["pointsForPerGame"] = round(c["pointsFor"] / g, 1); c["pointsAgainstPerGame"] = round(c["pointsAgainst"] / g, 1); c["pointDifferential"] = R(c["pointsFor"] - c["pointsAgainst"])
    c["podiums"] = c["titles"] + c["runnerUps"] + c["thirds"]; c["finals"] = c["titles"] + c["runnerUps"]
    c["firstSeason"] = min(c["years"]); c["lastSeason"] = max(c["years"])
    c["avgFinish"] = round(sum(l["finish"] for l in c["seasonLines"]) / len(c["seasonLines"]), 2)
    c["finishesByYear"] = " ".join(c["finishesByYear"])
    lines = c["seasonLines"]
    pct = lambda l: l["wins"] / (l["wins"] + l["losses"])
    c["bestSeason"] = max(lines, key=lambda l: (pct(l), l["wins"])); c["worstSeason"] = min(lines, key=lambda l: (pct(l), l["wins"]))
    c["highestScoringSeason"] = max(lines, key=lambda l: l["pointsFor"]); c["lowestScoringSeason"] = min(lines, key=lambda l: l["pointsFor"])
    c["yearsSinceLastTitle"] = (2025 - max(c["titleYears"])) if c["titleYears"] else None
    c["titleDroughtSeasons"] = (len([y for y in c["years"] if y > max(c["titleYears"])]) if c["titleYears"] else c["seasonsPlayed"])
    streak = 0; kind = None
    for l in reversed(lines):
        k = "winning" if l["wins"] > l["losses"] else "losing" if l["wins"] < l["losses"] else "even"
        if kind is None: kind = k
        if k != kind: break
        streak += 1
    c["currentStreak"] = {"type": kind, "seasons": streak, "through": c["lastSeason"]}
    del c["years"]

act = [c for c in careers.values() if c["active"]]
for key, desc in [("wins", True), ("winPct", True), ("pointsFor", True), ("pointsForPerGame", True), ("titles", True), ("podiums", True), ("pointsAgainst", True), ("avgFinish", False), ("lastPlaceFinishes", True), ("bottomThreeFinishes", True), ("topThreeFinishes", True)]:
    for i, c in enumerate(sorted(act, key=lambda c: c[key], reverse=desc)): c.setdefault("rankAmongActive", {})[key] = i + 1

allLines = [dict(l, owner=o) for o, c in careers.items() for l in c["seasonLines"]]
rec = lambda l: f'{l["wins"]}-{l["losses"]}'
pctr = lambda x: int(x["record"].split("-")[0]) / (int(x["record"].split("-")[0]) + int(x["record"].split("-")[1]))
league = {
    "seasonsCompleted": len(years), "firstSeason": int(years[0]), "latestSeason": int(years[-1]),
    "mostTitles": sorted([{"owner": o, "titles": c["titles"], "years": c["titleYears"]} for o, c in careers.items() if c["titles"]], key=lambda x: -x["titles"]),
    "mostCareerWins": sorted([{"owner": o, "wins": c["wins"], "record": f'{c["wins"]}-{c["losses"]}'} for o, c in careers.items()], key=lambda x: -x["wins"])[:5],
    "bestCareerWinPct": sorted([{"owner": o, "winPct": c["winPct"], "seasons": c["seasonsPlayed"]} for o, c in careers.items() if c["seasonsPlayed"] >= 3], key=lambda x: -x["winPct"])[:5],
    "mostCareerPoints": sorted([{"owner": o, "pointsFor": c["pointsFor"]} for o, c in careers.items()], key=lambda x: -x["pointsFor"])[:5],
    "bestCareerPointsPerGame": sorted([{"owner": o, "pointsForPerGame": c["pointsForPerGame"]} for o, c in careers.items()], key=lambda x: -x["pointsForPerGame"])[:5],
    "mostPodiums": sorted([{"owner": o, "podiums": c["podiums"]} for o, c in careers.items()], key=lambda x: -x["podiums"])[:5],
    "mostRunnerUpFinishes": sorted([{"owner": o, "runnerUps": c["runnerUps"], "years": c["runnerUpYears"]} for o, c in careers.items() if c["runnerUps"]], key=lambda x: -x["runnerUps"])[:5],
    "mostThirdPlaceFinishes": sorted([{"owner": o, "thirds": c["thirds"], "years": c["thirdYears"]} for o, c in careers.items() if c["thirds"]], key=lambda x: -x["thirds"])[:5],
    "mostLastPlaceFinishes": sorted([{"owner": o, "lastPlaceFinishes": c["lastPlaceFinishes"], "years": c["lastPlaceYears"]} for o, c in careers.items() if c["lastPlaceFinishes"]], key=lambda x: -x["lastPlaceFinishes"]),
    "mostBottomThreeFinishes": sorted([{"owner": o, "bottomThree": c["bottomThreeFinishes"], "years": c["bottomThreeYears"]} for o, c in careers.items() if c["bottomThreeFinishes"]], key=lambda x: -x["bottomThree"]),
    "mostTopThreeFinishes": sorted([{"owner": o, "topThree": c["topThreeFinishes"], "years": c["topThreeYears"]} for o, c in careers.items() if c["topThreeFinishes"]], key=lambda x: -x["topThree"]),
    "longestActiveTitleDrought": sorted([{"owner": o, "seasonsWithoutTitle": c["titleDroughtSeasons"], "lastTitle": max(c["titleYears"]) if c["titleYears"] else None} for o, c in careers.items() if c["active"]], key=lambda x: -x["seasonsWithoutTitle"])[:5],
    "bestSingleSeasonRecord": sorted([{"owner": l["owner"], "year": l["year"], "record": rec(l), "team": l["team"], "result": l["result"]} for l in allLines], key=lambda x: -pctr(x))[:5],
    "worstSingleSeasonRecord": sorted([{"owner": l["owner"], "year": l["year"], "record": rec(l), "team": l["team"]} for l in allLines], key=pctr)[:5],
    "highestSingleSeasonPoints": sorted([{"owner": l["owner"], "year": l["year"], "pointsFor": l["pointsFor"], "pfPerGame": l["pfPerGame"], "result": l["result"]} for l in allLines], key=lambda x: -x["pointsFor"])[:5],
    "lowestSingleSeasonPoints": sorted([{"owner": l["owner"], "year": l["year"], "pointsFor": l["pointsFor"]} for l in allLines], key=lambda x: x["pointsFor"])[:5],
    "bestRecordWithoutTitle": sorted([{"owner": l["owner"], "year": l["year"], "record": rec(l), "result": l["result"]} for l in allLines if l["result"] != "champion"], key=lambda x: -pctr(x))[:5],
    "worstRecordToWinTitle": sorted([{"owner": l["owner"], "year": l["year"], "record": rec(l)} for l in allLines if l["result"] == "champion"], key=pctr)[:3],
    "backToBackTitles": [{"owner": seasons[years[i]]["champion"], "years": [int(years[i]), int(years[i + 1])]} for i in range(len(years) - 1) if seasons[years[i]]["champion"] == seasons[years[i + 1]]["champion"]],
    "championsByYear": {y: seasons[y]["champion"] for y in years},
    "runnerUpsByYear": {y: seasons[y]["runnerUp"] for y in years},
    "ownersWithoutTitle": [o for o, c in careers.items() if c["active"] and not c["titles"]],
    "formerMembers": [o for o, c in careers.items() if not c["active"]],
    "note": "Head-to-head, weekly and playoff game data live in the matchups section.",
}
slim = {"commissioner": {"owner": "Andrew", "since": 2014, "note": "Andrew founded the BroChiefs in 2014 and has been commissioner every season since; he is the only person to hold the role."}, "owners": A["owners"], "leagueRecords": league, "careerTotals": careers, "seasons": seasons,
        "eras": [{"years": e[0], "name": e[1], "note": e[2]} for e in A["eras"]],
        "topTeamNames": [{"name": n[0], "owner": n[1], "year": n[2], "note": n[3]} for n in A["names"]],
        "formerMembers": [{"name": m[0], "years": m[1], "record": m[2], "line": m[3], "note": m[4]} for m in A["memoriam"]],
        "ownerNotes": A["copy"]}
open('worker/src/history-data.js', 'w').write("// League history dataset served to the archive Q&A route. Built from\n// history.js by scripts/build-history-data.py; regenerate when that changes.\nexport const HISTORY = " + json.dumps(slim, ensure_ascii=False, separators=(',', ':')) + ";\n")
print(f"wrote worker/src/history-data.js ({len(json.dumps(slim))} bytes)")
