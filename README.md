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

Image folders now include `chest`, `back`, `legs`, `shoulders`, and `arms`. The current app routes chest/back, legs, cardio and core; Claude can add shoulder/arm routing when adding those workout types.

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

## Shared contribution folders

- `assets/images/`: finished images ready for Claude to use in the app.
- `assets/manifest.json`: image paths, descriptions, and integration status.
- `handoffs/`: instructions accompanying each content delivery.
- `assistant/`: plans and behavior specifications for the future in-app assistant; no runtime integration yet.

See [the collaboration guide](COLLABORATION.md) for ownership and delivery steps.

## Image library

54 exercise illustrations are included: 20 legs, 8 chest, 8 back, 8 shoulders, and 10 arms. App-ready JPEGs are in [images/](images/README.md); original PNGs, final prompts, and visual catalogs are in [assets/images/](assets/images/README.md).

Browse the [20-image leg-day collection](assets/images/leg-day/README.md), including its visual catalog and generation prompts. See the [collection roadmap](assets/images/README.md) for planned additions.
