# App-ready exercise images

These JPEGs match the existing app image loader. Originals and exact image metadata remain in `assets/images/` and `assets/manifest.json`; `webPath` points to each JPEG. All images are AI-generated illustrations pending qualified trainer review before use as form guidance.

Folders: `legs/`, `chest/`, `back/`, `shoulders/`, and `arms/`. Leg-day originals are under `assets/images/leg-day/`; the app expects `images/legs/`.

JPEGs are resized to a maximum edge of 768 pixels with quality 80. Additional equivalent-name copies support existing workout names such as Push-Up Ladder, Dumbbell Chest Press, Cable Fly, Step-Ups, and Bodyweight Lunge. Weighted pull-ups, walking lunges, and exercises not depicted by this library retain the app's fallback icon; an unweighted image is not silently labeled as weighted.

Claude: pull main. Use these paths directly. The current loader only routes chest/back, legs, cardio and core; add explicit mappings when introducing shoulder or arm workout screens. Files alone do not add new workout types.

## Audit missing exercise images

Run the repository image-audit agent after adding workouts or images:

```sh
node scripts/audit-exercise-images.mjs --write
```

It crawls `app.js`, applies the app's actual image routing, and writes Markdown and JSON reports under `reports/`. See `agents/image-auditor/README.md` for details.
