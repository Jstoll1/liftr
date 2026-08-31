# Working together on Liftr

## Default responsibilities

Codex creates images, maintains their manifest entries, and writes content handoffs. Claude builds the interface and workflows in `index.html`, `styles.css`, and `app.js`, and integrates the delivered assets. The user can change this split at any time.

The `assistant/` folder is for future assistant planning. Agree on its UI/backend contract before either tool implements it. These folders do not install an assistant or change app behavior.

## Delivering images

1. Start from the latest `main`. Use a branch such as `codex/images-workout-cards` for each delivery.
2. Save only finished, optimized images in `assets/images/`. Use descriptive, lowercase names with hyphens and a version, such as `leg-day-card-v1.webp`. Do not rename or replace files already used by the interface; deliver a new version instead.
3. Add one entry per image to `assets/manifest.json`, following `assets/README.md`.
4. Add a dated handoff in `handoffs/` using its template. Include the exact paths, suggested placement, and any limitations.
5. Commit and push the branch. Share its name or pull request. Claude must fetch and check out that branch, or pull `main` after it is merged, before the assets are available locally. Pushing an unmerged branch does not update `main`.
6. Claude references the image path in the interface, checks its appearance on mobile and desktop, then updates the manifest status to `integrated`.

Keep UI changes and image deliveries in separate commits where practical. Avoid force pushes and concurrent changes to the same files. Each tool should use its own local checkout. Pulling or merging Git changes is what shares files between tools; folders alone do not synchronize them.

## Public repository precautions

Treat committed files as public and potentially accessible from the deployed site. Keep drafts and large source files outside this repository. Never commit API keys, private user data, personal reference photos without approval, or confidential prompts. A folder name does not provide access control.
