# Style inventory: what makes Brochiefs look Retro

Status: the app ships **Retro only**. Pro is paused (`trial=false` in the
loader in `index.html`); it still runs on the preview site. This file lists
every place the Retro look lives, so a swap later is a checklist, not a hunt.

Counts are from `styles.css` + `history.css` (8,980 lines) on 2026-10-27.

## 1. Design tokens (already swappable)

Defined once in `:root` (`styles.css`). A theme that redefines these changes
everything that uses them (2,068 `var(--…)` uses, 895 of them `--neon-*`).

| Token | Retro | Pro (`themes/pro.css`) |
|---|---|---|
| `--bg` | `#0a0014` deep purple black | `#0b0d10` graphite |
| `--bg2` | `#150024` | `#0b0d10` |
| `--card-bg` | `rgba(21,0,36,.75)` | `--s1 #111418` |
| `--card-border` | `rgba(193,60,255,.35)` purple | `--line #232830` hairline |
| `--neon-pink` | `#ff2079` | `--loss #ff5d5d` |
| `--neon-cyan` | `#05d9e8` | `--acc #d4ae68` gold (choice) |
| `--neon-purple` | `#c13cff` | neutral `--line2` |
| `--neon-yellow` | `#ffe45e` | `--acc` gold |
| `--neon-green` | `#39ff88` | `--win #2ecf7a` |
| `--text` / `--text-dim` / `--text-meta` | `#f4f0ff` / `#9a8bb8` / `#b4a7cd` | `#eef0f3` / `#9aa2ae` / `#b9c0ca` |

Pro adds surface steps (`--s1..--s3`, `--line`, `--line2`, `--t3`) and one
accent (`--acc`, `--acc-ink`, `--acc-soft`, `--on-acc`). Retro has no
equivalent for these yet: **add them to `:root` with Retro values first**,
then new code can use them in both looks.

## 2. Hard coded colour (the real swap cost)

Not behind a token, so a theme must override each rule:

- **300 distinct hex colours** and **91 distinct rgba bases**. Biggest:
  `#fff` 237, `#ffd23f` 71 (arcade gold, not a token), `#000` 66,
  `#ffe45e` 59, `#39ff88` 57, `#0a0414` 42, `#ff2079` 35, `#29e6ff` 30
  (a second cyan), `#ffb000` 28 (LED amber), `#07020f` 28.
- rgba of the neons written out by hand: yellow 181, cyan 170+26, pink 119,
  green 109, gold 78, purple 39.
- **Fix before a swap:** promote the repeat offenders to tokens
  (`--arcade-gold #ffd23f`, `--led #ffb000`, `--cyan-2 #29e6ff`,
  `--ink #0a0414`, `--ink-2 #07020f`) and glow alphas to
  `color-mix(in srgb, var(--neon-x) N%, transparent)`.

## 3. Signature effects

| Effect | Count | What it is | Pro answer |
|---|---|---|---|
| Neon `text-shadow` | 194 | glow on text | `none` |
| Glow `box-shadow` (`0 0 Npx`) | 280 | halos on cards, chips | soft drop shadow or none |
| Scanlines `repeating-linear-gradient` | 72 | CRT lines, often `::after` | hide the pseudo element |
| `steps()` animations | 71 | blink, pixel tick | static or eased |
| `@keyframes` | 94 | pops, sweeps, flicker | keep motion, drop flicker |
| `image-rendering: pixelated` | 7 | pixel turf, sprites | `auto` |
| Gradient frames (cyan to pink) | many, in `.wpx-card`, `.gc-cab`, `.gc-seg2` | arcade bezel | 1px `--line2` border |

## 4. Typography

| Face | Uses | Role | Pro |
|---|---|---|---|
| Press Start 2P | 511 css, 22 history | pixel labels, LED numbers, headings | Inter 600, letter spacing .04em |
| Orbitron | 79 css, 32 history, 1 js | ranks, scores | Inter 700 tabular nums |
| VT323 | 17 css, 10 js | terminal text (Path to Win) | Inter |
| Inter | 0 css, 22 js | only in Pro | body font |

Pixel fonts need **bigger sizes** in Inter: 6 to 8px pixel labels become
10 to 11px. Watch `font-size` on every swapped label.

## 5. Style that lives in JavaScript

- `app.js`: inline `style="…"` colours in templates, team accent colours,
  and colour literals (`#ffe45e`, `#ff2079`, `#05d9e8` x4 each,
  `#39ff88` x3, `#ffb000`, `#c13cff` x2, and others).
- Canvas drawing: `app.js` (2 contexts) and `gridcard.js` (the share card)
  paint Retro colours and fonts directly. **A CSS theme cannot reach these**;
  read colours from `getComputedStyle(document.documentElement)` instead.
- `history.js`, `ask-ui.js`, `lightning-ui.js` build their own markup with
  class names styled in `history.css` / `styles.css`.

## 6. Art and assets

Wordmark (`.home-logo-img`; Pro ships `themes/wordmark-pro.png`), award art
(`awardArt()`), `assets/fight-bg.webp`, `assets/grid-bg.png`, the boner skull
GIF, avatars. Retro art has no Pro version except the wordmark.

## 7. Components and where Pro stands

Class prefix: rule count, then Pro coverage today.

| Area | Prefixes (rules) | Pro |
|---|---|---|
| Header, nav, countdown | `home-`, `cd` 153, nav | done |
| Pick cards | `pick` 156, `picks` 196, `hz` 82, `game` 69 | done |
| Score cards | `bug` 147, `scorebug` 48, `bp` 39 | done |
| Leaderboard, standings | `ranking` 126, `rank` 124, `lb` 82, `rd` 136 | partial (`rd` not) |
| Gamecast, game info | `gc` 606, `ins` 306, `lv` 41, `ln` 77, `xp` 35 | done |
| Path to Win, odds | `pr` 108, `wpp` 87, `wpx` 62 | done (`wpp` partial) |
| Player card | `plc` 125 | done |
| Lock of the week | `lk` 262, `lotw` 131 | partial |
| Head to head | `h2h` 232, `h2x` 101, `h2c` 41, `sh` 136 | not started |
| Recap, week win | `recap` 174, `ww` 77, `rp` 87 | not started |
| Side pot, side bets | `sp` 112, `as`, `ssb` 151, `ssg` 79, `ssp` 40, `ss` 48 | not started |
| Lightning mode | `lt` 76 | not started |
| Polls, Ask | `poll` 92, `ask` | not started |
| Simulator, Game Box | `sim` 131, `gb` 36 | not started |
| Trivia, History | `history.css`, `hs` 57 | not started |
| Since you last looked | `since-` | done |
| Admin, console | `admin` 120, `ld` 199, `lvz` 127, `wi` 110, `con` 60 | skip (admin only) |

## 8. Swap plan, in order

1. Add the Pro only tokens (`--s1..3`, `--line*`, `--acc*`, `--win`,
   `--loss`) to `:root` with Retro values. Retro looks the same.
2. Replace the top hard coded colours (section 2) with tokens. Retro looks
   the same; Pro coverage jumps without new rules.
3. Move glows, scanlines and pixel fonts behind tokens
   (`--glow`, `--scan`, `--font-pixel`, `--font-num`) so Pro sets them to
   `none` / Inter in one place.
4. Canvas and JS colours read from CSS variables (section 5).
5. Then finish the "not started" rows in section 7 and restart the trial.

Rule for new work until then: **new UI uses tokens, never raw neon hex**,
so it already swaps.
