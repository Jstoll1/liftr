# App-ready exercise images

These JPEGs match the existing app image loader. Originals and exact image metadata remain in `assets/images/` and `assets/manifest.json`; `webPath` points to each JPEG. All images are AI-generated illustrations pending qualified trainer review before use as form guidance.

Folders: `legs/`, `chest/`, `back/`, `shoulders/`, `arms/`, and `core/`. Leg-day originals are under `assets/images/leg-day/`; the app expects `images/legs/`.

JPEGs are resized to a maximum edge of 768 pixels with quality 80. Additional equivalent-name copies support existing workout names such as Push-Up Ladder, Dumbbell Chest Press, Cable Fly, Step-Ups, and Bodyweight Lunge. Weighted pull-ups, walking lunges, and exercises not depicted by this library retain the app's fallback icon; an unweighted image is not silently labeled as weighted.

The loader (`getExerciseImageCandidates` in `app.js`) no longer guesses a
single folder — it tries every folder in this list, by exercise name alone,
and uses whichever one actually has a matching file. Adding a new folder
here means also adding it to `IMAGE_BODY_PARTS` in `app.js`, or the loader
will never look there. Run `node scripts/audit-exercise-images.js` anytime
to see which exercises in the app still have no matching photo, in any
folder.
