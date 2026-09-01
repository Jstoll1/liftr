# Complete exercise-image coverage handoff

The exercise-image audit reports 110 distinct exercises, 110 valid app-ready JPEGs, and zero missing or invalid paths.

## Existing images reused for equivalent workout names

- Barbell Bent Over Row → Bent-Over Barbell Row
- Barbell or EZ-Bar Preacher Curl → Preacher Curl
- Bench Press → Barbell Bench Press
- Bodyweight Squats → Bodyweight Squat
- Cable Crossover → Cable Fly
- Deadlift → Conventional Deadlift
- Dumbbell Bent-Over Lateral Raise → Bent-Over Reverse Fly
- Dumbbell Flye → Dumbbell Chest Fly
- Dumbbell Reverse Wrist Curl → Seated Reverse Wrist Curl
- Leg Curl → Seated Leg Curl
- Overhead Dumbbell Extension → Overhead Dumbbell Triceps Extension
- Plank → Forearm Plank
- Slow Lateral Lunge → Lateral Lunge
- Squat → Barbell Back Squat
- Barbell Shoulder Press → Standing Barbell Overhead Press

These are app-ready filename copies, so the existing browser and iOS image loader requires no alias logic or runtime fetch changes.

## New images

Sixty-four new exercise-specific source PNGs are under `assets/images/coverage/`. Their optimized JPEGs are in the app's existing body-part folders. Manifest entries retain generation provenance and qualified-trainer-review status.

Run `node scripts/audit-exercise-images.js --write --fail-on-missing` after adding or renaming exercises. A passing run means every exercise name resolves to a nonempty JPEG with valid start and end markers.
