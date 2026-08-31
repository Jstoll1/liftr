# liftr

A retro workout app for two lifters — Jessica and Jake. Static HTML/CSS/JS,
no build step; `index.html` is the entry point (works via GitHub Pages or
any static server).

## Adding exercise photos

The workout runner shows a small image tile for each exercise, and falls
back to an icon automatically if no image is found. To add real photos,
drop them into:

```
images/<body-part>/<slugified-exercise-name>.jpg
```

Body-part folders: `chest`, `back`, `legs`, `cardio`, `core`.

The slug is the exercise name lowercased, with anything that isn't a
letter/number turned into a single hyphen. For example:

- "Barbell Bench Press" → `images/chest/barbell-bench-press.jpg`
- "Romanian Deadlift" → `images/legs/romanian-deadlift.jpg`
- "Weighted Pull-Ups" → `images/back/weighted-pull-ups.jpg`

No manifest or code change needed — just get the filename right and commit
the image; the app requests it directly and quietly falls back to an emoji
icon if the file 404s.

## AI-powered workout planning

See `worker/README.md` for the Cloudflare Worker that lets ChatGPT pick
today's exercises (given your goal, time, energy, and any free-text notes)
instead of the built-in local rules.
