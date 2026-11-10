# Interactive phone tutorial maintenance

The desktop app `教程` is the user-facing source of truth for feature locations, step-by-step instructions, and the phone test checklist.

## Required update on every user-visible feature merge

1. Update `tutorial/tutorial.js`:
   - add an entry to `GUIDE_UPDATES` with the merge date and PR/feature summary;
   - revise or add the matching `GUIDES` entry with the exact in-app location and ordered steps;
   - add a practical test and expected result;
   - mark a feature as an issue only when a real report or a reproducible failure is known.
2. Update the desktop app directory when a new app tile or route is added.
3. Keep `sw.js` app-shell entries and its cache version in sync when tutorial assets change.
4. Add/update a contract assertion in `tests/tutorial-page-contract.test.mjs` whenever a new guide route is added.
5. Do not describe code presence, a green static test, or a deployment as real-device acceptance. Keep push delivery, background activity, and model-provider-dependent features explicitly unverified until exercised on a real phone.

The checklist and issue notes are stored locally under `maomao_tutorial_progress_v1`. They do not read or modify chat history, role profiles, or media collections.
