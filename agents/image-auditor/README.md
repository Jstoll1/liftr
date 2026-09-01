# Exercise Image Auditor

This repository-native agent crawls Liftr's real JavaScript workout definitions and checks the exact JPEG path the app will request for every exercise.

## Run it

```sh
node scripts/audit-exercise-images.mjs --write
```

Reports are written to:

- `reports/exercise-image-audit.md`
- `reports/exercise-image-audit.json`

Add `--fail-on-missing` when a nonzero exit status is useful in CI.

## What it scans

- Base exercises for Jessica and Jake
- Finishers
- Partner exercises
- Special workout presets
- The app's actual body-part routing and filename slugging function

## What it flags

- Missing files
- Zero-byte files
- Paths that are not files
- Files at `.jpg` paths that do not have valid JPEG start/end markers

The audit treats a missing image as the reason an exercise displays the app's fallback icon. It does not judge exercise technique or anatomical accuracy. Generated exercise art still requires the source PNG, prompt record, manifest entry, app-ready JPEG, handoff, and qualified trainer review described in `assets/images/README.md`.
