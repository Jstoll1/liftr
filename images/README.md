# App-ready exercise images

These JPEGs match the existing app image loader. Originals and exact image metadata remain in `assets/images/` and `assets/manifest.json`; `webPath` points to each JPEG. All images are AI-generated illustrations pending qualified trainer review before use as form guidance.

Folders: `legs/`, `chest/`, `back/`, `shoulders/`, `arms/`, and `core/`. Leg-day originals are under `assets/images/leg-day/`; the app expects `images/legs/`.

JPEGs are resized to a maximum edge of 768 pixels with quality 80. Additional equivalent-name copies support existing workout names such as Push-Up Ladder, Dumbbell Chest Press, Cable Fly, Step-Ups, and Bodyweight Lunge. Weighted pull-ups, walking lunges, and exercises not depicted by this library retain the app's fallback icon; an unweighted image is not silently labeled as weighted.

The loader (`getExerciseImageCandidates` in `app.js`) tries every configured body-part folder using the exercise name and displays the first matching file. When adding another image folder, also add it to `IMAGE_BODY_PARTS` in `app.js` and `scripts/audit-exercise-images.js`.

## Audit missing exercise images

Run the repository image-audit agent after adding workouts or images:

```sh
node scripts/audit-exercise-images.js --write
```

It writes Markdown and JSON reports under `reports/`. See `agents/image-auditor/README.md` for details.
