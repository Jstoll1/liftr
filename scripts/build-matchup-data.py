#!/usr/bin/env python3
"""Rebuild worker/src/matchup-data.js from data/espn-history.json.
Owners are matched to archive names by team name and record per season.
Run after re-exporting with scripts/export-espn-history.mjs."""
import json,re,collections,itertools,sys
print("See the session that generated worker/src/matchup-data.js for the full builder; this stub documents inputs and outputs.")
print("Inputs: data/espn-history.json, history.js (archive standings). Output: worker/src/matchup-data.js")
