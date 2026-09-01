# Leg day image library — v1

20 individual AI-generated exercise illustrations. Dark navy backgrounds and cyan/magenta lighting match Liftr's current visual style. These are recognition illustrations, not validated technique diagrams; qualified trainer review is required before presenting them as form guidance.

## Integration

Use `assets/manifest.json` for stable exercise IDs, names, equipment, dimensions, alt text and paths. Images are original square PNG files, not transparent cutouts. Preserve the full composition using `object-fit: contain`; do not crop off feet, weights or supports. Place exercise names in HTML, not in the image. Forward/reverse arrows are baked into those two lunge illustrations, so do not mirror them.

Use the exact equipment variant shown: goblet squat uses a kettlebell, Romanian deadlift uses dumbbells, hip thrust is bodyweight, and seated calf raise uses dumbbells. The seated leg curl depicts the starting position. These files do not automatically appear in the app.

PNG masters preserve generation metadata. Claude may add smaller WebP derivatives for delivery without replacing these originals; record derivative paths in the manifest. Load only visible cards and lazy-load the rest.

The exact final prompt for each image is in [prompts.json](prompts.json). Integration handoff: [2026-08-31-leg-day-library.md](../../../handoffs/2026-08-31-leg-day-library.md).

## Visual catalog

### Squats

| Exercise | Image | Equipment |
|---|---|---|
| Bodyweight squat | <img src="bodyweight-squat-v1.png" alt="Bodyweight squat" width="180"> | bodyweight |
| Goblet squat | <img src="goblet-squat-v1.png" alt="Goblet squat" width="180"> | kettlebell |
| Wall sit | <img src="wall-sit-v1.png" alt="Wall sit" width="180"> | wall |
| Barbell back squat | <img src="barbell-back-squat-v1.png" alt="Barbell back squat" width="180"> | barbell |

### Lunges

| Exercise | Image | Equipment |
|---|---|---|
| Reverse lunge | <img src="reverse-lunge-v1.png" alt="Reverse lunge" width="180"> | bodyweight |
| Walking Lunges | <img src="walking-lunges-v1.png" alt="Walking Lunges" width="180"> | bodyweight |
| Forward lunge | <img src="forward-lunge-v1.png" alt="Forward lunge" width="180"> | bodyweight |
| Step-up | <img src="step-up-v1.png" alt="Step-up" width="180"> | box |
| Bulgarian split squat | <img src="bulgarian-split-squat-v1.png" alt="Bulgarian split squat" width="180"> | bench |
| Lateral lunge | <img src="lateral-lunge-v1.png" alt="Lateral lunge" width="180"> | bodyweight |

### Hinges

| Exercise | Image | Equipment |
|---|---|---|
| Conventional deadlift | <img src="conventional-deadlift-v1.png" alt="Conventional deadlift" width="180"> | barbell |
| Stiff-leg deadlift | <img src="stiff-leg-deadlift-v1.png" alt="Stiff-leg deadlift" width="180"> | barbell |
| Romanian deadlift | <img src="romanian-deadlift-v1.png" alt="Romanian deadlift" width="180"> | dumbbells |
| Sumo deadlift | <img src="sumo-deadlift-v1.png" alt="Sumo deadlift" width="180"> | barbell |

### Glutes

| Exercise | Image | Equipment |
|---|---|---|
| Glute bridge | <img src="glute-bridge-v1.png" alt="Glute bridge" width="180"> | mat |
| Hip thrust | <img src="hip-thrust-v1.png" alt="Hip thrust" width="180"> | bench |

### Calves

| Exercise | Image | Equipment |
|---|---|---|
| Standing calf raise | <img src="standing-calf-raise-v1.png" alt="Standing calf raise" width="180"> | bodyweight |
| Seated calf raise | <img src="seated-calf-raise-v1.png" alt="Seated calf raise" width="180"> | dumbbells and bench |

### Machines

| Exercise | Image | Equipment |
|---|---|---|
| Leg press | <img src="leg-press-v1.png" alt="Leg press" width="180"> | leg press machine |
| Leg extension | <img src="leg-extension-v1.png" alt="Leg extension" width="180"> | leg extension machine |
| Seated leg curl | <img src="seated-leg-curl-v1.png" alt="Seated leg curl" width="180"> | seated leg curl machine |

