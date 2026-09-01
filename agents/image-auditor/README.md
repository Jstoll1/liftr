# Exercise Image Auditor

This repository agent crawls every exercise definition in `app.js` and checks the same body-part image folders the Liftr interface searches at runtime.

## Run it

```sh
node scripts/audit-exercise-images.js --write
```

It writes `reports/exercise-image-audit.md` for people and `reports/exercise-image-audit.json` for tools or image-generation workflows. Add `--fail-on-missing` when missing or invalid images should fail a CI job. Use `--json` to print machine-readable output.

## What it flags

- Missing JPEGs
- Empty files
- Directories at an expected image path
- Files without valid JPEG start and end markers

It suggests a body-part folder when it can infer one from the exercise name. The audit finds coverage gaps; generated exercise art still needs the source image, prompt record, manifest entry, app-ready JPEG, handoff, and qualified trainer review described in `assets/images/README.md`.
