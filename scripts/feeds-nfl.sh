#!/usr/bin/env bash
# NFL feeds, run by .github/workflows/feeds-nfl.yml (on main) from a
# checkout of the nfl branch: news and article picks, then ESPN's analysts'
# picks read in headless Chrome. Kept here so the NFL job can change without
# touching main.
set -e
SPORT=nfl node scripts/fetch-feeds.mjs
npm i --no-save --no-package-lock playwright@1.47.2 >/dev/null 2>&1
npx playwright install --with-deps chromium >/dev/null 2>&1
SPORT=nfl node scripts/espn-picks.mjs || echo "ESPN picks step failed; news kept"
