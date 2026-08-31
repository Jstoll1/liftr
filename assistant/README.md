# Future in-app assistant

This folder is reserved for public-safe behavior specifications and integration planning. No assistant is implemented yet.

Before implementation, decide with the user:

- What the assistant should help with, and what remains outside its scope.
- What workout context it can read and how users consent to sharing it.
- Which actions require explicit confirmation before changing app data.
- The request/response contract between Claude's chat interface and the backend.
- Loading, error, unavailable, and cancellation behavior.
- Where the backend runs and how authentication, cost limits, and secrets are managed.

Keep service API credentials on the backend, never in this static site's JavaScript or in Git. Final model and API choices remain undecided. Do not store private conversation histories here.
