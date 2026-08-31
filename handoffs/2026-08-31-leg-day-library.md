# Delivery: Leg day image library v1

Date: 2026-08-31
Branch: `codex/leg-day-image-library`
Status: ready for visual integration; trainer review pending for instructional use

## Delivered files

- `assets/images/leg-day/`: 20 individual square PNG originals, a visual catalog in `README.md`, and final generation prompts in `prompts.json`.
- `assets/manifest.json`: one entry per image, with stable exercise IDs, paths, equipment, dimensions, alt text, byte sizes, and review status.
- `assets/images/README.md`: collection structure and future coverage roadmap.

## Intended use

Leg-day selection cards and exercise detail illustrations. Preserve square aspect ratio and show the entire image using contain sizing, especially feet, bars, and benches. Keep names and instructions in accessible HTML. The current collection uses dark backgrounds with cyan/magenta lighting; the files have opaque backgrounds.

## Instructions for Claude

Fetch and review this branch, then merge into your current integration branch or main when appropriate. It includes the shared-folder setup and the main-branch UI/workflow updates through fc51360. Resolve any newer app changes normally; do not replace newer UI files with older versions.

1. Read the manifest and match by `exerciseId`, not array order. Only `collection: leg-day` belongs to this delivery. Add optional image fields to exercise definitions without changing workout selection or history behavior.
2. Suggested current-name mappings: Goblet Squat -> `goblet-squat`; Step-Ups -> `step-up`; Glute Bridge -> `glute-bridge`; Romanian Deadlift -> `romanian-deadlift` only when dumbbells are appropriate; Barbell Back Squat -> `barbell-back-squat`. Check actual workout names in the current code before mapping. Do not silently substitute equipment variants.
3. The reverse/forward lunge arrows represent direction; do not mirror these files. Their static bottom positions alone cannot communicate a full movement sequence.
4. Stiff-leg deadlift and Romanian deadlift are separate assets. The latter shows dumbbells. Hip thrust is bodyweight with a bench, while glute bridge is on the floor. The seated leg curl shows its starting position.
5. Originals total approximately 34 MB. Add optimized WebP derivatives and responsive sizes for production, preserve the originals, and record derivative paths in the manifest. Lazy-load offscreen cards; do not preload the whole set.
6. Use root-relative-to-repository paths without a leading slash so GitHub Pages project paths work. Show the exercise name even if an image fails to load. If adjacent text fully duplicates the image's accessible purpose, an empty alt attribute can avoid repetition.
7. Verify mobile and desktop layouts, image loading and failure behavior, keyboard navigation, and unchanged workout flows. Mark entries `integrated` only after actual integration.

## Verification and limitations

All 20 final outputs were visually inspected for recognizable exercise and equipment, and copied into the repository. PNG headers, square dimensions (1254 x 1254), unique IDs, file paths and inventory coverage are checked before delivery. One seated-leg-curl attempt was discarded because the lower roller was on the wrong side; the delivered version places it beneath the lower calves.

These are AI-generated illustrations, not professionally validated exercise instruction. All entries have `instructionalReview: pending-qualified-trainer-review`. Machine geometry is illustrative rather than a manufacturer's setup guide. Have a qualified trainer approve biomechanics and accompanying instructions before instructional release. No UI integration or live deployment was performed by this delivery.
