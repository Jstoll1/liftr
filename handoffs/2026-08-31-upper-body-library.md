# Upper-body image delivery

Images live in `assets/images/chest/`, `assets/images/back/`, `assets/images/shoulders/`, and `assets/images/arms/`. The leg-day collection remains at `assets/images/leg-day/`.

The user requested that these assets be published on main so Claude can pull and reference them directly. This delivery changes assets and documentation only; it does not integrate them into the interface or change workflows.

## Claude integration

- Pull main before starting. Read `assets/manifest.json` for exact paths, unique exercise IDs, equipment, dimensions and alt text. Do not substitute equipment variants or use array positions as IDs.
- Reference paths such as `assets/images/chest/push-up-v1.png` from the root app page, without a leading slash for GitHub Pages compatibility.
- Keep image proportions and use contain sizing to preserve the athlete and equipment. Retain accessible exercise names in HTML. Some large machine frames extend to the image edge; do not crop further.
- PNG originals are large. Produce optimized WebP derivatives for production, record their paths, and lazy-load offscreen images. Keep versioned originals intact.
- These are AI-generated recognition illustrations, not validated exercise technique guidance. Trainer review is pending for every asset. Machine geometry and grip details require professional review before instructional use.
- Verify image loading on mobile and desktop without changing workout generation, history, or existing assistant behavior. Mark `status` as `integrated` only once actually used in the app.

Final prompts and visual catalogs accompany each collection when the full set is complete. During delivery, the manifest lists only files that already exist.
