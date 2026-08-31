# Image inventory

Place finished images in `images/`. The manifest is a collaboration inventory; the app does not load it automatically.

For each delivery, add an object to the `images` array in `manifest.json`:

```json
{
  "id": "leg-day-card-v1",
  "path": "assets/images/leg-day-card-v1.webp",
  "alt": "Describe the actual image here",
  "width": 1200,
  "height": 800,
  "placement": "Leg day workout card",
  "status": "ready",
  "handoff": "handoffs/YYYY-MM-DD-workout-cards.md"
}
```

This example is not an existing asset. Record actual dimensions and use unique IDs. Paths are relative to the repository root; keep the `assets/` prefix without a leading slash so references work under a GitHub Pages project path. Status values are `ready`, `integrated`, and `retired`. Keep retired files while the app still references them. For decorative images use an empty alt string.
