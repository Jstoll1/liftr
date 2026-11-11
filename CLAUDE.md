# Working notes for Claude

## Design review before every push: BAD
Nothing ships (button, menu, strip, card, pop up) until it passes BAD at
phone width (390px) and, for shared pages, desktop width:

- **Balance**: weight spread evenly; no lone element floating in a big box,
  no heavy side and empty side.
- **Alignment**: text, icons and buttons share edges and centre lines; a
  header and its button sit on one row; lists line up in columns.
- **Deadspace**: no empty bands or padding with nothing in it; nothing
  wraps onto its own line leaving a gap; cards hug their content.
- **Odd counts stay balanced**: a grid of tiles must look balanced at every
  count. In a two-column grid an odd last tile centres under the pair above
  (never alone on the left); test with an odd count.

Screenshot the real component (every state: closed, open, empty, long text)
and look at it before committing. If it fails BAD, fix it first.

## Phones are always the phone layout
A phone (touch, longest side under 1000px; `html.phone`, `IS_PHONE` in
app.js) never gets a desktop layout, the /desktop pick sheet or any wide
screen rule, even held sideways. Vertical scroll and tap only: nothing
wider than the screen, no sideways scroll. Any new desktop feature must
check `!IS_PHONE` (JS) or sit behind `(hover: hover)` / `html:not(.phone)`
(CSS), and be tested with Playwright iPhone emulation (portrait and
landscape) before pushing.

## Keep the "SAVED" stamp on game cards
The "SAVED <day> <time>" line on each pick card stays: it is the user's
audit trail that a pick reached the league. Never hide or shorten it to
save space.

## Tick off fixes from a pasted friction log
When Jake pastes lines from the Live "Admin friction" log and a fix ships,
add one entry to `fixes.json` (main) in the same push:
`{ "k": "<dead-tap|rage|js-error|quick-exit>", "match": "<text from the line>", "at": <commit time in ms>, "commit": "<short sha>", "note": "<what changed>" }`.
Live then ticks every matching entry from before the fix; a repeat after it
stays open, which flags a fix that did not hold.

The same goes for a pasted health log brief ("Brochiefs CFB health log:
..."): add `{ "k": "<health kind, e.g. worker-fail, espn-fail, upstream-fail>",
"match": "<text from the entry, e.g. /auth>", "at": <commit time in ms>,
"commit": "<short sha>", "note": "<what changed>" }` to `fixes.json` in the
same push, and Live closes every matching health entry from before it.

## "Check Live"
`BROCHIEFS_KEY=… node scripts/live-brief.mjs` prints everything open on Live
(health, stuck moments, Ask the Chief misses; last 24h, filtered like Live).
When Jake says "check Live", run it, fix what it lists, and add the
`fixes.json` entries as above. Needs `BROCHIEFS_KEY` in the environment and
`liftr-ai.jhs797.workers.dev` allowed by its network policy. Never run it in
a GitHub Action and never commit its output.

## Retro arcade rules
Retro is the base look (`styles.css`; Pro overrides in `themes/pro.css`).
One look everywhere, a clean arcade, not a funhouse:

- **Background**: navy glass (`--bg`, `--bg2`, `--card-bg`).
- **Frames**: standard cards wear a thin subtle charcoal frame
  (`--card-border`), no glow. Purple (`--card-border-feature`) and gold
  are for featured content only; the one standout per screen glows (the
  replay champion, gold).
- **Corners**: Retro 10px radius. No chamfers.
- **Type**: pixel font (Press Start 2P) for kickers, headings and big
  numbers; body stays plain.
- **Colour, with meaning**: cyan = you / live / structure; green = right /
  won; pink = wrong / lost; gold = money / champion; purple = featured frames. Use
  the tokens in `:root` (`var(--neon-*)`, `rgba(var(--*-rgb), a)`), never
  raw hex in a Retro rule.
- **No boxes inside boxes**: stats sit on one line with thin dividers.
- **One block per component**: change a Retro rule where it lives (search
  `==== RETRO:`); never append another override layer below it.
- Run `node scripts/check-retro.mjs` before pushing style changes, and
  screenshot with animations finished (not disabled) so the check matches
  a real phone.

## Pushing to main: one deploy at a time
Every push to main starts a GitHub Pages deploy, and a new push cancels the
one still running. Before pushing again, check the last "pages build and
deployment" run (workflow 346657123) has finished. If its publish step times
out or fails, the site stays on the last good build: push a real change
(never an empty commit) to start a fresh deploy, then check it went green.
Check the run's head_sha too: Pages has built the commit before the one
just pushed, which leaves the site a push behind while showing green.

## Teach the Chief every new term
Ask Chief only knows what its prompt and tools tell it. When a feature adds
a name members will say (a stat, a line, a button, a pot), add one line to
the glossary in `weekChatSystem` (`worker/src/weekask.js`): what it means
and which tool has its numbers. Terms the Chief still doesn't know show on
Live as "UNKNOWN TERM"; add each to the glossary when you see it.

## Every team mention gets its logo
Anywhere a team is named on screen, show its logo with it. In a line of
text use `teamInline(name, espnId)` or `matchInline(game)` from app.js
(logo then name, sized to the text); cards and rows use their own logo
slot. Never print a bare team name in new UI. One logo per team per card:
if the card's art or an earlier line already shows that team, the name
stays plain text.
