# Brochiefs head-to-head modal — implementation handoff (2026-10-18)

## Objective
Improve the existing H2H modal shown in the screenshot without altering scoring, picks, data contracts, or league behavior. Claude owns implementation per COLLABORATION.md. This handoff is a UI/behavior specification, not a deployed change.

## Current issues
- The 03 vs 06 score competes with avatars, max scores, and pick records.
- Game rows combine team, spread, points earned, actual NFL score and state without explicit headings.
- Live games and upcoming games are mixed among finals.
- Same-pick section is prominent despite having no differential impact.
- Footer "Nathan by 3. Jake has 9 in play where they split" lacks a precise comeback calculation.

## Target UI
1. Header: "HEAD TO HEAD" plus close control. Player cards in fixed left/right positions, strong score typography, a concise "NATHAN LEADS BY 3" status. Keep player colors cyan and magenta, dark retro backdrop, restrained pixel heading. Display current score, record, max/potential only when their meaning is explicitly labeled. Never assume screenshot sample numbers are live values.
2. Differential summary directly below: current lead, remaining differential points available, and computed path to victory (or mathematically eliminated/tie possibility). No hardcoded prose.
3. Games divided into LIVE, UPCOMING, FINAL in that order, with clear section counts. Within each group retain original game number/order unless a well-defined kickoff sort exists. Avoid claiming a game is live from score alone; use authoritative status field.
4. Every game row uses a stable 3-column grid: left player pick, center NFL matchup/status/score, right player pick. Each player pick displays team logo/name, pick type and spread, and earned points or pending points. A compact column legend makes +2 vs 0 vs potential unmistakable. Use typography and icons in addition to color.
5. Highlight games with different picks; optionally show a small "SWING" label or border. Use calm, compact treatment for settled rows and emphasize live undecided rows.
6. Same picks collapsed by default under "SAME PICK · NO SWING (N)" with an accessible expand/collapse toggle. Be precise: same team may still have different wager types or spreads; classify as no-swing only if outcome/points differential is guaranteed identical under actual scoring rules. If not provably identical, keep in differential list.
7. Responsive: on narrow phones maintain player left/right columns, abbreviate long team names intelligently, never truncate essential points, avoid horizontal overflow. On desktop cap modal width and ensure scroll area/close button work. Maintain minimum tap targets and visible focus styles.

## Path-to-victory calculation
- Reuse existing canonical scoring and settlement logic; never recompute points from NFL scores with new assumptions.
- For each remaining game, determine the attainable **net score differential** between these two users across all possible outcomes using existing point values and pick rules. Account for SU vs spread, ties/pushes, game cancellation, already locked/earned points, and any league tiebreaker if available.
- Show current lead, maximum attainable swing, and minimum net gain needed to tie or win. Do not double-count current live provisional points: distinguish *currently displayed provisional points* from *locked earned points* and model remaining outcomes consistently.
- If the existing data lacks the information required for mathematically correct projections, omit precise "needs X" copy and show "X points still in play" only when provable; otherwise label projections unavailable. Never present fabricated odds.
- Finalized matchup: show final winner/tie, no remaining path text.

## Acceptance tests
- Screenshot scenario: Jake 3, Nathan 6 => lead correctly reads Nathan +3; do NOT assert Jake needs 4 unless tie-break rules and remaining swing support it.
- Game statuses: live/upcoming/final and canceled/unknown cases; correct counts, sorting, and display.
- SU and ATS picks; identical team with different wager type; pushes; same picks; pending games; score corrections; no games remaining.
- A game where live provisional scoring flips; projected path updates without double-counting.
- Narrow iPhone and desktop; long usernames, team names, accessibility keyboard/focus.
- Existing selection, scoring, auth, refresh, and admin behavior unchanged.

## Implementation boundaries
- Inspect current H2H rendering and CSS in app.js, styles.css, index.html and related modules before editing.
- Prefer targeted extraction of a renderer/component and CSS classes over broad refactors.
- No changes to backend contracts unless necessary and explicitly documented.
- Run existing checks/tests and provide before/after screenshots. Do not deploy automatically.
- Do not overwrite concurrent changes; rebase from latest main first.

## Handoff to Claude
"Read handoffs/2026-10-18-brochiefs-h2h-redesign.md and COLLABORATION.md. Implement the H2H redesign against latest main, preserving existing scoring and data contracts. Report changed files, tests, and screenshots; do not deploy until reviewed."
